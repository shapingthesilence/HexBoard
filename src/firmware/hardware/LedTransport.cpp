#include "LedTransport.h"
#include "LedFrameEncoding.h"
#include "LedBankState.h"
#include <initializer_list>
#include "HardwareConfig.h"
#include "hardware/clocks.h"
#include "hardware/dma.h"
#include "hardware/irq.h"
#include "hardware/pio.h"
#include "hardware/pio_instructions.h"
#include "hardware/sync.h"
#include "pico/platform.h"
#include <cstring>

namespace {
// 140 RGB pixels pack exactly into 105 words. Each phase begins with a bit count.
static_assert(LED_COUNT * 24 % 32 == 0, "LED stream must end on a word boundary");
constexpr unsigned kPayloadWords = LED_COUNT * 24 / 32;
constexpr unsigned kPhaseWords = 1 + kPayloadWords;
constexpr unsigned kCycleWords = 4 * kPhaseWords;
constexpr unsigned kBanks = 3;
uint32_t banks[kBanks][kCycleWords] = {};
alignas(4) uint32_t replayAddress = 0;
LedBankState bankState;
int dataChannel = -1;
int controlChannel = -1;
bool ready = false;
spin_lock_t* bankLock = nullptr;
PIO ledPio;
unsigned ledSm;
LedColor lastFrame[LED_COUNT];
uint8_t lastBits = 0;
uint16_t lastLimit = 0;

// Control completion means its read-address trigger has selected the next bank.
// Replay remains autonomous even while IRQs are masked for a flash write.
void __not_in_flash_func(ledControlIrq)() {
  uint32_t mask = 1u << controlChannel;
  if (!(dma_hw->ints0 & mask)) return;
  dma_hw->ints0 = mask;
  uint32_t lockState = spin_lock_blocking(bankLock);
  // A delayed/coalesced IRQ may arrive near another DMA restart. Only inspect
  // READ_ADDR with substantial payload remaining, so the autonomous control
  // channel cannot replace it while we acknowledge/publish. Otherwise replay
  // unchanged and retry at the next IRQ. 64 words leave >2ms at this wire rate.
  if (dma_hw->ch[dataChannel].transfer_count < 64 || !dma_channel_is_busy(dataChannel)) {
    spin_unlock(bankLock, lockState);
    return;
  }
  uintptr_t address = dma_hw->ch[dataChannel].read_addr;
  int selected = -1;
  for (unsigned bank = 0; bank < kBanks; ++bank) {
    uintptr_t begin = reinterpret_cast<uintptr_t>(banks[bank]);
    if (address >= begin && address < begin + sizeof(banks[bank])) {
      selected = bank;
      break;
    }
  }
  if (selected >= 0 && bankState.acknowledge(selected)) {
    __dmb();
    replayAddress = reinterpret_cast<uintptr_t>(banks[bankState.replay]);
  }
  spin_unlock(bankLock, lockState);
}

} // namespace

bool setupLedTransport() {
  if (ready) return true;
  // Ten clocks per bit at 8 MHz: T0H=.25us, T0L=1us, T1H=.75us,
  // T1L=.5us. Reset holds low for >=128us. PULL IFEMPTY also handles an
  // autopulled header without discarding it at a 32-bit payload boundary.
  const uint16_t instructions[] = {
    static_cast<uint16_t>(pio_encode_pull(true, true) | pio_encode_sideset(1, 0)), // 0
    static_cast<uint16_t>(pio_encode_out(pio_y, 32) | pio_encode_sideset(1, 0)), // 1 header
    static_cast<uint16_t>(pio_encode_out(pio_x, 1) | pio_encode_sideset(1, 0) | pio_encode_delay(2)), // 2
    static_cast<uint16_t>(pio_encode_jmp_not_x(5) | pio_encode_sideset(1, 1) | pio_encode_delay(1)), // 3
    static_cast<uint16_t>(pio_encode_jmp(6) | pio_encode_sideset(1, 1) | pio_encode_delay(3)), // 4
    static_cast<uint16_t>(pio_encode_nop() | pio_encode_sideset(1, 0) | pio_encode_delay(3)), // 5
    static_cast<uint16_t>(pio_encode_jmp_y_dec(2) | pio_encode_sideset(1, 0)), // 6
    static_cast<uint16_t>(pio_encode_set(pio_x, 31) | pio_encode_sideset(1, 0)), // 7
    // Side-set leaves four delay bits: 32 iterations * 32 cycles via two instructions.
    static_cast<uint16_t>(pio_encode_nop() | pio_encode_sideset(1, 0) | pio_encode_delay(15)), // 8
    static_cast<uint16_t>(pio_encode_jmp_x_dec(8) | pio_encode_sideset(1, 0) | pio_encode_delay(15)), // 9
  };
  const pio_program program = {instructions, 10, -1};
  int sm = -1;
  for (PIO candidate : {pio0, pio1}) {
    if (!pio_can_add_program(candidate, &program)) continue;
    sm = pio_claim_unused_sm(candidate, false);
    if (sm >= 0) { ledPio = candidate; break; }
  }
  if (sm < 0) return false;
  ledSm = sm;
  dataChannel = dma_claim_unused_channel(false);
  controlChannel = dma_claim_unused_channel(false);
  if (dataChannel < 0 || controlChannel < 0) {
    if (dataChannel >= 0) dma_channel_unclaim(dataChannel);
    if (controlChannel >= 0) dma_channel_unclaim(controlChannel);
    pio_sm_unclaim(ledPio, ledSm);
    return false;
  }
  int lockNumber = spin_lock_claim_unused(false);
  if (lockNumber < 0) {
    dma_channel_unclaim(dataChannel);
    dma_channel_unclaim(controlChannel);
    pio_sm_unclaim(ledPio, ledSm);
    return false;
  }
  bankLock = spin_lock_init(lockNumber);
  unsigned offset = pio_add_program(ledPio, &program);
  auto config = pio_get_default_sm_config();
  sm_config_set_wrap(&config, offset, offset + 9);
  sm_config_set_sideset(&config, 1, false, false);
  sm_config_set_sideset_pins(&config, LED_PIN);
  sm_config_set_out_shift(&config, false, true, 32);
  sm_config_set_fifo_join(&config, PIO_FIFO_JOIN_TX);
  sm_config_set_clkdiv(&config, clock_get_hz(clk_sys) / 8000000.0f);
  pio_gpio_init(ledPio, LED_PIN);
  pio_sm_set_consecutive_pindirs(ledPio, ledSm, LED_PIN, 1, true);
  pio_sm_init(ledPio, ledSm, offset, &config);
  for (unsigned bank = 0; bank < kBanks; ++bank) encodeLedBank(banks[bank], lastFrame, LED_COUNT, 2, 65535);
  replayAddress = reinterpret_cast<uintptr_t>(banks[0]);
  auto dataConfig = dma_channel_get_default_config(dataChannel);
  channel_config_set_transfer_data_size(&dataConfig, DMA_SIZE_32);
  channel_config_set_read_increment(&dataConfig, true);
  channel_config_set_write_increment(&dataConfig, false);
  channel_config_set_dreq(&dataConfig, pio_get_dreq(ledPio, ledSm, true));
  channel_config_set_chain_to(&dataConfig, controlChannel);
  dma_channel_configure(dataChannel, &dataConfig, &ledPio->txf[ledSm], banks[0], kCycleWords, false);
  auto controlConfig = dma_channel_get_default_config(controlChannel);
  channel_config_set_transfer_data_size(&controlConfig, DMA_SIZE_32);
  channel_config_set_read_increment(&controlConfig, false);
  channel_config_set_write_increment(&controlConfig, false);
  dma_channel_configure(controlChannel, &controlConfig, &dma_hw->ch[dataChannel].al3_read_addr_trig,
                        &replayAddress, 1, false);
  dma_channel_set_irq0_enabled(controlChannel, true);
  irq_add_shared_handler(DMA_IRQ_0, ledControlIrq, PICO_SHARED_IRQ_HANDLER_DEFAULT_ORDER_PRIORITY);
  irq_set_enabled(DMA_IRQ_0, true);
  ready = true;
  dma_start_channel_mask(1u << dataChannel);
  pio_sm_set_enabled(ledPio, ledSm, true);
  return true;
}

bool submitLedFrame(const LedColor* frame, uint8_t bits, uint16_t currentLimitMilliamps) {
  if (!ready) return false;
  if (bits < 8 || bits > 10) bits = 9;
  if (bits == lastBits && currentLimitMilliamps == lastLimit &&
      memcmp(lastFrame, frame, sizeof(lastFrame)) == 0) return true;
  int bank = -1;
  uint32_t irqState = spin_lock_blocking(bankLock);
  bank = bankState.available();
  spin_unlock(bankLock, irqState);
  if (bank < 0) return false;
  uint8_t phases = 1u << (bits - 8);
  encodeLimitedLedBank(banks[bank], frame, LED_COUNT, phases, currentLimitMilliamps);
  memcpy(lastFrame, frame, sizeof(lastFrame));
  lastBits = bits;
  lastLimit = currentLimitMilliamps;
  __dmb();
  irqState = spin_lock_blocking(bankLock);
  bankState.pending = bank;
  spin_unlock(bankLock, irqState);
  return true;
}

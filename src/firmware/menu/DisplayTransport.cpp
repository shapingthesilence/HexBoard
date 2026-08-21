#include "DisplayTransport.h"

namespace {
HexBoardDisplay* activeDisplay = nullptr;
}

extern "C" uint8_t hexboardDisplayByteCallback(u8x8_t* u8x8,
                                                uint8_t message,
                                                uint8_t argument,
                                                void* data) {
  if (!activeDisplay) {
    return u8x8_byte_arduino_hw_i2c(u8x8, message, argument, data);
  }
  return activeDisplay->handleByteMessage(u8x8, message, argument, data);
}

HexBoardDisplay::HexBoardDisplay(const u8g2_cb_t* rotation,
                                 uint8_t reset,
                                 uint8_t clock,
                                 uint8_t data)
  : U8G2() {
  activeDisplay = this;
  u8g2_Setup_sh1107_i2c_seeed_128x128_f(&u8g2,
                                         rotation,
                                         hexboardDisplayByteCallback,
                                         u8x8_gpio_and_delay_arduino);
  u8x8_SetPin_HW_I2C(getU8x8(), reset, clock, data);
}

uint8_t HexBoardDisplay::i2cAddress() {
  return static_cast<uint8_t>(u8x8_GetI2CAddress(getU8x8()) >> 1);
}

void HexBoardDisplay::enableAsyncTransfers() {
  // Transfers before this point are blocking, so the framebuffer is also an
  // exact mirror of the image currently held by the display controller.
  memcpy(displayedFrame_.data(), getBufferPtr(), displayedFrame_.size());
  // The async Wire path does not pass through U8g2's START_TRANSFER callback,
  // so apply the configured 1 MHz bus clock explicitly before DMA takes over.
  Wire.setClock(getBusClock());
  asyncTransfersEnabled_ = true;
}

void HexBoardDisplay::sendBuffer() {
  if (!asyncTransfersEnabled_) {
    U8G2::sendBuffer();
    return;
  }
  frameQueued_ = true;
  serviceTransfer();
}

void HexBoardDisplay::sendBufferAndWait() {
  if (!asyncTransfersEnabled_) {
    U8G2::sendBuffer();
    return;
  }

  sendBuffer();
  constexpr uint32_t DISPLAY_DRAIN_TIMEOUT_MICROS = 250000;
  const uint32_t startedAt = micros();
  while (!readyForNavigationInput()
         && static_cast<uint32_t>(micros() - startedAt) < DISPLAY_DRAIN_TIMEOUT_MICROS) {
    serviceTransfer();
    tight_loop_contents();
  }

  if (!readyForNavigationInput()) {
    // A terminal screen is more important than preserving the async transport.
    // Recover with the library's bounded blocking path if DMA did not drain.
    Wire.abortAsync();
    Wire.end();
    Wire.begin();
    asyncTransfersEnabled_ = false;
    U8G2::sendBuffer();
  }
}

bool HexBoardDisplay::readyForNavigationInput() {
  if (!asyncTransfersEnabled_) {
    return true;
  }
  return !frameActive_
         && !frameQueued_
         && !contrastPending_
         && !powerSavePending_
         && Wire.finishedAsync()
         && Wire.busIdle();
}

void HexBoardDisplay::setPowerSave(uint8_t isEnable) {
  if (!asyncTransfersEnabled_) {
    U8G2::setPowerSave(isEnable);
    return;
  }
  requestedPowerSave_ = isEnable ? 1 : 0;
  powerSavePending_ = true;
  serviceTransfer();
}

void HexBoardDisplay::setContrast(uint8_t value) {
  if (!asyncTransfersEnabled_) {
    U8G2::setContrast(value);
    return;
  }
  requestedContrast_ = value;
  contrastPending_ = true;
  serviceTransfer();
}

uint8_t HexBoardDisplay::handleByteMessage(u8x8_t* u8x8,
                                           uint8_t message,
                                           uint8_t argument,
                                           void* data) {
  if (!asyncTransfersEnabled_) {
    return u8x8_byte_arduino_hw_i2c(u8x8, message, argument, data);
  }

  switch (message) {
    case U8X8_MSG_BYTE_START_TRANSFER:
      callbackPacketLength_ = 0;
      return 1;
    case U8X8_MSG_BYTE_SEND: {
      const auto* bytes = static_cast<const uint8_t*>(data);
      const uint8_t available = static_cast<uint8_t>(callbackPacket_.size() - callbackPacketLength_);
      const uint8_t copyLength = std::min(argument, available);
      memcpy(callbackPacket_.data() + callbackPacketLength_, bytes, copyLength);
      callbackPacketLength_ = static_cast<uint8_t>(callbackPacketLength_ + copyLength);
      return 1;
    }
    case U8X8_MSG_BYTE_END_TRANSFER:
      if (callbackPacketLength_ >= 2 && callbackPacket_[0] == 0x00) {
        for (uint8_t i = 1; i < callbackPacketLength_; ++i) {
          if ((callbackPacket_[i] & 0xF0) == 0xB0) {
            callbackPage_ = static_cast<uint8_t>(callbackPacket_[i] & 0x0F);
            callbackPageBytes_ = 0;
          }
        }
      } else if (callbackPacketLength_ >= 2
                 && callbackPacket_[0] == 0x40
                 && callbackPage_ < DISPLAY_PAGE_COUNT) {
        callbackPageBytes_ = static_cast<uint16_t>(
          callbackPageBytes_ + callbackPacketLength_ - 1);
        if (callbackPageBytes_ >= DISPLAY_PAGE_BYTES) {
          if (callbackPage_ == DISPLAY_PAGE_COUNT - 1) {
            sendBuffer();
          }
          callbackPage_ = 0xFF;
          callbackPageBytes_ = 0;
        }
      }
      callbackPacketLength_ = 0;
      return 1;
    case U8X8_MSG_BYTE_SET_DC:
      return 1;
    default:
      return u8x8_byte_arduino_hw_i2c(u8x8, message, argument, data);
  }
}

void HexBoardDisplay::beginQueuedFrame() {
  memcpy(frameSnapshot_.data(), getBufferPtr(), frameSnapshot_.size());
  frameQueued_ = false;
  pendingPageMask_ = 0;
  for (uint8_t page = 0; page < DISPLAY_PAGE_COUNT; ++page) {
    const size_t offset = static_cast<size_t>(page) * DISPLAY_PAGE_BYTES;
    uint8_t start = 0;
    while (start < DISPLAY_PAGE_BYTES
           && frameSnapshot_[offset + start] == displayedFrame_[offset + start]) {
      ++start;
    }
    if (start >= DISPLAY_PAGE_BYTES) {
      dirtyColumnStart_[page] = 0;
      dirtyColumnEnd_[page] = 0;
      continue;
    }

    uint8_t end = DISPLAY_PAGE_BYTES;
    while (end > start
           && frameSnapshot_[offset + end - 1] == displayedFrame_[offset + end - 1]) {
      --end;
    }
    dirtyColumnStart_[page] = start;
    dirtyColumnEnd_[page] = end;
    pendingPageMask_ |= static_cast<uint16_t>(1u << page);
  }
  frameActive_ = pendingPageMask_ != 0;
  nextPage_ = 0;
}

void HexBoardDisplay::commitCompletedPage() {
  if (activePage_ >= DISPLAY_PAGE_COUNT) {
    return;
  }
  const size_t offset = static_cast<size_t>(activePage_) * DISPLAY_PAGE_BYTES;
  memcpy(displayedFrame_.data() + offset,
         frameSnapshot_.data() + offset,
         DISPLAY_PAGE_BYTES);
  activePage_ = DISPLAY_PAGE_COUNT;
}

bool HexBoardDisplay::startPendingControlTransfer() {
  size_t length = 1;
  transferPacket_[0] = 0x00;  // The remaining bytes are SH1107 commands.
  if (contrastPending_) {
    transferPacket_[length++] = 0x81;
    transferPacket_[length++] = requestedContrast_;
  }
  if (powerSavePending_) {
    transferPacket_[length++] = requestedPowerSave_ ? 0xAE : 0xAF;
  }
  if (length == 1) {
    return false;
  }
  if (!Wire.writeAsync(i2cAddress(), transferPacket_.data(), length)) {
    return false;
  }
  contrastPending_ = false;
  powerSavePending_ = false;
  return true;
}

bool HexBoardDisplay::startNextFrameTransfer() {
  while (nextPage_ < DISPLAY_PAGE_COUNT
         && (pendingPageMask_ & static_cast<uint16_t>(1u << nextPage_)) == 0) {
    ++nextPage_;
  }
  if (nextPage_ >= DISPLAY_PAGE_COUNT) {
    return false;
  }

  const uint8_t page = nextPage_;
  const uint8_t startColumn = dirtyColumnStart_[page];
  const uint8_t endColumn = dirtyColumnEnd_[page];
  const size_t dataLength = static_cast<size_t>(endColumn - startColumn);
  const uint8_t x = static_cast<uint8_t>(getU8x8()->x_offset + startColumn);
  // Co=1 command control bytes allow the column and page commands to share the
  // transaction. The final Co=0/D-C=1 byte switches the remainder to data.
  transferPacket_[0] = 0x80;
  transferPacket_[1] = static_cast<uint8_t>(0x10 | (x >> 4));
  transferPacket_[2] = 0x80;
  transferPacket_[3] = static_cast<uint8_t>(x & 0x0F);
  transferPacket_[4] = 0x80;
  transferPacket_[5] = static_cast<uint8_t>(0xB0 | page);
  transferPacket_[6] = 0x40;
  memcpy(transferPacket_.data() + DISPLAY_PAGE_PACKET_PREFIX_BYTES,
         frameSnapshot_.data() + (static_cast<size_t>(page) * DISPLAY_PAGE_BYTES) + startColumn,
         dataLength);

  if (!Wire.writeAsync(i2cAddress(),
                       transferPacket_.data(),
                       DISPLAY_PAGE_PACKET_PREFIX_BYTES + dataLength)) {
    return false;
  }

  pendingPageMask_ &= static_cast<uint16_t>(~(1u << page));
  activePage_ = page;
  ++nextPage_;
  return true;
}

void HexBoardDisplay::serviceTransfer() {
  if (!asyncTransfersEnabled_) {
    return;
  }
  if (!Wire.finishedAsync() || !Wire.busIdle()) {
    return;
  }

  commitCompletedPage();

  if (frameActive_ && pendingPageMask_ == 0) {
    frameActive_ = false;
  }

  if (frameActive_) {
    startNextFrameTransfer();
    return;
  }

  if (contrastPending_ || powerSavePending_) {
    startPendingControlTransfer();
    return;
  }

  if (frameQueued_) {
    beginQueuedFrame();
    if (!frameActive_) {
      return;
    }
    startNextFrameTransfer();
    return;
  }
}

#pragma once

#include "../FirmwareModule.h"

class HexBoardDisplay final : public U8G2 {
public:
  explicit HexBoardDisplay(const u8g2_cb_t* rotation,
                           uint8_t reset = U8X8_PIN_NONE,
                           uint8_t clock = U8X8_PIN_NONE,
                           uint8_t data = U8X8_PIN_NONE);

  // Snapshot and coalesce the current U8g2 framebuffer. Core 0 returns after
  // the copy; serviceTransfer() advances the physical I2C transfer with DMA.
  void enableAsyncTransfers();
  void sendBuffer();
  void sendBufferAndWait();
  void serviceTransfer();
  bool readyForNavigationInput();

  // Runtime display-control commands share the asynchronous I2C transport so
  // they cannot collide with a framebuffer transfer already in progress.
  void setPowerSave(uint8_t isEnable);
  void setContrast(uint8_t value);

  uint8_t handleByteMessage(u8x8_t* u8x8,
                            uint8_t message,
                            uint8_t argument,
                            void* data);

private:
  static constexpr uint8_t DISPLAY_PAGE_COUNT = 16;
  static constexpr size_t DISPLAY_PAGE_BYTES = 128;
  static constexpr size_t DISPLAY_FRAME_BYTES = DISPLAY_PAGE_COUNT * DISPLAY_PAGE_BYTES;
  static constexpr size_t DISPLAY_PAGE_PACKET_PREFIX_BYTES = 7;
  static constexpr size_t DISPLAY_PAGE_PACKET_BYTES =
    DISPLAY_PAGE_PACKET_PREFIX_BYTES + DISPLAY_PAGE_BYTES;

  std::array<uint8_t, DISPLAY_FRAME_BYTES> frameSnapshot_ = {};
  std::array<uint8_t, DISPLAY_FRAME_BYTES> displayedFrame_ = {};
  std::array<uint8_t, DISPLAY_PAGE_PACKET_BYTES> transferPacket_ = {};
  bool frameQueued_ = false;
  bool frameActive_ = false;
  uint16_t pendingPageMask_ = 0;
  std::array<uint8_t, DISPLAY_PAGE_COUNT> dirtyColumnStart_ = {};
  std::array<uint8_t, DISPLAY_PAGE_COUNT> dirtyColumnEnd_ = {};
  uint8_t nextPage_ = 0;
  uint8_t activePage_ = DISPLAY_PAGE_COUNT;
  bool powerSavePending_ = false;
  bool contrastPending_ = false;
  bool asyncTransfersEnabled_ = false;
  uint8_t requestedPowerSave_ = 0;
  uint8_t requestedContrast_ = 0;
  std::array<uint8_t, 32> callbackPacket_ = {};
  uint8_t callbackPacketLength_ = 0;
  uint8_t callbackPage_ = 0xFF;
  uint16_t callbackPageBytes_ = 0;

  void beginQueuedFrame();
  void commitCompletedPage();
  bool startNextFrameTransfer();
  bool startPendingControlTransfer();
  uint8_t i2cAddress();
};

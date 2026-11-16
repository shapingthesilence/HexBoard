#pragma once

// Protected by the transport's hardware spinlock. Only one producer may encode
// at a time; DMA can select replay while the IRQ is delayed or masked.
struct LedBankState {
  int current = 0;
  int replay = 0;
  int pending = -1;

  int available() const {
    if (pending >= 0) return -1;
    for (int bank = 0; bank < 3; ++bank) {
      if (bank != current && bank != replay) return bank;
    }
    return -1;
  }
  bool acknowledge(int selected) {
    current = selected;
    if (pending < 0) return false;
    replay = pending;
    pending = -1;
    return true;
  }
};

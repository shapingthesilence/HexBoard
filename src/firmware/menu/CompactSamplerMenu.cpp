#include "CompactSamplerMenu.h"
#include "VirtualListMenu.h"
#include "MenuAndDisplay.h"
#include "../synth/SynthAudio.h"

namespace {
char names[32][32];
uint8_t slots[32], count = 0;
uint16_t rows(void*) { return count + 1; }
bool label(void*, uint16_t i, char* out, size_t n) {
  if (i > count) return false;
  snprintf(out, n, "%s", i ? names[i - 1] : "Wavetable engine"); return true;
}
bool current(void*, uint16_t i) { return i ? compactSamplerSlot() == slots[i - 1] : !compactSamplerActive(); }
bool initial(void*, uint16_t* i) { for (*i = 0; *i <= count; ++*i) if (current(nullptr, *i)) return true; *i = 0; return true; }
void select(void*, uint16_t i) { if (i <= count) selectCompactSampler(i ? slots[i - 1] : 255); redrawVirtualListMenu(); }
void close(void*) { menuSynthOptionsHome(); }
bool back(void*) { close(nullptr); return true; }
}
void openCompactSamplerMenu() {
  count = 0;
  for (uint8_t slot = 0; slot < 32; ++slot) {
    uint32_t bytes;
    if (compactSamplerFileInfo(slot, names[count], sizeof(names[count]), bytes)) slots[count++] = slot;
  }
  VirtualListMenuProvider p;
  p.title = "Sampler / Engine"; p.getCount = rows; p.getLabel = label;
  p.isCurrent = current; p.getInitialSelection = initial; p.select = select; p.back = back; p.close = close;
  openVirtualListMenu(p);
}

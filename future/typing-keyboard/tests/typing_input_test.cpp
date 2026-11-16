#include "../src/firmware/typing/TypingInput.h"
#include <cassert>
#include <cstdio>

int main() {
  uint8_t keys[typing::KeyCount][2] = {};
  typing::InputState input;
  keys[0][0] = keys[1][0] = 4; // Duplicate A mappings retain A until both release.
  keys[2][0] = 6; keys[2][1] = 1; // Ctrl+C
  keys[3][0] = 0xe0; // Physical Ctrl
  assert(input.event(0, true, keys));
  assert(input.event(0, false, keys));
  assert(input.pending() == 2 && input.front()[1] == 1);
  input.pop(); assert(input.front() == typing::Report{}); input.pop();
  input.event(0, true, keys); input.pop();
  input.event(1, true, keys); input.pop();
  input.event(0, false, keys); assert(input.front()[1] == 1); input.pop();
  input.event(1, false, keys); assert(input.front()[1] == 0); input.pop();
  input.event(3, true, keys); input.pop();
  input.event(2, true, keys); assert(input.front()[0] == 1 && input.front()[1] == 4); input.pop();
  input.event(2, false, keys); assert(input.front()[0] == 1 && input.front()[1] == 0); input.pop();
  input.event(3, false, keys); assert(input.front()[0] == 0); input.pop();
  // More than six simultaneous keys, including the highest supported usage.
  for (int i = 0; i < 12; ++i) { keys[i][0] = i + 4; keys[i][1] = 0; input.event(i, true, keys); input.pop(); }
  keys[12][0] = 0x73;
  input.event(12, true, keys);
  assert(input.front()[1] == 255 && input.front()[2] == 15 && input.front()[14] == 128);
  input.release(); assert(input.pending() == 1 && input.front() == typing::Report{});
  for (size_t i = 0; i < typing::KeyCount; ++i) assert(!input.held(i));
  input.pop();
  for (int i = 0; i < 32; ++i) assert(input.event(0, (i & 1) == 0, keys));
  assert(!input.event(0, true, keys));
  assert(input.pending() == 1 && input.front() == typing::Report{} && !input.held(0));
  // Press/release chatter is filtered; unsigned arithmetic tolerates timer wrap.
  typing::Debouncer debounce;
  assert(!debounce.update(0, true, 100));
  assert(!debounce.update(0, false, 1000));
  assert(!debounce.update(0, true, 1500));
  assert(!debounce.update(0, true, 6499));
  assert(debounce.update(0, true, 6500));
  assert(debounce.update(0, false, 6600));
  assert(debounce.update(0, true, 6700));
  assert(debounce.update(0, false, 6800));
  assert(!debounce.update(0, false, 11800));
  assert(!debounce.update(1, true, UINT32_MAX - 100));
  assert(debounce.update(1, true, 4900));
  std::puts("typing input: taps, duplicate keys/modifiers, NKRO, overflow, debounce, and timer wrap passed");
}

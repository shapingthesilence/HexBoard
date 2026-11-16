#include "../src/firmware/app/SerialDebugCommand.h"
#include <cassert>
#include <random>
#include <string>

int command(SerialDebugCommandParser& parser, const std::string& line) {
  for (auto byte : line) assert(parser.consume(byte) == SerialDebugCommandParser::NoCommand);
  return parser.consume('\n');
}

int main() {
  SerialDebugCommandParser parser;
  assert(command(parser, "HBDBG?") == SerialDebugCommandParser::Query);
  assert(command(parser, "HBAUD 1") == SerialDebugCommandParser::AudioTestStart);
  assert(command(parser, "HBAUD 0\r") == SerialDebugCommandParser::AudioTestStop);
  assert(command(parser, "HBAUD 2") == SerialDebugCommandParser::AudioTestPiezo);
  for (int flags = 0; flags <= 15; ++flags)
    assert(command(parser, "HBDBG " + std::to_string(flags)) == flags);
  for (const char* invalid : {"HBDBG", "HBDBG -1", "HBDBG 16", "HBDBG 99", "HBDBG 1x", "HBDBG 0 0", "HELLO"})
    assert(command(parser, invalid) == SerialDebugCommandParser::NoCommand);
  assert(command(parser, "HBDBG 13\r") == 13);
  std::mt19937 random(123);
  for (int trial = 0; trial < 100000; ++trial) {
    std::string oversized(9 + random() % 1024, 'X');
    assert(command(parser, oversized) == SerialDebugCommandParser::NoCommand);
    assert(command(parser, "HBDBG 13") == 13);
  }
  parser.consume('H');
  parser.reset();
  assert(command(parser, "HBDBG 0") == 0);
}

#include "dynamic_ji_runtime.h"
#include "tuning/DynamicJustIntonation.h"
#include "midi/NoteDispatch.h"
#include <chrono>
#include <stdexcept>

namespace {
void require(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}
void near(float actual, float expected, float tolerance = 0.003f) {
  if (!std::isfinite(actual) || std::abs(actual - expected) > tolerance) {
    std::fprintf(stderr, "actual %.7f, expected %.7f\n", actual, expected);
    throw std::runtime_error("pitch mismatch");
  }
}
void reset(bool dynamic = true, bool bpm = false, byte limit = 41) {
  for (auto& key : h) key = TestKey{};
  pressedKeyIDs.clear();
  useDynamicJustIntonation = dynamic; useJustIntonationBPM = bpm;
  dynamicJIRatioTable = limit;
  justIntonationBPM = 60; justIntonationBPM_Multiplier = 1;
  testReferenceHz = 440; testStepCents = 100;
  testPeriodCents = 1200; testCentsTable.clear();
  mpeLowestChannel = 2; mpeHighestChannel = 16; testChannelMask = 0xfffe;
  MPEpitchBendsNeeded = 255; MPEpitchBendSemis = 48;
  mpeChannelQueueActive = true; standardMidiMicrotonalActive = false;
  testReleaseSucceeds = true; testMidiEvents.clear();
  syncDynamicJIRatioCandidates();
}
void setSteps(byte key, int16_t steps) {
  h[key].stepsFromC = steps;
  h[key].frequency = stepsToFrequency(steps);
  h[key].midiPitch = stepsToMIDI(steps);
  h[key].note = static_cast<byte>(std::clamp<int>(std::lround(h[key].midiPitch), 0, 127));
  h[key].bend = pitchBendForMidiPitch(h[key].midiPitch, h[key].note);
}
void setMidi(byte key, int midi) { setSteps(key, midi - 69); }
void tune(byte key) { pressedKeyIDs.add(key); justIntonationRetune(key); }
float bpmExpected(byte key) {
  const float grid = static_cast<float>((justIntonationBPM / 60.0) * justIntonationBPM_Multiplier);
  if (!(grid > 0)) return 0;
  const double reference = std::round(testReferenceHz / grid);
  const double note = std::round(h[key].frequency / grid);
  if (!(reference > 0) || !(note > 0)) return 0;
  return -stepsToCentsFromReference(h[key].stepsFromC) - 1200 * std::log2(reference / note);
}
void finite(byte key) {
  require(std::isfinite(h[key].jiRetuneCents), "nonfinite cents");
  require(std::isfinite(h[key].jiFrequencyMultiplier) && h[key].jiFrequencyMultiplier > 0,
          "invalid frequency multiplier");
  require(h[key].jiRetune >= -8192 && h[key].jiRetune <= 8191, "bend out of range");
}
void anchor() {
  reset(); setMidi(0, 60); setMidi(1, 64); setMidi(2, 71);
  tryMIDInoteOn(0); tryMIDInoteOn(1);
  near(h[1].jiRetuneCents, 1200 * std::log2(1.25f) - 400);
  tryMIDInoteOff(0); tryMIDInoteOn(2);
  near(700 + h[2].jiRetuneCents - h[1].jiRetuneCents, 1200 * std::log2(1.5f));
  // A duplicate pitch inherits the anchor's correction as a unison.
  setMidi(3, 64); tryMIDInoteOn(3);
  near(h[3].jiRetuneCents, h[1].jiRetuneCents);
  // The interval bound precedes the inherited offset.
  reset(); setMidi(0, 60); setMidi(1, 64); tune(0);
  h[0].jiRetuneCents = 40; tune(1);
  near(h[1].jiRetuneCents, 40 + 1200 * std::log2(1.25f) - 400);
}
float foldCents(double cents) {
  return static_cast<float>(cents - 1200 * std::floor(cents / 1200));
}
bool allowedInteger(unsigned value, unsigned limit) {
  for (unsigned factor = 2; factor <= value; ++factor) {
    while (value % factor == 0) {
      if (factor > limit) return false;
      value /= factor;
    }
  }
  return true;
}
std::vector<float> allowedRatios(unsigned limit) {
  std::vector<float> result;
  // An independent rational oracle: integer ratios and powers of three.
  for (unsigned numerator = 1; numerator <= 64; ++numerator) {
    if (!allowedInteger(numerator, limit)) continue;
    for (unsigned denominator = 1; denominator <= 64; ++denominator) {
      if (allowedInteger(denominator, limit)) {
        result.push_back(foldCents(1200 * std::log2(double(numerator) / denominator)));
      }
    }
  }
  for (int exponent = -26; exponent <= 26; ++exponent) {
    result.push_back(foldCents(exponent * 1200 * std::log2(3.0)));
  }
  return result;
}
void rationalInterval(byte anchorKey, byte noteKey, const std::vector<float>& allowed) {
  const double original = 1200 * std::log2(double(h[noteKey].frequency) / h[anchorKey].frequency);
  const float interval = foldCents(original + h[noteKey].jiRetuneCents - h[anchorKey].jiRetuneCents);
  bool found = false;
  for (float candidate : allowed) {
    const float distance = std::abs(candidate - interval);
    if (std::min(distance, 1200 - distance) < 0.008f) { found = true; break; }
  }
  require(found, "output interval is not a ratio in the selected prime limit");
}
void ratios() {
  for (byte limit : {3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41}) {
    reset(true, false, limit);
    const auto allowed = allowedRatios(limit);
    setMidi(0, 60); setMidi(1, 64); tune(0); tune(1);
    near(h[1].jiRetuneCents, limit == 3 ? 1200 * std::log2(81.0f / 64) - 400
                                     : 1200 * std::log2(1.25f) - 400);
    pressedKeyIDs.remove(1); setMidi(1, 67); tune(1);
    near(h[1].jiRetuneCents, 1200 * std::log2(1.5f) - 700);
    for (float step : {100.0f, 1200.0f / 31, 1901.955f / 13}) {
      testStepCents = step;
      for (int base : {-40, 0, 40}) {
        setSteps(0, base); pressedKeyIDs.clear(); tune(0);
        for (int interval = -100; interval <= 100; ++interval) {
          setSteps(1, base + interval); pressedKeyIDs.add(1); justIntonationRetune(1);
          finite(1);
          rationalInterval(0, 1, allowed);
          require(std::abs(h[1].jiRetuneCents) <= std::max(step / 4, 23.47f) + 0.003f,
                  "unexpected large nearest-ratio correction");
          pressedKeyIDs.remove(1);
        }
      }
    }
  }
  reset(); setMidi(0, 0); setMidi(1, 127); tune(0); tune(1);
  near(h[1].jiRetuneCents, 1200 * std::log2(1.5f) - 700);
  // The sparse 3-limit table uses a Pythagorean chromatic interval.
  reset(true, false, 3); setMidi(0, 60); setMidi(1, 61); tune(0); tune(1);
  near(h[1].jiRetuneCents, 1200 * std::log2(256.0f / 243) - 100);
  // Nearest fallback, not the first dense candidate: a 31-EDO step is
  // closer to the two-comma interval than to the one-comma interval.
  reset(true, false, 3); testStepCents = 1200.0f / 31;
  setSteps(0, 0); setSteps(1, 1); tune(0); tune(1);
  near(testStepCents + h[1].jiRetuneCents,
       1200 * (24 * std::log2(3.0) - 38));
}
void registers() {
  for (byte limit : {3, 5, 7, 41}) {
    const auto allowed = allowedRatios(limit);
    for (float step : {100.0f, 1200.0f / 31, 1901.955000865f / 13}) {
      reset(true, false, limit); testStepCents = step;
      for (int anchorStep : {-27, 0, 19}) {
        setSteps(0, anchorStep); pressedKeyIDs.clear(); tune(0);
        for (int interval : {-80, -53, -26, -13, -1, 0, 1, 13, 26, 53, 80}) {
          setSteps(1, anchorStep + interval); tune(1); rationalInterval(0, 1, allowed);
          const float correction = h[1].jiRetuneCents;
          // Lifting either frequency by 2^n must preserve the correction,
          // regardless of this tuning's period or division count.
          for (int octaves : {-5, -1, 1, 5}) {
            h[1].frequency = std::ldexp(stepsToFrequency(anchorStep + interval), octaves);
            justIntonationRetune(1); near(h[1].jiRetuneCents, correction, 0.008f);
            rationalInterval(0, 1, allowed);
          }
          pressedKeyIDs.remove(1);
        }
      }
    }
  }
  // A tritave is represented as 3:1, not replaced with 2:1.
  reset(); testStepCents = 1200 * std::log2(3.0) / 13;
  setSteps(0, 0); setSteps(1, 13); tune(0); tune(1);
  near(h[1].jiRetuneCents, 0);
  near(1200 * std::log2(h[1].frequency * h[1].jiFrequencyMultiplier / h[0].frequency),
       1200 * std::log2(3.0));
}
void nonOctaveTable() {
  const auto allowed = allowedRatios(5);
  reset(true, true, 5);
  testPeriodCents = 1350;
  testCentsTable = {0, 73, 225, 410, 730, 1060, 1290};
  testStepCents = testPeriodCents / testCentsTable.size();
  setSteps(0, -7); tune(0); near(h[0].jiRetuneCents, bpmExpected(0));
  for (int steps = -40; steps <= 40; ++steps) {
    setSteps(1, steps); tune(1); finite(1); rationalInterval(0, 1, allowed);
    pressedKeyIDs.remove(1);
  }
}
void separation() {
  for (unsigned divisions : {12, 31, 53}) {
    reset(true, false, 3); testStepCents = 1200.0f / divisions;
    setSteps(0, 0); tune(0);
    float previous = -INFINITY;
    for (int steps = -static_cast<int>(divisions); steps <= static_cast<int>(divisions); ++steps) {
      setSteps(1, steps); tune(1);
      const float pitch = steps * testStepCents + h[1].jiRetuneCents;
      require(pitch > previous + 0.01f, "adjacent notes collapsed or crossed");
      previous = pitch; pressedKeyIDs.remove(1);
    }
  }
  // Even a very fine distinct interval must not become a unison with its anchor.
  reset(true, false, 3); testStepCents = 0.1f;
  setSteps(0, 0); setSteps(1, 1); tune(0); tune(1);
  require(std::abs(testStepCents + h[1].jiRetuneCents) > 0.01f, "small interval became unison");
}
void cache() {
  reset(); setMidi(0, 60); tune(0);
  for (int midi = 0; midi <= 127; ++midi) {
    setMidi(1, midi); pressedKeyIDs.add(1); testRatioCalls = 0;
    justIntonationRetune(1);
    require(testRatioCalls == 1, "per-candidate logarithms returned to note-on");
    pressedKeyIDs.remove(1);
  }
}
void invalidFrequencies() {
  for (bool bpmSync : {false, true}) {
    reset(true, bpmSync); setMidi(0, 60); tune(0); setMidi(1, 64);
    for (float frequency : {0.0f, INFINITY, std::numeric_limits<float>::quiet_NaN()}) {
      h[1].frequency = frequency;
      tune(1); finite(1); near(h[1].jiRetuneCents, 0);
      pressedKeyIDs.remove(1);
    }
  }
}
void bpm() {
  reset(false, true);
  for (int tempo = 1; tempo <= 255; ++tempo) {
    justIntonationBPM = tempo;
    for (int multiplier = 1; multiplier <= 255; ++multiplier) {
      justIntonationBPM_Multiplier = multiplier;
      for (int midi : {0, 12, 60, 69, 127}) {
        setMidi(0, midi); justIntonationRetune(0); finite(0);
        near(h[0].jiRetuneCents, bpmExpected(0));
      }
    }
  }
  // Defensive handling of invalid zero settings does not alter stored values.
  for (byte zeroField : {0, 1}) {
    justIntonationBPM = zeroField ? 60 : 0;
    justIntonationBPM_Multiplier = zeroField ? 0 : 1;
    justIntonationRetune(0); finite(0); near(h[0].jiRetuneCents, 0);
  }
  reset(false, true); testReferenceHz = 432; setMidi(0, 60);
  justIntonationRetune(0); near(h[0].jiRetuneCents, bpmExpected(0));
}
void combined() {
  reset(true, true); justIntonationBPM = 123; justIntonationBPM_Multiplier = 3;
  setMidi(0, 60); setMidi(1, 64); setMidi(2, 71);
  tune(0); near(h[0].jiRetuneCents, bpmExpected(0)); tune(1);
  near(h[1].jiRetuneCents - h[0].jiRetuneCents, 1200 * std::log2(1.25f) - 400);
  pressedKeyIDs.remove(0); tune(2);
  near(h[2].jiRetuneCents - h[1].jiRetuneCents, 1200 * std::log2(1.5f) - 700);
  reset(true, true, 3); setMidi(0, 60); setMidi(1, 61); tune(0); tune(1);
  near(h[1].jiRetuneCents - h[0].jiRetuneCents, 1200 * std::log2(256.0f / 243) - 100);
  reset(true, true); justIntonationBPM = 255; justIntonationBPM_Multiplier = 255;
  setMidi(0, 60); setMidi(1, 64); tune(0); tune(1); finite(0); finite(1);
  near(h[1].jiRetuneCents, 1200 * std::log2(1.25f) - 400);
}
void exhaustion() {
  reset(); mpeHighestChannel = 2; testChannelMask = 2;
  setMidi(0, 60); setMidi(1, 64); setMidi(2, 71);
  tryMIDInoteOn(0); tryMIDInoteOn(1);
  require(h[1].MIDIch == 0, "expected exhausted MIDI pool");
  require(pressedKeyIDs.contains(1), "synth-only note missing from anchor set");
  near(h[1].jiRetuneCents, 1200 * std::log2(1.25f) - 400);
  // Retrying allocation must not recalculate or insert the held note twice.
  const float saved = h[1].jiRetuneCents;
  tryMIDInoteOn(1); near(h[1].jiRetuneCents, saved);
  require(pressedKeyIDs.size() == 2, "duplicate held key");
  tryMIDInoteOff(0); tryMIDInoteOn(2);
  near(h[2].jiRetuneCents - saved, 1200 * std::log2(1.5f) - 700);
  tryMIDInoteOff(1);
  require(!pressedKeyIDs.contains(1), "synth-only release left an anchor");
  near(h[1].jiRetuneCents, 0); near(h[1].jiFrequencyMultiplier, 1);
  releaseActiveMidiNotesForRoutingReset();
  require(pressedKeyIDs.size() == 0 && h[2].MIDIch == 0, "routing reset left notes");
}
void lifecycle() {
  reset(false, false); setMidi(0, 60);
  h[0].jiRetuneCents = 99; h[0].jiFrequencyMultiplier = 2;
  tryMIDInoteOn(0); near(h[0].jiRetuneCents, 0); near(h[0].jiFrequencyMultiplier, 1);
  near(h[0].activePitchBend, h[0].bend);
  require(testMidiEvents.size() == 1, "missing note-on");
  const byte sent = testMidiEvents.back().note;
  h[0].note = 70;
  tryMIDInoteOff(0);
  require(testMidiEvents.back().note == sent && !testMidiEvents.back().on, "note-off changed note");
  reset(); setMidi(0, 60); setMidi(1, 64); tryMIDInoteOn(0); tryMIDInoteOn(1);
  testReleaseSucceeds = false; tryMIDInoteOff(0);
  require(!pressedKeyIDs.contains(0), "blocked MIDI release retained a physical anchor");
  require(h[0].MIDIch != 0, "blocked MIDI release lost retry state");
  testReleaseSucceeds = true; tryMIDInoteOff(0);
  require(h[0].MIDIch == 0 && !pressedKeyIDs.contains(0), "release retry failed");
  reset(); h[0].note = UNUSED_NOTE; tryMIDInoteOn(0);
  require(pressedKeyIDs.size() == 0, "invalid note became anchor");
  // Non-MPE MIDI stays static while the synth still receives JI.
  reset(); MPEpitchBendsNeeded = 1; setMidi(0, 60); setMidi(1, 64);
  tryMIDInoteOn(0); tryMIDInoteOn(1);
  near(h[1].jiRetuneCents, 1200 * std::log2(1.25f) - 400);
  require(h[1].activeMidiNote == h[1].note && h[1].activePitchBend == h[1].bend,
          "disabled MPE changed external tuning");
}
void midiPitch() {
  for (int range : {1, 2, 12, 48, 96}) {
    reset(); MPEpitchBendSemis = range; setMidi(0, 60); setMidi(1, 64); tune(0); tune(1);
    prepareActiveMidiPitch(1);
    const float actual = h[1].activeMidiNote + h[1].activePitchBend * range / 8192.0f;
    near(actual, h[1].midiPitch + h[1].jiRetuneCents / 100, range / 8192.0f);
    const float synthPitch = h[1].frequency * h[1].jiFrequencyMultiplier;
    near(1200 * std::log2(synthPitch / h[0].frequency), 1200 * std::log2(1.25f));
  }
}
volatile float benchmarkSink = 0;
void benchmark() {
  constexpr int iterations = 200000, rounds = 9;
  struct BenchmarkCase {
    const char* name;
    bool dynamic, bpm, vary;
    byte primeLimit;
    float stepCents;
    int16_t anchorSteps, noteSteps;
  };
  const BenchmarkCase cases[] = {
    {"off", false, false, true, 41, 100, -9, -5},
    {"dynamic", true, false, true, 41, 100, -9, -5},
    {"bpm", false, true, true, 41, 100, -9, -5},
    {"combined", true, true, true, 41, 100, -9, -5},
    {"3-limit gaps", true, false, true, 3, 100, -9, -5},
    {"wide registers", true, false, true, 41, 100, -69, 56},
    {"tritave", true, false, true, 41, 1901.955000865f / 13, 0, 26},
    {"53-EDO fallback", true, false, true, 3, 1200.0f / 53, 0, 1},
    {"unison", true, false, false, 41, 100, -9, -9},
  };
  for (auto test : cases) {
    reset(test.dynamic, test.bpm, test.primeLimit);
    testStepCents = test.stepCents;
    setSteps(0, test.anchorSteps); tune(0); setSteps(1, test.noteSteps); pressedKeyIDs.add(1);
    std::array<double, rounds> times;
    uint64_t calls = 0;
    for (int round = 0; round < rounds; ++round) {
      testRatioCalls = 0;
      const auto start = std::chrono::steady_clock::now();
      for (int i = 0; i < iterations; ++i) {
        h[1].stepsFromC = test.noteSteps + (test.vary ? i % 3 : 0);
        h[1].frequency = stepsToFrequency(h[1].stepsFromC);
        justIntonationRetune(1);
        benchmarkSink = h[1].jiRetuneCents;
      }
      times[round] = std::chrono::duration<double, std::nano>(std::chrono::steady_clock::now() - start).count() / iterations;
      calls = testRatioCalls;
    }
    std::sort(times.begin(), times.end());
    std::printf("BENCH %s: median %.1f ns/note, ratio conversions %.2f/note\n",
                test.name, times[rounds / 2], double(calls) / iterations);
  }
}
}  // namespace

int main(int argc, char** argv) {
  if (argc == 2 && std::string(argv[1]) == "benchmark") { benchmark(); return 0; }
  const std::pair<const char*, void(*)()> cases[] = {
    {"anchor", anchor}, {"ratios", ratios}, {"registers", registers},
    {"non-octave table", nonOctaveTable}, {"separation", separation}, {"cache", cache},
    {"invalid frequencies", invalidFrequencies},
    {"bpm", bpm}, {"combined", combined},
    {"exhaustion", exhaustion}, {"lifecycle", lifecycle}, {"midi", midiPitch}
  };
  int failures = 0;
  for (auto test : cases) {
    if (argc == 2 && test.first != std::string(argv[1])) continue;
    try { test.second(); std::printf("PASS dynamic JI %s\n", test.first); }
    catch (const std::exception& error) {
      std::fprintf(stderr, "FAIL dynamic JI %s: %s\n", test.first, error.what()); ++failures;
    }
  }
  return failures ? 1 : 0;
}

# HexBoard.ino — Code Documentation & Analysis

> **File:** `src/HexBoard.ino` | **Lines:** 6,479 | **License:** GPL v3 (2022–2025)
> **Hardware:** Generic RP2040 @ 133 MHz, 16 MB flash, NeoPixels, SH1107 OLED, rotary encoder, piezo + audio jack

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Includes & Platform Macros](#includes--platform-macros)
3. [Helper Functions](#helper-functions)
4. [Settings & Default Values](#settings--default-values)
5. [Microtonal Tuning System](#microtonal-tuning-system)
6. [Custom EDO Generator](#custom-edo-generator)
7. [Isomorphic Layout Definitions](#isomorphic-layout-definitions)
8. [Scale Definitions](#scale-definitions)
9. [Color / Palette System](#color--palette-system)
10. [Preset System](#preset-system)
11. [Diagnostics & Timing](#diagnostics--timing)
12. [Grid System & Button Hardware](#grid-system--button-hardware)
13. [LED System](#led-system)
14. [MIDI System](#midi-system)
15. [Dynamic Just Intonation](#dynamic-just-intonation)
16. [Synthesizer Engine](#synthesizer-engine)
17. [Animation System](#animation-system)
18. [Note & Pitch Assignment](#note--pitch-assignment)
19. [Settings Persistence](#settings-persistence)
20. [GEM Menu System](#gem-menu-system)
21. [Input Interface](#input-interface)
22. [Main Program Flow](#main-program-flow)
23. [Improvement Recommendations](#improvement-recommendations)

---

## Architecture Overview

HexBoard is a **hexagonal isomorphic MIDI controller and synthesizer** running on a dual-core RP2040 microcontroller. The entire codebase lives in a single `.ino` file (intentionally — to avoid Arduino IDE multi-file compilation quirks), totaling 6,479 lines.

### Dual-Core Model

| Core | `setup` | `loop` |
|------|---------|--------|
| **Core 0** | Hardware init, file system, settings, menu, MIDI, LEDs | Button scanning, MIDI I/O, animation, menu interaction, auto-save |
| **Core 1** | PWM synth setup, hardware alarm ISR registration | Rotary encoder polling |

The synthesizer's audio ISR (`poll()`) runs on **Core 1 via a hardware alarm** at ~41 kHz, completely decoupled from the main loop. Cross-core communication uses `std::atomic` variables for envelope commands and voice state.

### Data Flow

```
Buttons → readHexes() → tryMIDInoteOn/Off() → USB/Serial MIDI out
                       → trySynthNoteOn/Off() → envelope commands → poll() ISR → PWM audio
                       → LED color update → strip.show()

Rotary Encoder → readKnob() (core 1) → dealWithRotary() (core 0) → GEM menu
```

---

## Includes & Platform Macros
**Lines 63–93**

### Libraries Used

| Include | Purpose |
|---------|---------|
| `<Arduino.h>` | Core Arduino API |
| `<Wire.h>` | I²C for OLED display (SDA=16, SCL=17) |
| `<GEM_u8g2.h>` | GEM menu framework on OLED |
| `<algorithm>`, `<array>`, `<atomic>`, `<cstdio>`, `<cstring>`, `<cmath>`, `<numeric>`, `<string>`, `<limits>`, `<queue>`, `<vector>` | C++ standard library |
| `<hardware/flash.h>` | RP2040 RAM function placement |
| `"pico/time.h"` | Non-blocking time functions |
| `"hardware/structs/sio.h"` | Direct GPIO register access for fast I/O |

### Macros

- **`RAM_FUNC(name)`** — wraps a function with `__not_in_flash_func()` to place it in RAM on the RP2040, required for time-critical ISR-safe execution.
- **`HARDWARE_UNKNOWN` / `HARDWARE_V1_1` / `HARDWARE_V1_2`** — board revision constants, detected at runtime.

---

## Helper Functions
**Lines 95–158**

| Function | Signature | What It Does |
|----------|-----------|--------------|
| `positiveMod` | `int(int n, int d)` | Always-positive modulo — C++ `%` can return negative values, this corrects that |
| `byteLerp` | `byte(byte a, byte b, float lo, float hi, float t)` | Linear interpolation between two byte values, clamped to `[0, 255]`. Used for color blending. |
| `wrapMidiChannel` | `byte(byte base, int32_t offset)` | Wraps a MIDI channel to the 1–16 range with a signed offset |
| `mapExtendedMidiNote` | `void(int32_t index, byte baseCh, byte& outNote, byte& outCh)` | Maps an extended MIDI index (which may exceed 0–127) to a note + channel pair — essential for **multi-channel microtonal MIDI** |
| `midiChannelOffset` | `int32_t(int32_t index)` | Returns how many channels an extended MIDI index is offset from the base channel |

### Global State

- **`pressedKeyIDs`** — `std::vector<byte>` tracking currently-pressed hex button indices (used for dynamic just intonation reference pitch)
- **`midiNoteToHexIndices`** — `std::array<std::vector<uint8_t>, 128>` — reverse map from MIDI note number to hex button indices (used for incoming MIDI animation)

---

## Settings & Default Values
**Lines 160–287**

All user-configurable parameters have a global variable with a compile-time default. These are overwritten at startup by `syncSettingsToRuntime()` from flash storage.

### MPE Modes

| Constant | Value | Behavior |
|----------|-------|----------|
| `MPE_MODE_AUTO` | 0 | Auto-detect from host MPE configuration messages |
| `MPE_MODE_DISABLE` | 1 | Force single-channel mode |
| `MPE_MODE_FORCE` | 2 | Force MPE mode regardless of host |

### Key Defaults

| Variable | Type | Default | Purpose |
|----------|------|---------|---------|
| `defaultMidiChannel` | `byte` | 1 | Non-MPE output channel |
| `mpeLowestChannel` / `mpeHighestChannel` | `byte` | 2 / 16 | MPE member channel range |
| `layoutRotation` | `byte` | 0 | 0–5 (× 60° increments) |
| `transposeSteps` | `int` | 0 | Semitone transposition |
| `scaleLock` | `bool` | false | When true, out-of-scale buttons are muted |
| `perceptual` | `bool` | true | OKLAB-style perceptual hue correction |
| `animationFPS` | `byte` | 32 | Animation frame rate |
| `playbackMode` | `byte` | `SYNTH_OFF` | Off / Mono / Arpeggio / Poly |
| `currWave` | `byte` | `WAVEFORM_HYBRID` | Synth waveform shape |
| `colorMode` | `byte` | `RAINBOW_MODE` | LED palette algorithm |
| `globalBrightness` | `byte` | 110 (`BRIGHT_DIM`) | Master LED brightness (10 named levels, 0–255) |

### Utility Functions

- **`clampMPEChannelRange()`** — ensures `mpeLowestChannel ≤ mpeHighestChannel` within 2–16.
- **`applyLEDLevel(value, level)`** — scales a byte by `level/255`, used for brightness/dim controls.

---

## Microtonal Tuning System
**Lines 288–433**

The HexBoard supports **arbitrary equal divisions of the octave (EDO)**, not just standard 12-tone.

### Constants

- `MAX_SCALE_DIVISIONS` = 87 — maximum steps per octave
- `TUNING_12EDO` = 0 — standard tuning index
- `TUNING_CUSTOM_1` through `TUNING_CUSTOM_12` — 12 user-definable slots
- `TUNINGCOUNT` = 13

### `tuningDef` Class (line 361)

Represents a complete tuning system:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | `char[18]` | Display name (≤17 chars, constrained by GEM menu width) |
| `cycleLength` | `byte` | Steps per octave (e.g., 12 for 12-EDO, 31 for 31-EDO) |
| `stepSize` | `float` | Cents per step (e.g., 100.0 for 12-EDO) |
| `keyChoices[]` | `SelectOptionInt[87]` | GEM dropdown entries for key selection |

Method `spanCtoA()` returns the number of steps from C to A in the given tuning — important for concert pitch reference.

### Envelope System

- **`envelopeTimeMicrosOptions[]`** — 10 preset durations from 0 to 2,000,000 µs
- **`EnvelopeStage`** enum: `Idle`, `Attack`, `Decay`, `Sustain`, `Release`
- **`EnvelopeParams`** struct: pre-computed tick counts and level increment per tick for each ADSR stage

---

## Custom EDO Generator
**Lines 434–544**

Generates arbitrary N-EDO tuning definitions at runtime using music-theory-derived interval relationships.

### Mathematical Basis

Given N-EDO (N equal divisions of the octave):

The patent-val fifth F = round(N × log₂(3/2))

Where F is the best approximation of a perfect fifth in N steps. From this:

| Interval | Formula |
|----------|---------|
| Chromatic semitone | s = 7F - 4N |
| Diatonic semitone | L = 3N - 5F |
| Whole tone | W = 2F - N |
| Minor third | m₃ = round(N × log₂(6/5)) |

### Key Functions

| Function | Purpose |
|----------|---------|
| `bestStepsForRatio(N, ratio)` | Patent-val: `round(N × log₂(ratio))` |
| `generateCustomTuning(slot, edo)` | Fills `tuningOptions[slot]` with stepSize = 1200/N, generates numeric key names |
| `generateCustomLayouts(slot, edo)` | Computes 5 standard layouts (Bosanquet-Wilson, Harmonic Table, Wicki-Hayden, Janko, Full Gamut) for the given EDO |
| `rebuildCustomKeySpinner(slot)` | Destroys and recreates the GEM key selector widget for updated tuning |

### Static Buffers

Three large static buffer pools hold the generated names and values:
- `customKeyNameBuf[12][87][4]` — key name strings
- `customTuningNameBuf[12][18]` — tuning display names
- `customEdoValues[12]` — stored EDO value per slot

---

## Isomorphic Layout Definitions
**Lines 545–725**

### `layoutDef` Class (line 556)

| Field | Type | Purpose |
|-------|------|---------|
| `name` | `const char*` | Display name |
| `isPortrait` | `bool` | Hex grid orientation |
| `hexMiddleC` | `int` | Grid index of middle C |
| `acrossSteps` | `int8_t` | Pitch steps moving horizontally |
| `dnLeftSteps` | `int8_t` | Pitch steps moving down-left |
| `tuning` | `byte` | Which tuning this layout belongs to |

### Layout Catalog

**71 total layout entries:**

- **11 hardcoded 12-EDO layouts:** Wicki-Hayden, Harmonic Table, Gerhard, Janko, Bosanquet-Wilson, Park, and several others
- **60 custom slots:** 5 layouts per custom tuning × 12 custom tuning slots (Bosanquet-Wilson, Harmonic Table, Wicki-Hayden, Janko, Full Gamut variants)

---

## Scale Definitions
**Lines 726–778**

### `scaleDef` Class (line 736)

| Field | Purpose |
|-------|---------|
| `name` | Display name |
| `tuning` | Bound to a specific tuning (or `ALL_TUNINGS` for universal) |
| `pattern[MAX_SCALE_DIVISIONS]` | Sequence of interval steps that sum to one octave |

### Scale Catalog

**30 entries:**
- "None" — chromatic (all notes playable)
- 17 standard 12-EDO scales: Major, Natural/Harmonic/Melodic Minor, Major/Minor Pentatonic, Blues, all 7 modes, Whole Tone, Diminished/Dominant Diminished
- 12 "Chromatic" entries — one per custom tuning slot

---

## Color / Palette System
**Lines 779–863**

### `colorDef` Class (line 842)

Stores color as HSV with float hue (0–360°), byte saturation, byte value.

Methods:
- **`tint()`** — brightens to full value, caps saturation at moderate (for "playing" state)
- **`shade()`** — darkens to low value, caps saturation (for "dim" state)

### Named Constants

Hue constants at 36° intervals: `HUE_RED` (0°) through `HUE_MAGENTA` (324°).

Value and saturation levels are defined for consistent palette generation across all color modes.

---

## Preset System
**Lines 864–925**

### `presetDef` Class (line 877)

Bundles all the indices needed to define the current musical configuration:

| Field | Purpose |
|-------|---------|
| `tuningIndex` | Index into `tuningOptions[]` |
| `layoutIndex` | Index into `layoutOptions[]` |
| `scaleIndex` | Index into `scaleOptions[]` |
| `keyStepsFromA` | Key selection (steps from A in current tuning) |
| `transpose` | Transposition offset |

Helper methods: `tuning()`, `layout()`, `scale()`, `keyStepsFromC()`, `pitchRelToA4()`, `keyDegree()`

**`current`** — the active preset, initialized to 12-EDO, Wicki-Hayden layout, no scale, key of C.

---

## Diagnostics & Timing
**Lines 926–957**

- **`readClock()`** — reads the RP2040's 64-bit hardware timer directly for microsecond precision
- **`timeTracker()`** — updates `runTime`, `lapTime`, `loopTime` every main loop iteration
- **`sendToLog()`** — conditional Serial debug output gated by `debugMessages` flag

---

## Grid System & Button Hardware
**Lines 958–1240**

### Hardware Layout

- **Multiplexer pins:** GPIO 2–5 (4-bit row select → 16 rows)
- **Column pins:** GPIO 6–15 (10 columns)
- **LED data:** GPIO 22
- **Grid:** 140 LEDs, 160 possible buttons (10×16), 7 command buttons at indices 0/20/40/60/80/100/120

### `buttonDef` Class (line 1030)

Per-button state (160 instances):

| Field | Purpose |
|-------|---------|
| `btnState` | 2-bit state machine: OFF → NEWPRESS → HELD → RELEASED → OFF |
| `coordRow` / `coordCol` | Hex grid coordinates |
| `LEDcodeAnim/Play/Rest/Off/Dim` | Pre-computed NeoPixel color codes for each display state |
| `stepsFromC` | Musical interval from middle C |
| `note`, `bend`, `frequency` | MIDI note, pitch bend, frequency in Hz |
| `MIDIch`, `synthCh` | Assigned MIDI and synth channels |
| `isCmd`, `inScale`, `animate` | Behavioral flags |
| `jiRetune`, `jiFrequencyMultiplier` | Just intonation adjustments |

### `wheelDef` Class (line 1079)

Virtual control wheel implemented with 3 command buttons:

- Reads button combinations to increment/decrement a value
- Two control modes: standard (3-button combos) and alternate (tap/target)
- `updateValue()` applies cooldown-limited smooth movement
- Instantiated 3 times: `modWheel`, `pbWheel`, `velWheel`

### Hardware Detection

`detectHardwareVersion()` (line 1228) reads button 140 — it's electrically shorted on v1.2 boards, allowing software to distinguish hardware revisions.

---

## LED System
**Lines 1241–1704**

### Hardware

Adafruit NeoPixel strip: 140 LEDs, GRB format, 800 kHz, on GPIO 22.

### Perceptual Hue Transform

`transformHue(float h)` (line 1265) maps a perceptual hue angle (0–360°) to a NeoPixel hue value (0–65535) using a **15-point piecewise linear lookup table** derived from Munsell color science. This corrects for the non-uniform hue distribution of RGB LEDs.

### Incandescence Emulation

The `incandescence` namespace (line 1283) implements **Planck blackbody radiation** color mapping, converting a "temperature" value to HSV. Used for the "Piano Incandescent" color mode where sharps/flats glow like hot filaments.

### Color Mode Engine — `setLEDcolorCodes()` (line 1376)

For each non-command hex, computes 5 pre-baked LED color values:

| Color Mode | Algorithm |
|------------|-----------|
| **Rainbow** | Linear hue spread across one octave |
| **Rainbow of Fifths** | Hue spread by circle-of-fifths order |
| **Piano** | Black & white keys; deviation from 12-EDO shown as tint |
| **Piano Alt** | Warm/cool hue split for black/white keys |
| **Piano Incandescent** | Blackbody temperature mapping |
| **Alternate** (Fox/Giedraitis) | Interval-based coloring with desaturation near perfect consonances |
| **Diatonic** (MOS layers) | White = diatonic, warm = sharps, cool = flats, purple = equidistant pitches |

Each button gets: `LEDcodeRest` (idle), `LEDcodePlay` (tinted), `LEDcodeDim` (shaded), `LEDcodeOff` (black), `LEDcodeAnim` (animation color).

### Display Functions

- `applyNotePixelColor(x)` — priority: animate > playing > inScale > scaleLock dim/off
- `lightUpLEDs()` — applies all pixel colors and calls `strip.show()`

---

## MIDI System
**Lines 1705–2617**

### Dual Output

Both USB MIDI (`UMIDI`) and Serial/DIN MIDI (`SMIDI`) are supported simultaneously. A `midiD` bitfield controls which outputs are active.

### MPE Channel Management

- `mpeAvailableChannels` — `std::vector<byte>` pool of free channels
- `takeMPEChannel()` — allocates a channel (FIFO or sorted, depending on `mpeLowPriorityMode`)
- `releaseMPEChannel()` — returns a channel to the pool
- `resetMPEChannelPool()` — rebuilds the pool from `mpeLowestChannel` to `mpeHighestChannel`

### Key Functions

| Function | Purpose |
|----------|---------|
| `freqToMIDI(Hz)` | Converts frequency to MIDI pitch (float) |
| `MIDItoFreq(midi)` | Converts MIDI note to frequency |
| `stepsToMIDI(stepsFromA)` | Tuning-aware conversion of scale steps to MIDI note number |
| `setPitchBendRange(ch, semis)` | Sends RPN 0 to configure pitch bend range |
| `setMPEzone(masterCh, size)` | Sends RPN 6 to configure MPE zone |
| `resetTuningMIDI()` | Master configuration: detects MPE vs. single-channel, sets zones, PB ranges, resets all controllers |
| `tryMIDInoteOn(x)` | Full note-on pipeline: channel allocation, JI retune, pitch bend, note message |
| `tryMIDInoteOff(x)` | Note-off with channel release and JI cleanup |

---

## Dynamic Just Intonation
**Lines 1950–2617** *(within the `@MIDI` section)*

### Overview

When enabled, the system **dynamically retunes played notes** to simple just-intonation ratios relative to the first pressed key. This makes intervals "purer" at the expense of equal-tempered consistency.

### BPM Sync

Optional feature that rounds frequencies to multiples of a BPM-derived resolution, so all voices phase-lock (useful for phase-based synthesis effects).

### Ratios Table

~350+ `std::pair<byte,byte>` entries (starting at line 1983) sorted from simplest (1:1, 1:2, 2:3) to most complex (38:5). The algorithm scans linearly for the simplest ratio within ¼ step of the EDO interval.

### Key Functions

| Function | Purpose |
|----------|---------|
| `pitchBendToFrequencyMultiplier(bend)` | Convert MIDI pitch bend to a frequency multiplier |
| `centsToRelativePitchBend(cents)` | Convert cents offset to MIDI pitch bend value (±8192) |
| `ratioToCents(ratio)` | 1200 × log₂(ratio) |
| `justIntonationRetune(x)` | Core algorithm: find simplest just ratio within tolerance, apply as pitch bend + frequency multiplier |
| `combinedPitchBend(index)` | Sum of microtonal bend + JI retune, clamped to ±8192 |

---

## Synthesizer Engine
**Lines 2618–3821**

### Hardware

- **Pin 23** — piezo speaker (PWM slice 3), always available
- **Pin 25** — audio jack (PWM slice 4), v1.2 hardware only
- **PWM resolution:** Selectable 8-bit (wrap=254) or 10-bit (wrap=1023), default 10-bit

### Waveform Tables

Three 256-byte lookup tables: `sine[]`, `strings[]`, `clarinet[]`. Additional waveforms (saw, triangle, square, hybrid) are computed mathematically.

### `oscillator` Class (line 3098)

| Field | Purpose |
|-------|---------|
| `increment` | Phase accumulator step size (determines pitch) |
| `counter` | Current phase (wraps at 2²⁴) |
| `a, b, c, ab, cd` | Hybrid waveform crossover parameters |
| `eq` | Equal-loudness compensation value (0–8) |

### Polyphony

**8-voice polyphony** (`POLYPHONY_LIMIT = 8`). Voice management uses:

- `channelInUse[8]` — atomic flags for cross-core safety
- `voiceGenerations[8]` — monotonic counter for voice-stealing (oldest voice gets stolen)
- `envelopeCommands[8]` — atomic command queue (`StartAttack`, `StartRelease`, `Reset`)

### `poll()` ISR — The Audio Engine (line 3135)

Runs on **Core 1 via hardware alarm at ~41 kHz** (~24 µs budget per sample, line 3135). Each invocation:

1. **Process envelope commands** — reads atomic command queue, transitions state
2. **Advance ADSR envelopes** — per-voice level tracking through Attack → Decay → Sustain → Release → Idle
3. **Read waveform sample** — phase accumulator lookup into wavetable or mathematical generator
4. **Apply EQ and envelope amplitude** — per-voice multiplication
5. **Mix all voices** with **smooth poly normalization** — uses sum of envelope levels to interpolate attenuation, preventing volume jumps when voices start/end
6. **Dual output:**
   - Audio jack: fixed PWM midpoint, symmetric headroom
   - Piezo: "moving midpoint" that tracks signal amplitude to prevent idle hiss

### Waveform Types

| Waveform | Generation Method |
|----------|-------------------|
| Saw | Mathematical (counter-based, no table) |
| Triangle | Mathematical |
| Square | Mathematical, pulse width modulated by mod wheel |
| Hybrid | Frequency-dependent blend: square → saw → triangle |
| Sine | 256-byte wavetable lookup |
| Strings | 256-byte wavetable lookup |
| Clarinet | 256-byte wavetable lookup |

### Voice Management Functions

| Function | Purpose |
|----------|---------|
| `trySynthNoteOn(x)` | Poly: allocate voice or steal oldest. Mono: replace current |
| `trySynthNoteOff(x)` | Poly: begin release envelope. Mono: find next held note |
| `stealOldestSynthVoice()` | Steals the voice with the lowest generation counter |
| `arpeggiate()` | Timed cycling through held notes in arpeggio mode |
| `panicStopOutput()` | Kills all MIDI (CC120+CC123 on all 16 ch) + all synth voices |

---

## Animation System
**Lines 3822–4090**

### Direction System

6 hex directions with precomputed `vertical[]` and `horizontal[]` offset arrays for neighbor traversal.

### Animation Types

| Type | Function | Effect |
|------|----------|--------|
| Octave / By Note | `animateMirror()` | Highlights all hexes with same pitch (mod octave or exact) |
| Orbit | `animateOrbit()` | Two lights orbit pressed keys at radius 2 |
| Beams | `animateStaticBeams()` | Random-direction beams extend from pressed keys |
| Star / Splash | `animateRadial()` | Expanding ring or corners from pressed keys |
| Star/Splash Reverse | `animateRadialReverse()` | Contracting ring or corners toward pressed keys |
| MIDI In | (inline) | Lights up hexes matching incoming MIDI notes |

### External MIDI Animation

`processIncomingMIDI()` (line 4021) reads USB and Serial MIDI input, dispatches NoteOn/NoteOff events to `applyExternalMidiToHex()` (line 4004), which uses the `midiNoteToHexIndices` reverse map to light up corresponding buttons.

---

## Note & Pitch Assignment
**Lines 4091–4271**

### `assignPitches()` (line 4099)

For each non-command hex:
1. Compute `midiNoteIndex` from `stepsFromC` + tuning parameters + transposition
2. For microtonal tunings (step size ≠ 100 cents): map to note + channel via `mapExtendedMidiNote()`
3. For standard tunings: compute MIDI note, pitch bend, frequency
4. Populate `midiNoteToHexIndices` reverse map

### `applyScale()` (line 4171)

Walks the scale pattern to determine each hex's `inScale` flag, then calls `setLEDcolorCodes()`.

### `applyLayout()` (line 4198)

1. Applies layout mirroring and rotation transforms
2. Computes each hex's `stepsFromC` from grid coordinates relative to `hexMiddleC`
3. Calls `applyScale()` and `assignPitches()`

### Command Buttons

`cmdOn(x)` (line 4232) / `cmdOff(x)` (line 4246) handle the 7 command buttons. Button 3 has special behavior: toggles between mod wheel and pitch bend wheel modes.

---

## Settings Persistence
**Lines 4272–4596**

### File Format

Binary file `/settings.dat` on LittleFS:

| Section | Content |
|---------|---------|
| Header (5 bytes) | Magic "STG" + version byte (currently 3) + default profile index |
| Profiles | 9 profiles × `NUM_SETTINGS` bytes each |

### `SettingKey` Enum (line 4272)

58 named setting keys covering all configurable parameters, including 12 custom EDO slots. Each maps to a byte offset in the profile array.

### Key Functions

| Function | Purpose |
|----------|---------|
| `load_settings()` | Read from flash, validate magic + version, fall back to defaults on mismatch |
| `save_settings()` | Write header + all 9 profiles to flash |
| `syncSettingsToRuntime()` (line 5761) | **Critical** — reads all `settings[]` bytes, assigns to runtime variables, regenerates custom EDOs, applies layout/scale/MIDI/synth |
| `markSettingsDirty()` (line 4539) | Sets dirty flag + timestamp for debounced auto-save |
| `checkAndAutoSave()` (line 4546) | 10-second debounce auto-save to profile 0 |

---

## GEM Menu System
**Lines 4597–6202**

### Display

U8G2 SH1107 128×128 OLED on I²C (line 4619), with a ~33-second screensaver timeout.

### Menu Hierarchy

```
Main Menu
├── Tuning (13 tuning options + custom EDO generator + JI settings)
├── Layout (71 layouts, filtered by current tuning)
├── Scales (key selector + scale lock + 30 scales, filtered by tuning)
├── Color Options (mode, brightness, animation, rest/dim levels)
├── Synth Options (mode, output, waveform, ADSR, arp speed/BPM)
├── MIDI Options (channel, MPE mode/bend/range, CC74, program change)
├── Control Wheel (velocity/PB/mod speed, sticky modes)
├── Transpose (-127..+127)
├── Save Profiles (9 slots)
├── Load Profiles (9 slots)
└── Advanced (firmware, hardware, reset, USB bootloader, debug)
```

### Callback System

Every persistent menu item uses a `PersistentCallbackInfo` struct:
- `settingIndex` — index into `settings[]`
- `variablePtr` — pointer to the runtime variable
- `reader` — optional encoder translation function
- `postChange` — optional hook (e.g., `refreshMidiRouting`, `setLEDcolorCodes`)

`universalSaveCallback()` reads the new value, writes to `settings[]`, marks dirty, and runs the post-change hook.

### Dynamic Filtering

- `showOnlyValidLayoutChoices()` — hides layouts for other tunings
- `showOnlyValidScaleChoices()` — hides scales for other tunings
- `showOnlyValidKeyChoices()` — updates key options for current tuning

---

## Input Interface
**Lines 6203–6417**

### Rotary Encoder

Pins: A=20 (line 6235), B=21 (line 6236), Click=24 (line 6237). Uses an 8-state lookup table for debounced direction detection. Holding the button for 2 seconds triggers a panic stop.

### `readHexes()` (line 6249)

The main button scanning loop:
- Uses **direct SIO register reads** (`sio_hw->gpio_in`) for maximum speed
- Double-samples each row for noise rejection
- Iterates 16 rows × 10 columns
- Dispatches to `cmdOn/Off`, `tryMIDInoteOn/Off`, `trySynthNoteOn/Off` based on button state transitions

### Wheels

`updateWheels()` processes the three virtual wheels (velocity, pitch bend, mod) and sends MIDI CC/PB messages.

---

## Main Program Flow
**Lines 6418–6479**

### Core 0 — `setup()` (line 6437)

1. TinyUSB initialization
2. USB + Serial MIDI setup
3. LittleFS file system (auto-format)
4. I²C wire for OLED
5. Pin + grid + hardware version configuration
6. Load settings from flash
7. LED, display, rotary, menu setup
8. Hardware-specific configuration (v1.2 audio jack)
9. `syncSettingsToRuntime()` — applies all loaded settings
10. Pitch bend factor computation

### Core 0 — `loop()` (line 6458)

```
timeTracker() → processEnvelopeReleases() → retryPendingReleases() → screenSaver()
→ readHexes() → arpeggiate() → updateWheels() → processIncomingMIDI()
→ animateLEDs() → lightUpLEDs() → dealWithRotary() → checkAndAutoSave()
```

### Core 1 — `setup1()` (line 6472)

Sets up PWM on both piezo and audio jack pins, registers the ~41 kHz hardware alarm ISR.

### Core 1 — `loop1()` (line 6476)

Continuously polls the rotary encoder (`readKnob()`).

---

## Improvement Recommendations

### 1. Redundancies & Dead Code

| Issue | Location | Impact |
|-------|----------|--------|
| **Duplicate JI ratio entries** | Lines ~1983–2450 | `{1,4}` and `{12,1}` appear twice in the ratios table. Deduplication reduces table size and eliminates redundant comparisons. |
| **Manual transpose spinner** | In `@menu` section (~line 4597+) | 255 hardcoded `SelectOptionInt` entries from -127 to +127 could be generated in a loop during `setupMenu()`. |

### 2. Memory Optimization

| Issue | Suggestion | Est. Savings |
|-------|------------|-------------|
| `tuningDef` has `SelectOptionInt[87]` × 13 tunings | Move to dynamically allocated only for the active tuning, or use PROGMEM | ~5 KB |
| General MIDI + Roland MT-32 instrument name tables (~2.5 KB each) | Store in flash with `PROGMEM` / `__in_flash()` | ~5 KB RAM |
| `customKeyNameBuf[12][87][4]` = 4,176 bytes static | Allocate only for used custom tuning slots | Up to ~3.5 KB |
| `midiNoteToHexIndices` uses `std::vector<uint8_t>` × 128 | Use a flat array with fixed max (each note maps to at most ~5 hexes) | Fewer heap allocations |
| `pressedKeyIDs` as `std::vector<byte>` | Use fixed-size array with count (max 140 simultaneous presses is impossible in practice — 10-20 is realistic) | Eliminates dynamic allocation near timing-critical code |
| `mpeAvailableChannels` as `std::vector<byte>` with sorted insert/erase | Use a 16-bit bitmap — `takeMPEChannel()` becomes `__builtin_ctz()`, `releaseMPEChannel()` becomes a single OR | Faster + smaller |

### 3. Performance Optimization

| Issue | Suggestion | Impact |
|-------|------------|--------|
| `setLEDcolorCodes()` does heavy float math per button for some modes | Precompute per **scale degree** (at most 87) rather than per button (140). Many buttons share the same scale degree. | ~60% fewer trig/log calls |
| `sendToLog()` uses `std::string` concatenation | Guard string construction with `if (debugMessages)` **before** building the string, not just before printing. Or use `#ifdef DEBUG`. | Eliminates heap churn in release builds |
| `justIntonationRetune()` linear scan of ~350 ratios | Precompute a lookup table indexed by interval class (at most `cycleLength` entries). For 12-EDO, that's 12 pre-resolved ratios. | O(1) vs O(350) per note |
| `poll()` ISR uses `int64_t` multiplication | Profile to ensure the full 8-voice mix completes within the 24 µs budget. Consider fixed-point `int32_t` arithmetic with bit-shifting. | Reduces ISR overhead |
| `animateOrbit()` / `animateRadial()` recompute neighbor offsets each frame | Cache neighbor coordinate lists at layout-change time | Minor CPU savings per frame |

### 4. Architectural Improvements

| Issue | Suggestion |
|-------|------------|
| **Single 6,479-line file** | The `@tag` comments already section the code. Splitting into headers per section (as the authors note they intend to do) would vastly improve maintainability. Arduino 2.x and PlatformIO handle multi-file projects correctly. |
| **`SettingKey` enum + `factoryDefaults[]` manual sync** | Use a struct or X-macro pattern so each setting's key, default, type, and variable pointer are defined in one place. This eliminates the risk of index mismatches. |
| **Envelope commands via 8 separate atomics** | Replace with a single lock-free SPSC ring buffer for commands. Simpler, more cache-friendly, and eliminates the retry/pending release mechanism. |
| **`universalSaveCallback()` + `PersistentCallbackInfo` pattern** | Clean and well-designed, but the `reader` function pointer adds indirection. Consider a template-based approach for compile-time dispatch. |
| **Magic numbers scattered in color computations** | Define named constants for the Munsell hue correction points, blackbody temperature ranges, and MOS layer thresholds. |

### 5. Code Size Reduction

| Target | Technique | Est. Savings |
|--------|-----------|-------------|
| Generate transpose spinner programmatically | Loop in `setupMenu()` | ~260 lines |
| Consolidate duplicate ratio entries in JI table | Deduplicate | ~10 lines + minor runtime savings |
| Extract shared LED computation into helper | Refactor `setLEDcolorCodes()` | ~50 lines via shared per-scale-degree path |
| Move instrument name tables to PROGMEM | `const char* const PROGMEM` | No line savings but ~5 KB flash-only |

### 6. Robustness

| Issue | Suggestion |
|-------|------------|
| `load_settings()` trusts file size after magic check | Add CRC32 checksum to settings header |
| No bounds checking on `layoutIndex`, `scaleIndex`, `tuningIndex` in `presetDef` | Add `assert()` or clamping in accessors |
| `mpeAvailableChannels` can be empty if range is misconfigured | `takeMPEChannel()` should handle empty pool gracefully (it may already, but a comment would help) |
| `poll()` ISR has no watchdog/timing check | Add a cycle counter to detect overruns in debug mode |

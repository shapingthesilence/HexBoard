# Compact Sampler Proposal

Status: proposed, unimplemented. This assesses the RP2040 HexBoard using the
local HexBoard Advanced implementation as a reference. Capacities are design
targets unless identified as measurements.

## Agreed Goal And Feasibility

- One selected instrument, with several user instruments stored on the board.
- Eight simultaneous notes; compact mono samples and some tonal differences
  from Advanced are acceptable.
- Success means importing a handful of familiar N64-style sounds with decent
  quality. Expected source instruments are well under 1 MB each.
- Users supply SoundFonts; no game recordings enter the factory library.

A simple eight-voice sampler is plausible, subject to hardware timing and
listening qualification. Implement browser conversion and a sample instrument
player. Raw device-side SF2/SF3 parsing, ROM extraction and console sound-chip
emulation are outside this proposal. Preserve tuning, layout, MIDI and arp use.

The [RP2040 has 264 KiB SRAM](https://www.raspberrypi.com/products/rp2040/specifications/).
This project's linker provides 256 KiB in the ordinary data/heap region; the
small scratch banks also hold stacks. The normal build uses 250 MHz, 16 MiB
flash and approximately 8 MiB LittleFS. Advanced has a separate RP2350 audio
processor, 8 MiB PSRAM and SD storage.

Baseline `make` on 2026-10-27 passed after retrying an external-library read
timeout. It reports **222,640 bytes static RAM** and **39,504 bytes remaining**
in the ordinary region. That remainder must accommodate runtime allocations;
it is not spare sample capacity. Measure heap fragmentation and both stacks.
See [transfer memory](developer-guide.md#transfer-memory).

| Existing allocation | Bytes | Reuse opportunity |
| --- | ---: | --- |
| Active wavetable base | 8,192 | Exclusive engine workspace |
| Active wavetable mip samples | 40,960 | Exclusive engine workspace |
| FX modulation scale table | 16,384 | Candidate after call-site audit |
| Positive/negative pitch modulation tables | 8,136 | Audit shared versus exclusive use |

The first two arrays offer 48 KiB for reuse. A 64 KiB workspace is a reasonable
initial target if the FX table moves too. Metadata, voices and caches consume
part of it: **32–48 KiB PCM** is an initial planning range, not a committed
limit. Additional RAM-resident sampler code also needs SRAM.

Recordings are shared between voices. Eight notes do not require eight copies
of an instrument, but every distinct recording and prepared representation
counts. For illustration, 48 KiB mono PCM16 holds 1.11 seconds at 22.05 kHz or
1.54 seconds at 16 kHz, summed across recordings. Loops can sustain indefinitely.

**Sub-1-MB storage does not establish RAM fit.** Measure selected, decoded and
converted instruments rather than compressed source-bank size. Larger instruments
need qualified flash-backed playback or further conversion reductions. This is
the main unresolved product-scope gate.

## Reuse From Advanced

Reference checkout: `../HexBoard_Advanced`, especially `src/sampler/`,
`firmware/audio/HexBoard_Audio/src/synth/`, `docs/sampler.md`,
`docs/sampler-format.md` and `docs/synth-engine-memory.md`.

| Area | Assessment |
| --- | --- |
| Browser SF2/SF3 importer and preset chooser | High reuse; already present in this repository's Advanced editor |
| WAV/SFZ support, trim, loop editing, maps and conversion reports | High reuse where useful; prioritize SoundFonts |
| Source audition | Reuse; add audition of the actual compact conversion |
| Offline preparation | Reuse algorithms/tests; add compact rate and size policy |
| Loop, envelope, region and continuous-pitch behavior | Reuse semantics and fixtures with smaller runtime structures |
| Checksums, validation and engine lifecycle | Reuse patterns and matching codec helpers |
| Advanced sample renderer | Substantial adaptation or replacement |
| PSRAM/SD services, I2S and interprocessor protocol | Hardware-specific; use this model's storage and PWM/DMA |

Existing browser importer changes are uncommitted. Preserve them and coordinate
extraction into shared modules rather than replacing them wholesale.

The importer retains original sample rates, recordings and loops in its
intermediate patch. Advanced's resident encoder then converts to 44.1 kHz and
generates filtered octave representations. This can inflate small game sounds;
the compact target should preserve lower rates where practical. The current
compact import adaptation is a useful starting point, although simultaneous
source layers can still require rendering and increase size.

A Cortex-M0+ type-size probe of Advanced gives directory **38,748 bytes**,
renderer **43,136**, reverb **34,268**, and filter coefficients **55,728**.
Together that exceeds 167 KiB before PCM, other state or code. Its renderer also
uses floating-point work and RP2350 DSP specializations. A wholesale port is
unsuitable; reuse the authoring pipeline and behavior more than its hot DSP.

## Engine Memory And Switching

Add Wavetable/Sampler selection separately from waveform and playback mode.
Use one aligned fixed-capacity workspace with engine-owned views, keeping
transport, routing and small common state permanent. Preparation-time
initialization achieves RAM reuse without heap fragmentation or render allocation.

Start with data sharing. Advanced's executable linker overlays are a later
option only if measured code RAM requires them. Keep measured hot functions
and tables in RAM; do not move them to flash to make a size report look better.

Switching is a maintenance transaction:

1. Validate header, bounds, features and memory needs before disturbing audio
   where possible.
2. Fade to silence, block internal note starts, and clear voices, release tails,
   queued commands and cached pointers.
3. Obtain Core 1 acknowledgement at a completed render-block boundary before
   replacing workspace. Mute alone is not a memory ownership barrier.
4. Construct the engine, load/verify content and publish readiness; restart and
   fade in. Keep controls cooperative and rotary polling available.
5. Require fresh presses for keys held through the transition. Reject stale
   events so old note-offs cannot release new voices.

Do not promise seamless changes or preservation of the old instrument after
replacement begins. On load failure, reconstruct Basic Shapes and report the
exact failing path/stage. Distinguish requested selection from active state.

Storage and preset-sync code currently access wavetable arrays directly.
Encapsulate those accesses behind engine-aware APIs: wavetable uploads and
settings refreshes must never overwrite active sampler PCM. Cross-subsystem
calls use `synth/SynthAudio.h`; private state remains synth-owned.

## Compact Playback

Use mono PCM16, fixed-point playback position/increment, fractional pitch,
root/fine tuning, key ranges, optional velocity splits, gain and sample-authored
amplitude envelopes. Support one-shots, forward sustain loops, loop release
behavior and steal fades. Deduplicate recordings across regions.

Start with eight total voice slots including releases. Separate tail slots
need their own timing/memory qualification. Reuse current note/arp ownership
through an engine-neutral note interface. Select regions using actual tuned
frequency and preserve microtonal pitch, dynamic retuning and configured bend
behavior. Advanced's qualified bend range cannot silently replace this model's
controls.

Retain approximately 40.7 kHz output through existing 64-sample PWM/DMA buffers;
source sample rates are independent. Compare linear interpolation with a short
higher-quality integer reader. Add offline filtering or limited representations
only where required and within the byte budget. Qualify pitched loops, foldover,
odd/short-loop tuning and clicks. Advertise pitch limits and never clamp silently.

Leave Advanced room reverb, general modulation, resonant filters, stereo,
simultaneous layered readers and recording outside the first runtime. Report
omitted source behavior or refuse unsupported conversions. A later simple tone
filter needs separate timing and listening evidence.

## Instruments Larger Than RAM

Store converted files in LittleFS and load fitting patches into the workspace.
Several stored instruments do not need to fit RAM simultaneously. Resident
playback performs no filesystem work in the audio loop.

Investigate flash playback in the first proof phase because the stated size
envelope can exceed RAM. Prototype bounded prefetch into SRAM windows. Measure
worst-case service latency with scanning, USB, LEDs, display and rotary active;
flash bandwidth alone does not establish feasibility because code also uses
flash. Test eight unrelated readers, highest supported rates, attack bursts,
loop boundaries and fragmented files. Evaluate pinning attacks/loops in RAM.

LittleFS reads in the renderer are unacceptable. A Core 0 file service must
prove timely delivery and bounded input latency. Direct XIP requires validated
physical mapping; never assume a LittleFS file is contiguous. If supported
mapping is unavailable and a raw partition is needed, review that layout change
explicitly with factory/update and data-preservation tests. Do not silently
repartition boards.

If the flash proof fails, report the measured resident limit and actual
conversion results before promising larger instruments. Compression reduces
flash use only unless bounded decoding is implemented too. BRR/ADPCM and
console-specific encodings remain later options.

## Import, Formats And Storage

Add compact preparation to the shared intermediate patch. Keep original short
recordings/loops and native or reduced rates; optionally downmix, deduplicate,
trim and resample with a clear change report. Preserve loop pitch and endpoints.
Default to keeping samples rather than long rendered source-motion captures.

Show file bytes, active RAM bytes, recording/region counts, pitch coverage and
sound changes before upload. Offer reductions with converted-patch audition;
refuse patches that still exceed limits. Original-bank audition cannot establish
compact-device quality.

Specify version, source rates, PCM bounds, loops, roots/tuning, regions/envelopes
and CRCs. Compare a restricted HBS subset with a distinct compact encoding during
the proof. HBS currently fixes its base clock at 44.1 kHz: do not reuse its
magic/version with changed rate semantics or import its full directory arrays.
An initial 16-recording/32-region planning cap needs actual source validation.
Preserve Advanced export behavior.

Advertise a compact-sampler capability and explicit limits in this model's
preset-sync protocol. Reuse chunking, packing, CRC and file staging patterns;
do not route RP2040 through Advanced's transport/capability. Avoid a second
instrument-sized transfer buffer. Publish only verified installs; preserve
existing catalog records on failure. Writes use the existing muted flash-safe
workflow. Include selection, delete/export and backup in the library workflow.

Persist engine and instrument reference using existing settings ownership.
Append keys only through `SettingKeys.inc.h`; update runtime, menu, preset/profile
and factory wiring. Bump the current settings version 35 when persisted layout
or meaning changes, and test migrations from version 32 onward. Firmware-only
updates must preserve user instruments.

Boot still mounts once without formatting, provisioning or repair. Read-only
selection/loading must recover from absent/corrupt content into normal operation
with hardware-aware defaults, 12 EDO and Basic Shapes. Mount failure disables
saving. No game recordings enter builds; use generated synthetic test content.

## Implementation Sequence And Gates

1. **Prove memory, quality and timing.** Inventory representative instruments'
   decoded PCM, unique recordings, loops/layers and envelopes. Measure live
   heap/stack margins under maximum catalog and transfer load. Prototype eight
   integer voices and larger synthetic flash-backed instruments. Exit with
   measured resident capacity, interpolation, pitch coverage and a decision on
   whether flash playback is needed and practical.
2. **Introduce engine ownership.** Share wavetable arrays and audited tables,
   encapsulate external accesses and implement acknowledged transitions/fallback.
   Qualify repeated switches and unchanged wavetable behavior.
3. **Implement compact codec and playback.** Add bounded validation, loops,
   envelopes, retunes, release/panic and stealing. Qualify eight-voice hardware
   phrases. If phase 1 requires flash playback, add the proven cache design as a
   separate gated step before claiming larger instrument support.
4. **Deliver browser import and board library.** Share importer/UI pieces, add
   compact preparation/audition, limits, transfer and persisted selection.
   Compare the chosen game-style sounds against source and Advanced by listening.
5. **Qualify and document.** Run firmware, web, protocol, migration and factory
   checks; update implementation references and user workflows with measured limits.

Hardware acceptance covers eight voices, steals/retriggers, shortest loops,
one-shot ends, bends and held retunes, arp, sustain/releases, panic, switches
and corrupt/missing content. Require zero underruns, allocation-free rendering,
useful margin below the roughly 1.57 ms refill period, responsive controls and
measured heap/stack high-water marks. Exercise jack/piezo routing on supported
hardware. Optional sequencer builds need separate combined-load/RAM checks.

Production-code host tests cover bounds, tuning, malformed records, CRCs,
stale events, repeated ownership changes and interrupted installs. Run `make`,
relevant web tests/build, factory generation when required and `git diff --check`.
Host tests do not qualify hardware timing or listening quality.

## Assessment Verification

- Baseline normal `make`: passed; Factory and Update UF2 generation completed.
- Existing browser sampler import/library/loading tests: 21 passed. Layer-render
  tests emit preset lookup warnings; their pass is not listening validation.
- Advanced sizes: Cortex-M0+ cross-compiled type-size probe; no Advanced source
  files changed.
- No sampler firmware, web or protocol implementation accompanies this proposal.

Remaining evidence: representative converted instruments' size/quality and
RP2040 renderer/cache measurements.

# Classic Sampler

The RP2040 HexBoard has a resident mono sampler alongside the wavetable engine.
Users convert their own SF2/SF3 SoundFonts, WAV recordings or supported SFZ/HBS
instruments in HexBoard Sync.

## Playing And Importing

Connect an updated Classic board, open Synth, then choose **Instruments**. The sample
editor, SoundFont preset chooser, waveform/loop tools and pitch/velocity map are
shared with Advanced. Classic hides unsupported engine and expression controls.
Classic keeps source recordings and reports omitted source motion. Simultaneous
source layers need a rendered adaptation and can exceed Classic capacity.

Importing or editing automatically prepares the Classic instrument. Compare
**Original recordings** and **Converted for HexBoard** on the audition keyboard.
An instrument lives inside its sound: there are no separate instrument files.
**Send to HexBoard** stores a sampler sound holding the current prepared
instrument and plays it, using the sound name (23 characters, default the
instrument name) and folder (default `Instruments`) fields beside it; sending
again with the same name and folder replaces that sound's instrument.
**Save sound file** downloads the same sound as a `.hexsound` file. **Edit
instrument** in a sampler sound's editor opens its instrument here; sending it
back replaces the instrument in that sound and keeps the sound's settings
(**Make a new sound instead** sends it as a new sound). Sending and export wait
for preparation to finish.
Envelope edits reuse the fitted samples for immediate audition. Sample edits wait
for their new conversion. Browser interpolation and output
protection differ from the board, so compare on the device too. `.hexsound`
files and older `.hbc` instruments can be reopened in the shared editor.
Advanced `.hbs` export remains unchanged.
Waveform, loop, mapping and **Region ADSR** controls remain visible. ADSR sliders
give finer control over short times; type exact milliseconds or sustain percent,
then press Enter or leave the field. **Edit all regions** changes each region at
once; **Copy ADSR to all** copies all four values from the selected region. A
slider drag is one Undo step. Delay, hold and Advanced tone controls remain in the
region inspector. The conversion report lists adaptations and playable-range changes.
The shared [loop-editing guide](web-app-guide.md#sampler-loop-editing) covers
sample-level zoom, zero-crossing tools, length locking, crossfades and tuning.

On the board, the loaded sound chooses the engine: a sampler sound plays the
instrument stored inside it, and any other sound uses the wavetable engine.
**Save Sound** over another sound, or **Save as new**, copies the playing
instrument into that sound; deleting a sampler sound deletes its instrument.
Changes briefly mute playback and clear
voices. Keys held through the change require a fresh press. Tuning, layout,
pitch bend, the board arpeggiator, volume and jack/piezo routing remain available.
Sampler envelopes come from the converted instrument, unless the sound's `Amp
Env` sets a stage: each set stage replaces that stage in every region when a
note starts (release stays at least 4 ms), and `Inst` keeps the region's own.
The mod wheel always adds vibrato (`Wheel Amt` sets the depth, `Vib Speed` the
rate, at the wavetable engine's depth); the wavetable LFO, FX envelopes and
other wheel targets do not apply. The shared output drive still applies.

Because the instrument travels inside the sound, a sampler sound can be copied
between HexBoards and browsers, exported and shared as one `.hexsound` file. If
a sound's instrument cannot be read, the board shows **Upload instrument** and
plays the wavetable engine with the sound's wavetable.

The current engine follows the normal settings/profile save policy through the
profile's synth preset or draft; a sampler draft names the sound whose
instrument it plays. AutoSave is respected. Sounds are stored immediately and
survive firmware-only updates.

## Capacity And Conversion

| Resource | Limit |
| --- | --- |
| Voice slots, including releases | 8 |
| Mono signed PCM16 sample pool | 49,152 bytes / 24,576 frames |
| Recordings per instrument | 16 |
| Non-overlapping pitch/velocity regions | 32 |
| Sampler sounds (each holds its instrument) | 128 of the 512 sounds |

Recordings are shared by voices. File size also includes bounded metadata;
the maximum complete file is 51,264 bytes. Original low sample rates are retained
when possible. Oversized instruments first discard unreachable data after
continuous loops, keeping loop-until-release tails. Each recording receives its
own minimum rate, based on its root pitch and measured frequency content. The
remaining RAM is allocated without repeated rate-halving, and each recording is
resampled once. Odd sustain loops retain their periodic pitch through reduction.
Stereo mixing protects against phase cancellation. Modest reduction loss is
corrected with peak headroom; requested normalization happens after filtering.

Conversion stops if preserving tone requires more than 48 KiB or measured signal
loss exceeds the accepted limit. The error gives a RAM estimate or names the
recording: trim long recordings, reduce the map or choose a smaller preset. A
large bank's disk size is not its selected instrument's decoded sample size.
Preparation is a conservative quality check, not a guarantee of identical timbre.

The reader supports forward sustain loops, loop-until-release, one-shots,
amplitude delay/attack/hold/decay/sustain/release, gain, key tracking, velocity
ranges and fractional pitch. Note-off release is at least 4 ms. One-shots ignore
note-off. Release tails share the eight slots and can be stolen with a short fade.
Velocity is fixed for ordinary Classic keys and captured for internal preview /
sequencer notes; it does not imply Advanced pressure or lift sensing.

Playback uses linear interpolation. Source increments span 1/65,536 through
64 frames per output sample; conversion narrows map bounds if needed and reports
the resulting range. Transposition changes duration normally. High transpositions
can alias. Stereo is downmixed; resonant tone filters, pressure response, room
reverb, custom modulators, patch response/arp recall, round robin, choke groups
and fixed-key kit maps are not implemented by this runtime. The converter reports
omissions or rejects unsupported mappings. Large-instrument flash streaming is
not implemented.

## Runtime And Ownership

Browser `sampler/compactAudio.mjs` owns fitting and level protection. For oversized
sources it estimates a rate floor from six times root frequency and 98% spectral
energy in significant 2,048-frame Hann-windowed probes, including the loudest
transient. Native rates cap these floors. Integer loop lengths set exact rate
ratios; a bounded search distributes remaining frames. A final RMS check rejects
loss above 1.5 dB. Smaller corrections stay within 1.5 dB and available peak
headroom. This work runs during preparation, outside the device audio path.

`synth/CompactSampler.cpp` owns preparation, selection, runtime directory and
private readers. Core 0 merges a region's envelope with the sound's overridden
stages when it picks the region for a note; Core 1 copies that envelope when it
starts the reader. Vibrato is refreshed every 32 samples, and each voice's
vibrato step is recomputed only then or when its pitch changes, so eight voices
cost about 2% of the render budget more than without vibrato (911 µs versus
895 µs per 64-sample block, budget 1,572 µs, measured with
`test_synth_performance.py`). `CompactSamplerCodec.h` contains the bounded, host-testable
format validator and sample reader. `SynthSampleWorkspace` overlaps the existing
48 KiB active wavetable data with sampler PCM; it does not add another PCM pool.
Engine choice is dispatched once per 64-sample buffer. Both engines share the
same inlined output stage, mute ramps, DMA and output caps.

Core 0 validates the complete file and CRCs before replacement. It fades output,
requests a pause, and waits for Core 1 acknowledgement at a completed block
boundary before replacing workspace. DMA is then held idle while content is
loaded and verified again. Preparation can allocate bounded metadata buffers;
rendering performs no allocation or filesystem I/O. Rotary polling continues
while rendering is paused. Voice-freed notifications carry generation identity
so an ended old sample cannot release a newly assigned owner.

A sampler sound's preset file (`/presets/<bucket>/<id>.hsp`) is the header and
HSP v13 record followed by the complete HBC1 instrument; the record CRC covers
only the record and the instrument keeps its own CRCs. The record carries the
instrument's name (empty for wavetable sounds) and the amp envelope override
mask. `CompactSampler.cpp` keeps the requested name and the object id of the
sound file holding the instrument, and loads it from
`syncCompactSamplerSelection()`. Every rewrite of a sound copies its instrument
into the new file before the atomic rename; at most 128 sounds may hold one.
Transfers stream into the existing temporary-file mechanism and are validated
before the sound is stored, so an interrupted or rejected transfer leaves the
stored sound intact. Abandoned transfers use the existing preset-sync timeout
and restore muted output. Loading is read-only. Mount and content failures
retain normal operation and report exact paths/stages; boot never formats or
repairs storage. Invalid boot selections use the wavetable fallback. Settings
version 37 dropped version 36's `SamplerSlot` byte. See
[settings ownership](developer-guide.md#settings-and-persistence) and the
[wire/format contract](preset-sync-sysex.md#classic-compact-sampler).

## Verification Tools

`scripts/compact_sampler.py` installs user-supplied `.hexsound` files with ACK
pacing, plays each one and checks its instrument byte for byte on readback. It requires
`mido` and `python-rtmidi`; `scripts/test_synth_performance.py` additionally needs
`pyserial`. Files and output reports can live outside the repository:

```sh
python3 scripts/compact_sampler.py --install /path/to/Sound.hexsound --output /tmp/install.json
python3 scripts/test_synth_performance.py --output /tmp/sampler-performance.json --max-cpu-percent 90
```

The audio suite identifies sampler runs and exercises the real allocator,
eight voices, releases, retriggers and stealing. Its expression phases sweep
fractional pitch at 100 Hz, combining ±2 semitones and independent ±18-cent
retunes. These phases do not claim unsupported wavetable effects in the sampler.
Pass `--piezo` to exercise piezo output temporarily; the suite restores the
previous route afterward (`HBAUD 2` over CDC). Use a sustained synthetic patch
covering the phrase for full voice coverage;
short one-shots can legitimately end before a peak measurement.

Host codec tests cover malformed metadata, CRCs, loop wrap interpolation,
release tails, extreme reader increments and browser-produced files under
address/undefined-behavior sanitizers. Qualification applies to the actual tested
build, patch and output. Timing tests do not replace physical playing and listening.
Browser conversion tests also cover high-note rejection, independent rate budgets,
level retention, stereo cancellation and normalization after filtering.

The shared [tuning and loop analysis tools](sampler-tuning.md) include precise
anchors, reference audition and converted-loop checks. Planned native expression
and effects are described separately in the [sampler roadmap](sampler-roadmap.md).

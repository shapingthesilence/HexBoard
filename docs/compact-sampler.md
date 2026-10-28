# Classic Sampler

The RP2040 HexBoard has a resident mono sampler alongside the wavetable engine.
Users convert their own SF2/SF3 SoundFonts, WAV recordings or supported SFZ/HBS
instruments in HexBoard Sync.

## Playing And Importing

Connect an updated Classic board, open Synth, then choose **Sampler**. The sample
editor, SoundFont preset chooser, waveform/loop tools and pitch/velocity map are
shared with Advanced. Classic hides unsupported engine and expression controls.
Choose **Keep source samples** for small game instruments; conversion reports
any omitted source motion. Simultaneous source layers need a rendered adaptation
and can exceed Classic capacity.

Use **Prepare Classic audition** to hear the converted mono patch in the browser.
The report shows size reductions and playable-range changes. Browser interpolation
and output protection differ from the board, so compare on the device too.
**Copy small patch over USB** verifies and installs a new instrument, then selects
it. Existing slots are protected; delete an instrument explicitly to reclaim one.
The board library supports selection, export and deletion. Exported `.hbc` files
can be reopened in the shared editor. Advanced `.hbs` export remains unchanged.

On the board, **Editor → Synth → Sampler / Engine** selects an installed instrument
or returns to the wavetable engine. Changes briefly mute playback and clear
voices. Keys held through the change require a fresh press. Tuning, layout,
pitch bend, the board arpeggiator, volume and jack/piezo routing remain available.
Sampler envelopes come from the converted instrument; wavetable envelope/LFO
settings do not replace them. The shared output drive still applies.

Engine selection follows the normal settings/profile save policy. AutoSave is
respected. **Save startup settings** in the browser copies current settings to
profile 1 through the normal settings writer without enabling AutoSave.
Named instrument files are installed immediately and survive firmware-only updates.

## Capacity And Conversion

| Resource | Limit |
| --- | --- |
| Voice slots, including releases | 8 |
| Mono signed PCM16 sample pool | 49,152 bytes / 24,576 frames |
| Recordings per instrument | 16 |
| Non-overlapping pitch/velocity regions | 32 |
| Stored instrument slots | 32 |

Recordings are shared by voices. File size also includes bounded metadata;
the maximum complete file is 51,264 bytes. Original low sample rates are retained
when possible. An oversized instrument is downsampled with a conversion report;
some sources require trimming or fewer recordings. Odd sustain loops retain
their periodic pitch through reduction. Both sample RAM and converted-file size
are shown before transfer.

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

`synth/CompactSampler.cpp` owns preparation, selection, runtime directory and
private readers. `CompactSamplerCodec.h` contains the bounded, host-testable
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

The installed files are `/sampler/00.hbc` through `/sampler/31.hbc`. Transfers
stream into the existing temporary-file mechanism, validate metadata and PCM,
then rename into an unused slot. An interrupted or rejected install cannot
replace an existing instrument. Abandoned transfers use the existing preset-sync
timeout and restore muted output. File loading is read-only. Mount and content
failures retain normal operation and report exact paths/stages; boot never formats
or repairs storage. Invalid boot selections use the wavetable fallback.

`SamplerSlot` is appended to `SettingKeys.inc.h`: 0–31 select instruments and
255 selects wavetable. Settings version 36 has 61 non-synth bytes per profile;
versions 32–35 retain their original prefixes and initialize the new byte from
factory defaults. See [settings ownership](developer-guide.md#settings-and-persistence)
and the [wire/format contract](preset-sync-sysex.md#classic-compact-sampler).

## Verification Tools

`scripts/compact_sampler.py` installs user-supplied HBC files with ACK pacing,
checks byte-for-byte readback, lists slots and stresses engine changes. It requires
`mido` and `python-rtmidi`; `scripts/test_synth_performance.py` additionally needs
`pyserial`. Files and output reports can live outside the repository:

```sh
python3 scripts/compact_sampler.py --install /path/to/Instrument.hbc --output /tmp/install.json
python3 scripts/compact_sampler.py --select 0 --switch-cycles 30 --output /tmp/switching.json
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

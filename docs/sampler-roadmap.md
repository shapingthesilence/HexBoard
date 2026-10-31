# Sampler Roadmap — Unimplemented Features

This is a proposal for later passes, not a description of shipped controls.
The shared Sample/Map/Sound editor, setup sheet, tuning/loop workflow and Advanced voice/tail reservations, stereo SD, envelope/LFO motion and configurable room are implemented; see [Sample tuning](sampler-tuning.md).

## Shared Authoring, Qualified Device Profiles

Keep one editor for both boards. Browser analysis, reference audition, loop
suggestions, pitch anchors, import reports and offline processing must remain
available to both. Show capability-dependent playback/export differences with a
clear adaptation report. Do not hide shared authoring behind an Advanced flag.
Native DSP must fit each board's measured budget; no claim that the devices have
identical polyphony, storage, streaming or effects.

## Remaining Motion And Import Fidelity

The separate DAHDSR envelope, delayed/faded vibrato and general LFO, sine/triangle
shapes, pressure/velocity depth, key-scaled hold/decay and per-region resonance are
implemented. Supported SoundFont generator inheritance compiles into native
region records. See [motion and room](sampler-motion.md).

- Compile default/custom SF2 MIDI modulators with inheritance, overrides, units
  and source curves. Current generator support does not implement arbitrary
  controller modulation. Keep omitted or baked routes explicit in import reports.
- Additional joystick, pedal and MIDI-controller sources, velocity/key-scaled
  attack/release and independent LFO shapes/phases need explicit scope and budgets.
- Qualify more moving-filter, sample-band transition and stereo card workloads.
  Pitch-copy preparation now includes authored envelope/LFO/vibrato bounds; a
  measured automatic feature-admission model remains separate work.

Advanced's default profile keeps 16 held voices plus four tails under
qualified workloads. Patches can now explicitly choose 1–16 held voices and 0–4
extra release slots. A future measured admission model must account for that
choice, per-voice features, shared effects, memory and SD demand separately;
current source-size/read-count summaries are not DSP qualification. Classic should gain native features only where measured
budgets permit; otherwise use shared browser audition and explicit offline
adaptations. Never silently substitute a baked loop for live pressure expression.

## Further Reverb Controls

Amount, Decay, Tone and Width use the existing Advanced network. Browser audition
builds matching room responses off the UI thread and crossfades shape changes.
Low cut, predelay and per-zone sends remain candidates. Predelay consumes buffer
memory; per-zone sends require mixing work. Variable room-size/delay lengths need
click-free transitions and separate memory/CPU qualification. Keep bypass and the
limiter ceiling unchanged. Classic shares authoring/original audition and reports
omitted native effects in its export adaptation.

## Later, Separately Qualified

- Shared bus chorus; live velocity/pressure layer crossfades; release-trigger
  recordings. These add readers, delay memory or I/O and must
  not silently compromise the standard voice budget.
- Offline pitch-drift correction with a visible edit curve and preservation of
  intentional vibrato. Duration-preserving pitch/time processing is separate
  from the current rate-based correction.
- A visual beating/phase aid, manual harmonic/fundamental selection for difficult
  samples, broader pitch-analysis range and real-instrument accuracy corpus.
- Streaming analysis of exceptionally long individual loop windows and faster
  incremental verification. Current HBS checking already decodes sustain windows
  on demand instead of creating a second full floating-point bank.
- End-to-end device clock/pitch calibration against a measured reference; browser
  estimates and format precision alone do not prove absolute DAC-clock accuracy.
- Saved named analysis revisions/original comparisons beyond the current panel
  session, and direct device-tuning synchronization rather than editor snapshots.

Any necessary Advanced bank-format change should be one deliberate revision with
converted current banks, rather than accumulating unreleased compatibility readers.
Classic settings compatibility continues to follow that repository's supported
settings migration policy. Validate browser behavior and export on both profiles;
then measure native audio, storage, scanner timing and physical playing separately.


## Remaining instrument and standalone work

- Reverse/ping-pong playback and arbitrary starts need explicit residency rules.
  Stereo streaming is implemented; extend its named card/rate/bend/modulation
  qualification before general capacity claims. Never silently reduce the saved
  voice count to enable a feature.
- Transient slicing and editable slice boundaries extend current equal slices.
  Keep tuning/layout independent of physical Kit/Slices key assignments.
- Standalone sampler authoring should reuse the existing joystick/OLED ownership:
  saved sounds and quick edits, explicit saves, and captured soft-key/audition
  release behavior. Full authoring remains in Sync; no second editor framework.
- Longer unattended/card-fragmentation/combined-load runs and physical listening
  remain required before general capacity, quality or power claims.

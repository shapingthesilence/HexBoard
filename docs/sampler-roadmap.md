# Sampler Roadmap — Unimplemented Features

This is a proposal for later passes, not a description of shipped controls.
The shared tuning/loop workflow is implemented; see [Sample tuning](sampler-tuning.md).

## Shared Authoring, Qualified Device Profiles

Keep one editor for both boards. Browser analysis, reference audition, loop
suggestions, pitch anchors, import reports and offline processing must remain
available to both. Show capability-dependent playback/export differences with a
clear adaptation report. Do not hide shared authoring behind an Advanced flag.
Native DSP must fit each board's measured budget; no claim that the devices have
identical polyphony, storage, streaming or effects.

## Next Pass: Motion And Import Fidelity

- Separate modulation DAHDSR from the existing volume envelope. Route it to
  vibrato depth, pitch and brightness.
- Separate vibrato LFO and general modulation LFO, with rate/depth/delay/fade and
  note-relative phase. Start with triangle/sine. Add pressure, velocity, key,
  joystick, pedal and MIDI controller sources where supported.
- Compile common SF2 default/custom modulators with correct inheritance,
  overrides, units and source curves into bounded native control paths. Keep
  omitted or baked routes explicit in the import report.
- Add per-zone filter resonance and velocity/key scaling of envelope times;
  preserve fixed-key/fixed-velocity semantics without unnecessary audio baking.
- Qualify moving filter coefficient cost, reader-band transitions and streaming
  demand. Control-rate evaluation is a proposed optimization, not proof of cost.
- Combine bend, vibrato and pitch-envelope bounds when preparing sample copies
  and pinned starts. Preserve continuous microtonal pitch and captured roots.

Advanced's standard profile must keep 16 held voices plus four tails under
qualified workloads. Classic should gain native features only where measured
budgets permit; otherwise use shared browser audition and explicit offline
adaptations. Never silently substitute a baked loop for live pressure expression.

## Configurable Reverb

Expose Amount, Decay, Tone/damping and Width using the existing Advanced network.
Then assess low cut, predelay and per-zone sends. Predelay consumes additional
buffer memory; per-zone sends require mixing work. Variable delay lengths/room
size need click-free transitions and separate memory/CPU qualification. Keep
browser/device behavior comparable, preserve bypass, and leave the limiter ceiling
unchanged. Classic can share authoring/offline adaptation; native support depends
on its capability and measured budget.

## Later, Separately Qualified

- Shared bus chorus; live velocity/pressure layer crossfades; release-trigger
  recordings; stereo streaming. These add readers, delay memory or I/O and must
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
  Stereo streaming must qualify the Advanced 16-held/four-tail floor with a named
  card/rate/bend envelope; do not silently reduce voices to enable a feature.
- Transient slicing and editable slice boundaries extend current equal slices.
  Keep tuning/layout independent of physical Kit/Slices key assignments.
- Standalone sampler authoring should reuse the existing joystick/OLED ownership:
  saved sounds and quick edits, explicit saves, and captured soft-key/audition
  release behavior. Full authoring remains in Sync; no second editor framework.
- Longer unattended/card-fragmentation/combined-load runs and physical listening
  remain required before general capacity, quality or power claims.

# Sample Tuning And Loop Suggestions

The **Analyze & tune** panel is shared by Classic and Advanced in Sync's Sampler.
It runs in the browser before copying an instrument to either board. It does not
require a firmware update or additional per-voice DSP.

## Measure A Recording

Select a recording, then select a stable sustain in the analysis waveform. Drag
its two handles, use Left/Right for one frame (Shift for 100), or enter start/end
seconds. Selections can be up to 30 seconds; the initial selection covers up to
five seconds after the first 15% of the recording.

Choose **Analyze pitch & suggest loops**. The pitch trace shows measured cents
relative to the selection's median; gaps indicate uncertain estimates. Read the
estimated frequency, confidence, variation and offset from the current root.
Confidence measures periodicity and coverage, not a guarantee of accuracy.
Analysis currently covers 30–2500 Hz. Silence, noise, short clips, ensembles and
inharmonic material can produce no reliable single pitch or an octave error.

Existing WAV/SoundFont roots and corrections are preserved. An untagged WAV may
receive a precise suggested root only when its pitch is stable and confidence is
high. Analyzing a recording never silently applies another correction.

## Set The Anchor Or Correct The Recording

**Root frequency (Hz)** and **Fine tune anchor (cents)** edit the precise root;
Fine cents are relative to the opening anchor, so Undo and root edits remain
consistent. Type a value and press Enter or leave the field to apply it; Escape
cancels. Arrow keys apply one step immediately (Shift multiplies the step by ten).
MIDI note names elsewhere are labels, not semitone quantization. **Use measured
tuning anchor** says what pitch was recorded. The sampler then transposes from
that anchor to the key being played, without changing source PCM.

**Target frequency (Hz)** defines the comparison pitch. After visiting Tunings &
Layouts in the same session, **Tuning key** offers the tuned keys from that editor,
including Scala/non-octave tunings and custom reference frequencies. This is the
last tuning-editor preview, not an assertion about which tuning is currently
active on a connected board. Direct-MIDI/chord/disabled keys are excluded.

**Correct recording to target on export** adjusts the recording clock and root;
the normal exporter renders that correction. Source PCM is retained and Undo is
available. This is ordinary resampling: duration changes. It does not remove
pitch drift or flatten vibrato, ensemble beating or piano stretch tuning. Large
corrections beyond one octave require setting the anchor instead.

## Listen And Compare

Use **Hear sample**, **Hear reference**, **Sample + reference**, or **Alternate
sample / reference**. The reference is a quiet sine at the target frequency;
listen for beating and use the octave buttons when a detector follows an overtone.
Audition supports targets from 20 to 16000 Hz. Root and target edits affect a held tuning
audition smoothly, including the reference tone. **Compare** switches between the edited recording and its
state when this recording's analysis panel was opened. **Loop-only audition**
skips the attack when a loop exists. Auditions stop after eight seconds; **Stop
tuning audition**, **All notes off**, and changing recordings also stop them.

## Choose A Loop

Stable selections offer **Natural**, **Compact**, and **Smooth** candidates.
Natural favors a longer sustain, Compact a shorter one, and Smooth includes a
small crossfade. Suggestions compare boundary shape/slope across both channels
and avoid near-silent candidates. They do not guarantee a seamless musical loop.

Each candidate shows its duration, seam score, crossfade, measured repeating-loop
pitch and estimated change from the source. Hear candidates before applying them.
**Use loop** changes boundaries while preserving an existing loop-until-release
mode. **Use loop and measured anchor** also applies the loop's measured root.
Uncertain pitch is never used automatically. Existing manual loop tools remain
available, including exact length locking and seam matching.

**Verify rendered loop tuning** measures the repeated loop after its crossfade,
not the raw recording or the loop's repetition rate. A multi-cycle loop's repeat
rate is not the note's fundamental.

Export also checks stable source/device loop regions at the same played pitch,
accounting for root and key-tracking changes. Advanced verification validates the
bank and decodes sustain windows on demand, rather than making another complete
floating-point bank copy. Its report gives the largest estimated tuning change
and identifies regions that could not be verified, including protected copies
outside the detector's range. These checks are advisory and never secretly
rewrite imported tuning. Existing device/file capacity limits still apply.

Classic retains its existing resident capacity and conversion limits; Advanced
retains its current resident/SD profiles. Both store fractional tuning using their
existing formats. These tools do not add streaming or native effects to Classic.

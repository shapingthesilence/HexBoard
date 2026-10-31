# Sample Tuning And Loop Suggestions

Sync's Sampler has three linked workspaces on Classic and Advanced: **Sample**
for trim, pitch and loops, **Map** for pitch/velocity regions or HexBoard key
assignments, and **Sound** for envelopes, tone, expression and room. Selection,
waveform zoom and audition stay available when changing workspace.

**Setup** (instrument setup) is an optional, single sheet available before importing or
at any later time. Starting points suggest natural/compact sustain design or
Kit/Slices mapping. Sustain design does not replace authored loops automatically.
Choose 2, 4 or 8 cycles for compact design. Advanced's held voices (1–16) and
extra release slots (0–4) are saved in HBS and enforced by browser audition and
current audio firmware; defaults remain 16+4. Classic retains its eight-voice
profile. Reducing voices stops old audition voices when applied. It reduces
reader/filter work, not the preallocated renderer's SRAM footprint.

The channel choice keeps source channels or explicitly mixes stereo to mono;
Undo retains the previous PCM. Advanced preserves stereo in both resident and
SD profiles. Stereo doubles sample bytes and channel processing; configured
voices and device qualification determine the useful performance profile.
Setup also offers optional gentle/pressure vibrato starting points; Keep authored
motion preserves imported regions. Sound has **Envelope**, **Touch & release** (Advanced), **Motion**
and **Room** pages. See [motion and room](sampler-motion.md).

The Setup button summarizes voices, channels, room and motion. It does not
estimate CPU load or certify device timing. Preparation determines actual converted bytes, pitch copies and cache admission.
Measured feature admission, custom controller routes and further effects remain in
the [roadmap](sampler-roadmap.md).

On desktop, the waveform stays beside one Loop / Tune inspector. Narrow screens stack these controls and keep the audition dock available.

Analysis opens inline from **Sample → Tune & analyze**.
It runs in the browser before copying an instrument to either board. It does not
require a firmware update or additional per-voice DSP.

## Measure A Recording

Select a recording, then drag a stable sustain region in the main waveform. The analysis panel uses that same selection; enter start/end seconds there to refine it. Selections can be up to 30 seconds. Without an explicit selection, import, batch suggestions and source analysis use an energy-envelope window after the estimated initial attack and before the quiet tail, capped at 750 ms. This is a heuristic rather than guaranteed transient separation; the main waveform selection always takes precedence for manual analysis.

Choose **Analyze pitch & suggest loops**. The result shows the detected note and whether its pitch varies. Open **Measurement details** for frequency, confidence, variation, offset from the current root and a pitch trace. The trace shows cents relative to the selection's median; gaps indicate uncertain estimates. Confidence measures periodicity and coverage, not a guarantee of accuracy.
Analysis currently covers 30–2500 Hz. Silence, noise, short clips, ensembles and
inharmonic material can produce no reliable single pitch or an octave error.

Existing WAV/SoundFont roots and corrections are preserved. An untagged WAV may
receive a precise suggested root only when its pitch is stable and confidence is
high. Analyzing a recording never silently applies another correction.

## Set Original Pitch Or Retune The Recording

**Original pitch** (note, octave and cents, with the frequency shown below) edits the selected recording directly. In **Tune & analyze**, **Precise original pitch and reference** provides **Root frequency (Hz)** and **Fine tune anchor (cents)**, which edit that same root;
Fine cents are relative to the opening anchor, so Undo and root edits remain
consistent. Type a value and press Enter or leave the field to apply it; Escape
cancels. Arrow keys apply one step immediately (Shift multiplies the step by ten).
MIDI note names elsewhere are labels, not semitone quantization. **Set original pitch from measurement** says what pitch was recorded. The sampler then transposes from
that anchor to the key being played, without changing source PCM.

**Target frequency (Hz)** defines the comparison pitch. After visiting Tunings &
Layouts in the same session, **Tuning key** offers the tuned keys from that editor,
including Scala/non-octave tunings and custom reference frequencies. This is the
last tuning-editor preview, not an assertion about which tuning is currently
active on a connected board. Direct-MIDI/chord/disabled keys are excluded.

**Retune recording to target on export** adjusts the recording clock and root;
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
tuning audition**, the dock's **All notes off**, and changing recordings also stop them.

## Choose A Loop

Stable selections offer **Natural**, **Compact**, and **Smooth** candidates.
Natural favors a longer sustain, Compact a shorter one, and Smooth includes a
small crossfade. Suggestions compare boundary shape/slope across both channels
and avoid near-silent candidates. They do not guarantee a seamless musical loop.

Choose **Loop suggestion** to compare Natural, Compact and Smooth in one review area. The blue outline on the main waveform previews the suggestion; gold handles represent the saved loop. Each candidate shows its duration, seam score, crossfade and estimated pitch difference. **Hear suggestion** auditions it without applying.
**Use suggested loop** changes boundaries while preserving an existing loop-until-release
mode. **Use loop & measured anchor** also applies the loop's measured root.
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

## Tiny Periodic Loops And PCM Edits

In **Sample → Loop**, choose **Compact · 2–8 cycles**, choose 2, 4 or 8 cycles, then **Find compact loop**. It keeps the attack through the loop and trims the unused ending. PCM stays intact; Undo restores the previous trim. The search uses the recording's original-pitch anchor and the main waveform selection; it does not require the tiny loop to pass pitch detection. Metadata, a source measurement or manual original pitch can supply the anchor. The cycle-based Hz readout is a calculation from rate, length and assumed cycles, not a measured fundamental. **Tune from cycle count** explicitly applies that assumption.

When a recording loops, use **Keep attack / loop only…** (Classic: **Reduce size…**) to compare **Keep attack + loop** with **Loop only**, audition the candidate, then apply it. Both remove trailing tail data and switch to envelope-release looping. Retained PCM is an estimate; prepared size after export is authoritative. No sample-rate-reduction memory claim is made for Advanced's fixed-rate export.

At 96 visible frames or fewer, choose the **Pencil** tool to draw points. **Edit audio** offers linked channels (default) or a selected stereo channel, DC removal, normalization, smoothing and amplitude scaling of the selected region. **Repair seam…** (shown when the recording loops) previews either a locked-length boundary adjustment or PCM smoothing. Apply only after comparison. Original PCM remains reachable through Undo; a drawing gesture is one undo step. These are waveform edits, not duration-preserving pitch correction.

## Persistent Browser Audition

The bottom audition dock remains available in all three workspaces. Click its keyboard to play at any time. Turn on **Keys & MIDI** to also play with computer keys A W S E…; text fields and dialogs do not trigger typing notes. Choose **Instrument** for the full map or **Selected recording** to bypass mapping. Octave, velocity, volume, sustain and **All notes off** are in the desktop dock; **More…** opens audition settings with pressure and bend controls. On narrow screens, play target, velocity, volume and sustain move into that same sheet so All notes off and octave controls stay accessible.

With a connected HexBoard transport, turning on **Keys & MIDI** also listens to its MIDI input. Notes, note-off velocity, sustain, channel bend/RPN range, channel pressure and poly pressure feed browser playback without MIDI echo. Disconnect and All notes off release voices. Held loop readers crossfade to edited PCM/loop boundaries after rapid edits settle. Browser audition and conversion checks do not establish physical device timing or listening qualification.

Use **Save / export** for preparation, output settings, the board library and conversion reports. Named warnings offer **Review** to return to the affected recording's Sample view. **SFZ folder…** in the toolbar imports an SFZ folder. The dock's **All notes off** stops instrument, source and tuning auditions. Export also provides instrument naming, so naming does not require leaving the save dialog.

## Pitch Recognition And Musical Readouts

Source recognition uses shorter overlapping frames, normalized autocorrelation and interpolated period candidates. It prefers the shortest convincing complete period rather than a longer subharmonic, with conservative long-baseline refinement only when it agrees. Rendered-loop verification keeps the stricter precision path so improved source recognition does not overstate cents-level conversion accuracy. Silence, noise and out-of-range/decimation artifacts remain rejected.

Imports accept high-clarity source estimates with up to 25 cents of measured variation, rather than requiring an unrealistically constant plucked note. The fractional median is preserved, without snapping the recording to the filename or an equal-tempered note. File tuning metadata still wins. Wider drift or ambiguity remains advisory rather than automatically changing the anchor.

The main view shows the original musical note, playback mode, level, editing controls and loop duration. Compact mode shows assumed cycles and loop duration because they affect waveform design. Sample rate, raw frame counts, Hz, seam scores and periodicity statistics are in **Details**, **Exact trim & waveform display**, or analysis measurement details. The analysis result defaults to the detected note and whether it varies. Precise measurements remain available for tuning, seam work and troubleshooting; they are not presented as guaranteed musical correctness.

In Classic's **Optimize** dialog, sample-rate reduction offers conservative filtering before downsampling. A Blackman-windowed sinc filter removes high harmonics with a transition band below the new Nyquist frequency. Preview original and reduced audio before applying. For loops, the exact new native rate follows the rounded loop length to preserve repetition pitch. Classic stores this reduced PCM and native rate directly, saving sample RAM. Advanced's current fixed-rate export does not offer this control, because simple downsampling followed by upsampling would not provide that storage saving.

Method background: [McLeod and Wyvill, A Smarter Way to Find Pitch](https://citeseerx.ist.psu.edu/document?doi=60dd4c01f687858a5fbf6c021920c56247bcf2db&repid=rep1&type=pdf). The browser implementation combines normalized correlation with the existing conservative refinement; it is not a neural model or a full pYIN implementation.

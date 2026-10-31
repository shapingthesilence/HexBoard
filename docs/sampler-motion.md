# Sampler Motion And Room

Use **Setup** in the toolbar early or whenever the instrument needs a different
performance profile. Held voices and release slots are explicit choices on
Advanced. Source stereo is preserved in RAM and on SD, or choose Mix to mono.
Keep authored motion preserves imported settings. Gentle delayed vibrato and
Pressure vibrato are optional starting points that replace motion for every
region when applied; Undo restores the previous patch.

**Sound** has focused pages. **Envelope** contains the region envelope, pan,
key tracking, round robin, choke group, velocity curve, delay, hold and filter.
**Touch & release** (Advanced) contains pressure tone and level, key and pedal
release and patch response. **Motion** contains selected-region expression;
**Room** contains the shared effect. Region level is on **Sample**. The audition
dock stays available.

## Motion

Motion opens on Vibrato, with Depth, Rate, Delay and Fade in. Depth follows
Automatic, Motion envelope, Key pressure or Strike velocity. Envelope opens the
separate DAHDSR and its Pitch/Brightness depths. LFO opens rate, delay, fade and
Pitch/Brightness/Tremolo depths. Tremolo is bipolar in dB and stays at unity while delayed; negative depth reverses its direction. The two LFOs share the Sine/Triangle choice and
start relative to note-on. Zero depth disables a route. Pitch units are cents;
roots, tuning and bends remain continuous.

The selected region owns these settings. **Use this motion for all regions**
copies them explicitly. Note release starts the modulation release stage;
sustain defers it until pedal-up. One-shots retain their existing release rules.
Pressure is per captured key where available; MIDI/channel expression still
follows the input adapter's ownership. Shared room parameters are not driven by
competing per-note pressure events.

Advanced evaluates motion once per 128-frame audio block; volume envelope and
sample reading remain at audio rate. This has finite control resolution and is
not audio-rate FM. Export includes worst positive pitch movement in protected
sample copies and pinned starts. Fixed-pitch regions reject motion above 970
cents rather than producing an unsafe reader rate. Unsupported extreme ranges
produce actionable conversion errors.

## Room

Room exposes Amount, Decay (200–8000 ms), Tone (dark to bright), and Width.
Width zero makes the wet return mono; dry stereo remains intact. Amount zero
bypasses native room processing. Decay changes feedback in the existing delay
network, and tone changes its damping; neither allocates new delay memory.
Native changes are smoothed. Browser audition calculates matching impulse
responses in a worker and crossfades changes, keeping the controls responsive.
Decay is a musical target, not a measured constant across every frequency.

The existing live SD-library amount control and header-only Save effect remain
available. Native parameter IDs 13–15 additionally support decay, tone and width.
Other patch edits are auditioned before normal export/transfer. Predelay, variable
room size, per-zone sends and further effects remain [planned](sampler-roadmap.md).

## Import And Device Differences

SoundFont flattening resolves inherited supported generators before conversion. SoundFont LFOs retain their triangular shape; source envelope curves are reported as an adaptation to the bounded linear DAHDSR model.
Volume/modulation hold/decay key scaling, modulation envelope, vibrato/general
LFO generators, bounded resonance and fixed key/velocity semantics are preserved.
Custom MIDI modulator routing remains an explicit adaptation, not a claim of full
SoundFont modulation compatibility. Values outside live limits are reported.
SFZ supports pitch-LFO, amplitude-LFO and filter-envelope generators in addition
to existing sample and volume-envelope opcodes. Other opcodes remain reported.

Classic shares these authoring and original browser audition tools. Its current
native compact profile omits live motion, filters and room; conversion warnings
and converted audition make that difference visible. It also downmixes stereo.
Offline baked movement is a separate adaptation with its own report, not a
substitute for live pressure expression.

The combined stereo/motion/long-room workload exceeds the deadline at 16 held + 4 tails. Setup offers an explicit 8 held + 2 tail starting profile; export warns when a larger stereo profile needs qualification. The voice count is never silently reduced. Mono retains its standard 16+4 profile.

The Setup button summarizes voices, channels, room and motion. The editor does
not infer a CPU percentage from browser speed. Stereo, moving filters and long room
tails require named hardware workloads and a suitable voice profile. The editor
never silently lowers the saved number of voices.

Generator unit reference: [SoundFont 2.04 specification](https://www.synthfont.com/sfspec24.pdf), sections 8.1.2–8.1.3. Filter resonance is adapted to the device two-pole model rather than claiming source-identical filter gain.

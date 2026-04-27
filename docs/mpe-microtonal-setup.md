# MPE Microtonal Setup Guide

This guide explains how HexBoard sends microtonal pitches over MIDI, how to set up common DAWs and synths to receive them, and when to change the `MIDI` menu's MPE settings.

## Quick Setup

For most MPE-capable software instruments:

1. On HexBoard, leave `MIDI` -> `MPE Mode` set to `Auto`.
2. Leave `MPE Bend` at `48` unless your synth uses a different MPE pitch-bend range.
3. Leave `MPE Low Ch` at `2` and `MPE High Ch` at `16` unless the receiver has fewer voices or channels.
4. In the DAW or synth, enable MPE.
5. Choose the lower MPE zone if the receiver asks for a zone.
6. Set the global or master channel to `1`.
7. Set the note/member channels to `2-16`, or set the MPE channel count to `15`.
8. Set the per-note pitch-bend range to match HexBoard's `MPE Bend` value.

Do not also load the same microtonal scale into the receiving synth unless you are intentionally combining tuning systems. HexBoard's MPE output is already retuned before it reaches the synth. A second microtuning layer will usually make the result wrong.

## How HexBoard Retuning Works

MIDI notes are normally chromatic 12-EDO note numbers. That is not enough to represent HexBoard tunings such as `17 EDO`, `31 EDO`, `Bohlen-Pierce`, or dynamic just intonation. HexBoard handles this by sending each played note on its own MIDI channel and applying pitch bend only to that note.

For each playable button, the firmware:

1. Computes the intended pitch from the active tuning, layout, key, and transpose.
2. Converts that pitch to a fractional MIDI note value relative to A4 = `440 Hz`.
3. Rounds to the nearest standard MIDI note number.
4. Computes the pitch bend needed to move that rounded note to the exact target pitch.
5. Sends the pitch bend on the note's MPE channel.
6. Sends the note-on on the same channel.

In MPE mode, channel `1` is the global/master channel. HexBoard uses the configured MPE note-channel range for individual notes. The factory range is channels `2-16`, which gives up to `15` simultaneous MPE note channels.

The receiving instrument must use the same pitch-bend range as HexBoard. If HexBoard is set to `MPE Bend = 48`, the synth must treat full-scale per-note pitch bend as `+/-48` semitones. If the synth is set to a different range, notes will be out of tune even though MIDI is being received.

## HexBoard MPE Settings

### MPE Mode

`Auto` is the normal setting. In `Auto`, ordinary `12 EDO` stays in regular MIDI unless dynamic or BPM-linked just intonation needs per-note retuning. Microtonal tunings and non-standard 12-tone tunings use MPE automatically.

`Force` uses MPE even when the active tuning does not require it. Use this when testing an MPE setup, when a synth preset expects MPE expression, or when you want a consistent MPE recording path for both 12-EDO and microtonal material.

`Disable` prevents MPE. In non-12 tunings, HexBoard can still spread MIDI note numbers across channels without pitch bend, but a normal synth will not become microtonal from that alone. Use this only with a downstream retuning system that knows how to interpret those channels, or while troubleshooting a receiver that mishandles MPE.

### MPE Bend

`MPE Bend` is the per-note pitch-bend range, in semitones. Available values are `1`, `2`, `12`, `24`, `48`, and `96`.

Use `48` first. It is the factory default and a common MPE default. Change it when:

- The receiving synth has a fixed or limited range, such as `12`.
- The synth preset is already configured for another MPE pitch-bend range.
- Recorded MPE clips were captured with another range and must play back the same way.
- You are using dynamic just intonation and want finer bend resolution for small pitch corrections.
- You need more bend headroom for wide pitch movement or retuning and the receiver supports a larger range.

The rule is simple: HexBoard and the receiving synth must match.

Smaller bend ranges can be useful with dynamic just intonation because the subtle pitch shifts become audible through beating between held notes, and finer pitch-bend resolution can make those corrections cleaner. Do not set the range too low if you use JI BPM sync or wide retuning, because the required correction can run out of pitch-bend headroom. When that happens, the note can no longer reach the intended pitch even though MPE is enabled.

### MPE Low Ch And MPE High Ch

These settings choose the note channels HexBoard can use. The default is `2-16`.

Change them when:

- A hardware synth supports fewer MPE note channels than HexBoard's default.
- You want to reserve MIDI channels for another instrument on the same port.
- A DAW or plugin is configured for a smaller MPE zone.

Set the receiver to the same channel range. If it asks for channel count rather than high channel, use:

```text
channel count = MPE High Ch - MPE Low Ch + 1
```

For example, `2-16` is `15` note channels. `2-9` is `8` note channels.

### MPE Low Priority

This changes MPE channel allocation behavior. Leave it off unless you are deliberately testing channel behavior with a limited channel range.

If held notes are being dropped, increase the channel range if the receiver supports it. If the receiver cannot support more channels, reduce the number of simultaneous notes or use a less dense voicing.

### Extra MPE

`Extra MPE` adds per-note expression messages such as channel pressure and CC74. Leave it off for basic pitch retuning. Turn it on when the receiving synth is configured to use pressure or CC74 as expressive controls.

This option was added mainly to improve compatibility with receivers such as the Haken Continuum that expect a fuller MPE expression stream.

If enabling `Extra MPE` unexpectedly changes filter brightness, timbre, or loudness, either map those controls intentionally in the synth or turn `Extra MPE` back off.

## DAW Setup Notes

### Ableton Live

Ableton Live has two different microtonal workflows. Pick one tuning authority for a track: either HexBoard retunes notes with MPE, or Live's Tuning System retunes ordinary note numbers. Do not use both on the same instrument unless you intentionally want stacked retuning.

#### HexBoard MPE Retuning

1. Open `Preferences` -> `Link/MIDI`.
2. Enable the `MPE` button for HexBoard's MIDI input.
3. Use an MPE-capable Live instrument or an MPE-capable third-party plugin.
4. For third-party plugins, also enable MPE in the plugin or plugin wrapper when Live exposes that option.
5. Match the instrument's pitch-bend range to HexBoard's `MPE Bend`.

Live 12 instruments support MPE. In Live 11, use an MPE-capable device or plugin. If a plugin receives notes but all pitch bends affect the whole chord, the plugin or Live device wrapper is probably not in MPE mode.

Use this workflow when HexBoard's firmware tuning, dynamic just intonation, or JI BPM sync should define the final pitch.

#### Live Tuning Systems

Live 12 can load built-in tunings, Scala `.scl` files, and Ableton `.ascl` tuning files. In this workflow, Live owns the retuning, so HexBoard should send note numbers without MPE pitch-bend retuning.

1. On HexBoard, set `MIDI` -> `MPE Mode` to `Disable`.
2. On HexBoard, choose the same tuning/layout you want to play so the grid, scale behavior, note indices, and LEDs still match your musical intent.
3. In Live, load the matching Tuning System from the browser's `Tunings` label, or drag a compatible `.scl` or `.ascl` file into the Tuning section.
4. Leave Live's MPE input setup for HexBoard off unless another track specifically needs it.
5. Use Live's built-in instruments, or use plugins/external instruments that Live can drive from its Tuning System.
6. Keep HexBoard's played range inside MIDI notes `0-127`. HexBoard's non-MPE channel folding is for receivers that understand that convention; Live's Tuning Systems should be treated as note-index based, not as an extended channel-folded note space.

If Live is retuning a third-party plugin or external instrument through MPE, Live's documentation expects the receiving instrument to use a `+/-48` semitone per-note pitch-bend range. That is downstream from Live and separate from HexBoard's `MPE Bend`, because HexBoard's MPE retuning is disabled in this workflow.

This works best when Live's loaded tuning uses the same note order and reference pitch as the selected HexBoard tuning. HexBoard computes pitches from A4 = `440 Hz`. If a Scala `.scl` file sounds offset in Live, adjust Live's reference pitch and save the result as an `.ascl` file. If Live uses a tuning that HexBoard does not have, HexBoard can still send note numbers, but its layout, labels, and LEDs may not correspond to Live's final pitches.

Tradeoffs:

| Area | HexBoard MPE retuning | Live Tuning Systems |
| --- | --- | --- |
| Pitch source | HexBoard computes final pitch and sends per-note pitch bend | Live maps incoming note numbers through the loaded tuning |
| Best for | Hardware/software that should follow HexBoard's tuning, dynamic JI, or BPM-linked JI | Live-native production, Live piano roll editing, and projects that should carry their tuning in the `.als` |
| DAW editing | Recorded MIDI contains MPE pitch-bend expression that must keep the same bend range on playback | Recorded MIDI is ordinary note numbers interpreted by the active Live tuning |
| Dynamic JI | Supported from HexBoard | Not represented by Live's static tuning file |
| JI BPM sync | Supported from HexBoard, subject to bend-range headroom | Not represented by Live's static tuning file |
| Compatibility | Requires MPE-capable receiver and matching bend range | Works directly with Live instruments; plugins or external instruments may still require Live-driven MPE at `48` semitones |
| Main risk | Wrong receiver bend range causes wrong pitches | Loading a different tuning changes what the same MIDI notes mean |

### Logic Pro

1. Use a Logic instrument that supports `MIDI Mono Mode`, or use an MPE-capable third-party plugin.
2. Open the instrument's extended parameters.
3. Set `MIDI Mono Mode` to the mode with common/base channel `1`.
4. Set the mono mode pitch range to HexBoard's `MPE Bend`.

Logic's built-in MPE-capable instruments include Alchemy, EFM1, ES2, Quick Sampler, Retro Synth, Sampler, Sculpture, and Vintage Clav. Logic's MPE mono mode uses separate MIDI channels for note expression, so the pitch range still has to match HexBoard.

### Bitwig Studio

Bitwig's own devices are designed around per-note expression. For third-party plugins:

1. Select the plugin device.
2. Open the Inspector.
3. Enable `Use MPE` if it is not already enabled.
4. Set the plugin `PB range` to HexBoard's `MPE Bend`.
5. Make sure the plugin itself is also in MPE mode if it has its own MPE switch.

### Cubase And Nuendo

1. Add or select HexBoard as a Note Expression or MPE input device if it is not detected automatically.
2. Select HexBoard as the instrument track input.
3. Avoid forcing all input to one MIDI channel. For MPE, the note channels must stay separate.
4. Open the track's Note Expression section and confirm pressure, horizontal, and vertical movement mappings if you use expression data.
5. Use an MPE or Note Expression-capable instrument, then match its per-note pitch-bend range to HexBoard.

For basic microtonal retuning, pitch bend is the critical expression. Pressure and CC74 only matter if `Extra MPE` is enabled and mapped intentionally.

### Channel-Transparent Hosts

Some hosts do not have a dedicated MPE setup page but can still pass multi-channel MIDI to an MPE plugin. In those hosts:

- Record or monitor all incoming MIDI channels from HexBoard.
- Do not remap input to channel `1`.
- Do not merge all channels before the synth.
- Put the synth itself in MPE mode.
- Match the synth's note-channel range and pitch-bend range to HexBoard.

### DAWless And MPC-Style Setups

DAWless setups are reasonable when the final sound source understands the tuning method. They are less reliable when a standalone groovebox is expected to act like a DAW tuning engine.

The most reliable DAWless path is:

```text
HexBoard -> MPE-capable hardware synth
```

Use HexBoard's normal MPE setup: `MPE Mode = Auto` or `Force`, lower zone, global channel `1`, note channels starting at `2`, and a matching per-note pitch-bend range on the synth.

An MPC-style box can still be useful as a sequencer, router, sampler, or audio recorder:

```text
HexBoard -> MPC MIDI input -> MPE-capable hardware synth
```

Treat this as a channel-transparency test. The MPC must preserve note channels, per-channel pitch bends, note-ons, note-offs, channel pressure, and CC74 if `Extra MPE` is enabled. Do not force all incoming MIDI to one output channel. If the MPC records the performance, play it back into the same MPE synth with the same bend range and channel range. If recorded chords come back in tune, the setup is usable.

Using HexBoard directly into MPC standalone internal instruments is not the recommended microtonal path unless that specific MPC instrument can receive independent per-channel pitch bends per voice. If it collapses MIDI to one channel or treats pitch bend globally, MPE retuning will fail for chords.

MPC-style sampling can still be musically useful:

- Sample the audio output of an MPE-capable synth while HexBoard performs the retuning.
- Build a keygroup or sample program that is already tuned for a specific static scale.
- Use HexBoard with `MPE Mode = Disable` when you only need note triggers and the MPC program itself is already tuned.

Tradeoffs:

| Setup | Reasonable? | Notes |
| --- | --- | --- |
| HexBoard directly into MPE hardware | Yes | Best DAWless choice for live microtonal chords and dynamic JI |
| HexBoard through MPC to MPE hardware | Maybe | Works only if the MPC preserves all channels and pitch bends during monitoring and playback |
| HexBoard into MPC internal instruments | Limited | Usually fine for 12-EDO; microtonal MPE chords require true per-channel/per-voice pitch bend support |
| HexBoard into MPC sampler/audio tracks | Yes | Record the tuned audio, or prebuild static tuned sample/keygroup programs |

For a first test, use a simple two-note chord in a non-12 tuning. If both notes stay in tune while held together, the receiver is preserving per-note retuning. If one note drags the other or both notes sound chromatic, the setup is not handling HexBoard's MPE retuning correctly.

## Synth Setup Notes

### Surge XT

Enable MPE from Surge XT's MPE settings menu. Set the current and default MPE pitch-bend range to match HexBoard. Surge XT also exposes MPE pressure and timbre sources, so `Extra MPE` can be useful once pitch is working.

### ROLI Equator And Equator2

Use MPE mode. Set:

- Global channel: `1`
- Channels: `2-16`, or the same reduced range you set on HexBoard
- Per-note pitch-bend range: same as HexBoard's `MPE Bend`
- Global pitch-bend range: usually `2`, unless you specifically need a wider global wheel range

Equator and Equator2 commonly default to `48`, which matches HexBoard's factory `MPE Bend`.

### Arturia Instruments And Pigments

For Arturia instruments that support MPE, enable MPE from the instrument settings. Then set the zone, channel count, and bend range to match HexBoard. Arturia's documentation also calls out that Ableton Live users must enable MPE on the Live side as well as inside the instrument.

For Pigments, use its settings menu and MPE controls. Set the bend range to HexBoard's `MPE Bend`; Pigments supports bend ranges up to `96` semitones and defaults to `48` in its documented MPE setup.

### Logic Built-In Instruments

Use `MIDI Mono Mode` with common/base channel `1`, then set the mono mode pitch range to HexBoard's `MPE Bend`. If a Logic instrument does not expose MIDI Mono Mode or MPE settings, choose another instrument or use a third-party MPE plugin.

### Hardware Synths

Use the synth's MPE receive mode, usually:

- Lower zone
- Global/master channel `1`
- Note/member channels starting at `2`
- Pitch-bend range matching HexBoard

If the synth has `8` voices, try HexBoard `MPE Low Ch = 2` and `MPE High Ch = 9`. If it has `6` voices, try `2-7`.

### Non-MPE Synths

A normal single-channel synth cannot play independent microtonal chord notes from HexBoard's MPE retuning. It may work for `12 EDO`, but microtonal chords need either:

- MPE support,
- one synth voice per MIDI channel with matched pitch bend,
- a DAW retuning plugin that understands the incoming multi-channel stream, or
- a hardware retuning setup designed for multi-channel microtonal MIDI.

## Test Procedure

1. Set HexBoard to `12 EDO`, `MPE Mode = Auto`, and confirm ordinary notes play.
2. Change HexBoard to a tuning such as `17 EDO` or `31 EDO`.
3. Confirm the DAW still sees notes on channels `2-16`.
4. Confirm the synth is in MPE mode with the same pitch-bend range as HexBoard.
5. Play a small chord. Each note should stay in tune independently.
6. Record a short MIDI clip and play it back without changing any MPE settings.

Keep the same bend range when reopening or moving a project. If a MIDI part was recorded with `MPE Bend = 24`, it should be played back into a receiver set to `24`.

## Troubleshooting

### Notes play, but the tuning is wrong

The synth pitch-bend range does not match HexBoard's `MPE Bend`, or the synth is also applying a microtuning table. Match the bend range first. Then disable any extra synth-side microtuning unless you intentionally want it.

In Ableton Live, also check which tuning workflow you are using. If Live's Tuning System is loaded, set HexBoard `MPE Mode` to `Disable`. If HexBoard is doing MPE retuning, remove Live's Tuning System from the Set unless you intentionally want both tuning layers.

### Every note bends together

The receiver is not in MPE mode, or the DAW is merging HexBoard's note channels into one channel. Enable MPE in the DAW and synth, and keep channels `2-16` separate.

### Some notes do not sound

The MPE channel range is too small for the number of held notes, or the DAW/synth zone does not match HexBoard's channel range. Use `2-16` where possible. If the synth has fewer voices, set both HexBoard and the synth to the same reduced range.

### Microtonal tunings sound chromatic

The receiver is ignoring pitch bend, or `MPE Mode` is set to `Disable`. Enable MPE on both sides, or use a downstream microtonal retuning system that is designed for HexBoard's non-MPE multi-channel output.

### Dynamic JI or BPM sync sounds constrained

The `MPE Bend` range may be too small for the required retuning. Smaller bend ranges can improve fine JI corrections, but JI BPM sync can need more pitch-bend headroom. Raise `MPE Bend` on both HexBoard and the receiver if notes stop reaching the expected pitch.

### 12-EDO does not show MPE data

That is expected in `Auto`. HexBoard uses regular MIDI for ordinary `12 EDO` unless MPE is needed. Set `MPE Mode` to `Force` if you need MPE output for a 12-EDO test or recording workflow.

### Timbre changes unexpectedly

Turn off `Extra MPE`, or remap the receiving synth's pressure and CC74 destinations. Basic microtonal pitch retuning only requires per-note pitch bend.

## Reference Links

- [Ableton: MPE in Live FAQ](https://help.ableton.com/hc/en-us/articles/360019144999-MPE-in-Live-FAQ)
- [Ableton: Using Tuning Systems](https://www.ableton.com/en/live-manual/12/using-tuning-systems/)
- [Ableton: Tuning Systems FAQ](https://help.ableton.com/hc/en-us/articles/11535414344476-Tuning-Systems-FAQ)
- [Akai: Using third-party VSTs with MPC](https://support.akaipro.com/en/support/solutions/articles/69000876025-akai-mpc-series-how-to-use-3rd-party-vst-s-with-your-mpc)
- [Akai: MPC One FAQ, including Multi-MIDI Control](https://support.akaipro.com/en/support/solutions/articles/69000816149-akai-pro-mpc-one-frequently-asked-questions)
- [Apple: Use MPE with software instruments in Logic Pro](https://support.apple.com/guide/logicpro/use-mpe-with-software-instruments-lgcp8f599497/10.7/mac/11.0)
- [Bitwig: Plug-in Inspector MPE settings](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)
- [Steinberg: Note Expression input devices for MPE](https://www.steinberg.help/r/cubase-pro/15.0/en/cubase_nuendo/topics/note_expression/note_expression_mpe_device_page_r.html)
- [ROLI: Setting the ideal pitch bend range](https://support.roli.com/en/support/solutions/articles/36000028378-setting-the-ideal-pitch-bend-range)
- [ROLI: Changing MIDI settings in Equator2](https://support.roli.com/support/solutions/articles/36000447444-changing-midi-settings-in-equator2)
- [Surge XT Manual: MPE settings](https://surge-synthesizer.github.io/manual-xt/index.html)
- [Arturia: MPE compatibility](https://support.arturia.com/hc/en-us/articles/4793918378908-MPE-Compatibility)

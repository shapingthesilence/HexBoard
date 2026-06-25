# HexBoard Sequencer Manual

The HexBoard sequencer is optional in the current firmware port. Default builds
compile it out. Builds made with `HEXBOARD_ENABLE_SEQUENCER=1` show a
`Sequencer` entry in the OLED menu.

This page is the dedicated home for sequencer behavior. The fuller existing
sequencer manual will be ported here later.

## Entering And Exiting

Open `Sequencer` from the main menu to enter Sequencer mode. Return to
`Keyboard` to exit Sequencer mode.

Exiting Sequencer mode stops sequencer playback and releases sequencer-held MIDI
notes.

## Current Behavior

The current sequencer is a simple 32-step MIDI sequencer. Select a step pad,
then press playable note keys to toggle tuning-relative notes into that step.
Each step can hold up to `6` notes.

Button `9` starts and stops playback. Playback uses the internal clock only,
runs through the active step range, and defaults to `120 BPM` with each step
lasting one 16th note. Open `Playback Settings` from the Sequencer page to edit
three volatile controls:

- `Steps`: active loop length, `1` through `32`, default `32`.
- `Direction`: `Forward`, `Backward`, `Ping-Pong`, `Random`, `Brownian`, or
  `Drunk`, default `Forward`.
- `Tempo`: internal tempo, `1` through `255` BPM, default `120`.

Programmed steps send MIDI using the current tuning, transpose, MIDI routing,
and MPE settings. Empty steps advance silently.

Button `19` clears the selected step after the current confirm-hold gesture.

Sequencer LEDs show selected steps, programmed steps, the clear button,
transport state, and the current play position. Button `9` is red when stopped
and green while playing. The current play step is highlighted, including empty
steps. Step LEDs beyond the active `Steps` range stay off even if those steps
contain notes.

Patterns and Playback Settings are not persistent yet. Rebooting clears
programmed sequencer steps and restores `Steps`, `Direction`, and `Tempo` to
their defaults. These controls will become file-backed when sequencer
persistence lands.

## Not Yet Ported

The current sequencer slice does not include persistence, save/load/browser
flows, external MIDI clock, MIDI start/stop/clock send, onboard synth playback,
note-entry audition sound, step preview, Play Type settings, probability, ties,
backup tools, or settings schema changes.

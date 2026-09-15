# HexBoard Sync User Guide

## Learning Your First Scale

Open **Learn** for a guided C-major scale from C4 to C5. Choose Wicki-Hayden,
Harmonic Table, or Janko, then **Start on HexBoard**, or use **Try on screen** without a board.
Release all hardware keys before starting. Board lessons require firmware with
version-2 learning sessions; the app explains when an update is needed.

Sound comes from the browser during the lesson. **Hear & watch the scale**
demonstrates the pattern. Play notes in order; you can hold one while pressing the next.
Every playable note keeps its Rainbow-mode color across octaves, with C as red.
The next pitch becomes much brighter with a solid outline; any matching key
counts. Held keys brighten in their own note color and have a dashed outline
on screen. Function keys are hidden from the lesson map. Adjust **Board
brightness** at any time, including during a run. This scales the lesson's LED
values within the saved board brightness and current limit; it does not change
saved settings or dim the web map.

Choose a **Scale pattern**: ascending, descending, up and down, down and up,
or thirds. Round trips play the turning note once. All patterns stay within
C4–C5 and work on any supported layout.

- **At your own pace · timed runs** waits for correct answers and counts extra
  attempts. Timing starts with the first correct attack and stops at the last
  correct attack, excluding the final held note. The final correct attack completes the run. The last run's time and extra attempts remain visible.
- **Play to a beat · graded runs** offers 40–180 BPM and four high count-in
  clicks before every run. Play one note per click; targets advance even if
  you miss. Each run shows a score out of 100, a grade, notes hit, misses,
  extra attempts, and average distance from the beat in milliseconds. A
  complete pattern also shows its first-to-last attack time. The score rewards
  correct notes close to their assigned beat and penalizes misses and extras.
  Use speakers or wired headphones for consistent timing; device/browser
  latency still affects the result.

**Repeat runs automatically** starts another free run on your next first note,
or another beat run after the next count-in. Turn it off before starting for
single runs with repeat buttons. Stop to change the pattern, mode, tempo, or
layout. Hints and board brightness remain adjustable during practice.
Demonstrations are available in at-your-own-pace mode. Results last only for
this visit; no mastery or practice history is saved.

Under **Use your own layout**, import a tuning-bundle JSON exported from the
editor. This prototype supports standard concert-pitch 12-EDO bundles with the
factory C-based reference anchor. It honors rotation, mirroring, disabled keys,
pitch overrides, and direct MIDI assignments. Command and one-button chord keys
are unavailable. A layout missing a required pitch is blocked before starting.
Imported layouts last for this visit to Learn.

The lesson uses its selected layout; saved device settings are not replaced.
The web map rotates with the layout, and current firmware temporarily rotates
the board's OLED to match. The saved OLED orientation returns on exit.
Normal instrument playing and controls return after **Stop lesson**. Switching
views or hiding the browser tab ends the session. Sessions have no heartbeat
or automatic timeout. If the browser crashes or disconnects before exit is
delivered, hold the encoder for about five seconds. Release the encoder and
all keys, then start another lesson; restarting the board is not part of the
normal recovery workflow. Update the app and firmware together for version-2
sessions.

## Connecting and Editing

A browser-based HexBoard Sync app lets you edit and sync tunings, layouts,
colors, custom key assignments, synth presets, and user wavetables.

Device connection requires a Web MIDI-capable browser, usually Chrome or Edge, and must be
opened from `localhost` or a secure HTTPS address. Connect HexBoard by USB and
select `Connect HexBoard` in the top bar. While not connected, you can edit
and save browser drafts and import or export files. If several compatible boards are
available, choose one from the device selector.

## Tunings, Layouts, And Colors

In the tuning/layout editor, you can create EDO tunings, equal-step tunings,
Scala `.scl` imports, vector layouts, scales, custom scale-degree colors, and
per-button pitch, color, direct-MIDI, or chord overrides. Choose a tuning in
`Library`, then switch freely between `Tuning`, `Layout`, and `Scale & color`.
The board shows your changes as you edit. Sync and save
actions remain at the top of the tuning studio. Valid, in-range numeric edits
update the preview as you type. Empty, incomplete, or out-of-range drafts remain
editable without changing the preview, then restore or clamp when you leave the
field. Names and descriptions likewise apply their
length and fallback rules only after you leave the field. Note labels are
edited individually in the note-label grid or together under `Edit labels as text`.
In `Scale & color`, click the note chips to include or exclude degrees. All Notes
is protected; create a scale to choose a subset of notes. Reorder layouts and
scales to choose which loads first with the tuning; All Notes can be reordered
but cannot be edited or deleted. The `Pitch anchor` statement groups the anchored
tuning degree, frequency, and scientific-pitch MIDI key, for example
`A4 = 440 Hz · A (degree 9)`. Changing the anchored degree retunes
the labeled notes without renaming or rotating them. `Default key` appears
separately under `Scale defaults` and chooses the scale key selected when the
tuning is first loaded. The app does not infer note names or reference positions
from the tuning size.
The board tools are `Select`, `Paint`, and `Pick color`. Painting selects
`Custom` color mode and can target individual keys or scale-degree colors.
Painting a scale degree clears matching per-key color overrides in the active
layout. Turn on `Key numbers` when you need hardware key numbers.

Use `Key inspector` to choose a tuned note, a fixed MIDI note/channel, a chord
of up to four tones, or `Off`. Chord intervals can use tuning steps or MIDI
semitones. You can override pitch and color independently; `Advanced pitch
details` shows the derived tuning information. `Reset all key overrides`
restores the selected key to its layout and palette.

Shift-click selects a range; Control-click or Command-click toggles individual
keys. The primary key is gold and other selected keys are green. The primary
key is also the center for transforms. `Deselect All` clears the selection.

`Device rotation` changes the board's displayed orientation. Use the layout
transform controls for transposition, 60-degree rotation, and mirroring.
`Whole layout` moves the layout and its overrides together; `Selected keys`
changes only the selection's overrides. Mirrors follow the displayed board
orientation. Overrides moved beyond the visible board are retained and can
return with later transforms or undo. Undo/redo also covers painting, with one
continuous brush stroke treated as one action.

Both editors keep drafts in this browser when you switch items or reload the
page. `Save to Browser` updates the saved library item; `Discard draft` returns
to the saved or originally opened version. Library copies and exports use the
saved item. The editor’s export action includes its current draft. Browser
storage is local to this browser; export files for a portable backup.

## Previewing And Saving

`Preview on HexBoard` applies the current edit without saving it permanently.
`Live preview` keeps compatible edits audible on the connected instrument.
The status distinguishes browser drafts, saved browser items, and device saves.
`Save to HexBoard` saves the complete tuning, then applies its active
layout, scale, colors, and key assignments so the preview and device
menu agree. The saved tuning appears in the on-device `Tuning`, `Layout`, and
`Scales` browsers. HexBoard stores up to 64 complete tunings; each includes its
palette and linked layouts and scales. Tuning division and scale-cycle lengths
may be from 1 through 1024. Each tuning may contain up to 32 layouts and 32
scales.

The editor's `Color mode` selector is saved with each tuning and is
applied when that tuning loads. The supplied `12 EDO (Normal)` tuning defaults
to `Rainbow`.

## Tuning Libraries

In Library, click a tuning name to edit it, or drag tuning rows to reorder them. `Copy to HexBoard` and
`Copy to Browser` copy a tuning between libraries. The item’s more-actions menu
contains rename, move, copy, export, and delete. `Export File` saves a
portable tuning file to the computer, and older exported tuning files remain
importable. Uploads and downloads show progress while the transfer is active.
If HexBoard has no usable stored tunings, the app shows a
built-in rescue-tuning notice instead of presenting that read-only rescue as an
editable library item.

`Rename / Move` updates a tuning in place in either library. The app
shows the final folder and name before saving. If that destination is occupied,
it identifies the tuning that will be replaced and requires confirmation;
deletion happens only after the renamed tuning has saved. Direct `Delete`
actions also require confirmation.

Selection boxes provide the same batch workflow as the synth preset library.
Select the tunings shown by the current folder filter, then copy them together
to the other library or export them as one tuning-library file. `Import
Files` accepts several individual tuning files and bulk tuning-library files in
one selection. A single warning summarizes any destination tunings that a batch
copy or import will replace.

Library folder rows begin with the visually distinct system views `All` and
`Root`, followed by user folders. New folders belong to the
computer library and stay available between sessions. An empty computer folder
can be deleted from the `Folders` menu; move or delete its tunings first when it
is not empty. HexBoard folders are derived from the saved items on the device,
so a device folder disappears automatically after its last item is moved or
deleted.

## Synth Presets And Wavetables

In the synth editor, you can manage synth presets and user wavetables. Presets
can be saved on the computer, uploaded to HexBoard, downloaded from HexBoard,
exported/imported as JSON, edited, erased, and organized into folders.
`New sound` starts a preset. Opening a preset restores its draft, if one exists.
The sound’s more-actions menu contains export, `Load current HexBoard sound`,
and `Discard draft`; `Other drafts` resumes unfinished sounds. Connecting does
not replace your open sound. Previewing or saving to HexBoard requires a connection.

The wavetable graph follows the selected frame. The volume envelope graph
shows the shape of the sound, with compressed time spacing to keep short stages
visible. Sliders show times, rates, and percentages. Expand the modulation
envelopes or LFO to edit their controls; their summaries show the target and amount.
Wavetables can be imported from Serum/Vital `.wav` files or HexBoard
`.hexwav` files, uploaded, downloaded, exported, renamed, moved, and selected
for the open preset. Short HexBoard wavetable files are expanded to fit the
instrument automatically.

Preset and wavetable libraries use the same `All` and `Root` system views.
The `Folders` menu creates and deletes empty computer folders; folders persist
between browser sessions. The built-in `Basic Shapes` fallback appears in
`Root` like the other root-level wavetables. New wavetable imports start in
`Root` unless another folder is selected.

`HexBoard Wavetables` is refreshed from the connected device; if a preset
references a computer-only wavetable, previewing or saving that preset to HexBoard requires
uploading the same-name wavetable or selecting an alternate first. Wavetable
names are unique across folders, and `Basic Shapes` is reserved for the
built-in fallback.

Expand **Test keyboard** in the preset editor to hear the current patch through
your browser. It starts hidden. Hold the onscreen keys or their labeled typing
keys; use Octave, Mod, Preview Vol, or Chord to test the sound. Stop, hiding the
keyboard, and leaving the browser window stop playback. Editing text does not
trigger notes. Notes use 12 EDO independently of the device's tuning layout.

The preview uses the selected wavetable and synth settings to approximate the
instrument's sound, including envelopes, modulation, drive, and playback mode.
Your speakers and HexBoard's piezo will sound different. No connection is needed
for Basic Shapes or wavetables available on the computer; download device-only
wavetables before auditioning them. The keyboard does not send notes to HexBoard.

## Transfer Feedback

Large transfers, such as full preset saves or wavetable imports, show their
direction and progress on HexBoard. Audio and controls may pause briefly while
HexBoard saves the transferred item. Individual live synth edits do not show a
transfer screen or mute the audio.

For onboard controls and recovery, see the [user manual](user-manual.md).
For app development, see the [web README](../web/README.md).

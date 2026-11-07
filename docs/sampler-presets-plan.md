# Sampler Presets And Larger Library — Plan

This is a proposal. Apart from the first section, nothing here is implemented.
Current behavior is described in the [user manual](user-manual.md), the
[developer guide](developer-guide.md#settings-and-persistence),
[preset sync](preset-sync-sysex.md) and the [Classic sampler](compact-sampler.md).

## Goal

One preset library for both engines. A preset is a sound source plus settings:

- **Wavetable presets** keep every current control.
- **Sampler presets** name one installed sampler instrument and add only
  Volume, Drive, Vibrato and Amp Envelope edits (plus Glide and Arp, which
  already apply to both engines).
- Choosing a preset chooses the engine. The separate `Sampler / Engine` item
  goes away.
- The board cannot change which instrument a sampler preset uses. Sync sets it
  when the preset is created.
- Each Amp Envelope stage defaults to **Inst** (the instrument's own per-region
  value). Turning a stage replaces it for every region; turning back to Inst
  restores the original.
- Preset rows show a small engine icon.

## Done: Preset Index, Folder Loading And Phase 1

- Preset files live in 16 subdirectories (`/presets/<first id hex digit>/`).
  `/preset_index/` holds a 32-slot folder table and one index file per folder
  (`storage/SynthPresetIndexCodec.h`). Handles are `slot × 256 + position`.
- RAM keeps only the folder table with counts and the open browser folder
  (32 presets with 24-byte names, 24 subfolders). Static RAM is about 9.4 KB
  lower than with the old 128-preset catalog.
- Limits: 512 presets, 32 folder paths, 32 presets per folder, checked before
  anything is written. The board shows "Preset not saved" with the reason;
  Sync checks the same limits and the 23-character name limit before sending.
- Boot validates the index without listing `/presets`; a pending marker
  detects interrupted changes. A first-use rebuild also moves files from the
  old flat layout.
- The board's load list starts with `Favorites`: favorite presets from every
  folder (one pass over the folder files, up to 32 shown).
- A first-use rebuild shows "Moving presets n / N" and "Indexing presets
  n / N" on the flash-save screen.
- Index records reserve engine bits (`kFlagEngineMask`), so the browser can
  show engine icons without opening preset files.

Measured on a Classic board with 512 presets:

| | One flat directory, one index file | Buckets, per-folder index |
| --- | --- | --- |
| Save one preset | 1.0–2.3 s | 0.4–0.6 s |
| Load presets at boot | 248 ms | 86 ms |
| Read one folder (board) | about 17 ms (whole index) | about 5 ms |
| List all presets in Sync | 16 s (with full passes per page) | 7.5 s (USB-bound) |

Whole-board setup takes about 1.9–2.6 s either way. The 8.6 s reboot time
reported earlier came from the test script's retries while macOS set up MIDI,
not from the board. The one-time move of 512 flat files took several minutes;
boards updating from released firmware hold at most 128 presets.

## Done: Phase 2 — Sampler Preset Data Model

- Sampler presets reference their instrument **by name**, like wavetable
  presets reference wavetables. This replaces the earlier idea of files named by
  object id: the HBC format and Sync's install protocol stay unchanged, and an
  edited instrument re-sent from Sync keeps its presets working. Installing an
  instrument whose name is already installed replaces the older copy. The 32
  slots remain; raising the cap is a separate change to the slot loop in Sync.
- HSP v13 appends the instrument name (empty for wavetable presets) and a
  5-bit amp envelope override mask (`SAMPLER_ENVELOPE_OVERRIDE_*`). Older
  records expand as wavetable presets. Preset sync carries them as TLVs `0x28`
  and `0x29`; Sync keeps them through edits, export and import.
- Settings version 37 drops `SamplerSlot`. The profile's preset or draft records
  the engine. When a version 36 file loads, the boot profile's slot becomes the
  current sound's instrument name and the next normal save records it; other
  profiles' slot choices are not carried over.
- The `Sampler / Engine` menu is gone. Sending an instrument from Sync plays it;
  Save Preset on the board stores a sampler preset.
- Index records set the engine bits, so phase 3 icons need no file reads.
- A missing instrument shows "Upload instrument" and plays the wavetable engine.
- The factory library accepts `sampler/*.hbc` instruments and presets with a
  `sampler` reference; no factory instruments are included yet.
- The envelope mask is stored and round-trips, but playback ignores it until
  phase 4.

## Done: Phase 3 — Board Menus, 64 Instruments, Saving From Sync

- With a sampler preset loaded the Synth page shows a read-only
  `Inst: <name>` row and a sampler `Amp Env` page whose stages start at `Inst`;
  wavetable, `WT Pos`, `Wheel FX`, FX envelopes and LFO are hidden. `Wheel Amt`
  and `Vib Speed` stay as the vibrato controls (the planned `Vibrato ▸`
  submenu was not needed). Hiding uses `updateSynthMenuVisibility()`.
- Preset rows show a wavetable or sampler icon; the loaded-preset diamond moves
  to the right edge (`VirtualListMenuProvider::getIcon`).
- Instrument slots rose from 32 to 64. A 4-byte name hash per slot finds an
  instrument by name without opening every file. Sync finds the board's slot
  count from slot-info NACKs, so it works with both limits.
- Sync's Classic sampler editor has **Send and save preset**: install, select
  and save a sampler preset in one step, without touching the board.

## Done: Sounds

- The board calls presets **sounds**: `Sound:<name>`, the `Sounds` list and
  `Save Sound`, whichever engine a sound uses.
- Sync's **Send to HexBoard** always saves a sound for the instrument (default
  folder `Instruments`); the separate save button is gone.
- Once per board, opening `Sounds` gives every installed instrument without a
  sound one in `Instruments`; `/sampler/sounds.done` keeps it from repeating.

## Done: Phase 4 — Classic Sampler Runtime

- Mod wheel vibrato on sampler voices at the wavetable engine's depth and
  rate (`Wheel Amt`, `Vib Speed`), refreshed every 32 samples; each voice's
  vibrato step is recomputed only then or when its pitch changes.
  `test_synth_performance.py` passes at eight voices: 911 µs versus 895 µs per
  64-sample block without vibrato (budget 1,572 µs). A first per-sample 64-bit
  version overran the budget and was replaced.
- Amp envelope overrides: Core 0 merges the region envelope with the sound's
  set stages when a note starts; release stays at least 4 ms.
- Drive already applied through the shared output stage.

## Phase 5 — Sync App

- Show both engines in one library, with the same icons as the board.
- Sampler preset editor: choose the instrument at creation, then edit only the
  board-supported controls. Upload the instrument before the preset that uses
  it.
- Warn before deleting an instrument that presets still use.

## Verification

- Host: `python3 scripts/test_host.py` (includes the index codec test and the
  generator/firmware index cross-check), `make`, `git diff --check`.
- Device: back up with `picotool save -v -r 0x10000000 0x11000000 <file>`, flash
  the Update image, then use a preset-sync probe to compare preset lists and
  bodies before and after, round-trip append/rename/move/delete, test the folder
  and library limits, and time empty filtered listings at 18 and 512 presets.
- Web: run the web tests and build when Phase 5 lands.

## Open Questions

None at the moment.

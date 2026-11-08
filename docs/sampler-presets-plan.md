# Sampler Presets And Larger Library — Plan

Every phase below is implemented. This page records the plan and its
measurements; current behavior lives in the guides linked here.
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

## Done: Phase 5 — Sync App

- One library for both engines, with the board's wave and sample icons. The
  Classic tabs are now **Sounds** and **Instruments**.
- **New sampler sound** picks an installed instrument; the sampler editor offers
  Playback, Amp envelope with `Inst` per stage, Vibrato and Drive. Saving or
  previewing checks the instrument is installed (instruments are sent from
  **Instruments**, which already saves a sound with each one).
- Deleting an instrument lists the sounds that use it first.
- No firmware change: Sync reads every preset body already, so the sampler
  reference is known without a new list flag.

## Verification

- Host: `python3 scripts/test_host.py` (includes the index codec test and the
  generator/firmware index cross-check), `make`, `git diff --check`.
- Device: back up with `picotool save -v -r 0x10000000 0x11000000 <file>`, flash
  the Update image, then use a preset-sync probe to compare preset lists and
  bodies before and after, round-trip append/rename/move/delete, test the folder
  and library limits, and time empty filtered listings at 18 and 512 presets.
- Web: `npm test` and `npm run build` in `web/`; a Playwright run against a
  connected board checked icons, the sampler editor, saving a sampler sound
  (instrument and mask on the board) and the delete warning.

## Not Yet Done

Known gaps after Phase 5. None is implemented; each needs a decision first.

- **Factory instruments.** The factory build can ship instruments and sampler
  sounds, but `factory-library/` has none, so a fresh board has no sampler
  sounds. Needs freely licensed source recordings (see Open Questions).
- **Renamed or deleted instruments.** Sounds find their instrument by name.
  Re-sending it under a new name, or deleting it, leaves its sounds on
  **Upload instrument**. The delete warning names them but cannot delete them
  or point them at another instrument. Pointing a sound at another instrument
  would relax the rule that a sound keeps its instrument.
- **Sharing sounds between boards.** A sampler sound saved in the Browser
  Library or exported as a file carries only the instrument's name. A bundle of
  sound plus instrument would let it move to a board without that instrument.
- **Delete warning speed.** Sync reads every sound body to find the ones using
  an instrument. That took a few seconds at 49 sounds and will be slower near
  512. A sampler flag in the board's list replies would let Sync read only
  sampler sounds (firmware and protocol change).
- **Inst stage values.** A stage set to `Inst` shows the sound's stored value
  on its knob, not the envelope the instrument actually uses. Sync could read
  the instrument file to show its real values.
- **Untested by ear.** Preview on HexBoard and Live preview for sampler sounds
  in Sync.

## Open Questions

- Which freely licensed instruments to ship in the factory library, and how
  many fit next to user instruments in the board's storage.

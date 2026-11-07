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
  (64 presets with 24-byte names, 24 subfolders). Static RAM is about 9.4 KB
  lower than with the old 128-preset catalog.
- Limits: 512 presets, 32 folder paths, 64 presets per folder, checked before
  anything is written. The board shows "Preset not saved" with the reason;
  Sync checks the same limits and the 23-character name limit before sending.
- Boot validates the index without listing `/presets`; a pending marker
  detects interrupted changes. A first-use rebuild also moves files from the
  old flat layout.
- The board's load list starts with `Favorites`: favorite presets from every
  folder (one pass over the folder files, up to 64 shown).
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

## Phase 2 — Sampler Preset Data Model

1. **Instrument files by object id.** Replace `/sampler/00.hbc`–`31.hbc` with
   `/sampler/<object-id>.hbc` and drop the slot numbers. Presets reference the
   id. No resident instrument catalog is needed: loading a preset opens the
   file by path, and Sync lists instruments from the directory. A cap of 64
   instruments (about 3.3 MB at most) leaves room for user content in the
   8 MB filesystem. The Classic sampler format is unreleased, so no migration
   is needed.
2. **HSP v13.** Append an engine byte, the instrument object id, and one
   `SamplerEnvelopeOverride` bitmask (bits for attack, hold, decay, sustain,
   release). Sampler presets reuse the existing envelope, drive, vibrato speed
   and mod-amount values; a clear bit means **Inst**. Older files expand with
   engine = wavetable through the existing `persistedSynthPresetWidth` table.
3. **Remove `SamplerSlot`.** The profile's synth reference already decides the
   sound. Bump `CURRENT_SETTINGS_VERSION`, add a tested migration that drops
   the byte, and update the runtime sync, menu wiring, factory config and
   validation (see `SettingKeys.inc.h` rules in `AGENTS.md`).
4. **Index flags.** Write the engine into the record flags so icons and filters
   work from the index alone.
5. **Missing instrument.** Loading a sampler preset whose instrument is not
   installed shows a notice and falls back to Basic Shapes, as missing
   wavetables do today.
6. **Factory library.** Add `factory-library/sampler/*.hbc` (or source files
   converted by the existing browser tools). The generator validates every
   preset's instrument reference and the flash budget.

## Phase 3 — Board Menus

1. **Engine-aware Synth page.** With a sampler preset loaded, show:
   `Instrument: <name>` (read-only), Volume, Drive, `Vibrato ▸` (Depth, Speed,
   Mod wheel), `Amp Env ▸` (A/H/D/S/R with Inst as the first value), Glide,
   Arp and Save Preset. Hide the wavetable picker, position, FX Env 1/2 and LFO.
   Use the existing menu-visibility updates rather than a second menu tree.
2. **Remove `Sampler / Engine`** and `CompactSamplerMenu`.
3. **Engine icons.** Add an icon callback to `VirtualListMenuProvider`, draw a
   wavetable or sampler sprite at the row's left edge, and move the current
   preset diamond to the right edge. Check both sprites on the real OLED.

## Phase 4 — Classic Sampler Runtime

1. **Vibrato.** Apply a shared pitch LFO to sampler voice increments once per
   64-sample block. Measure with `scripts/test_synth_performance.py` at eight
   voices before enabling.
2. **Envelope overrides.** When a mask bit is set, voices use the preset's
   stage value instead of the region's. Keep note-off release at least 4 ms.
3. Drive already applies through the shared output stage.

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

- Is 64 instruments the right cap, given the factory library's size?

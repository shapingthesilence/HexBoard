# HexBoard Web App

This is the browser-first companion app scaffold for HexBoard preset sync. It is
kept inside this firmware repository so the web protocol, future firmware
implementation, and documentation can evolve together.

The app is intentionally isolated under `web/`; there are no root-level Node
files.

## Development

Install dependencies from this directory:

```sh
cd web
npm install
```

Run the local app:

```sh
npm run dev
```

Run tests:

```sh
npm test
```

Build for the repository's main GitHub Pages project URL:

```sh
npm run build -- --mode github-pages-main
```

Build for the development GitHub Pages URL:

```sh
npm run build -- --mode github-pages-development
```

The main GitHub Pages build uses `/HexBoard/` as the Vite base path, and the
development build uses `/HexBoard/development/`. Local development and ordinary
local builds still use `/`.

## GitHub Pages

The root workflow `.github/workflows/pages.yml` deploys this app to GitHub
Pages. It runs on pushes to `main` and `development`, and it can also be started
manually from the GitHub `Actions` tab. Each deployment fetches both branches,
publishes `main` at the project root, and publishes `development` under
`/development/`. If one branch does not have `web/package.json` yet, the
workflow publishes a placeholder for that branch and continues deploying the
other branch.

Before the first deployment, set the repository's Pages source to GitHub
Actions in `Settings` -> `Pages`. The deployed project-page URL should be:

```text
https://<your-github-username>.github.io/HexBoard/
https://<your-github-username>.github.io/HexBoard/development/
```

Web MIDI SysEx requires a browser that supports Web MIDI, usually Chrome or
Edge, and a secure context such as `localhost` or HTTPS.
Use `Connect HexBoard` in the header. Discovery pairs compatible input and
output ports; if several boards are found, choose one from the device selector.
The app opens both selected ports and keeps device actions unavailable offline.
Device preset reads ACK `READ_BEGIN`, each `DATA_CHUNK`,
and `TRANSFER_END` so firmware can pace object transfers.

## Current Scope

- A shared responsive header keeps device connection, light/dark appearance,
  and the top-level `Tunings & Layouts` and `Synth Editor` views in
  a consistent location. `Tunings & Layouts` opens by default.
- Protocol helpers for the draft preset-sync SysEx frame.
- CRC32 and 8-to-7 packing utilities matching the firmware draft.
- TLV object encoding for user tunings, layouts, scale color maps, explicit
  button maps, and named/foldered synth presets.
- Atomic `HGB` encoding for complete tuning bundles. Saving a tuning transfers
  one staged file, while live preview continues to send only the active
  tuning/layout/scale/color/map objects without writing flash. Tuning divisions
  and scale cycles are limited to the firmware's `1..1024` range; each tuning
  can contain up to 32 layouts and 32 scales. Layouts and scales can be reordered
  in a drag-and-drop dialog; the first item is the device-menu default when the
  tuning is loaded. All Notes remains protected from editing and deletion but
  can be reordered with the other scales.
- Generated note labels and default degree colors are omitted from encoded
  objects. Custom labels and color overrides remain packed records, so large
  tunings do not pay a per-division transfer or runtime cost for defaults.
- Color-mode defaults are stored with each tuning; the supplied 12 EDO tuning
  uses Rainbow. Computer and HexBoard library rows can be reordered by
  dragging. Device reorders update the UI immediately, wait for a 2-second
  quiet period, then write only the compact geometry-order file; unchanged
  order bytes do not cause another flash write.
- A tuning library with independently accessible `Tuning`, `Layout`, and
  `Scale & color` editing tabs. The library gets a full-width transfer
  and folder-management view. Folder filters consistently begin with `All` and
  `Root`; empty computer folders can be created and deleted, while device
  folders appear only when a saved item uses them. Editing keeps tuning sync
  actions and the visual HexBoard preview in consistent locations. Device
  rotation is four-way and separate from musical layout transforms. A layout
  toolbar directly below the color tools provides step transposition, two-way
  60-degree rotation, device-relative horizontal/vertical mirrors, and
  undo/redo. Layout transforms and each continuous color-paint stroke share
  this history. An explicit `Transform` selector chooses whole-layout transforms
  around the gold pivot key or overrides on selected keys, independently of
  selection count. Overrides that rotate beyond the physical board remain in
  the saved tuning bundle so later transforms can bring them back. The selected-key
  inspector separates key state, optional pitch overrides, inherited or per-key
  color, and advanced pitch details; color editing uses a compact visual
  picker. Shift/Ctrl/Command selection enables
  bulk transposition and reset. Green selection rings, a gold primary-key ring,
  and a live selection count in the layout toolbar remain visible independently
  of key colors. `Deselect All` clears the transform selection and disables
  transform actions until another key is selected. A
  collapsed advanced-output section supports
  fixed MIDI note/channel output and reusable four-tone chord shapes without
  adding controls to the ordinary tuned-note workflow. Read-only pitch and
  scale values are presented as facts rather than form fields, and all overrides
  can be reset together. Raw encoded-object details are collapsed until needed.
  The editor also supports clickable scale-degree chips, scale-degree palette
  editing, individual note-label fields with optional bulk text editing, a grouped pitch anchor with explicit degree, frequency, and MIDI
  key selection, and a separate default-key degree that is applied when a tuning
  first loads. A paint mode applies per-button color overrides or scale-degree
  palette colors directly on the preview. Painting a scale degree clears
  matching color overrides in the active layout so the palette color takes
  effect immediately, and a confirmed reset returns all keys in the active
  layout to scale-degree colors.
  EDO pitch generation preserves the exact period/division ratio rather than
  treating the rounded decimal step display as authoritative. Sync writes
  each authoritative tuning value once as firmware-native binary32, and the
  editor preview uses the same binary32 rounding as firmware. EDO step size,
  equal-step period, and cents-list period are derived rather than stored as
  duplicate values.
  Scala `.scl`
  import reads trailing interval labels, exposes the 1/1 reference key
  and Hz reference, and enables cents-table live send when the connected
  firmware advertises runtime support. Live preview serializes only the active
  runtime records. `Save to HexBoard` writes the whole tuning bundle, preserves
  tuning and color object IDs for tunings opened from the device, then reapplies the
  active records so the hardware preview and on-device menus agree.
  Opening, copying, or exporting a HexBoard tuning streams its complete stored
  `.hgb` bundle once and shows byte progress in the app. The compiled rescue
  tuning is not presented as an editable library item; the library shows a
  fallback notice when the device reports that rescue state.
  Editor drafts are preserved separately from Browser Library records.
  `Save to Browser` commits the current draft, and `Discard draft` restores
  its baseline. Drafts survive item changes, navigation between editors, and
  reloads. Library copy/export actions use saved records. `Copy to HexBoard` and
  `Copy to Browser` copy between libraries; `Export File` writes a portable
  `hexboard.tuningBundle.v2` JSON file. Version 1 tuning bundles and legacy
  `hexboard.layoutBundle.v5` files remain importable; legacy layout bundles use
  their former device-facing bundle name as the tuning name. `Rename / Move`
  updates the selected browser or device bundle without creating a duplicate
  and gives an explicit replacement warning when the destination is occupied.
  Multi-select actions copy several bundles between libraries or export one
  `hexboard.tuningBundleLibrary.v1` JSON file; multi-file import accepts those
  library files alongside individual tuning-bundle files.
- A synth preset editor with name and folder selection, folder creation, main
  synth parameter controls, mono retrigger/legato, mono portamento,
  arpeggiator speed/direction/tempo, Drive/AHDSR sliders, apply-only live sends,
  waveform and envelope graphs, collapsible modulation controls, and explicit
  browser/device saves. Preview and save feedback are separate; offline
  operation never reports a mock device save. A dormant
  browser AudioWorklet audition implementation remains in the source behind a
  disabled visibility gate for later offline preset design work. Opened presets
  are automatically preserved browser drafts; saving an existing library preset preserves its
  object identity while updating its name, folder, and sound. Saving a new
  destination asks before replacing an occupied folder/name. Saves to real
  devices wait for ACK/NACK responses through the flash commit before the app
  refreshes device storage.
- Synth preset library areas named `Browser Library` for browser-saved/imported
  presets and `HexBoard Library` for device-side presets loaded through SysEx,
  with independently collapsible library panels,
  including persistent browser folders with explicit create/delete controls,
  an `All presets` filter, searchable compact preset rows, per-row overflow
  actions, identity-preserving `Rename / Move`, drag-and-drop folder moves,
  library copy actions, device refresh, JSON import, JSON export, open, and
  confirmed delete controls. The batch toolbar appears after a selection.
  Multi-select can copy a
  batch between libraries or export one `hexboard.synthPresetLibrary.v1` JSON
  file, and multi-file import accepts individual and library files together.
  Device preset listing uses
  small one-record pages to stay within conservative MIDI SysEx buffer limits
  and refreshes automatically when the synth preset view opens with a real MIDI
  transport.
- Synth wavetable library areas named `Browser Wavetables` and
  `HexBoard Wavetables`, using the same folder controls as presets. Imported
  wavetables default to `Root`. The firmware-resident Basic Shapes fallback is
  also presented in `Root`; its special storage path is never shown as a folder.
  Imports save in the browser and, when connected, upload to HexBoard for hardware audition and refresh the
  device-authoritative HexBoard wavetable list after the flash commit. Short
  HexBoard `.hexwav` imports are interpolated to the device's 16-frame table.
  The preset editor separates on-device and computer-only wavetables. Selecting
  a computer-only wavetable offers to upload it before applying the selection;
  preset saves repeat the availability check as a safety net and require either
  uploading the same-name dependency or choosing an alternate. Wavetable names
  are globally unique; folders are organization only and preset dependencies
  match by name. With Live preview enabled, selecting an existing device wavetable
  uses a single runtime-select control frame rather than transferring the open
  synth preset.
- A mock MIDI transport used internally for offline operation and protocol tests;
  device preview and write actions are gated on a real connection.
- Basic React views for device connection, tuning/layout editing, and synth
  preset organization.

Firmware currently implements synth preset, wavetable, and geometry preset-sync
paths used by the app. Offline editing remains available without a compatible device.

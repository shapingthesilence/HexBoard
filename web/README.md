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
Choose both the HexBoard output and input ports on the Device page. Live
parameter sends only need the output port, but device library reads need the
input port that receives HexBoard SysEx responses. The app explicitly opens the
selected ports when connecting and warns before a device-library refresh if no
input port is attached. Device preset reads ACK `READ_BEGIN`, each `DATA_CHUNK`,
and `TRANSFER_END` so firmware can pace object transfers.

## Current Scope

- A shared responsive header keeps device connection, light/dark appearance,
  and the top-level `Tunings & Layouts`, `Synth Editor`, and `Profiles` views in
  a consistent location. `Tunings & Layouts` opens by default.
- Protocol helpers for the draft preset-sync SysEx frame.
- CRC32 and 8-to-7 packing utilities matching the firmware draft.
- TLV object encoding for user tunings, layouts, scale color maps, explicit
  button maps, and named/foldered synth presets.
- A tuning/layout bundle editor organized as a four-step `Library`, `Tuning`,
  `Layout`, and `Scale & color` workflow. The library gets a full-width transfer
  and folder-management view. Folder filters consistently begin with `All` and
  `Root`; empty computer folders can be created and deleted, while device
  folders appear only when a saved item uses them. Editing keeps bundle sync
  actions and the visual HexBoard preview in consistent locations. Device
  rotation is four-way and separate from six-way musical layout rotation and
  mirroring. The selected-key inspector separates key state, optional pitch
  overrides, inherited or per-key color, and advanced pitch details; color
  editing uses a compact visual picker. Shift/Ctrl/Command selection enables
  bulk transposition and reset. A collapsed advanced-output section supports
  fixed MIDI note/channel output and reusable four-tone chord shapes without
  adding controls to the ordinary tuned-note workflow. Read-only pitch and
  scale values are presented as facts rather than form fields, and all overrides
  can be reset together. Raw encoded-object details are collapsed until needed.
  The editor also supports scale-degree palette editing, A-first note labels,
  and a paint mode for applying per-button color overrides or scale-degree
  palette colors directly on the preview. Painting a scale degree clears
  matching color overrides in the active layout so the palette color takes
  effect immediately, and a confirmed reset returns all keys in the active
  layout to scale-degree colors.
  EDO pitch generation preserves the exact period/division ratio rather than
  treating the rounded decimal step display as authoritative. Sync writes
  firmware-native binary32 tuning values alongside milli-unit compatibility
  fields, and the editor preview uses the same binary32 rounding as firmware.
  Scala `.scl`
  import reads trailing interval labels, exposes the 1/1 MIDI note
  and Hz reference, and enables cents-table live send when the connected
  firmware advertises runtime support.
- A synth preset editor with name and folder selection, folder creation, main
  synth parameter controls, mono retrigger/legato, mono portamento,
  arpeggiator speed/direction/tempo, Drive/AHDSR sliders, apply-only live sends,
  and an explicit save sync action over the active MIDI transport. A dormant
  browser AudioWorklet audition implementation remains in the source behind a
  disabled visibility gate for later offline preset design work. Opened presets
  are temporary editor drafts; saving creates a new folder/name when
  unique and asks before overwriting an existing folder/name. Saves to real
  devices wait for ACK/NACK responses through the flash commit before the app
  refreshes device storage.
- Synth preset library areas named `Computer Library` for browser-saved/imported
  presets and `HexBoard Library` for device-side presets loaded through SysEx,
  including persistent computer folders with explicit create/delete controls,
  `All` and `Root` system filters, drag-and-drop folder moves, upload/download
  actions, device refresh, JSON import, JSON export, open, and erase controls.
  Device preset listing uses
  small one-record pages to stay within conservative MIDI SysEx buffer limits
  and refreshes automatically when the synth preset view opens with a real MIDI
  transport.
- Synth wavetable library areas named `Computer Wavetables` and
  `HexBoard Wavetables`, using the same folder controls as presets. Imported
  wavetables default to `Root`. The firmware-resident Basic Shapes fallback is
  also presented in `Root`; its special storage path is never shown as a folder.
  Imports upload to HexBoard immediately for hardware audition and refresh the
  device-authoritative HexBoard wavetable list after the flash commit. Short
  HexBoard `.hexwav` imports are interpolated to the device's 16-frame table.
  Saving a preset that references a computer-only wavetable offers to upload
  the wavetable first.
- A mock MIDI transport for UI and protocol work before firmware support exists.
- Basic React views for device connection, profile sync, tuning/layout editing,
  and synth preset organization.

Firmware currently implements synth preset, wavetable, and geometry preset-sync
paths used by the app. Mock mode still covers UI work when no compatible device
is connected.

# HexBoard Web App

HexBoard Sync is the React/TypeScript companion app for preset sync. Firmware
and app share the [protocol contract](../docs/preset-sync-sysex.md).
For connection and editing workflows, use the
[HexBoard Sync user guide](../docs/web-app-guide.md).

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

## Source Ownership

| Path under `src/` | Responsibility |
| --- | --- |
| `App.tsx`, `views/DeviceConnect.tsx` | Top-level views and device connection UI |
| `views/TuningLayoutEditor.tsx` | Tuning, layout, scale/color editing and tuning libraries |
| `views/SynthPresetLibrary.tsx` | Synth editor, preset libraries, and wavetable libraries |
| `editor/drafts.ts` | Browser draft values, discard baselines, and persistence |
| `catalogs/` | Musical models, import/export, object IDs, validation, and device encoding |
| `midi/presetSyncClient.ts`, `midi/webMidi.ts` | Request/transfer lifecycle and real MIDI ports |
| `midi/mockTransport.ts` | Internal offline transport and protocol test support |
| `protocol/` | Constants, SysEx framing, TLV, CRC32, and 8-to-7 packing |
| `components/` | Shared library actions, folders, and organization dialogs |
| `audio/` | Browser audition implementation behind a disabled visibility gate |

## Integration Contracts

- Firmware implements synth presets, wavetables, geometry preview, complete
  geometry bundle storage and geometry ordering. Negotiate capabilities;
  reserved profile/snapshot/backup object types are not implemented.
- Individual geometry objects are runtime previews. Persist a complete `HGB`
  bundle, then apply its active records. Opening or exporting a device tuning
  reads the complete stored bundle once. Rescue geometry is not an editable
  library item.
- Use firmware-native binary32 rounding for pitch previews and encoded values.
  Store each authoritative tuning quantity once; derive EDO step size,
  equal-step period, and cents-list period. Omit generated labels and colors
  from transfer bodies. See the protocol for field definitions and limits.
- Wavetable names are globally unique and preset dependencies match by name.
  Check device availability before preview/save; upload the dependency or
  require an alternate selection. Existing-device live selection uses its
  control frame rather than a complete preset transfer.
- Device writes finish only after the commit ACK. Reads ACK `READ_BEGIN`, every
  `DATA_CHUNK`, and `TRANSFER_END`. Re-list compact handles after catalog changes.
- Geometry reordering waits for two seconds of quiet before writing the compact
  ordering file. Identical ordering does not trigger another flash write.
- Drafts and saved browser records are separate. Draft entries retain both value
  and discard baseline; synth draft keys include the source library. Library
  copy/export uses saved records; editor export uses its draft. Track device-save
  fingerprints only after acknowledged writes or device reads in that connection.
- Connecting refreshes libraries without replacing the open synth draft. Offline
  edits never imply a device save; preview/write controls require a real connection.
- Import compatibility is implemented in `catalogs/`: tuning bundle v2, tuning
  library v1, synth preset/library files, and wavetable files; tuning bundle v1
  and layout bundle v5 remain importable. Keep compatibility conversion at import.

## Verification

Run `npm test` and `npm run build` for app code changes. Factory-content changes
also use the [factory generator](../factory-library/README.md). Tests are
colocated with protocol, catalog, MIDI, draft, and view helpers.

For changes to device operations, exercise list/read/write/apply/delete/abort,
ACK/NACK failures, disconnects, dependency checks, and draft preservation on real
hardware as relevant. Mock transport coverage does not establish hardware timing
or flash behavior. See [architecture proposals](../docs/architecture-proposals.md)
for proposed editor and operation-service boundaries.

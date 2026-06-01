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

- Protocol helpers for the draft preset-sync SysEx frame.
- CRC32 and 8-to-7 packing utilities matching the firmware draft.
- TLV object encoding for user tunings, layouts, scale color maps, explicit
  button maps, and named/foldered synth presets.
- A synth preset editor with name and folder selection, folder creation, main
  synth parameter controls, Drive/AHDSR sliders, apply-only live sends, and an
  explicit save sync action over the active MIDI transport. Opened presets are
  temporary editor drafts; saving creates a new folder/name when unique and asks
  before overwriting an existing folder/name. Saves to real devices wait for
  ACK/NACK responses through the flash commit before the app refreshes device
  storage.
- Synth preset library areas named `Computer Library` for browser-saved/imported
  presets and `HexBoard Library` for device-side presets loaded through SysEx,
  including drag-and-drop folder moves, upload/download actions, device refresh,
  JSON import, JSON export, open, and erase controls. Device preset listing uses
  small one-record pages to stay within conservative MIDI SysEx buffer limits
  and refreshes automatically when the synth preset view opens with a real MIDI
  transport.
- A mock MIDI transport for UI and protocol work before firmware support exists.
- Basic React views for device connection, profile sync, tuning/layout editing,
  and synth preset organization.

Firmware currently implements the synth preset subset of preset sync. Mock mode
still covers UI work for protocol areas that firmware does not implement yet.

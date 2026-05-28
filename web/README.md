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

Web MIDI SysEx requires a browser that supports Web MIDI, usually Chrome or
Edge, and a secure context such as `localhost` or HTTPS.
Choose both the HexBoard output and input ports on the Device page. Live
parameter sends only need the output port, but device library reads need the
input port that receives HexBoard SysEx responses.

## Current Scope

- Protocol helpers for the draft preset-sync SysEx frame.
- CRC32 and 8-to-7 packing utilities matching the firmware draft.
- TLV object encoding for user tunings, layouts, scale color maps, explicit
  button maps, and named/foldered synth presets.
- A synth preset editor with name and folder selection, folder creation, main
  synth parameter controls, Drive/AHDSR sliders, apply-only live sends, and an
  explicit save sync action over the active MIDI transport. Saves to real
  devices wait for ACK/NACK responses through the flash commit before the app
  refreshes device storage.
- Synth preset library areas named `Computer Library` for browser-saved/imported
  presets and `HexBoard Library` for device-side presets loaded through SysEx,
  including drag-and-drop folder moves, upload/download actions, device refresh,
  JSON import, JSON export, edit, and erase controls. Device preset listing uses
  small one-record pages to stay within conservative MIDI SysEx buffer limits
  and refreshes automatically when the synth preset view opens with a real MIDI
  transport.
- A mock MIDI transport for UI and protocol work before firmware support exists.
- Basic React views for device connection, profile sync, tuning/layout editing,
  and synth preset organization.

Firmware currently implements the synth preset subset of preset sync. Mock mode
still covers UI work for protocol areas that firmware does not implement yet.

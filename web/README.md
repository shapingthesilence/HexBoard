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

## Current Scope

- Protocol helpers for the draft preset-sync SysEx frame.
- CRC32 and 8-to-7 packing utilities matching the firmware draft.
- TLV object encoding for user tunings, layouts, scale color maps, explicit
  button maps, and named/foldered synth presets.
- A synth preset editor with name and folder fields, folder creation, main synth
  parameter controls, Drive/AHDSR sliders, apply-only live sends, and an
  explicit save sync action over the active MIDI transport.
- A mock MIDI transport for UI and protocol work before firmware support exists.
- Basic React views for device connection, profile sync, tuning/layout editing,
  and synth preset organization.

The firmware does not implement preset sync yet, so mock mode is the primary
development path for now.

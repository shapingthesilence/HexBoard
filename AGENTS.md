# HexBoard Agent Instructions

Applies repository-wide. Code is authoritative; correct stale docs when relevant.

## Ownership And Runtime

- Keep `HexBoard.ino` to Arduino lifecycle wrappers; firmware belongs in
  `src/firmware/`. Never edit generated `build/` files as source.
- Each `.cpp` must include its direct dependencies and compile independently.
  Shared declarations belong in the owning subsystem header; private state in
  its `.cpp`. Use `synth/SynthAudio.h` across subsystems and keep
  `SynthAudioInternal.h` synth-private.
- Prefer coherent subsystem ownership over stacked narrow fixes unless a
  temporary workaround is requested.
- Keep latency-sensitive ISR, audio, scan, rotary, MIDI, and control work bounded
  and allocation-free. Use `RAM_FUNC` where measurement justifies it; keep hot
  helpers and tables in RAM.
- Persist rotary inversion as user reversal of the detected hardware default,
  separate from effective direction.
- Normal builds have no diagnostic variants; temporary diagnostics are only for
  an active boot investigation.
- Update `web/` when firmware changes affect what it sends, receives, displays,
  or validates.

## Settings, Factory Images, And Storage

- Change setting keys only through `SettingKeys.inc.h`; update runtime sync,
  menu wiring, factory config, and validation. Bump `CURRENT_SETTINGS_VERSION`
  when persisted layout or byte meaning changes.
- `factory-library/` is source: web-compatible preset JSON, tuning bundles, and
  `.hexwav` wavetables. Source subdirectories become device folders.
  `config.json` owns factory settings and selections; keep it aligned with
  setting keys, `factoryDefaults`, and the current settings version.
- Compile only 12 EDO and Basic Shapes as rescue content; other factory objects
  are editable catalog records.
- Normal builds must produce a complete, destructive `*_Factory.uf2` and a
  firmware-only `*_Update.uf2`. Assemble LittleFS on the host and validate all
  256-byte pages in every touched factory-image sector.
- Boot mounts LittleFS once without auto-format. Never format, provision,
  migrate, repair, or rewrite compatible records during boot.
- Storage failures must reach normal operation with hardware-aware defaults,
  an empty editable catalog when unavailable, 12 EDO, and Basic Shapes. Mount
  failure disables saving. Report exact failing paths and validation stages.

## Documentation

- Check relevance for behavior, settings, protocol, menu, build, hardware, and
  architecture changes. Restoring an already documented contract needs no edit;
  UI layout matters only when interaction, information, workflow, or a durable
  constraint changes. If no docs change is needed, explain why in the final report.
- Follow the audience and ownership map in [docs/README.md](docs/README.md).
  User guides cover operation, choices, and recovery; developer references cover
  implementation, runtime, schemas, and verification. Link instead of duplicating.
- Replace stale text with current behavior. Keep investigation, root-cause,
  migration, implementation, and verification history in Git. Write release
  notes or proposals only when requested; separate proposals from current
  contracts and label unimplemented features explicitly.

## Verification

- Run `git diff --check` and report verification results.
- Firmware changes: run `make`; escalate and retry blocked Arduino cache access.
- Factory content or web code/assets: run the factory generator and relevant
  web tests/build. Documentation-only changes need no firmware or web build;
  check affected links and validate technical claims against source.

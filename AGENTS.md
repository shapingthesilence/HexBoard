# HexBoard Agent Instructions

These rules apply repository-wide. Treat code as the final source of truth and
update stale documentation with the code.

## Source Ownership

- Keep `HexBoard.ino` limited to Arduino lifecycle wrappers; firmware lives in
  `src/firmware/`.
- Give every `.cpp` direct headers and independent compilation. Put shared
  declarations in the nearest owning subsystem header; keep private state in its
  `.cpp`.
- Use `synth/SynthAudio.h` as the public synth API and
  `synth/SynthAudioInternal.h` only between synth modules.
- Do not edit generated `build/` files as source.
- Keep ISR code and latency-sensitive audio, scan, rotary, MIDI, and control
  helpers and data in RAM with `RAM_FUNC` where measurement justifies it. Do not
  move hot tables to flash.
- Update `web/` when firmware behavior, schemas, protocol, or capabilities alter
  what the companion app sends, receives, displays, or validates.

## Factory Images And Storage

- Treat `factory-library/` as source. Presets are web-compatible JSON under
  `presets/`; wavetables are `.hexwav` files under `wavetables/`; source
  subdirectories become device folders.
- Compile only 12 EDO and Basic Shapes as rescue content. Other factory objects
  remain editable catalog records.
- `factory-library/config.json` owns factory settings and selected objects.
  Keep it aligned with `SettingKeys.inc.h`, `factoryDefaults`, and
  `CURRENT_SETTINGS_VERSION`.
- Normal builds must produce a complete, destructive `*_Factory.uf2` and a
  firmware-only `*_Update.uf2`. Validate complete 256-byte pages for every
  touched factory-image sector.
- Assemble factory filesystems on the host. Boot mounts LittleFS once without
  auto-format and never formats, provisions, migrates, repairs, or rewrites
  compatible records.
- Storage failures must still reach normal operation using hardware-aware
  settings, an empty editable catalog, 12 EDO, and Basic Shapes. Disable saving
  after mount failure and identify exact failing paths and validation stages.

## Product And Engineering Constraints

- Persist rotary inversion as the user's reversal of the detected hardware
  default; keep the saved preference separate from effective direction.
- Do not add diagnostic variants to normal builds. Use temporary diagnostics
  only for an active boot investigation.
- Prefer coherent ownership and maintainable subsystem design over stacked
  narrow fixes unless the user requests a temporary workaround.

## Documentation

Every behavior, setting, protocol, menu, build, hardware, or architecture change
requires a documentation relevance check. Corrective changes that restore
already-documented behavior need no doc edit. Document UI layout only when
information, interaction, workflow, or a durable constraint changes.

Replace stale text with concise current-state descriptions. Do not preserve
investigation history, root cause narratives, implementation chronology, or
verification history in repository documentation; Git history is the record of
engineering changes.

Do not document a change merely because code changed. Documentation describes
the product as it currently works, not what was recently implemented, fixed,
optimized, or restored. Never accumulate chronological commentary, migration
narrative, prior behavior, implementation rationale, task outcomes, or
engineering history in documentation. Release notes are written only when
explicitly requested and should describe user-facing release impact rather than
serve as an engineering log.

Keep `docs/user-manual.md` strictly user focused. Include only information a
user needs to understand the product, choose settings, operate it, or recover
from a problem. Describe observable behavior in product language. Exclude
internal scheduling, refresh policies, transfer mechanisms, performance
implementation, architecture, source ownership, and developer verification.
Do not add text when a code change preserves the manual's existing user-facing
contract.

- `README.md`: overview, features, repository layout, build, and flashing
- `docs/user-manual.md`: user-visible behavior, defaults, workflows, hardware,
  and troubleshooting; no implementation details or engineering history
- `docs/sequencer/`: sequencer behavior, persistence, USB Backup, and layouts
- `docs/developer-guide.md`: architecture, ownership, runtime, risks, and recipes
- `docs/delegated-control.md`: delegated-control protocol and runtime gates
- `docs/preset-sync-sysex.md`: preset-sync protocol and object schemas
- `web/README.md`: companion-app development, deployment, and scope

If no documentation changes are relevant, state why in the final report.

## Settings

- Add, remove, or reorder keys only through `SettingKeys.inc.h`; update runtime
  sync, menu wiring, factory config, validation, and relevant docs.
- Bump `CURRENT_SETTINGS_VERSION` whenever persisted layout or byte meaning
  changes. Keep only the current schema contract in the developer guide.

## Verification

- Run `git diff --check`.
- Run `make` for firmware changes; if Arduino cache access is blocked, request
  escalation and retry.
- For factory-library or web changes, run the generator and relevant web
  tests/build. Report all verification results.

# HexBoard Agent Instructions

These instructions apply to the entire repository. This guide is for future AI agents and engineers modifying the HexBoard Firmware. If these instructions and the code disagree, trust the code first.

## Source Of Truth

- Edit the root `HexBoard.ino` only for Arduino lifecycle wrappers.
- Edit firmware implementation under `src/firmware/` as the primary firmware source.
- Keep firmware `.cpp` files independently compilable with direct headers; do not include `.cpp` files from other `.cpp` files.
- For synth/audio work, keep `src/firmware/synth/SynthAudio.h` as the public cross-subsystem API and `src/firmware/synth/SynthAudioInternal.h` as synth-private glue between synth modules.
- Put shared firmware types, constants, and cross-module function declarations in the nearest owning subsystem header under `src/firmware/`; keep implementation-private globals in the owning `.cpp` where practical.
- Do not edit generated files under `build/` as source.
- Keep audio ISR code, synth helper code called from the ISR, button/knob scan paths, and other latency-sensitive runtime helpers in RAM with `RAM_FUNC` or RAM-resident data. Do not move hot audio/control tables into flash.
- When firmware behavior, settings, menus, synth preset schema, or preset-sync protocol changes affect companion-app behavior, update the web app in `web/` in the same change.

## Engineering Preference

- Prefer code changes designed for cleanliness, clear ownership, and long-term maintainability over the quickest implementation. Avoid stacking narrow patches on top of earlier patches when a small, coherent redesign would leave the subsystem easier to understand and maintain.
- When a quick fix and a cleaner design differ materially, choose the cleaner design unless the user explicitly asks for a temporary workaround or urgent minimal patch.

## Documentation Requirement

Every behavior, setting, protocol, menu, build, hardware, or architecture change must include a documentation pass before the task is considered complete.

When code changes, check and update the relevant docs:

- `README.md` for project overview, build target, feature highlights, repository layout, or build/flash instructions.
- `docs/user-manual.md` for user-visible behavior, menu items, defaults, workflows, troubleshooting, or hardware-facing usage.
- `docs/developer-guide.md` for current firmware architecture, subsystem ownership, settings wiring, runtime flow, risk areas, edit recipes, or verification checklist updates.
- `docs/delegated-control.md` for external delegated-control protocol, SysEx behavior, host integration, or delegated runtime gates.
- `docs/preset-sync-sysex.md` for preset-sync SysEx behavior, object schemas, host integration, or future tuning/layout/preset storage design.

If a code change does not require documentation updates, explicitly say why in the final response.

## Settings And Persistence

- When adding, removing, or reordering `SettingKey` entries, update `factoryDefaults`, `syncSettingsToRuntime()`, menu wiring if needed, and documentation.
- Bump `CURRENT_SETTINGS_VERSION` when persisted settings layout changes.
- Document settings-version changes in `docs/developer-guide.md`.

## Verification

- Run `git diff --check` for changed code and docs.
- For firmware changes, run `make` when possible.
- If `make` fails because Arduino needs to access caches outside the workspace, rerun with the required escalation instead of skipping compile verification.
- Include verification results in the final response.

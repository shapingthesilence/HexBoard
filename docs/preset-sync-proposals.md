# Proposed Preset-Sync Extensions

These designs are unimplemented. They are retained for design work, not host
integration. Use the [implemented protocol](preset-sync-sysex.md) and advertised
capabilities for device operations. On-device profile storage does not imply
support for the proposed `DeviceProfile` wire object.

Reserved types are `DeviceProfile` (`0x01`), `ActiveSnapshot` (`0x02`), `Bundle`
(`0x08`), and `Folder` (`0x09`). Ratio-list tuning kind `3` is also unsupported.
`Bundle` is distinct from the implemented atomic `GeometryBundle` (`0x0C`).

## Device Profile Object

`DeviceProfile` represents a main HexBoard profile. It should not be a raw copy
of one row of `settingsProfiles`, because that makes the protocol fragile when
`SettingKey` changes.

Recommended TLVs:

| Tag | Name | Value |
| --- | --- | --- |
| `0x20` | `SettingsSchemaVersion` | `u8`, current firmware is `29` |
| `0x21` | `SettingValues` | Repeated `<setting-key-u8> <value-u8>` records |
| `0x22` | `TuningRef` | Object reference |
| `0x23` | `LayoutRef` | Object reference |
| `0x24` | `ScaleColorMapRef` | Optional object reference |
| `0x25` | `ExplicitButtonMapRef` | Optional object reference |
| `0x26` | `SynthPresetRef` | Optional object reference |
| `0x27` | `ScaleRef` | Optional object reference |

`SettingValues` may use current `SettingKey` ordinals only when
`SettingsSchemaVersion` exactly matches the firmware's current schema. Boot
accepts only that version and the exact current payload size; preset-sync hosts
must use the advertised schema. Keep user tunings/layouts/mappings in separate
objects and store references here.

## Bundle Object

`Bundle` is for web-app backup and restore. It can contain multiple complete
objects plus a manifest that preserves references between them.

Recommended use:

- Backup all user tunings, layouts, scales, color maps, explicit maps,
  profiles, and synth presets.
- For a user tuning bundle, keep one tuning, one custom scale-degree
  color set, one or more layouts, and one or more scales together in the
  exported JSON. Persistent restore encodes that set as one `GeometryBundle`;
  individual contained objects remain available for read and runtime preview.
- Restore by dry-run validating all objects first.
- Write dependencies before profiles that reference them.
- Commit profiles last.
- Preserve synth preset folder paths and names.

The proposed host owns bundle composition. Whole-backup atomicity is not
defined; the implemented device only guarantees atomic installation of each
validated geometry bundle.

## Proposed Profile Read Workflow

1. Host sends device identity request.
2. Host sends `HELLO_REQ`.
3. Device sends `HELLO_RESP`.
4. Host sends `READ_REQ` for `DeviceProfile` slot `0..8`.
5. Device sends `READ_BEGIN`.
6. Host ACKs.
7. Device sends ordered `DATA_CHUNK` messages.
8. Host ACKs each chunk.
9. Device sends `TRANSFER_END`.
10. Host verifies object CRC32 and ACKs.

## Design Constraints

Before implementing profile or backup transfers, define dependency validation,
missing-reference fallback, dry-run behavior, and restore ordering. Keep stable
16-byte object IDs; compact catalog handles can change. Negotiate wire and
object-schema compatibility independently, and bump persisted schemas when
storage layout or meaning changes.

Manual-layout editing needs an explicit policy for combining generator controls
with per-button overrides. Current web transforms can move overrides together;
on-device rotation and mirror settings leave them attached to physical buttons.
Any restriction on those controls is a separate product decision.

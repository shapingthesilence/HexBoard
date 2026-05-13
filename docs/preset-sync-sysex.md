# HexBoard Preset Sync SysEx Protocol Draft

This is a design spec for a future HexBoard preset-sync protocol. It is not
implemented in firmware yet.

The intent is to keep the device-side protocol small while allowing the web app
to handle tedious editing work such as Scala import, individual button mapping,
and larger preset organization. On-device editing should stay focused on compact
musical controls such as generated x-EDO tunings, isomorphic layout vectors,
profile selection, and simple scale/color choices.

## Design Goals

- Version every protocol frame and every transferred object schema.
- Avoid raw LittleFS file sync. Transfer musical objects, not filesystem images.
- Keep factory tunings/layouts read-only and allow user tunings/layouts in user
  slots.
- Let profiles reference tuning, layout, scale color, explicit button mapping,
  and synth preset objects by identity instead of depending only on hard-coded
  array positions.
- Support small, ACKed chunks so USB MIDI and serial MIDI can share the same
  protocol.
- Validate every write with a whole-object CRC32 before applying it.
- Make the simple path simple: generated EDO tuning plus vector layout should be
  compact enough to create on-device.
- Put advanced paths in the web app: Scala import, full cents/ratio lists,
  individual button edits, and batch backup/restore.

## Storage Direction

This protocol should map to a future storage model with separate catalogs:

- `/settings.dat` remains the main profile/settings file.
- `/layouts.dat` is the proposed user musical-geometry catalog. Despite the
  short name, it should own user-generated tunings, layouts, scale color maps,
  and explicit button maps because those objects need to reference each other.
- `/synth_presets.dat` should evolve from fixed unnamed slots into a named synth
  preset catalog with optional folder paths.

Keeping user tunings and layouts together in `/layouts.dat` avoids fragile
cross-file references such as a user layout pointing to a missing user tuning.
The file can still expose separate object types through SysEx.

Recommended future file headers:

| File | Magic | Version owner | Payload |
| --- | --- | --- | --- |
| `/settings.dat` | `STG` | Main settings schema | Main profile bytes and object references |
| `/layouts.dat` | `LYT` | User mapping catalog schema | User tuning/layout/color/map objects |
| `/synth_presets.dat` | `SYP` | Synth preset catalog schema | Named synth preset objects and folders |

The current firmware already has `/settings.dat` and fixed-slot
`/synth_presets.dat`; `/layouts.dat` and foldered synth presets are future
storage changes, not current implementation facts.

## Relationship To Current SysEx

The current firmware already implements:

- MIDI universal device identity inquiry and response.
- Delegated-control SysEx under the development manufacturer ID `0x7D` with
  command bytes `0x01`, `0x02`, and `0x03`.

Preset sync should coexist with that protocol. This draft reserves a new command
family byte:

```text
F0 7D 10 <protocol...> F7
```

`0x10` means "HexBoard preset sync". The existing delegated-control commands
remain:

```text
F0 7D 01 F7
F0 7D 02 F7
F0 7D 03 <led-records...> F7
```

`0x7D` is the MIDI development/educational manufacturer ID. Replace it with an
assigned manufacturer ID if the project gets one.

## Device Inquiry

Hosts should start with the standard MIDI device identity request:

```text
F0 7E <device-id> 06 01 F7
```

The current firmware response payload is:

```text
7E 00 06 02 7D 01 00 01 00 <hardware-version> 00 00 00
```

Example all-call request:

```text
F0 7E 7F 06 01 F7
```

Example response from hardware version `2`:

```text
F0 7E 00 06 02 7D 01 00 01 00 02 00 00 00 F7
```

After identity, the host sends a preset-sync hello request to negotiate protocol
version, capabilities, and chunk size.

## SysEx Frame

All preset-sync messages use this frame:

```text
F0 7D 10 <major> <minor> <message> <transaction-ms7> <transaction-ls7> <payload...> F7
```

| Field | Meaning |
| --- | --- |
| `F0` | SysEx start |
| `7D` | Development/educational manufacturer ID |
| `10` | HexBoard preset-sync family |
| `<major>` | Protocol major version |
| `<minor>` | Protocol minor version |
| `<message>` | Message type |
| `<transaction-ms7> <transaction-ls7>` | Host-chosen `u14` transaction id |
| `<payload...>` | Message-specific 7-bit-safe payload |
| `F7` | SysEx end |

Protocol `1.0` is the first version defined by this draft.

Major versions are incompatible. If a device receives an unsupported major
version, it should respond with `NACK` error `UnsupportedProtocol`.

Minor versions are additive. A device may accept a lower host minor version and
must ignore unknown optional flags. Required features must be negotiated through
the hello capability flags before use.

## 7-Bit Data Types

All bytes inside a SysEx frame must be `0x00..0x7F`.

| Type | Encoding |
| --- | --- |
| `u7` | One byte, `0..127` |
| `u14` | Two 7-bit bytes, most-significant group first |
| `u21` | Three 7-bit bytes, most-significant group first |
| `u28` | Four 7-bit bytes, most-significant group first |
| `u35` | Five 7-bit bytes, most-significant group first; top three bits zero for `u32` values |
| `s14` | `u14` biased by `8192` |
| `s21` | `u21` biased by `1048576` |
| `bool` | `0x00` false, `0x01` true |

Binary object data is carried inside chunks using 8-to-7 packing:

1. Split raw bytes into groups of up to `7`.
2. Emit one prefix byte. Bit `0` contains raw byte `0` bit `7`, bit `1`
   contains raw byte `1` bit `7`, and so on.
3. Emit the low `7` bits of each raw byte.
4. The final group may contain fewer than `7` raw bytes.

Example raw bytes:

```text
48 42 53 31
```

Packed SysEx data:

```text
00 48 42 53 31
```

Example raw bytes containing high bits:

```text
80 4F 12 00
```

Packed SysEx data:

```text
01 00 4F 12 00
```

## Checksums And CRC

Each data chunk carries a lightweight checksum:

```text
chunkChecksum = sum(unpackedChunkBytes) mod 128
```

The complete transferred object also carries a CRC32:

- Polynomial: `0xEDB88320`
- Initial value: `0xFFFFFFFF`
- Final XOR: `0xFFFFFFFF`
- Byte order for the numeric CRC field: `u35`

This matches the existing firmware `crc32()` implementation used for settings
and synth preset files.

Receivers should use chunk checksums to catch immediate chunk damage and the
whole-object CRC32 to decide whether the object can be committed. Partial writes
must not be applied.

## Message Types

| Type | Name | Direction | Meaning |
| --- | --- | --- | --- |
| `0x01` | `HELLO_REQ` | Host to device | Negotiate protocol and host limits |
| `0x02` | `HELLO_RESP` | Device to host | Return device capabilities and limits |
| `0x06` | `ACK` | Either | Acknowledge a message or chunk |
| `0x07` | `NACK` | Either | Reject a message or chunk |
| `0x20` | `OBJECT_LIST_REQ` | Host to device | List objects by type |
| `0x21` | `OBJECT_LIST_RESP` | Device to host | Return one object-list page |
| `0x22` | `READ_REQ` | Host to device | Request one object |
| `0x23` | `READ_BEGIN` | Device to host | Start a device-to-host transfer |
| `0x24` | `WRITE_BEGIN` | Host to device | Start a host-to-device transfer |
| `0x25` | `DATA_CHUNK` | Either | Send one object chunk |
| `0x26` | `TRANSFER_END` | Sender to receiver | Mark all chunks sent |
| `0x27` | `WRITE_COMMIT` | Host to device | Validate and persist a received object |
| `0x28` | `TRANSFER_ABORT` | Either | Cancel the active transfer |
| `0x29` | `DELETE_REQ` | Host to device | Delete a user object |

Only one write transfer should be active at a time. A device may also allow only
one total transfer at a time. If busy, it should send `NACK Busy`.

## ACK And NACK

`ACK` payload:

```text
<acked-message> <status> <next-chunk-index-u21> <detail>
```

| Field | Meaning |
| --- | --- |
| `<acked-message>` | Message type being acknowledged |
| `<status>` | `0x00` OK, other values message-specific |
| `<next-chunk-index-u21>` | Next expected chunk, or `0` when not chunk-related |
| `<detail>` | Optional detail, normally `0` |

`NACK` payload:

```text
<failed-message> <error-code> <expected-chunk-index-u21> <detail>
```

Common error codes:

| Code | Name | Meaning |
| --- | --- | --- |
| `0x01` | `UnsupportedProtocol` | Major version or required feature unsupported |
| `0x02` | `UnknownMessage` | Message type is unknown |
| `0x03` | `BadLength` | Payload length is invalid |
| `0x04` | `BadObjectType` | Object type is unknown or unsupported |
| `0x05` | `BadChecksum` | Chunk checksum mismatch |
| `0x06` | `BadCRC` | Whole-object CRC mismatch |
| `0x07` | `UnexpectedChunk` | Chunk index or offset is not the next expected value |
| `0x08` | `Busy` | Another transfer or flash write is active |
| `0x09` | `StorageFull` | Not enough device storage |
| `0x0A` | `WriteProtected` | Factory or read-only object cannot be changed |
| `0x0B` | `ObjectMissing` | Requested object does not exist |
| `0x0C` | `SchemaMismatch` | Object schema cannot be read by this firmware |
| `0x0D` | `ValidationFailed` | Object parsed but contains invalid values |
| `0x0E` | `Timeout` | Transfer expired |

## Hello

`HELLO_REQ` payload:

```text
<host-max-packed-chunk-u14> <required-cap-flags-u28>
```

`host-max-packed-chunk` is the largest packed chunk payload the host wants to
receive in one `DATA_CHUNK`. A web app over USB MIDI can ask for larger chunks.
A serial MIDI host should ask for smaller chunks.

`required-cap-flags` lets a host fail early if a required operation is missing.
Send `0` for discovery.

`HELLO_RESP` payload:

```text
<negotiated-major> <negotiated-minor>
<device-max-packed-chunk-u14>
<cap-flags-u28>
<max-raw-object-bytes-u28>
<settings-schema-version>
<synth-preset-schema-version>
<profile-count>
<synth-preset-count>
<user-tuning-slots>
<user-layout-slots>
<scale-color-map-slots>
<explicit-button-map-slots>
<hardware-version>
```

Capability flags:

| Bit | Meaning |
| --- | --- |
| `0` | Profile read/write |
| `1` | Synth preset read/write |
| `2` | User tuning read/write |
| `3` | User layout read/write |
| `4` | Scale color map read/write |
| `5` | Explicit button map read/write |
| `6` | Active snapshot read |
| `7` | Dry-run validation |
| `8` | Delete user object |
| `9` | Factory object listing |

Example hello request, transaction `1`, host max packed chunk `128`, no required
flags:

```text
F0 7D 10 01 00 01 00 01 01 00 00 00 00 00 F7
```

Example response, transaction `1`, max packed chunk `128`, capabilities `0x7F`,
max raw object bytes `4096`, settings schema `11`, synth preset schema `3`,
`9` profiles, `8` synth preset slots, `16` user slots for each user object
class, hardware version `2`:

```text
F0 7D 10 01 00 02 00 01 01 00 01 00 00 00 00 7F 00 00 20 00 0B 03 09 08 10 10 10 10 02 F7
```

## Object Addressing

Many messages use a field named `<slot-u14>` for compactness. Treat it as an
object handle:

- For fixed arrays, it is the actual slot index. Current examples include main
  profiles `0..8` and legacy synth presets `0..7`.
- For catalog files such as future `/layouts.dat` and foldered
  `/synth_presets.dat`, it is a compact handle returned by `OBJECT_LIST_RESP`.
  The handle may change after create/delete/reorder operations.
- Persistent identity comes from the object's `ObjectId` TLV, not from the
  handle.
- `0x3FFF` is reserved as `NEW_OBJECT` in write requests that create a new
  catalog entry.

Hosts should list a catalog before reading, updating, or deleting entries in
that catalog. Profiles should store object references by `ObjectId`, not by
handle.

## Object Types

| Type | Name | Handle meaning |
| --- | --- | --- |
| `0x01` | `DeviceProfile` | Main settings/profile slot, current firmware has `0..8` |
| `0x02` | `ActiveSnapshot` | Read-only snapshot of the currently active runtime state |
| `0x03` | `UserTuning` | `/layouts.dat` tuning handle |
| `0x04` | `UserLayout` | `/layouts.dat` layout handle |
| `0x05` | `ScaleColorMap` | `/layouts.dat` color-map handle |
| `0x06` | `ExplicitButtonMap` | `/layouts.dat` button-map handle |
| `0x07` | `SynthPreset` | Synth-only preset catalog entry; current firmware has legacy fixed slots `0..7` |
| `0x08` | `Bundle` | Web-app backup containing multiple objects |
| `0x09` | `Folder` | Optional virtual folder record for catalog navigation |

Factory tunings, factory layouts, and factory scales may be listed when the
device advertises factory object listing, but they are read-only.

## Object List

`OBJECT_LIST_REQ` payload:

```text
<object-type> <page-index-u14> <page-size> <folder-filter-len> <folder-filter-ascii...>
```

`object-type` may be `0` to list all supported object classes. `page-size`
allows small responses on serial MIDI. `folder-filter` is optional; omit it by
sending length `0`.

`OBJECT_LIST_RESP` payload:

```text
<object-type> <page-index-u14> <page-count-u14> <record-count>
<record>...
```

Each record:

```text
<object-type> <handle-u14> <flags> <schema-major> <schema-minor>
<object-id-packed-len> <object-id-packed...>
<folder-len> <folder-ascii...>
<name-len> <name-ascii...>
```

Record flags:

| Bit | Meaning |
| --- | --- |
| `0` | Valid object exists |
| `1` | Read-only factory object |
| `2` | Active object |
| `3` | Object references another object |
| `4` | Folder/container record |

Names in list responses should be ASCII and short enough for menu display. Full
UTF-8 names and folder paths can live inside the object body. For synth
presets, hosts should treat folder plus name as display organization only and
use object ids for stable references.

`object-id-packed` is the common `ObjectId` TLV value encoded with the same
8-to-7 packing used for chunk data. Empty fixed slots may report length `0`.

## Read Transfer

Read request payload:

```text
<object-type> <handle-u14> <read-flags>
```

Read flags:

| Bit | Meaning |
| --- | --- |
| `0` | Include dependencies if object type is `Bundle` |
| `1` | Return compact device representation when available |
| `2` | Return expanded web-app representation when available |

Device response starts with `READ_BEGIN`.

`READ_BEGIN` payload:

```text
<object-type> <handle-u14>
<transfer-id-u14>
<object-schema-major> <object-schema-minor>
<raw-byte-length-u28>
<object-crc32-u35>
<raw-chunk-size-u14>
<transfer-flags>
```

Then the device sends one or more `DATA_CHUNK` messages. The host ACKs each
chunk. The device finishes with `TRANSFER_END`, and the host ACKs it.

Example read profile slot `0`, transaction `2`:

```text
F0 7D 10 01 00 22 00 02 01 00 00 00 F7
```

Example ACK for that request:

```text
F0 7D 10 01 00 06 00 02 22 00 00 00 00 00 F7
```

## Write Transfer

Write begin payload:

```text
<object-type> <handle-u14>
<transfer-id-u14>
<object-schema-major> <object-schema-minor>
<raw-byte-length-u28>
<object-crc32-u35>
<raw-chunk-size-u14>
<write-flags>
```

Write flags:

| Bit | Meaning |
| --- | --- |
| `0` | Apply to active runtime after commit |
| `1` | Save to flash after commit |
| `2` | Overwrite existing object at handle |
| `3` | Dry-run validation only; do not apply or save |

The device ACKs `WRITE_BEGIN` if it can accept the transfer. The host then sends
`DATA_CHUNK` messages in order. The device ACKs every accepted chunk with the
next expected chunk index. After all chunks, the host sends `TRANSFER_END`.

Example `WRITE_BEGIN` for a new `UserTuning` object, transaction `20`,
transfer `5`, schema `1.0`, raw length `33`, CRC32 `0x6702FE2B`, raw chunk size
`64`, save-to-flash flag set:

```text
F0 7D 10 01 00 24 00 14 03 7F 7F 00 05 01 00 00 00 00 21 06 38 0B 7C 2B 00 40 02 F7
```

`WRITE_COMMIT` payload:

```text
<transfer-id-u14>
<raw-byte-length-u28>
<object-crc32-u35>
<commit-flags>
```

`commit-flags` repeats the meaningful write flags so a host can stage a transfer
and decide whether to apply/save only at commit time. The device must recompute
CRC32 from the staged raw object bytes before any runtime apply or flash write.

Firmware should avoid applying profile, mapping, or synth changes while notes
are held. A simple implementation can reject commit with `Busy` until active
notes are clear, or perform panic cleanup before applying if that behavior is
explicitly documented in the user-facing workflow.

## Data Chunks

`DATA_CHUNK` payload:

```text
<transfer-id-u14>
<chunk-index-u21>
<raw-offset-u28>
<raw-length-u14>
<chunk-checksum>
<packed-data...>
```

`raw-length` is the number of unpacked bytes in this chunk. `packed-data` is the
8-to-7 encoded representation of those raw bytes.

Example chunk containing only raw bytes `48 42 53 31` (`"HBS1"`), transfer `5`,
chunk `0`, offset `0`, checksum `0x0E`:

```text
F0 7D 10 01 00 25 00 13 00 05 00 00 00 00 00 00 00 00 04 0E 00 48 42 53 31 F7
```

Example `NACK` for bad checksum on the same chunk:

```text
F0 7D 10 01 00 07 00 13 25 05 00 00 00 02 F7
```

## Transfer End And Abort

`TRANSFER_END` payload:

```text
<transfer-id-u14> <final-chunk-count-u21>
```

The receiver ACKs if all chunks were received in order and staged bytes match
the declared length.

`TRANSFER_ABORT` payload:

```text
<transfer-id-u14> <reason-code>
```

Both sides should free staged transfer memory after abort.

## Delete User Object

`DELETE_REQ` payload:

```text
<object-type> <handle-u14> <delete-flags>
```

Delete flags:

| Bit | Meaning |
| --- | --- |
| `0` | Dry-run validation only |
| `1` | Delete dependencies that are uniquely owned by this object |

The device must reject deletion of factory/read-only objects. It should also
reject deletion when another saved object references the target, unless the host
uses a validated bundle workflow that updates or removes those references in the
same operation.

## Object Body Format

Transferred objects are raw binary bytes before 8-to-7 packing. The common
object body starts with:

```text
48 42 53 31 <object-type> <schema-major> <schema-minor> <object-flags> <tlv...>
```

`48 42 53 31` is ASCII `"HBS1"`.

Each TLV record is:

```text
<tag-u8> <length-u16-little-endian> <value-bytes...>
```

Common TLV tags:

| Tag | Name | Value |
| --- | --- | --- |
| `0x01` | `Name` | UTF-8, no NUL terminator |
| `0x02` | `ObjectId` | 16-byte stable id generated by the web app or firmware |
| `0x03` | `Source` | UTF-8 such as `device`, `web-app`, or `scala-import` |
| `0x04` | `Comment` | Optional UTF-8 note |
| `0x05` | `Dependency` | Repeated object reference records |
| `0x06` | `FolderPath` | UTF-8 path using `/` as separator, no leading slash |
| `0x07` | `SortName` | Optional UTF-8 normalized sort/display key |
| `0x08` | `Tags` | UTF-8 comma-separated tags, optional |

Object reference record:

```text
<object-type-u8> <handle-u16-le> <object-id-16-bytes>
```

Object ids prevent a profile from silently binding to the wrong user tuning,
layout, or synth preset after records are rearranged. If a referenced object id
is missing, the device should reject write commit with `ValidationFailed` or
load the profile with a documented fallback.

The handle in a saved reference is only a hint. Firmware should resolve by
`ObjectId` first and may use the handle as a fast path when it still points to
the same id.

`FolderPath` is metadata, not identity. Moving a preset from `Bass/` to
`Leads/` should not break profiles that reference its object id.

## Device Profile Object

`DeviceProfile` represents a main HexBoard profile. It should not be a raw copy
of one row of `settingsProfiles`, because that makes the protocol fragile when
`SettingKey` changes.

Recommended TLVs:

| Tag | Name | Value |
| --- | --- | --- |
| `0x20` | `SettingsSchemaVersion` | `u8`, current firmware is `11` |
| `0x21` | `SettingValues` | Repeated `<setting-key-u8> <value-u8>` records |
| `0x22` | `TuningRef` | Object reference |
| `0x23` | `LayoutRef` | Object reference |
| `0x24` | `ScaleColorMapRef` | Optional object reference |
| `0x25` | `ExplicitButtonMapRef` | Optional object reference |
| `0x26` | `SynthPresetRef` | Optional object reference |

`SettingValues` may use current `SettingKey` ordinals only when
`SettingsSchemaVersion` matches a schema the firmware knows how to migrate. For
future-proof sync, keep user tunings/layouts/mappings in separate objects and
store references here.

## User Tuning Object

`UserTuning` supports both on-device generated EDO and web-app imported tuning
data.

Recommended TLVs:

| Tag | Name | Value |
| --- | --- | --- |
| `0x20` | `TuningKind` | `u8`: `1` EDO, `2` cents list, `3` ratio list |
| `0x21` | `EdoDivisions` | `u16-le`, only for EDO |
| `0x22` | `PeriodMilliCents` | `u32-le`, default `1200000` for octave |
| `0x23` | `StepMilliCents` | `u32-le`, optional cached EDO step |
| `0x24` | `ReferenceMidiNote` | `u8`, default `69` for A4 |
| `0x25` | `ReferenceMilliHz` | `u32-le`, default `440000` |
| `0x26` | `CentsTable` | Repeated `i32-le` mill cent offsets within period |
| `0x27` | `RatioTable` | Repeated `<numerator-u32-le> <denominator-u32-le>` |
| `0x28` | `KeyLabels` | Repeated fixed or length-prefixed labels |

The device can create and edit an EDO object with only `Name`, `TuningKind`,
`EdoDivisions`, and `PeriodMilliCents`. The web app can import Scala and write a
cents or ratio table instead.

Example raw TLV snippet for a generated `19 EDO` tuning:

```text
48 42 53 31 03 01 00 00
01 06 00 31 39 20 45 44 4F
20 01 00 01
21 02 00 13 00
22 04 00 80 4F 12 00
```

## User Layout Object

`UserLayout` should represent compact isomorphic layouts first and only move to
explicit per-button maps when needed.

Recommended TLVs:

| Tag | Name | Value |
| --- | --- | --- |
| `0x20` | `LayoutKind` | `u8`: `1` isomorphic vector, `2` explicit map reference |
| `0x21` | `TuningRef` | Object reference |
| `0x22` | `CenterButton` | `u16-le`, current defaults often use `64`, `65`, or `75` |
| `0x23` | `AcrossSteps` | `i16-le` |
| `0x24` | `DownLeftSteps` | `i16-le` |
| `0x25` | `Portrait` | `u8 bool` |
| `0x26` | `ExplicitButtonMapRef` | Object reference |

This matches the current firmware layout model closely enough for simple
on-device editing: choose tuning, center button, across steps, down-left steps,
and portrait orientation.

## Scale Color Map Object

`ScaleColorMap` lets users customize scale-degree colors without requiring a
full per-button map.

Recommended TLVs:

| Tag | Name | Value |
| --- | --- | --- |
| `0x20` | `TuningRef` | Optional object reference |
| `0x21` | `CycleLength` | `u16-le` |
| `0x22` | `DefaultColorMode` | `u8`, firmware-defined color mode fallback |
| `0x23` | `DegreeColors` | Repeated `<degree-u16-le> <hue-u16-le> <sat-u8> <val-u8>` |

Hue is `0..3599` tenths of a degree. Saturation and value are `0..255`.

On-device editing can expose a small color chooser per scale degree or a few
palette templates. The web app can offer batch editing and previews.

## Explicit Button Map Object

`ExplicitButtonMap` is the advanced escape hatch for individual button editing.
The web app should own this path. The device may only display it as a named
mapping and allow select/delete.

Recommended TLVs:

| Tag | Name | Value |
| --- | --- | --- |
| `0x20` | `TuningRef` | Object reference |
| `0x21` | `LayoutRef` | Optional object reference |
| `0x22` | `MapRecordFormat` | `u8`, start with `1` |
| `0x23` | `ButtonRecords` | Repeated map records |

Map record format `1`:

```text
<button-index-u16-le>
<role-u8>
<steps-from-c-i32-le>
<midi-note-u8>
<color-mode-u8>
<hue-u16-le>
<sat-u8>
<val-u8>
```

Roles:

| Value | Meaning |
| --- | --- |
| `0` | Unused |
| `1` | Playable note |
| `2` | Command button |
| `3` | Reserved hardware/internal slot |

For the visible HexBoard surface, button indices `0..139` are meaningful. Slots
`140..159` are internal scan positions in the current firmware and should not be
used for user note mapping.

## Synth Preset Object

The current synth setup is already cohesive, so v1 should transfer synth presets
as synth-only objects, separate from tuning/layout/profile objects.

Synth presets should be named and organized by folder path. The fixed `8` slots
in the current firmware can migrate into a catalog as:

```text
Legacy/Slot 1
Legacy/Slot 2
...
Legacy/Slot 8
```

After that migration, the user-facing model should be a foldered preset library
rather than a numbered slot bank. A device menu can still present this simply as
folders plus preset names.

Recommended TLVs:

| Tag | Name | Value |
| --- | --- | --- |
| `0x20` | `SynthPresetSchemaVersion` | `u8`, current firmware is `3` |
| `0x21` | `SynthValues` | Repeated `<synth-key-u8> <value-u8>` records |
| `0x22` | `Category` | Optional UTF-8 category such as `Lead`, `Pad`, or `Bass` |
| `0x23` | `Favorite` | `u8 bool` |
| `0x24` | `LastModifiedUnixTime` | Optional `u32-le` timestamp from the web app |

The current synth preset key set is:

```text
PlaybackMode
Waveform
SynthDrive
SynthModTarget
SynthModAmount
SynthVibratoSpeed
ArpeggiatorDivision
SynthBPM
EnvelopeAttackIndex
EnvelopeHoldIndex
EnvelopeDecayIndex
EnvelopeSustainLevel
EnvelopeReleaseIndex
EffectEnvelopeTarget
EffectEnvelopeAmount
EffectEnvelopeAttackIndex
EffectEnvelopeHoldIndex
EffectEnvelopeDecayIndex
EffectEnvelopeSustainLevel
EffectEnvelopeReleaseIndex
EffectEnvelope2Target
EffectEnvelope2Amount
EffectEnvelope2AttackIndex
EffectEnvelope2HoldIndex
EffectEnvelope2DecayIndex
EffectEnvelope2SustainLevel
EffectEnvelope2ReleaseIndex
```

These are sound-focused settings only. A synth preset should not imply the
current profile slot, tuning, layout, MIDI channel, LED animation, or delegated
control state.

The common `Name` and `FolderPath` TLVs are required for named/foldered synth
presets. Duplicate names are allowed in different folders. Within the same
folder, firmware may reject duplicates or allow them as long as object ids stay
unique.

Example metadata for a named preset in folder `Pads/Warm`:

```text
01 0B 00 53 6F 66 74 20 53 74 72 69 6E 67
06 09 00 50 61 64 73 2F 57 61 72 6D
22 03 00 50 61 64
```

## Bundle Object

`Bundle` is for web-app backup and restore. It can contain multiple complete
objects plus a manifest that preserves references between them.

Recommended use:

- Backup all user tunings, layouts, color maps, explicit maps, profiles, and
  synth presets.
- Restore by dry-run validating all objects first.
- Write dependencies before profiles that reference them.
- Commit profiles last.
- Preserve synth preset folder paths and names.

The device does not need to create bundles on-device. It only needs to read or
write the individual objects after the web app unpacks a bundle.

## Preset Sync Workflows

### Read A Profile

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

### Write A Generated EDO Tuning

1. Host builds a `UserTuning` object with `TuningKind = EDO`.
2. Host sends `WRITE_BEGIN` for a `/layouts.dat` user tuning handle, or
   `NEW_OBJECT` to create one.
3. Device validates handle availability and ACKs.
4. Host sends chunks.
5. Device validates chunk checksums and ACKs each chunk.
6. Host sends `TRANSFER_END`.
7. Host sends `WRITE_COMMIT` with dry-run first if desired.
8. Device parses the TLV object, checks range limits, verifies CRC32, and then
   applies/saves according to flags.

### Write A Scala Import

1. Web app imports `.scl`.
2. Web app converts Scala data into `UserTuning` `CentsTable` or `RatioTable`.
3. Web app writes the object through the same chunked transfer path.
4. Device stores the converted tuning object. It does not need to parse Scala
   text.

### Write Individual Button Edits

1. Web app creates an `ExplicitButtonMap`.
2. Web app optionally references an existing `UserTuning` and `UserLayout`.
3. Device validates button indices, roles, and pitch ranges.
4. Device stores the map as a named user object.
5. A profile or layout can reference that map.

### Transfer A Synth Preset

1. Host sends `READ_REQ` or `WRITE_BEGIN` with object type `SynthPreset`.
2. Legacy firmware-compatible transfers may address fixed slots `0..7`; the
   future catalog model should address presets by object id and use handle only
   as a compact list cursor or compatibility alias.
3. Device validates `SynthPresetSchemaVersion`, `Name`, and `FolderPath`.
4. Commit with `apply` changes the current synth settings and marks normal
   settings dirty.
5. Commit with `save` writes the named preset catalog to `/synth_presets.dat`
   through the existing flash-safe save path.

## Implementation Notes For Future Firmware

- Keep the preset-sync parser separate from delegated-control mode. Preset sync
  is configuration transfer, not a live LED/input protocol.
- Use bounds-checked parsing for every frame and every TLV.
- Stage writes in RAM or a temporary file, verify CRC32, then commit.
- Never overwrite factory objects.
- Reject writes that reference missing dependencies unless the write is part of
  a validated bundle workflow.
- Avoid long blocking writes during active performance. Flash writes currently
  mute the synth because RP2040 flash operations pause interrupts.
- If a change adds persisted user tuning/layout/map storage, bump the relevant
  storage schema and document migration separately from the SysEx protocol
  version.
- Keep object schema migration separate from wire protocol negotiation. A device
  may speak protocol `1.0` while supporting newer object schemas.

## Open Design Questions

- User slot counts: `16` is a reasonable first target for tunings, layouts,
  scale color maps, and explicit maps, but actual limits should follow LittleFS
  space and menu usability.
- Object id format: 16 random bytes are robust, but a shorter CRC-based id may
  be easier on-device. The important rule is that profiles should not silently
  bind to the wrong object after slot moves.
- On-device color editing depth: per-degree scale colors are likely worthwhile;
  per-button color editing is probably better left to the web app.
- Profile fallback behavior: if a profile references a missing user tuning, the
  safest behavior is validation failure during write and a clear fallback during
  load, likely factory `12 EDO` plus first compatible layout.
- Factory list exposure: the web app may benefit from reading factory tuning and
  layout metadata, but the firmware can also ship that metadata in the app to
  keep device responses smaller.

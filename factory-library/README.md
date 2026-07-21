# Factory Library Source

`make` compiles this directory into the complete LittleFS image included in
`HexBoard_Factory.uf2` and `HexBoard_Sequencer_Factory.uf2`.

## Presets

Place web-app-compatible preset `.json` files under `presets/`. The relative
source directory is the on-device folder, so:

```text
presets/Pads/Soft String Pad.json -> Pads/Soft String Pad
```

The generator writes each source preset as one independently checksummed
`/presets/<object-id>.hsp` file.

The JSON `name` must match the filename and `folderPath` must match the source
directory. Each preset must provide all current synth values and reference
either a wavetable in this library or `/Built In/Basic Shapes`.

## Wavetables

Place HexBoard `.hexwav` files under `wavetables/`. These are 8-bit mono PCM WAV
containers containing either the 8,192-byte base table or the 49,152-byte
fixed-mip table. The relative directory and filename become the on-device
folder and name.

`web/scripts/generate-factory-wavetables.mjs` regenerates the supplied
`wavetables/` files from the project WAV and anchor sources. Basic
Shapes is intentionally excluded from LittleFS because it is the immutable
rescue wavetable compiled into firmware.

## Geometry Bundles

Place web-app-compatible `hexboard.layoutBundle.v4` JSON files under
`geometry/`. Each file is one bundle: one tuning and custom palette plus all of
its layouts and scales. As with synth presets, the relative source directory is
the on-device folder, while the bundle name must match the filename and its
`folderPath` must match that source directory.

The supplied `geometry/Built In/` files compile into 22 editable factory
bundles containing 332 linked records. The record count is an encoding detail;
device capacity is 64 complete bundles, counted by tuning roots. Only the
minimal 12 EDO rescue tuning, Wicki-Hayden layout, All Notes scale, and rescue
palette remain compiled into firmware, and they are exposed only if the
filesystem geometry catalog cannot be used.

Each source bundle becomes one independently checksummed
`/geometry/<tuning-object-id>.hgb` file. `selectedGeometry` is written to
`/default_geometry.dat`; filesystem directory order does not choose the factory
default.

## Configuration And Validation

`config.json` defines the filesystem generation, settings schema, factory
settings, and selected objects. `selectedGeometry` chooses the bundle referenced
at factory boot. The selected wavetable must match
the selected preset's dependency so the factory state does not start out
modified. Setting names must exactly match the firmware `SettingKey` order and
values.

The build stops with a source path and validation stage for malformed JSON,
bad `.hexwav` data, folder/name mismatches, missing values, duplicate object
IDs or names, unresolved wavetable references, capacity overflow, or a schema
version mismatch. Geometry validation also checks linked active layout/scale
IDs and the 64-bundle limit. It also extracts the generated LittleFS image and compares
every file before creating the Factory UF2.

The firmware-only Update UF2 contains no LittleFS blocks and therefore does not
install anything from this directory.

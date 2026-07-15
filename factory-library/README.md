# Factory Library Source

`make` compiles this directory into the complete LittleFS image included in
`HexBoard_Factory.uf2` and `HexBoard_Sequencer_Factory.uf2`.

## Presets

Place web-app-compatible preset `.json` files under `presets/`. The relative
source directory is the on-device folder, so:

```text
presets/Pads/Soft String Pad.json -> Pads/Soft String Pad
```

The JSON `name` must match the filename and `folderPath` must match the source
directory. Each preset must provide all current synth values and reference
either a wavetable in this library or `/Built In/Basic Shapes`.

## Wavetables

Place HexBoard `.hexwav` files under `wavetables/`. These are 8-bit mono PCM WAV
containers containing either the 8,192-byte base table or the 49,152-byte
fixed-mip table. The relative directory and filename become the on-device
folder and name.

`web/scripts/generate-factory-wavetables.mjs` regenerates the supplied
`wavetables/Factory/` files from the project WAV and anchor sources. Basic
Shapes is intentionally excluded from LittleFS because it is the immutable
rescue wavetable compiled into firmware.

## Configuration And Validation

`config.json` defines the filesystem generation, settings schema, factory
settings, and selected objects. The selected wavetable must match the selected
preset's dependency so the factory state does not start out modified. Setting
names must exactly match the firmware `SettingKey` order and values.

The build stops with a source path and validation stage for malformed JSON,
bad `.hexwav` data, folder/name mismatches, missing values, duplicate object
IDs or names, unresolved wavetable references, capacity overflow, or a schema
version mismatch. It also extracts the generated LittleFS image and compares
every file before creating the Factory UF2.

The firmware-only Update UF2 contains no LittleFS blocks and therefore does not
install anything from this directory.

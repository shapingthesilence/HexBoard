#!/usr/bin/env python3
"""Compile the editable factory library into HexBoard LittleFS records."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import wave
import zlib

PROFILE_COUNT = 9
CURRENT_SETTINGS_VERSION = 24
CURRENT_FILESYSTEM_GENERATION = 2
SYNTH_PRESET_MAX_COUNT = 128
SYNTH_WAVETABLE_MAX_COUNT = 32
SYNTH_PRESET_FILE_VERSION = 10
SYNTH_WAVETABLE_FILE_VERSION = 1
GEOMETRY_OBJECT_FILE_VERSION = 2
SYNTH_WAVETABLE_SAMPLE_BYTES = 16 * 512
SYNTH_WAVETABLE_MIP_SAMPLE_BYTES = SYNTH_WAVETABLE_SAMPLE_BYTES * 6

SETTING_KEYS = (
    "RotaryInvert", "AutoSave", "MPEpitchBend", "MPEMode", "ExtraMPE",
    "MPELowestChannel", "MPEHighestChannel", "MPELowPriority",
    "DefaultMIDIChannel", "CC74Value", "CurrentTuning", "CurrentLayout",
    "CurrentScale", "CurrentKeyStepsFromA", "CurrentTransposeSteps",
    "LayoutRotation", "MirrorLeftRight", "MirrorUpDown", "ScaleLock",
    "PaletteCenterOnKey", "WheelAltMode", "PBSticky", "ModSticky",
    "PBWheelSpeed", "ModWheelSpeed", "VelWheelSpeed", "PlaybackMode",
    "Waveform", "AudioDestination", "ArpeggiatorDivision", "SynthBPM",
    "ColorMode", "RestLedBrightness", "DimLedBrightness", "GlobalBrightness",
    "AnimationType", "ProgramChange", "JustIntonationBPMSync", "BeatBPM",
    "BPMMultiplier", "DynamicJI", "EnvelopeAttackIndex", "EnvelopeDecayIndex",
    "EnvelopeSustainLevel", "EnvelopeReleaseIndex", "DisplayPlayedNotes",
    "LedCurrentLimitMode", "SynthDrive", "SynthModTarget", "SynthVibratoSpeed",
    "MetronomeMode", "MetronomeSignature", "EffectEnvelopeAttackIndex",
    "EffectEnvelopeDecayIndex", "EffectEnvelopeSustainLevel",
    "EffectEnvelopeReleaseIndex", "BootAnimationEnabled", "EffectEnvelopeTarget",
    "EffectEnvelopeAmount", "EffectEnvelope2Target", "EffectEnvelope2Amount",
    "EffectEnvelope2AttackIndex", "EffectEnvelope2DecayIndex",
    "EffectEnvelope2SustainLevel", "EffectEnvelope2ReleaseIndex",
    "SynthAttackEffect", "EnvelopeHoldIndex", "EffectEnvelopeHoldIndex",
    "EffectEnvelope2HoldIndex", "SynthModAmount", "HeadphoneVolumeCap",
    "DeviceRotation", "SynthPortamentoTimeIndex", "ArpeggiatorDirection",
    "SynthWavetablePosition", "SynthLfoTarget", "SynthLfoAmount", "SynthLfoWave",
    "SynthLfoSpeed", "DynamicJIRatioTable", "SequencerStepAccentEvery",
    "SequencerStepColorMode", "SequencerStepHue", "SequencerMonophonicMode",
    "SequencerTapPreview", "SequencerClockSource", "SequencerSendClock",
    "SequencerSendTransport", "PiezoVolumeCap",
)

SYNTH_PRESET_KEYS = (
    "PlaybackMode", "Waveform", "SynthDrive", "SynthModTarget", "SynthModAmount",
    "SynthVibratoSpeed", "ArpeggiatorDivision", "SynthBPM",
    "EnvelopeAttackIndex", "EnvelopeHoldIndex", "EnvelopeDecayIndex",
    "EnvelopeSustainLevel", "EnvelopeReleaseIndex", "EffectEnvelopeTarget",
    "EffectEnvelopeAmount", "EffectEnvelopeAttackIndex", "EffectEnvelopeHoldIndex",
    "EffectEnvelopeDecayIndex", "EffectEnvelopeSustainLevel",
    "EffectEnvelopeReleaseIndex", "EffectEnvelope2Target", "EffectEnvelope2Amount",
    "EffectEnvelope2AttackIndex", "EffectEnvelope2HoldIndex",
    "EffectEnvelope2DecayIndex", "EffectEnvelope2SustainLevel",
    "EffectEnvelope2ReleaseIndex", "SynthPortamentoTimeIndex",
    "ArpeggiatorDirection", "SynthWavetablePosition", "SynthLfoTarget",
    "SynthLfoAmount", "SynthLfoWave", "SynthLfoSpeed",
)


class LibraryError(RuntimeError):
    pass


def fail(path: Path, stage: str, detail: str) -> LibraryError:
    return LibraryError(f"[{stage}] {path}: {detail}")


def crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def read_json(path: Path, stage: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise fail(path, stage, f"invalid JSON ({error})") from error
    if not isinstance(value, dict):
        raise fail(path, stage, "top-level value must be an object")
    return value


def checked_byte(value: object, path: Path, field: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 255:
        raise fail(path, "values", f"{field} must be an integer from 0 to 255")
    return value


def encoded_text(value: object, path: Path, field: str, capacity: int) -> bytes:
    if not isinstance(value, str) or not value.strip():
        raise fail(path, "metadata", f"{field} must be a non-empty string")
    encoded = value.strip().encode("utf-8")
    if len(encoded) >= capacity:
        raise fail(path, "metadata", f"{field} is {len(encoded)} bytes; limit is {capacity - 1}")
    return encoded + bytes(capacity - len(encoded))


def normalized_folder(value: str) -> str:
    pieces = [piece for piece in value.replace("\\", "/").split("/") if piece]
    return "/".join(pieces) or "/"


def source_folder(path: Path, root: Path) -> str:
    relative = path.parent.relative_to(root).as_posix()
    return normalized_folder(relative if relative != "." else "/")


def parse_object_id(value: object, path: Path, seed: bytes) -> bytes:
    if value is None or value == "":
        return hashlib.sha256(seed).digest()[:16]
    if not isinstance(value, str) or len(value) != 32:
        raise fail(path, "metadata", "objectId must contain exactly 32 hexadecimal characters")
    try:
        return bytes.fromhex(value)
    except ValueError as error:
        raise fail(path, "metadata", "objectId is not hexadecimal") from error


def web_deterministic_object_id(seed: str) -> bytes:
    output = bytearray(16)
    for index, character in enumerate(seed):
        slot = index % len(output)
        output[slot] = (output[slot] + ord(character) + index * 17) & 0xFF
    return bytes(output)


def parse_hexwav(path: Path) -> bytes:
    try:
        with wave.open(str(path), "rb") as wavetable:
            if wavetable.getcomptype() != "NONE":
                raise fail(path, "hexwav", "compressed WAV data is not supported")
            if wavetable.getnchannels() != 1 or wavetable.getsampwidth() != 1:
                raise fail(path, "hexwav", "expected 8-bit mono PCM WAV data")
            samples = wavetable.readframes(wavetable.getnframes())
    except (OSError, EOFError, wave.Error) as error:
        raise fail(path, "hexwav", f"invalid WAV container ({error})") from error
    if len(samples) not in (SYNTH_WAVETABLE_SAMPLE_BYTES, SYNTH_WAVETABLE_MIP_SAMPLE_BYTES):
        raise fail(
            path,
            "hexwav",
            f"sample data is {len(samples)} bytes; expected "
            f"{SYNTH_WAVETABLE_SAMPLE_BYTES} or {SYNTH_WAVETABLE_MIP_SAMPLE_BYTES}",
        )
    return samples


def build_wavetables(root: Path, output: Path) -> tuple[list[bytes], set[tuple[str, str]]]:
    paths = sorted(root.rglob("*.hexwav"))
    if len(paths) > SYNTH_WAVETABLE_MAX_COUNT:
        raise fail(root, "wavetables", f"found {len(paths)} files; capacity is {SYNTH_WAVETABLE_MAX_COUNT}")
    records: list[bytes] = []
    references: set[tuple[str, str]] = {("Built In", "Basic Shapes")}
    sample_paths: set[str] = set()
    object_ids: set[bytes] = set()
    for path in paths:
        folder = source_folder(path, root)
        name = path.stem
        key = (folder, name)
        if key in references:
            raise fail(path, "wavetables", f"duplicate device name {folder}/{name}")
        samples = parse_hexwav(path)
        object_id = web_deterministic_object_id(f"factory-wavetable:{folder}:{name}")
        sample_path = f"/wt_{object_id[:8].hex().upper()}.wtb"
        if object_id in object_ids or sample_path in sample_paths:
            raise fail(path, "wavetables", "generated object ID or sample filename collided")
        slot = (
            b"\x01"
            + object_id
            + encoded_text(name, path, "name", 32)
            + encoded_text(folder, path, "folder", 48)
            + encoded_text(sample_path, path, "sample path", 48)
        )
        if len(slot) != 145:
            raise fail(path, "wavetables", f"internal slot size is {len(slot)}; expected 145")
        (output / sample_path.removeprefix("/")).write_bytes(samples)
        records.append(slot)
        references.add(key)
        object_ids.add(object_id)
        sample_paths.add(sample_path)
    body = b"".join(records)
    header = struct.pack("<3sBHHI", b"SYW", SYNTH_WAVETABLE_FILE_VERSION, len(records), 0, crc32(body))
    (output / "synth_wavetables.dat").write_bytes(header + body)
    return records, references


def parse_preset(path: Path, root: Path,
                 wavetable_references: set[tuple[str, str]]) -> tuple[
                     bytes, str, bytes, dict[str, int], tuple[str, str]
                 ]:
    document = read_json(path, "preset")
    source = document.get("preset") if document.get("format") == "hexboard.synthPreset.v1" else document
    if not isinstance(source, dict):
        raise fail(path, "preset", "file does not contain a preset object")
    folder = source_folder(path, root)
    declared_folder = normalized_folder(str(source.get("folderPath", "/")))
    if declared_folder != folder:
        raise fail(path, "preset", f"folderPath {declared_folder!r} does not match source folder {folder!r}")
    name_value = source.get("name", path.stem)
    if name_value != path.stem:
        raise fail(path, "preset", f"name {name_value!r} does not match filename {path.stem!r}")
    name = str(name_value)
    wavetable = source.get("wavetable")
    if not isinstance(wavetable, dict):
        raise fail(path, "preset", "wavetable reference is required")
    wavetable_name = str(wavetable.get("name", "")).strip()
    wavetable_folder = normalized_folder(str(wavetable.get("folderPath", "")))
    if (wavetable_folder, wavetable_name) not in wavetable_references:
        raise fail(path, "preset", f"wavetable {wavetable_folder}/{wavetable_name} is not in the factory library")
    values_source = source.get("values")
    if not isinstance(values_source, dict):
        raise fail(path, "preset", "values must be an object")
    unknown = sorted(set(values_source) - set(SYNTH_PRESET_KEYS))
    missing = sorted(set(SYNTH_PRESET_KEYS) - set(values_source))
    if unknown or missing:
        detail = []
        if missing:
            detail.append(f"missing {', '.join(missing)}")
        if unknown:
            detail.append(f"unknown {', '.join(unknown)}")
        raise fail(path, "preset", "; ".join(detail))
    values = {key: checked_byte(values_source[key], path, key) for key in SYNTH_PRESET_KEYS}
    if values["Waveform"] != 27:
        raise fail(path, "preset", "Waveform must be 27 for explicit wavetable presets")
    object_id = parse_object_id(
        source.get("objectId"), path,
        f"hexboard.factory.preset.v1\0{folder}\0{name}".encode(),
    )
    slot = (
        b"\x01"
        + (b"\x01" if source.get("favorite") is True else b"\x00")
        + object_id
        + encoded_text(name, path, "name", 32)
        + encoded_text(folder, path, "folder", 48)
        + encoded_text(wavetable_name, path, "wavetable name", 32)
        + encoded_text(wavetable_folder, path, "wavetable folder", 48)
        + bytes(values[key] for key in SYNTH_PRESET_KEYS)
    )
    if len(slot) != 212:
        raise fail(path, "presets", f"internal slot size is {len(slot)}; expected 212")
    selected_key = f"{folder}/{name}" if folder != "/" else name
    return slot, selected_key, object_id, values, (wavetable_folder, wavetable_name)


def build_presets(root: Path, output: Path, config: dict,
                  wavetable_references: set[tuple[str, str]]) -> tuple[
                      bytes, dict[str, int], tuple[str, str]
                  ]:
    paths = sorted(root.rglob("*.json"))
    if len(paths) > SYNTH_PRESET_MAX_COUNT:
        raise fail(root, "presets", f"found {len(paths)} files; capacity is {SYNTH_PRESET_MAX_COUNT}")
    records: list[bytes] = []
    selected_id: bytes | None = None
    selected_values: dict[str, int] | None = None
    selected_wavetable: tuple[str, str] | None = None
    selected_name = config.get("selectedPreset")
    seen_ids: set[bytes] = set()
    seen_names: set[str] = set()
    for path in paths:
        slot, key, object_id, values, wavetable = parse_preset(path, root, wavetable_references)
        if object_id in seen_ids:
            raise fail(path, "presets", f"duplicate objectId {object_id.hex()}")
        if key in seen_names:
            raise fail(path, "presets", f"duplicate device path {key}")
        if key == selected_name:
            selected_id = object_id
            selected_values = values
            selected_wavetable = wavetable
        records.append(slot)
        seen_ids.add(object_id)
        seen_names.add(key)
    if selected_id is None or selected_values is None or selected_wavetable is None:
        raise fail(root, "selection", f"selectedPreset {selected_name!r} was not found")
    body = b"".join(records)
    header = struct.pack("<3sBIHH", b"SYP", SYNTH_PRESET_FILE_VERSION, crc32(body), len(records), 0)
    (output / "synth_presets.dat").write_bytes(header + body)
    reference_body = b"\x01" + selected_id
    current_reference = b"CSP" + b"\x01" + b"\x01" + bytes(3) + selected_id + struct.pack("<I", crc32(reference_body))
    (output / "current_synth_preset.dat").write_bytes(current_reference)
    return selected_id, selected_values, selected_wavetable


def build_settings(config_path: Path, output: Path, config: dict,
                   selected_preset_values: dict[str, int]) -> None:
    settings_source = config.get("settings")
    if not isinstance(settings_source, dict):
        raise fail(config_path, "settings", "settings must be an object")
    unknown = sorted(set(settings_source) - set(SETTING_KEYS))
    missing = sorted(set(SETTING_KEYS) - set(settings_source))
    if unknown or missing:
        detail = []
        if missing:
            detail.append(f"missing {', '.join(missing)}")
        if unknown:
            detail.append(f"unknown {', '.join(unknown)}")
        raise fail(config_path, "settings", "; ".join(detail))
    settings = {key: checked_byte(settings_source[key], config_path, key) for key in SETTING_KEYS}
    if settings["RotaryInvert"] != 0:
        raise fail(config_path, "settings", "RotaryInvert factory value must be 0 (relative to hardware default)")
    profiles = [bytearray(settings[key] for key in SETTING_KEYS) for _ in range(PROFILE_COUNT)]
    for key, value in selected_preset_values.items():
        profiles[0][SETTING_KEYS.index(key)] = value
    profile_data = b"".join(profiles)
    version = checked_byte(config.get("settingsVersion"), config_path, "settingsVersion")
    if version != CURRENT_SETTINGS_VERSION:
        raise fail(
            config_path,
            "settings",
            f"settingsVersion is {version}; builder expects {CURRENT_SETTINGS_VERSION}",
        )
    header = struct.pack("<3sBB3xI", b"STG", version, 0, crc32(profile_data))
    (output / "settings.dat").write_bytes(header + profile_data)


def build_wavetable_references(config_path: Path, output: Path, config: dict,
                               references: set[tuple[str, str]],
                               selected_preset_wavetable: tuple[str, str]) -> None:
    selected = config.get("selectedWavetable")
    if not isinstance(selected, str) or not selected.strip("/"):
        raise fail(config_path, "selection", "selectedWavetable must be a folder/name path")
    selected_path = selected.strip("/")
    if "/" in selected_path:
        selected_folder, selected_name = selected_path.rsplit("/", 1)
    else:
        selected_folder, selected_name = "/", selected_path
    selected_folder = normalized_folder(selected_folder)
    if (selected_folder, selected_name) not in references:
        raise fail(config_path, "selection", f"selectedWavetable {selected!r} was not found")
    if (selected_folder, selected_name) != selected_preset_wavetable:
        preset_folder, preset_name = selected_preset_wavetable
        raise fail(
            config_path,
            "selection",
            f"selectedWavetable {selected!r} does not match the selected preset dependency "
            f"{preset_folder}/{preset_name}",
        )
    name = encoded_text(selected_name, config_path, "wavetable name", 32)
    folder = encoded_text(selected_folder, config_path, "wavetable folder", 48)
    reference_data = name + folder
    current = b"CWT" + b"\x01" + reference_data + struct.pack("<I", crc32(reference_data))
    (output / "current_wavetable.dat").write_bytes(current)
    profiles = reference_data * PROFILE_COUNT
    profile_file = b"PWT" + b"\x01" + profiles + struct.pack("<I", crc32(profiles))
    (output / "profile_wavetables.dat").write_bytes(profile_file)


def build_miscellaneous(config_path: Path, output: Path, config: dict) -> None:
    (output / "layouts.dat").write_bytes(struct.pack("<3sBHHI", b"LYT", GEOMETRY_OBJECT_FILE_VERSION, 0, 0, 0))
    generation = checked_byte(config.get("filesystemGeneration"), config_path, "filesystemGeneration")
    if generation != CURRENT_FILESYSTEM_GENERATION:
        raise fail(
            config_path,
            "filesystem",
            f"filesystemGeneration is {generation}; builder expects {CURRENT_FILESYSTEM_GENERATION}",
        )
    ready_prefix = b"HFS" + bytes([generation])
    (output / "storage_ready.dat").write_bytes(ready_prefix + struct.pack("<I", crc32(ready_prefix)))
    sequence_root = output / "Sequences"
    sequence_root.mkdir()
    (sequence_root / ".keep").write_bytes(b"")


def build_library(library: Path, output: Path) -> None:
    config_path = library / "config.json"
    config = read_json(config_path, "config")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    wavetable_root = library / "wavetables"
    preset_root = library / "presets"
    if not wavetable_root.is_dir() or not preset_root.is_dir():
        raise fail(library, "layout", "expected presets/ and wavetables/ directories")
    wavetable_records, wavetable_references = build_wavetables(wavetable_root, output)
    _, selected_values, selected_preset_wavetable = build_presets(
        preset_root, output, config, wavetable_references
    )
    build_settings(config_path, output, config, selected_values)
    build_wavetable_references(
        config_path, output, config, wavetable_references, selected_preset_wavetable
    )
    build_miscellaneous(config_path, output, config)
    print(
        f"Factory library: {len(list(preset_root.rglob('*.json')))} presets, "
        f"{len(wavetable_records)} editable wavetables, Basic Shapes rescue core"
    )
    for path in sorted(output.rglob("*")):
        relative = path.relative_to(output).as_posix()
        if path.is_file():
            print(f"  [file] /{relative} ({path.stat().st_size} bytes)")
        else:
            print(f"  [dir]  /{relative}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--library", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    build_library(args.library, args.output)


if __name__ == "__main__":
    try:
        main()
    except LibraryError as error:
        raise SystemExit(f"factory library build failed: {error}") from error

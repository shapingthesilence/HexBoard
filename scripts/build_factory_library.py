#!/usr/bin/env python3
"""Compile the editable factory library into HexBoard LittleFS records."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import wave
import zlib

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
PERSISTENT_MODELS_HEADER = REPOSITORY_ROOT / "src/firmware/storage/PersistentDataModels.h"
SETTING_KEYS_DEFINITION = REPOSITORY_ROOT / "src/firmware/storage/SettingKeys.inc.h"


def source_integer_constant(name: str) -> int:
    source = PERSISTENT_MODELS_HEADER.read_text(encoding="utf-8")
    match = re.search(
        rf"constexpr\s+\w+\s+{re.escape(name)}\s*=\s*(\d+)\s*;",
        source,
    )
    if match is None:
        raise RuntimeError(f"{PERSISTENT_MODELS_HEADER}: missing integer constant {name}")
    return int(match.group(1))


def source_setting_keys() -> tuple[str, ...]:
    keys = re.findall(
        r"^HEXBOARD_SETTING\((\w+),",
        SETTING_KEYS_DEFINITION.read_text(encoding="utf-8"),
        flags=re.MULTILINE,
    )
    if not keys:
        raise RuntimeError(f"{SETTING_KEYS_DEFINITION}: no settings found")
    if len(keys) != len(set(keys)):
        raise RuntimeError(f"{SETTING_KEYS_DEFINITION}: duplicate setting name")
    return tuple(keys)


PROFILE_COUNT = source_integer_constant("PROFILE_COUNT")
CURRENT_SETTINGS_VERSION = source_integer_constant("CURRENT_SETTINGS_VERSION")
SYNTH_PRESET_MAX_COUNT = 128
SYNTH_WAVETABLE_MAX_COUNT = 32
GEOMETRY_FACTORY_BUNDLE_MAX_COUNT = 64
GEOMETRY_BUNDLE_RECORD_MAX_COUNT = 255
GEOMETRY_LAYOUT_SCALE_MAX_COUNT = 32
GEOMETRY_OBJECT_MAX_COUNT = GEOMETRY_FACTORY_BUNDLE_MAX_COUNT * GEOMETRY_BUNDLE_RECORD_MAX_COUNT
SYNTH_PRESET_FILE_VERSION = 11
SYNTH_WAVETABLE_FILE_VERSION = 1
GEOMETRY_OBJECT_FILE_VERSION = 3
GEOMETRY_OBJECT_SCHEMA_VERSION = 2
SYNTH_WAVETABLE_SAMPLE_BYTES = 16 * 512
SYNTH_WAVETABLE_MIP_SAMPLE_BYTES = SYNTH_WAVETABLE_SAMPLE_BYTES * 6
GEOMETRY_MENU_TEXT_LENGTH = 20
GEOMETRY_OBJECT_MAX_RAW_BYTES = 8192
GEOMETRY_BUNDLE_MAX_RAW_BYTES = 262144
GEOMETRY_OBJECT_ID_LENGTH = 16
MAX_SCALE_DIVISIONS = 128

OBJECT_TYPE_USER_TUNING = 0x03
OBJECT_TYPE_USER_LAYOUT = 0x04
OBJECT_TYPE_SCALE_COLOR_MAP = 0x05
OBJECT_TYPE_EXPLICIT_BUTTON_MAP = 0x06
OBJECT_TYPE_USER_SCALE = 0x0A

COMMON_TLV_NAME = 0x01
COMMON_TLV_OBJECT_ID = 0x02
COMMON_TLV_SOURCE = 0x03
COMMON_TLV_FOLDER_PATH = 0x06

TUNING_TLV_KIND = 0x20
TUNING_TLV_DIVISIONS = 0x21
TUNING_TLV_REFERENCE_MIDI_NOTE = 0x24
TUNING_TLV_KEY_LABELS = 0x28
TUNING_TLV_PERIOD_CENTS_FLOAT32 = 0x29
TUNING_TLV_STEP_CENTS_FLOAT32 = 0x2A
TUNING_TLV_REFERENCE_HZ_FLOAT32 = 0x2B

LAYOUT_TLV_KIND = 0x20
LAYOUT_TLV_TUNING_REF = 0x21
LAYOUT_TLV_CENTER_BUTTON = 0x22
LAYOUT_TLV_ACROSS_STEPS = 0x23
LAYOUT_TLV_DOWN_LEFT_STEPS = 0x24
LAYOUT_TLV_DEVICE_ROTATION = 0x27
LAYOUT_TLV_ROTATION = 0x28
LAYOUT_TLV_MIRROR_FLAGS = 0x29
LAYOUT_TLV_CENTER_STEPS_FROM_C = 0x2A

SCALE_COLOR_TLV_TUNING_REF = 0x20
SCALE_COLOR_TLV_CYCLE_LENGTH = 0x21
SCALE_COLOR_TLV_DEFAULT_COLOR_MODE = 0x22
SCALE_COLOR_TLV_DEGREE_COLORS = 0x23

USER_SCALE_TLV_TUNING_REF = 0x20
USER_SCALE_TLV_CYCLE_LENGTH = 0x21
USER_SCALE_TLV_ROOT_DEGREE = 0x22
USER_SCALE_TLV_PATTERN_STEPS = 0x23
USER_SCALE_TLV_INCLUDED_DEGREES = 0x24

LAYOUT_BUNDLE_FORMAT = "hexboard.layoutBundle.v5"

SETTING_KEYS = source_setting_keys()

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


def geometry_text(value: object, path: Path, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise fail(path, "geometry metadata", f"{field} must be a non-empty string")
    text = value.strip()
    if len(text.encode("utf-8")) >= GEOMETRY_MENU_TEXT_LENGTH:
        raise fail(
            path,
            "geometry metadata",
            f"{field} is too long; limit is {GEOMETRY_MENU_TEXT_LENGTH - 1} UTF-8 bytes",
        )
    return text


def geometry_int(value: object, path: Path, field: str, minimum: int, maximum: int) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not minimum <= value <= maximum:
        raise fail(path, "geometry values", f"{field} must be an integer from {minimum} to {maximum}")
    return value


def geometry_number(value: object, path: Path, field: str, minimum: float | None = None) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise fail(path, "geometry values", f"{field} must be a number")
    result = float(value)
    if not (float("-inf") < result < float("inf")) or (minimum is not None and result < minimum):
        suffix = f" greater than or equal to {minimum}" if minimum is not None else " finite"
        raise fail(path, "geometry values", f"{field} must be{suffix}")
    return result


def geometry_object_id(value: object, path: Path, field: str) -> bytes:
    if not isinstance(value, str) or len(value) != GEOMETRY_OBJECT_ID_LENGTH * 2:
        raise fail(path, "geometry metadata", f"{field} must contain exactly 32 hexadecimal characters")
    try:
        return bytes.fromhex(value)
    except ValueError as error:
        raise fail(path, "geometry metadata", f"{field} is not hexadecimal") from error


def f32(value: float) -> float:
    return struct.unpack("<f", struct.pack("<f", value))[0]


def geometry_tlv(tag: int, value: bytes) -> bytes:
    if len(value) > 0xFFFF:
        raise ValueError("geometry TLV is too large")
    return bytes([tag]) + struct.pack("<H", len(value)) + value


def geometry_text_tlv(tag: int, value: str) -> bytes:
    return geometry_tlv(tag, value.encode("utf-8"))


def geometry_object_reference(object_type: int, object_id: bytes) -> bytes:
    return bytes([object_type, 0, 0]) + object_id


def build_geometry_object_body(
    object_type: int,
    object_id: bytes,
    name: str,
    folder: str,
    records: list[bytes],
) -> bytes:
    common = [
        geometry_text_tlv(COMMON_TLV_NAME, name),
        geometry_tlv(COMMON_TLV_OBJECT_ID, object_id),
        geometry_text_tlv(COMMON_TLV_SOURCE, "factory-library"),
        geometry_text_tlv(COMMON_TLV_FOLDER_PATH, folder),
    ]
    return b"HBS1" + bytes([object_type, GEOMETRY_OBJECT_SCHEMA_VERSION, 0, 0]) + b"".join(common + records)


def geometry_catalog_record(
    object_type: int,
    object_id: bytes,
    name: str,
    folder: str,
    body: bytes,
) -> bytes:
    if len(body) > GEOMETRY_OBJECT_MAX_RAW_BYTES:
        raise ValueError(f"geometry object {name!r} is {len(body)} bytes; limit is {GEOMETRY_OBJECT_MAX_RAW_BYTES}")
    name_bytes = name.encode("utf-8")
    folder_bytes = folder.encode("utf-8")
    return (
        bytes([object_type, GEOMETRY_OBJECT_SCHEMA_VERSION, 0, 0])
        + object_id
        + bytes([len(name_bytes)])
        + name_bytes
        + bytes([len(folder_bytes)])
        + folder_bytes
        + struct.pack("<I", len(body))
        + body
    )


def key_labels_for_tlv(labels: list[str], cycle_length: int) -> list[str]:
    span_c_to_a = -((cycle_length * 9 + 6) // 12)
    return [labels[(span_c_to_a + c_index) % cycle_length] for c_index in range(cycle_length)]


def encode_key_labels(labels: list[str]) -> bytes:
    output = bytearray()
    for label in labels:
        encoded = label.encode("utf-8")
        output.append(len(encoded))
        output.extend(encoded)
    return bytes(output)


def parse_geometry_tuning(
    path: Path,
    bundle: dict,
    folder: str,
    cycle_length: int,
    tuning_object_id: bytes,
) -> tuple[bytes, str]:
    source = bundle.get("tuning")
    if not isinstance(source, dict):
        raise fail(path, "geometry tuning", "bundle.tuning must be an object")
    name = geometry_text(bundle.get("name"), path, "bundle.name")
    kind = source.get("kind")
    if kind not in ("edo", "equal-step"):
        raise fail(path, "geometry tuning", "factory tunings must use kind 'edo' or 'equal-step'")
    reference_midi_note = geometry_int(source.get("referenceMidiNote", 69), path, "referenceMidiNote", 0, 127)
    reference_hz = f32(geometry_number(source.get("referenceHz", 440.0), path, "referenceHz", 0.000001))
    labels_source = source.get("keyLabels")
    if not isinstance(labels_source, list) or len(labels_source) != cycle_length:
        raise fail(path, "geometry tuning", f"keyLabels must contain exactly {cycle_length} strings")
    labels = [geometry_text(label, path, f"keyLabels[{index}]") for index, label in enumerate(labels_source)]
    if any(len(label.encode("utf-8")) > 7 for label in labels):
        raise fail(path, "geometry tuning", "key labels may contain at most 7 UTF-8 bytes")

    if kind == "edo":
        edo_divisions = geometry_int(source.get("edoDivisions"), path, "edoDivisions", 1, MAX_SCALE_DIVISIONS)
        if edo_divisions != cycle_length:
            raise fail(path, "geometry tuning", "edoDivisions must match cycleLength")
        tuning_kind = 1
        period_cents = f32(geometry_number(source.get("periodCents", 1200.0), path, "periodCents", 0.000001))
        step_cents = f32(period_cents / cycle_length)
    else:
        tuning_kind = 4
        step_cents = f32(geometry_number(source.get("stepCents"), path, "stepCents", 0.000001))
        period_cents = f32(step_cents * cycle_length)

    records = [
        geometry_tlv(TUNING_TLV_KIND, bytes([tuning_kind])),
        geometry_tlv(TUNING_TLV_DIVISIONS, struct.pack("<H", cycle_length)),
        geometry_tlv(TUNING_TLV_REFERENCE_MIDI_NOTE, bytes([reference_midi_note])),
        geometry_tlv(TUNING_TLV_REFERENCE_HZ_FLOAT32, struct.pack("<f", reference_hz)),
        geometry_tlv(TUNING_TLV_KEY_LABELS, encode_key_labels(key_labels_for_tlv(labels, cycle_length))),
    ]
    records.append(
        geometry_tlv(
            TUNING_TLV_PERIOD_CENTS_FLOAT32 if kind == "edo" else TUNING_TLV_STEP_CENTS_FLOAT32,
            struct.pack("<f", period_cents if kind == "edo" else step_cents),
        )
    )
    return build_geometry_object_body(OBJECT_TYPE_USER_TUNING, tuning_object_id, name, folder, records), name


def parse_geometry_layout(
    path: Path,
    source: object,
    index: int,
    folder: str,
    tuning_object_id: bytes,
) -> tuple[bytes, bytes, str]:
    if not isinstance(source, dict):
        raise fail(path, "geometry layout", f"layouts[{index}] must be an object")
    object_id = geometry_object_id(source.get("objectIdHex"), path, f"layouts[{index}].objectIdHex")
    name = geometry_text(source.get("name"), path, f"layouts[{index}].name")
    center_button = geometry_int(source.get("centerButton"), path, f"layouts[{index}].centerButton", 0, 139)
    center_steps = geometry_int(source.get("centerStepsFromC", 0), path, f"layouts[{index}].centerStepsFromC", -32768, 32767)
    across_steps = geometry_int(source.get("acrossSteps"), path, f"layouts[{index}].acrossSteps", -128, 127)
    up_right_steps = geometry_int(source.get("upRightSteps"), path, f"layouts[{index}].upRightSteps", -128, 127)
    device_rotation = geometry_int(source.get("deviceRotationSteps", 0), path, f"layouts[{index}].deviceRotationSteps", 0, 3)
    layout_rotation = geometry_int(source.get("layoutRotationSteps", 0), path, f"layouts[{index}].layoutRotationSteps", 0, 5)
    mirror_flags = (1 if source.get("mirrorLeftRight") is True else 0) | (2 if source.get("mirrorUpDown") is True else 0)
    records = [
        geometry_tlv(LAYOUT_TLV_KIND, b"\x01"),
        geometry_tlv(LAYOUT_TLV_TUNING_REF, geometry_object_reference(OBJECT_TYPE_USER_TUNING, tuning_object_id)),
        geometry_tlv(LAYOUT_TLV_CENTER_BUTTON, struct.pack("<H", center_button)),
        geometry_tlv(LAYOUT_TLV_ACROSS_STEPS, struct.pack("<h", across_steps)),
        geometry_tlv(LAYOUT_TLV_DOWN_LEFT_STEPS, struct.pack("<h", -up_right_steps)),
        geometry_tlv(LAYOUT_TLV_DEVICE_ROTATION, bytes([device_rotation])),
        geometry_tlv(LAYOUT_TLV_ROTATION, bytes([layout_rotation])),
        geometry_tlv(LAYOUT_TLV_MIRROR_FLAGS, bytes([mirror_flags])),
        geometry_tlv(LAYOUT_TLV_CENTER_STEPS_FROM_C, struct.pack("<i", center_steps)),
    ]
    body = build_geometry_object_body(OBJECT_TYPE_USER_LAYOUT, object_id, name, folder, records)
    return object_id, body, name


def parse_geometry_scale(
    path: Path,
    source: object,
    index: int,
    folder: str,
    tuning_object_id: bytes,
    cycle_length: int,
) -> tuple[bytes, bytes, str]:
    if not isinstance(source, dict):
        raise fail(path, "geometry scale", f"scales[{index}] must be an object")
    object_id = geometry_object_id(source.get("objectIdHex"), path, f"scales[{index}].objectIdHex")
    name = geometry_text(source.get("name"), path, f"scales[{index}].name")
    included_source = source.get("includedDegrees")
    if not isinstance(included_source, list) or not included_source:
        raise fail(path, "geometry scale", f"scales[{index}].includedDegrees must be a non-empty array")
    included = sorted(set(
        geometry_int(value, path, f"scales[{index}].includedDegrees", 0, cycle_length - 1)
        for value in included_source
    ))
    records = [
        geometry_tlv(USER_SCALE_TLV_TUNING_REF, geometry_object_reference(OBJECT_TYPE_USER_TUNING, tuning_object_id)),
        geometry_tlv(USER_SCALE_TLV_CYCLE_LENGTH, struct.pack("<H", cycle_length)),
        geometry_tlv(USER_SCALE_TLV_ROOT_DEGREE, b"\x00\x00"),
        geometry_tlv(USER_SCALE_TLV_PATTERN_STEPS, b""),
        geometry_tlv(USER_SCALE_TLV_INCLUDED_DEGREES, b"".join(struct.pack("<H", value) for value in included)),
    ]
    body = build_geometry_object_body(OBJECT_TYPE_USER_SCALE, object_id, name, folder, records)
    return object_id, body, name


def parse_geometry_color_map(
    path: Path,
    source: object,
    folder: str,
    tuning_object_id: bytes,
    color_object_id: bytes,
    cycle_length: int,
) -> tuple[bytes, str]:
    if not isinstance(source, dict):
        raise fail(path, "geometry palette", "bundle.palette must be an object")
    default_mode = geometry_int(source.get("defaultColorMode", 1), path, "palette.defaultColorMode", 0, 7)
    colors_source = source.get("degreeColors")
    if not isinstance(colors_source, list):
        raise fail(path, "geometry palette", "palette.degreeColors must be an array")
    seen: set[int] = set()
    encoded_colors = bytearray()
    for index, color in enumerate(colors_source):
        if not isinstance(color, dict):
            raise fail(path, "geometry palette", f"degreeColors[{index}] must be an object")
        degree = geometry_int(color.get("degree"), path, f"degreeColors[{index}].degree", 0, cycle_length - 1)
        if degree in seen:
            raise fail(path, "geometry palette", f"degreeColors contains duplicate degree {degree}")
        seen.add(degree)
        hue = geometry_int(color.get("hueTenthDegrees"), path, f"degreeColors[{index}].hueTenthDegrees", 0, 3599)
        saturation = checked_byte(color.get("saturation"), path, f"degreeColors[{index}].saturation")
        value = checked_byte(color.get("value"), path, f"degreeColors[{index}].value")
        encoded_colors.extend(struct.pack("<HHBB", degree, hue, saturation, value))
    name = "Custom Palette"
    records = [
        geometry_tlv(SCALE_COLOR_TLV_TUNING_REF, geometry_object_reference(OBJECT_TYPE_USER_TUNING, tuning_object_id)),
        geometry_tlv(SCALE_COLOR_TLV_CYCLE_LENGTH, struct.pack("<H", cycle_length)),
        geometry_tlv(SCALE_COLOR_TLV_DEFAULT_COLOR_MODE, bytes([default_mode])),
        geometry_tlv(SCALE_COLOR_TLV_DEGREE_COLORS, bytes(encoded_colors)),
    ]
    return build_geometry_object_body(OBJECT_TYPE_SCALE_COLOR_MAP, color_object_id, name, folder, records), name


def parse_geometry_bundle(path: Path, root: Path) -> list[tuple[int, bytes, str, str, bytes]]:
    document = read_json(path, "geometry bundle")
    if document.get("format") != LAYOUT_BUNDLE_FORMAT or not isinstance(document.get("bundle"), dict):
        raise fail(path, "geometry bundle", f"expected format {LAYOUT_BUNDLE_FORMAT!r} and a bundle object")
    bundle = document["bundle"]
    folder = source_folder(path, root)
    declared_folder = normalized_folder(str(bundle.get("folderPath", "/")))
    if declared_folder != folder:
        raise fail(path, "geometry bundle", f"folderPath {declared_folder!r} does not match source folder {folder!r}")
    folder = geometry_text(folder, path, "folderPath") if folder != "/" else "/"
    bundle_name = geometry_text(bundle.get("name"), path, "bundle.name")
    if bundle_name != path.stem:
        raise fail(path, "geometry bundle", f"bundle name {bundle_name!r} does not match filename {path.stem!r}")
    bundle_id = geometry_object_id(bundle.get("objectIdHex"), path, "bundle.objectIdHex")
    tuning_object_id = web_deterministic_object_id(f"{bundle_id.hex()}:tuning")
    color_object_id = web_deterministic_object_id(f"{bundle_id.hex()}:colors")
    tuning_source = bundle.get("tuning")
    if not isinstance(tuning_source, dict):
        raise fail(path, "geometry tuning", "bundle.tuning must be an object")
    cycle_length = geometry_int(tuning_source.get("cycleLength"), path, "tuning.cycleLength", 1, MAX_SCALE_DIVISIONS)

    output: list[tuple[int, bytes, str, str, bytes]] = []
    tuning_body, tuning_name = parse_geometry_tuning(path, bundle, folder, cycle_length, tuning_object_id)
    output.append((OBJECT_TYPE_USER_TUNING, tuning_object_id, tuning_name, folder, tuning_body))

    layouts = bundle.get("layouts")
    if not isinstance(layouts, list) or not layouts:
        raise fail(path, "geometry layout", "bundle.layouts must contain at least one layout")
    if len(layouts) > GEOMETRY_LAYOUT_SCALE_MAX_COUNT:
        raise fail(
            path,
            "geometry layout",
            f"bundle.layouts contains {len(layouts)} layouts; capacity is {GEOMETRY_LAYOUT_SCALE_MAX_COUNT}",
        )
    layout_ids: set[bytes] = set()
    layout_objects: list[tuple[bytes, bytes, str]] = []
    for index, source in enumerate(layouts):
        object_id, body, name = parse_geometry_layout(path, source, index, folder, tuning_object_id)
        if object_id in layout_ids:
            raise fail(path, "geometry layout", f"duplicate layout objectId {object_id.hex()}")
        layout_ids.add(object_id)
        layout_objects.append((object_id, body, name))
    active_layout_id = geometry_object_id(bundle.get("activeLayoutIdHex"), path, "bundle.activeLayoutIdHex")
    if active_layout_id not in layout_ids:
        raise fail(path, "geometry layout", "activeLayoutIdHex does not identify a bundle layout")
    for object_id, body, name in layout_objects:
        output.append((OBJECT_TYPE_USER_LAYOUT, object_id, name, folder, body))

    scales = bundle.get("scales")
    if not isinstance(scales, list) or not scales:
        raise fail(path, "geometry scale", "bundle.scales must contain at least one scale")
    if len(scales) > GEOMETRY_LAYOUT_SCALE_MAX_COUNT:
        raise fail(
            path,
            "geometry scale",
            f"bundle.scales contains {len(scales)} scales; capacity is {GEOMETRY_LAYOUT_SCALE_MAX_COUNT}",
        )
    scale_ids: set[bytes] = set()
    scale_objects: list[tuple[bytes, bytes, str]] = []
    for index, source in enumerate(scales):
        object_id, body, name = parse_geometry_scale(path, source, index, folder, tuning_object_id, cycle_length)
        if object_id in scale_ids:
            raise fail(path, "geometry scale", f"duplicate scale objectId {object_id.hex()}")
        scale_ids.add(object_id)
        scale_objects.append((object_id, body, name))
    active_scale_id = geometry_object_id(bundle.get("activeScaleIdHex"), path, "bundle.activeScaleIdHex")
    if active_scale_id not in scale_ids:
        raise fail(path, "geometry scale", "activeScaleIdHex does not identify a bundle scale")
    for object_id, body, name in scale_objects:
        output.append((OBJECT_TYPE_USER_SCALE, object_id, name, folder, body))

    color_body, color_name = parse_geometry_color_map(
        path, bundle.get("palette"), folder, tuning_object_id, color_object_id, cycle_length
    )
    output.append((OBJECT_TYPE_SCALE_COLOR_MAP, color_object_id, color_name, folder, color_body))
    return output


def build_geometry(
    root: Path, output: Path, config_path: Path, config: dict
) -> tuple[int, bytes, bytes, bytes]:
    paths = sorted(root.rglob("*.json"))
    if len(paths) > GEOMETRY_FACTORY_BUNDLE_MAX_COUNT:
        raise fail(
            root,
            "geometry",
            f"found {len(paths)} bundles; factory bundle capacity is {GEOMETRY_FACTORY_BUNDLE_MAX_COUNT}",
        )
    selected = config.get("selectedGeometry")
    if not isinstance(selected, str) or not selected.strip("/"):
        raise fail(config_path, "selection", "selectedGeometry must be a folder/name path")
    selected_path = selected.strip("/")
    path_keys = {
        path: f"{source_folder(path, root).strip('/')}/{path.stem}".strip("/")
        for path in paths
    }
    if selected_path not in path_keys.values():
        raise fail(config_path, "selection", f"selectedGeometry {selected!r} was not found")
    configured_order = config.get("geometryOrder")
    if not isinstance(configured_order, list) or not all(isinstance(value, str) for value in configured_order):
        raise fail(config_path, "geometry order", "geometryOrder must list every geometry folder/name path")
    normalized_order = [value.strip("/") for value in configured_order]
    if len(normalized_order) != len(set(normalized_order)):
        raise fail(config_path, "geometry order", "geometryOrder contains duplicate paths")
    available_paths = set(path_keys.values())
    if set(normalized_order) != available_paths:
        missing = sorted(available_paths - set(normalized_order))
        extra = sorted(set(normalized_order) - available_paths)
        raise fail(config_path, "geometry order", f"geometryOrder mismatch; missing={missing}, extra={extra}")
    order_by_path = {value: index for index, value in enumerate(normalized_order)}
    paths.sort(key=lambda path: order_by_path[path_keys[path]])
    geometry_output = output / "geometry"
    geometry_output.mkdir()
    seen_ids: set[bytes] = set()
    record_count = 0
    selected_tuning_id: bytes | None = None
    selected_layout_id: bytes | None = None
    selected_scale_id: bytes | None = None
    ordered_tuning_ids: list[bytes] = []
    for catalog_order, path in enumerate(paths):
        try:
            objects = parse_geometry_bundle(path, root)
        except ValueError as error:
            if isinstance(error, LibraryError):
                raise
            raise fail(path, "geometry encoding", str(error)) from error
        if not objects or objects[0][0] != OBJECT_TYPE_USER_TUNING:
            raise fail(path, "geometry bundle", "first object must be the tuning root")
        if len(objects) > GEOMETRY_BUNDLE_RECORD_MAX_COUNT:
            raise fail(
                path,
                "geometry bundle",
                f"contains {len(objects)} records; capacity is {GEOMETRY_BUNDLE_RECORD_MAX_COUNT}",
            )
        bundle_records: list[bytes] = []
        for object_type, object_id, name, folder, body in objects:
            if object_id in seen_ids:
                raise fail(path, "geometry metadata", f"duplicate generated objectId {object_id.hex()}")
            seen_ids.add(object_id)
            bundle_records.append(geometry_catalog_record(object_type, object_id, name, folder, body))
        bundle_body = b"".join(bundle_records)
        header = struct.pack(
            "<3sBHHI",
            b"HGB",
            GEOMETRY_OBJECT_FILE_VERSION,
            len(bundle_records),
            catalog_order,
            crc32(bundle_body),
        )
        if len(header) + len(bundle_body) > GEOMETRY_BUNDLE_MAX_RAW_BYTES:
            raise fail(
                path,
                "geometry bundle",
                f"encoded file is {len(header) + len(bundle_body)} bytes; capacity is {GEOMETRY_BUNDLE_MAX_RAW_BYTES}",
            )
        tuning_id = objects[0][1]
        ordered_tuning_ids.append(tuning_id)
        (geometry_output / f"{tuning_id.hex().upper()}.hgb").write_bytes(header + bundle_body)
        if path_keys[path] == selected_path:
            selected_tuning_id = tuning_id
            selected_layout_id = next(
                object_id for object_type, object_id, *_ in objects
                if object_type == OBJECT_TYPE_USER_LAYOUT
            )
            selected_scale_id = next(
                object_id for object_type, object_id, *_ in objects
                if object_type == OBJECT_TYPE_USER_SCALE
            )
        record_count += len(bundle_records)
    if record_count > GEOMETRY_OBJECT_MAX_COUNT:
        raise fail(root, "geometry", f"generated {record_count} objects; capacity is {GEOMETRY_OBJECT_MAX_COUNT}")
    if selected_tuning_id is None or selected_layout_id is None or selected_scale_id is None:
        raise fail(config_path, "selection", f"selectedGeometry {selected!r} did not produce a tuning root")
    geometry_order_body = b"".join(ordered_tuning_ids)
    geometry_order_header = struct.pack(
        "<3sBB3xI",
        b"HGO",
        1,
        len(ordered_tuning_ids),
        crc32(geometry_order_body),
    )
    (output / "geometry_order.dat").write_bytes(geometry_order_header + geometry_order_body)
    default_geometry_reference = b"DGE" + b"\x01" + selected_tuning_id
    (output / "default_geometry.dat").write_bytes(
        default_geometry_reference + struct.pack("<I", crc32(selected_tuning_id))
    )
    return record_count, selected_tuning_id, selected_layout_id, selected_scale_id


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
        if any(existing_name == name for _, existing_name in references):
            raise fail(path, "wavetables", f"duplicate device wavetable name {name}")
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
    if not any(existing_name == wavetable_name for _, existing_name in wavetable_references):
        raise fail(path, "preset", f"wavetable {wavetable_name} is not in the factory library")
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
    preset_output = output / "presets"
    preset_output.mkdir()
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
        header = struct.pack("<3sBI", b"HSP", SYNTH_PRESET_FILE_VERSION, crc32(slot))
        (preset_output / f"{object_id.hex().upper()}.hsp").write_bytes(header + slot)
        seen_ids.add(object_id)
        seen_names.add(key)
    if selected_id is None or selected_values is None or selected_wavetable is None:
        raise fail(root, "selection", f"selectedPreset {selected_name!r} was not found")
    reference_body = b"\x01" + selected_id
    current_reference = b"CSP" + b"\x01" + b"\x01" + bytes(3) + selected_id + struct.pack("<I", crc32(reference_body))
    (output / "current_synth_preset.dat").write_bytes(current_reference)
    return selected_id, selected_values, selected_wavetable


def build_settings(config_path: Path, output: Path, config: dict,
                   selected_preset_values: dict[str, int],
                   selected_geometry: tuple[bytes, bytes, bytes],
                   selected_wavetable: tuple[str, str]) -> None:
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
    tuning_id, layout_id, scale_id = selected_geometry
    geometry_reference = bytes([0x07]) + tuning_id + layout_id + scale_id
    geometry_profile_data = geometry_reference * PROFILE_COUNT
    wavetable_folder, wavetable_name = selected_wavetable
    wavetable_reference = (
        encoded_text(wavetable_name, config_path, "wavetable name", 32)
        + encoded_text(wavetable_folder, config_path, "wavetable folder", 48)
    )
    wavetable_profile_data = wavetable_reference * PROFILE_COUNT
    version = checked_byte(config.get("settingsVersion"), config_path, "settingsVersion")
    if version != CURRENT_SETTINGS_VERSION:
        raise fail(
            config_path,
            "settings",
            f"settingsVersion is {version}; builder expects {CURRENT_SETTINGS_VERSION}",
        )
    settings_data = profile_data + geometry_profile_data + wavetable_profile_data
    header = struct.pack("<3sBB3xI", b"STG", version, 0, crc32(settings_data))
    (output / "settings.dat").write_bytes(header + settings_data)


def validate_selected_wavetable(config_path: Path, config: dict,
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
    if selected_name != selected_preset_wavetable[1]:
        preset_folder, preset_name = selected_preset_wavetable
        raise fail(
            config_path,
            "selection",
            f"selectedWavetable {selected!r} does not match the selected preset dependency "
            f"{preset_folder}/{preset_name}",
        )


def build_library(library: Path, output: Path) -> None:
    config_path = library / "config.json"
    config = read_json(config_path, "config")
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    wavetable_root = library / "wavetables"
    preset_root = library / "presets"
    geometry_root = library / "geometry"
    if not wavetable_root.is_dir() or not preset_root.is_dir() or not geometry_root.is_dir():
        raise fail(library, "layout", "expected geometry/, presets/, and wavetables/ directories")
    wavetable_records, wavetable_references = build_wavetables(wavetable_root, output)
    _, selected_values, selected_preset_wavetable = build_presets(
        preset_root, output, config, wavetable_references
    )
    geometry_object_count, selected_tuning_id, selected_layout_id, selected_scale_id = (
        build_geometry(geometry_root, output, config_path, config)
    )
    build_settings(
        config_path,
        output,
        config,
        selected_values,
        (selected_tuning_id, selected_layout_id, selected_scale_id),
        selected_preset_wavetable,
    )
    validate_selected_wavetable(
        config_path, config, wavetable_references, selected_preset_wavetable
    )
    print(
        f"Factory library: {len(list(preset_root.rglob('*.json')))} presets, "
        f"{len(wavetable_records)} editable wavetables, "
        f"{len(list(geometry_root.rglob('*.json')))} geometry bundles "
        f"({geometry_object_count} objects), 12 EDO and Basic Shapes rescue core"
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

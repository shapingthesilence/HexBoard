import {
  clampScaleDegreeColor,
  ButtonMapField,
  ButtonMapRecordFormat,
  ButtonOutputMode,
  ButtonMapActionKind,
  ChordPitchMode,
  ColorMode,
  createAllNotesScale,
  createDefaultDegreeColors,
  createDefaultLayout,
  currentFirmwareDownLeftToUpRight,
  defaultKeyLabels,
  decodeGeometryBundleFile,
  deterministicObjectId,
  ExplicitButtonMapTlv,
  isHexBoardCommandIndex,
  LayoutTlv,
  MaxTuningDivisions,
  normalizeScaleDegrees,
  normalizeKeyLabels,
  objectIdToHex,
  parseTuningBundleFile,
  ScaleColorMapTlv,
  TuningTlv,
  UserScaleTlv,
  UserTuningKind,
  type TuningBundle,
  type TuningBundleButtonOverride,
  type TuningBundleChordAction,
  type TuningBundleGridOverride,
  type TuningBundleLayout,
  type TuningBundleScale,
  type TuningBundleTuning,
  type ScaleDegreeColor,
  type ColorModeValue
} from "./index.ts";
import { ObjectListFlag, ObjectType, type ObjectListRecord } from "../protocol/index.ts";
import { CommonTlv, textFromBytes, type TlvRecord } from "../protocol/tlv.ts";
const rootFolderPath = "/";
function clampInteger(value: number, min: number, max: number) { return Math.max(min, Math.min(max, Math.round(value))); }
function tuningCycleLength(tuning: TuningBundleTuning) { return tuning.cycleLength; }
function isEditableButtonIndex(index: number) { return Number.isInteger(index) && index >= 0 && index < 140 && !isHexBoardCommandIndex(index); }
function noteButtonIndexOrFallback(index: number, fallback: number) { return isEditableButtonIndex(index) ? index : isEditableButtonIndex(fallback) ? fallback : 65; }
export interface HexBoardGeometryBundleEntry { deviceHandle: number; name: string; folderPath: string; catalogOrder: number }
export interface DeviceGeometryObject { record: ObjectListRecord; body: Uint8Array; records: TlvRecord[] }
export function objectReferenceIdHex(value: Uint8Array): string | null {
  if (value.length < 19) {
    return null;
  }
  return objectIdToHex(value.slice(3, 19));
}

export function tlvValue(records: TlvRecord[], tag: number): Uint8Array | undefined {
  return records.find((record) => record.tag === tag)?.value;
}

export function tlvText(records: TlvRecord[], tag: number, fallback: string): string {
  const value = tlvValue(records, tag);
  return value ? textFromBytes(value) || fallback : fallback;
}

export function u8(value: Uint8Array | undefined, fallback = 0): number {
  return value && value.length >= 1 ? value[0] : fallback;
}

export function u16LE(value: Uint8Array | undefined, fallback = 0): number {
  return value && value.length >= 2 ? value[0] | (value[1] << 8) : fallback;
}

export function i16LE(value: Uint8Array | undefined, fallback = 0): number {
  const unsigned = u16LE(value, fallback);
  return unsigned & 0x8000 ? unsigned - 0x10000 : unsigned;
}

export function i32LEFromBytes(value: Uint8Array, offset: number): number {
  const unsigned = (value[offset] | (value[offset + 1] << 8) | (value[offset + 2] << 16) | (value[offset + 3] << 24)) >>> 0;
  return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

export function float32LE(value: Uint8Array | undefined, fallback: number, offset = 0): number {
  if (!value || offset < 0 || offset + 4 > value.length) {
    return fallback;
  }
  const decoded = new DataView(value.buffer, value.byteOffset + offset, 4).getFloat32(0, true);
  return Number.isFinite(decoded) ? decoded : fallback;
}

export function i16LEFromBytes(value: Uint8Array, offset: number): number {
  const unsigned = value[offset] | (value[offset + 1] << 8);
  return unsigned > 0x7fff ? unsigned - 0x10000 : unsigned;
}

export function decodeKeyLabels(value: Uint8Array | undefined, cycleLength: number): string[] {
  if (!value) {
    return defaultKeyLabels(cycleLength);
  }
  const labels: string[] = [];
  let cursor = 0;
  while (cursor < value.length && labels.length < cycleLength) {
    const length = value[cursor];
    cursor += 1;
    if (cursor + length > value.length) {
      return defaultKeyLabels(cycleLength);
    }
    labels.push(textFromBytes(value.slice(cursor, cursor + length)));
    cursor += length;
  }
  return normalizeKeyLabels(labels, cycleLength);
}

export function legacyReferenceDegree(cycleLength: number, referenceMidiNote: number): number {
  const degree = Math.round((cycleLength * (referenceMidiNote - 60)) / 12);
  return ((degree % cycleLength) + cycleLength) % cycleLength;
}

export function objectReferences(object: DeviceGeometryObject, tag: number, objectType: number, objectIdHex: string): boolean {
  const value = tlvValue(object.records, tag);
  return Boolean(value && value.length >= 19 && value[0] === objectType && objectReferenceIdHex(value) === objectIdHex);
}

export function decodeDeviceTuning(entry: HexBoardGeometryBundleEntry, object: DeviceGeometryObject): TuningBundleTuning {
  const kind = u8(tlvValue(object.records, TuningTlv.TuningKind), UserTuningKind.Edo);
  const cycleLength = clampInteger(u16LE(tlvValue(object.records, TuningTlv.EdoDivisions), 12), 1, MaxTuningDivisions);
  const name = tlvText(object.records, CommonTlv.Name, entry.name);
  const defaultKeyDegree = clampInteger(u16LE(tlvValue(object.records, TuningTlv.DefaultKeyDegree), 0), 0, cycleLength - 1);
  const referenceMidiNote = clampInteger(u8(tlvValue(object.records, TuningTlv.ReferenceMidiNote), 69), 0, 127);
  const referenceDegree = clampInteger(
    u16LE(tlvValue(object.records, TuningTlv.ReferenceDegree), legacyReferenceDegree(cycleLength, referenceMidiNote)),
    0,
    cycleLength - 1
  );
  const referenceHz = float32LE(tlvValue(object.records, TuningTlv.ReferenceHzFloat32), 440);

  if (kind === UserTuningKind.EqualStep) {
    return {
      kind: "equal-step",
      name,
      stepCents: float32LE(tlvValue(object.records, TuningTlv.StepCentsFloat32), 1200 / cycleLength),
      cycleLength,
      referenceDegree,
      defaultKeyDegree,
      referenceMidiNote,
      referenceHz,
      keyLabels: decodeKeyLabels(tlvValue(object.records, TuningTlv.KeyLabels), cycleLength)
    };
  }

  if (kind === UserTuningKind.CentsList) {
    const centsBytes = tlvValue(object.records, TuningTlv.CentsTableFloat32);
    const cents: number[] = [];
    if (centsBytes) {
      for (let offset = 0; offset + 3 < centsBytes.length; offset += 4) {
        cents.push(float32LE(centsBytes, 0, offset));
      }
    }
    const periodCents = cents[cents.length - 1] ?? 1200;
    const safeCents = (cents.length > 0 ? cents : [periodCents]).slice(0, MaxTuningDivisions);
    return {
      kind: "scala",
      name,
      description: name,
      cents: safeCents,
      periodCents,
      cycleLength: clampInteger(safeCents.length, 1, MaxTuningDivisions),
      referenceDegree: clampInteger(referenceDegree, 0, safeCents.length - 1),
      defaultKeyDegree: clampInteger(defaultKeyDegree, 0, safeCents.length - 1),
      referenceMidiNote,
      referenceHz,
      keyLabels: decodeKeyLabels(tlvValue(object.records, TuningTlv.KeyLabels), safeCents.length)
    };
  }

  return {
    kind: "edo",
    name,
    edoDivisions: cycleLength,
    periodCents: float32LE(
      tlvValue(object.records, TuningTlv.PeriodCentsFloat32),
      1200
    ),
    cycleLength,
    referenceDegree,
    defaultKeyDegree,
    referenceMidiNote,
    referenceHz,
    keyLabels: decodeKeyLabels(tlvValue(object.records, TuningTlv.KeyLabels), cycleLength)
  };
}

export function decodeDeviceColorMap(object: DeviceGeometryObject | undefined, cycleLength: number): ScaleDegreeColor[] {
  if (!object) {
    return createDefaultDegreeColors(cycleLength);
  }
  const colors = createDefaultDegreeColors(cycleLength);
  const colorBytes = tlvValue(object.records, ScaleColorMapTlv.DegreeColors);
  if (!colorBytes) {
    return colors;
  }
  for (let offset = 0; offset + 5 < colorBytes.length; offset += 6) {
    const degree = colorBytes[offset] | (colorBytes[offset + 1] << 8);
    if (degree >= cycleLength) {
      continue;
    }
    colors[degree] = clampScaleDegreeColor({
      degree,
      hueTenthDegrees: colorBytes[offset + 2] | (colorBytes[offset + 3] << 8),
      saturation: colorBytes[offset + 4],
      value: colorBytes[offset + 5]
    });
  }
  return colors;
}

export function decodeDeviceDefaultColorMode(object: DeviceGeometryObject | undefined): ColorModeValue {
  const value = u8(tlvValue(object?.records ?? [], ScaleColorMapTlv.DefaultColorMode), ColorMode.Custom);
  return Object.values(ColorMode).some((mode) => mode === value) ? value as ColorModeValue : ColorMode.Custom;
}

export function decodeDeviceScale(object: DeviceGeometryObject, index: number, cycleLength: number): TuningBundleScale {
  const includedBytes = tlvValue(object.records, UserScaleTlv.IncludedDegrees);
  const includedDegrees: number[] = [];
  if (includedBytes) {
    for (let offset = 0; offset + 1 < includedBytes.length; offset += 2) {
      includedDegrees.push(includedBytes[offset] | (includedBytes[offset + 1] << 8));
    }
  }
  return {
    objectIdHex: objectIdToHex(object.record.objectId),
    name: tlvText(object.records, CommonTlv.Name, `Scale ${index + 1}`),
    includedDegrees: normalizeScaleDegrees(includedDegrees.length > 0 ? includedDegrees : createAllNotesScale(cycleLength).includedDegrees, cycleLength)
  };
}

export function decodeDeviceButtonMap(map: DeviceGeometryObject | undefined): {
  overrides: TuningBundleButtonOverride[];
  offGridOverrides: TuningBundleGridOverride[];
  chordActions: TuningBundleChordAction[];
} {
  const records = map ? tlvValue(map.records, ExplicitButtonMapTlv.ButtonRecords) : undefined;
  if (!records) {
    return { overrides: [], offGridOverrides: [], chordActions: [] };
  }
  const recordFormat = u8(tlvValue(map?.records ?? [], ExplicitButtonMapTlv.MapRecordFormat), ButtonMapRecordFormat.Fixed);
  const overrides: TuningBundleButtonOverride[] = [];
  if (recordFormat === ButtonMapRecordFormat.FieldMasked) {
    for (let cursor = 0; cursor + 2 <= records.length;) {
      const recordLength = records[cursor] | (records[cursor + 1] << 8);
      cursor += 2;
      if (recordLength < 17 || cursor + recordLength > records.length) {
        break;
      }
      const buttonIndex = records[cursor] | (records[cursor + 1] << 8);
      const fieldMask = records[cursor + 2] | (records[cursor + 3] << 8);
      if (isEditableButtonIndex(buttonIndex)) {
        const override: TuningBundleButtonOverride = {
          buttonIndex,
          role: (fieldMask & ButtonMapField.Role) !== 0 && records[cursor + 4] === 0 ? "unused" : "note"
        };
        if ((fieldMask & ButtonMapField.Pitch) !== 0) {
          override.stepsFromC = i32LEFromBytes(records, cursor + 5);
        }
        if ((fieldMask & ButtonMapField.Color) !== 0) {
          override.hueTenthDegrees = records[cursor + 13] | (records[cursor + 14] << 8);
          override.saturation = records[cursor + 15];
          override.value = records[cursor + 16];
        }
        if ((fieldMask & ButtonMapField.Action) !== 0) {
          const outputMode = records[cursor + 9];
          if (outputMode === ButtonOutputMode.DirectMidi) {
            override.action = {
              kind: "direct-midi",
              midiNote: records[cursor + 10],
              midiChannel: records[cursor + 11]
            };
          } else if (outputMode === ButtonOutputMode.Chord) {
            override.action = {
              kind: "chord",
              chordActionId: records[cursor + 12],
              rootMidiNote: records[cursor + 10]
            };
          }
        }
        overrides.push(override);
      }
      cursor += recordLength;
    }
  } else {
    for (let offset = 0; offset + 12 < records.length; offset += 13) {
      const buttonIndex = records[offset] | (records[offset + 1] << 8);
      if (!isEditableButtonIndex(buttonIndex)) {
        continue;
      }
      const override: TuningBundleButtonOverride = {
        buttonIndex,
        role: records[offset + 2] === 0 ? "unused" : "note",
        stepsFromC: i32LEFromBytes(records, offset + 3)
      };
      if (records[offset + 8] !== 0) {
        override.hueTenthDegrees = records[offset + 9] | (records[offset + 10] << 8);
        override.saturation = records[offset + 11];
        override.value = records[offset + 12];
      }
      overrides.push(override);
    }
  }
  const actionBytes = map ? tlvValue(map.records, ExplicitButtonMapTlv.Actions) : undefined;
  const chordActions: TuningBundleChordAction[] = [];
  if (actionBytes) {
    for (let cursor = 0; cursor + 2 <= actionBytes.length;) {
      const actionLength = actionBytes[cursor] | (actionBytes[cursor + 1] << 8);
      cursor += 2;
      if (actionLength < 6 || cursor + actionLength > actionBytes.length) {
        break;
      }
      if (actionBytes[cursor + 1] === ButtonMapActionKind.Chord) {
        const toneCount = Math.min(4, actionBytes[cursor + 4]);
        const nameLength = actionBytes[cursor + 5];
        const intervalStart = cursor + 6;
        const nameStart = intervalStart + (toneCount * 2);
        if (nameStart + nameLength <= cursor + actionLength) {
          chordActions.push({
            id: actionBytes[cursor],
            name: textFromBytes(actionBytes.slice(nameStart, nameStart + nameLength)) || `Chord ${actionBytes[cursor]}`,
            pitchMode: actionBytes[cursor + 2] === ChordPitchMode.MidiSemitones ? "midi-semitones" : "tuning-steps",
            midiChannel: actionBytes[cursor + 3],
            intervals: Array.from({ length: toneCount }, (_, index) => i16LEFromBytes(actionBytes, intervalStart + (index * 2)))
          });
        }
      }
      cursor += actionLength;
    }
  }
  return {
    overrides: overrides.sort((left, right) => left.buttonIndex - right.buttonIndex),
    offGridOverrides: [],
    chordActions
  };
}

export function decodeDeviceLayout(object: DeviceGeometryObject, index: number, buttonMap: DeviceGeometryObject | undefined): TuningBundleLayout {
  const deviceRotationSteps = clampInteger(u8(tlvValue(object.records, LayoutTlv.DeviceRotation), 0), 0, 3);
  const mirrorFlags = u8(tlvValue(object.records, LayoutTlv.MirrorFlags), 0);
  const acrossSteps = i16LE(tlvValue(object.records, LayoutTlv.AcrossSteps), 3);
  const downLeftSteps = i16LE(tlvValue(object.records, LayoutTlv.DownLeftSteps), -11);
  const buttonMapData = decodeDeviceButtonMap(buttonMap);
  return {
    objectIdHex: objectIdToHex(object.record.objectId),
    name: tlvText(object.records, CommonTlv.Name, `Layout ${index + 1}`),
    centerButton: noteButtonIndexOrFallback(u16LE(tlvValue(object.records, LayoutTlv.CenterButton), 65), 65),
    centerStepsFromC: i32LEFromBytes(tlvValue(object.records, LayoutTlv.CenterStepsFromC) ?? new Uint8Array(4), 0),
    acrossSteps,
    upRightSteps: currentFirmwareDownLeftToUpRight(acrossSteps, downLeftSteps),
    deviceRotationSteps,
    layoutRotationSteps: clampInteger(u8(tlvValue(object.records, LayoutTlv.LayoutRotation), 0), 0, 5),
    mirrorLeftRight: (mirrorFlags & 1) !== 0,
    mirrorUpDown: (mirrorFlags & 2) !== 0,
    buttonOverrides: buttonMapData.overrides,
    offGridOverrides: buttonMapData.offGridOverrides,
    chordActions: buttonMapData.chordActions
  };
}

export function decodeDeviceGeometryBundle(entry: HexBoardGeometryBundleEntry, bundleFile: Uint8Array): { bundle: TuningBundle; objects: DeviceGeometryObject[] } {
    const catalogOrder = entry.catalogOrder;
    const decodedBundle = decodeGeometryBundleFile(bundleFile);
    const bundleObjects: DeviceGeometryObject[] = decodedBundle.objects.map((object, index) => ({
      record: {
        objectType: object.objectType,
        handle: entry.deviceHandle + index,
        flags: ObjectListFlag.Valid,
        schemaMajor: object.schemaMajor,
        schemaMinor: object.schemaMinor,
        objectId: object.objectId,
        name: object.name,
        folderPath: object.folderPath ?? rootFolderPath
      },
      body: object.body,
      records: object.records
    }));
    const tuningObject = bundleObjects[0];
    if (!tuningObject || tuningObject.record.objectType !== ObjectType.UserTuning) {
      throw new Error("HexBoard tuning bundle is missing its tuning root");
    }
    const layoutObjects = bundleObjects.filter((object) => object.record.objectType === ObjectType.UserLayout);
    const scaleObjects = bundleObjects.filter((object) => object.record.objectType === ObjectType.UserScale);
    const colorMapObjects = bundleObjects.filter((object) => object.record.objectType === ObjectType.ScaleColorMap);
    const buttonMapObjects = bundleObjects.filter((object) => object.record.objectType === ObjectType.ExplicitButtonMap);
    const tuningObjectIdHex = objectIdToHex(tuningObject.record.objectId);
    const linkedLayouts = layoutObjects.filter((object) => objectReferences(object, LayoutTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex));
    const linkedScales = scaleObjects.filter((object) => objectReferences(object, UserScaleTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex));
    const linkedColorMap = colorMapObjects.find((object) => objectReferences(object, ScaleColorMapTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex));
    const linkedLayoutIds = new Set(linkedLayouts.map((object) => objectIdToHex(object.record.objectId)));
    const linkedButtonMaps = buttonMapObjects.filter((object) =>
      objectReferences(object, ExplicitButtonMapTlv.TuningRef, ObjectType.UserTuning, tuningObjectIdHex)
      || [...linkedLayoutIds].some((layoutIdHex) => objectReferences(object, ExplicitButtonMapTlv.LayoutRef, ObjectType.UserLayout, layoutIdHex))
    );
    const tuning = decodeDeviceTuning(entry, tuningObject);
    const cycleLength = tuningCycleLength(tuning);
    const layouts = linkedLayouts.length > 0
      ? linkedLayouts.map((layout, index) => {
          const layoutIdHex = objectIdToHex(layout.record.objectId);
          const buttonMap = linkedButtonMaps.find((map) =>
            objectReferences(map, ExplicitButtonMapTlv.LayoutRef, ObjectType.UserLayout, layoutIdHex)
          );
          return decodeDeviceLayout(layout, index, buttonMap);
        })
      : [createDefaultLayout(cycleLength)];
    const scales = linkedScales.map((scale, index) => decodeDeviceScale(scale, index, cycleLength));
    const bundle: TuningBundle = {
      objectIdHex: objectIdToHex(deterministicObjectId(`device-geometry:${tuningObjectIdHex}`)),
      tuningObjectIdHex,
      catalogOrder,
      ...(linkedColorMap ? { colorObjectIdHex: objectIdToHex(linkedColorMap.record.objectId) } : {}),
      folderPath: entry.folderPath,
      tuning,
      palette: {
        defaultColorMode: decodeDeviceDefaultColorMode(linkedColorMap),
        degreeColors: decodeDeviceColorMap(linkedColorMap, cycleLength)
      },
      layouts,
      activeLayoutIdHex: layouts[0].objectIdHex,
      scales,
      activeScaleIdHex: scales[0]?.objectIdHex ?? createAllNotesScale(cycleLength).objectIdHex
    };
    return {
      bundle,
      objects: [
        tuningObject,
        ...linkedLayouts,
        ...linkedScales,
        ...(linkedColorMap ? [linkedColorMap] : []),
        ...linkedButtonMaps
      ]
    };
}

import { ObjectType } from "../protocol/constants.ts";
import { deterministicObjectId } from "./objectId.ts";
import {
  createExplicitButtonMap,
  createGeneratedEdoTuning,
  createScaleColorMap,
  createUserScale,
  createVectorLayout
} from "./layoutsCatalog.ts";
import { createSynthPresetCatalog, createSynthPresetObject } from "./synthPresets.ts";
import type { LayoutsDatCatalog } from "./types.ts";

const nineteenEdoId = deterministicObjectId("19 EDO");
const vectorLayoutId = deterministicObjectId("19 EDO Wicki");

export const sampleTuning = createGeneratedEdoTuning({
  objectId: nineteenEdoId,
  name: "19 EDO",
  edoDivisions: 19
});

export const sampleLayout = createVectorLayout({
  objectId: vectorLayoutId,
  name: "Wicki 19",
  tuningRef: {
    objectType: ObjectType.UserTuning,
    handle: 0,
    objectId: nineteenEdoId
  },
  centerButton: 65,
  acrossSteps: 3,
  upRightSteps: 11,
  portrait: true
});

export const sampleScaleColorMap = createScaleColorMap({
  objectId: deterministicObjectId("19 EDO colors"),
  name: "Soft degrees",
  tuningRef: {
    objectType: ObjectType.UserTuning,
    handle: 0,
    objectId: nineteenEdoId
  },
  cycleLength: 19,
  defaultColorMode: 0,
  degreeColors: [
    { degree: 0, hueTenthDegrees: 0, saturation: 220, value: 210 },
    { degree: 3, hueTenthDegrees: 980, saturation: 200, value: 190 },
    { degree: 7, hueTenthDegrees: 1900, saturation: 180, value: 220 },
    { degree: 11, hueTenthDegrees: 2850, saturation: 190, value: 205 }
  ]
});

export const sampleScale = createUserScale({
  objectId: deterministicObjectId("19 EDO diatonic scale"),
  name: "Diatonic",
  tuningRef: {
    objectType: ObjectType.UserTuning,
    handle: 0,
    objectId: nineteenEdoId
  },
  cycleLength: 19,
  patternSteps: [3, 3, 2, 3, 3, 3, 2],
  includedDegrees: [0, 3, 6, 8, 11, 14, 17]
});

export const sampleButtonMap = createExplicitButtonMap({
  objectId: deterministicObjectId("button edits"),
  name: "Top row edits",
  tuningRef: {
    objectType: ObjectType.UserTuning,
    handle: 0,
    objectId: nineteenEdoId
  },
  layoutRef: {
    objectType: ObjectType.UserLayout,
    handle: 1,
    objectId: vectorLayoutId
  },
  records: [
    {
      buttonIndex: 64,
      role: 1,
      stepsFromC: 0,
      midiNote: 60,
      colorMode: 1,
      hueTenthDegrees: 0,
      saturation: 255,
      value: 220
    }
  ]
});

export const sampleLayoutsCatalog: LayoutsDatCatalog = {
  tunings: [sampleTuning],
  layouts: [sampleLayout],
  scales: [sampleScale],
  scaleColorMaps: [sampleScaleColorMap],
  explicitButtonMaps: [sampleButtonMap]
};

export const sampleSynthCatalog = createSynthPresetCatalog([
  createSynthPresetObject({
    objectId: deterministicObjectId("Soft String Pad"),
    name: "Soft String Pad",
    folderPath: "Pads/Warm",
    favorite: true,
    tags: ["smooth", "poly"],
    values: {
      PlaybackMode: 3,
      Waveform: 6,
      SynthDrive: 0,
      SynthModTarget: 0,
      SynthModAmount: 127,
      SynthVibratoSpeed: 5,
      EnvelopeAttackIndex: 12,
      EnvelopeHoldIndex: 0,
      EnvelopeDecayIndex: 14,
      EnvelopeSustainLevel: 100,
      EnvelopeReleaseIndex: 14
    }
  }),
  createSynthPresetObject({
    objectId: deterministicObjectId("Bright Mono Lead"),
    name: "Bright Mono Lead",
    folderPath: "Leads",
    favorite: false,
    values: {
      PlaybackMode: 1,
      Waveform: 3,
      SynthDrive: 2,
      SynthModTarget: 2,
      SynthModAmount: 100,
      EnvelopeAttackIndex: 0,
      EnvelopeHoldIndex: 0,
      EnvelopeDecayIndex: 4,
      EnvelopeSustainLevel: 110,
      EnvelopeReleaseIndex: 5
    }
  })
]);

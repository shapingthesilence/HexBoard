import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import {
  clampScaleDegreeColor,
  computeVectorLayoutSteps,
  createAllNotesScale,
  createDefaultDegreeColors,
  createDefaultLayout,
  createDefaultLayoutBundle,
  defaultKeyLabels,
  deterministicObjectId,
  encodeLayoutBundle,
  hexBoardGeometry,
  isHexBoardCommandIndex,
  normalizeScaleDegrees,
  normalizeScaleDegreeColors,
  normalizeKeyLabels,
  objectIdToHex,
  parseLayoutBundleFile,
  parseLayoutBundleLibrary,
  parseScalaScale,
  resolveLayoutBundleButtonColor,
  serializeLayoutBundle,
  type HexBoardKey,
  type LayoutBundle,
  type LayoutBundleButtonOverride,
  type LayoutBundleLayout,
  type LayoutBundleScale,
  type LayoutBundleTuning,
  type ScaleDegreeColor
} from "../catalogs/index.ts";
import { crc32 } from "../protocol/crc32.ts";
import { formatByteLength } from "./format.ts";

const layoutBundleStorageKey = "hexboard.layoutBundles.v1";
const previewHexHalfStepX = 24;
const previewHexRowStepY = 42;
const previewHexInset = 24;

type LayoutGuideFocus = "center" | "across" | "upRight";
type GeometryEditorTab = "tuning" | "layouts" | "scales";

const layoutAxisDirectionLabels = [
  { across: "Right", upRight: "Up-right" },
  { across: "Down", upRight: "Down-right" },
  { across: "Left", upRight: "Down-left" },
  { across: "Up", upRight: "Up-left" }
] as const;

interface PreviewKey {
  key: HexBoardKey;
  role: "note" | "command" | "unused";
  generatedStepsFromC: number;
  stepsFromC: number;
  degree: number;
  inScale: boolean;
  color: ScaleDegreeColor;
  colorSource: "button" | "degree";
  noteSource: "button" | "generated";
  override?: LayoutBundleButtonOverride;
}

interface GuideHalo {
  key: HexBoardKey;
  tone: "green" | "red";
}

function createUntitledBundle(): LayoutBundle {
  const base = createDefaultLayoutBundle();
  const objectIdHex = objectIdToHex(deterministicObjectId(`layout-bundle:${Date.now()}`));
  const layoutIdHex = objectIdToHex(deterministicObjectId(`${objectIdHex}:layout:default`));
  const scaleIdHex = objectIdToHex(deterministicObjectId(`${objectIdHex}:scale:all-notes`));
  return {
    ...base,
    objectIdHex,
    name: "Untitled Geometry",
    tuning: {
      ...base.tuning,
      name: "19 EDO"
    },
    palette: base.palette,
    layouts: base.layouts.map((layout) => ({ ...layout, objectIdHex: layoutIdHex, name: "Untitled Layout" })),
    activeLayoutIdHex: layoutIdHex,
    scales: base.scales.map((scale) => ({ ...scale, objectIdHex: scaleIdHex })),
    activeScaleIdHex: scaleIdHex
  };
}

function loadStoredBundles(): LayoutBundle[] {
  if (typeof window === "undefined") {
    return [createDefaultLayoutBundle()];
  }
  try {
    const raw = window.localStorage.getItem(layoutBundleStorageKey);
    if (!raw) {
      return [createDefaultLayoutBundle()];
    }
    const parsed = JSON.parse(raw) as unknown;
    return parseLayoutBundleLibrary(parsed);
  } catch {
    return [createDefaultLayoutBundle()];
  }
}

function persistBundles(bundles: LayoutBundle[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(layoutBundleStorageKey, JSON.stringify(bundles));
  }
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function tuningCycleLength(tuning: LayoutBundleTuning): number {
  return Math.max(1, Math.round(tuning.cycleLength));
}

function tuningPeriodCents(tuning: LayoutBundleTuning): number {
  if (tuning.kind === "equal-step") {
    return tuning.stepCents * tuningCycleLength(tuning);
  }
  return tuning.periodCents;
}

function layoutAxisLabels(rotationSteps: number): typeof layoutAxisDirectionLabels[number] {
  const index = ((Math.round(rotationSteps) % 4) + 4) % 4;
  return layoutAxisDirectionLabels[index];
}

function withCycleColors(bundle: LayoutBundle, cycleLength: number): LayoutBundle {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  const scales = bundle.scales.length > 0 ? bundle.scales : [createAllNotesScale(safeCycleLength)];
  return {
    ...bundle,
    palette: {
      ...bundle.palette,
      degreeColors: normalizeScaleDegreeColors(bundle.palette.degreeColors, safeCycleLength)
    },
    layouts: bundle.layouts.map((layout) => ({
      ...layout,
      rotationSteps: clampInteger(layout.rotationSteps ?? 0, 0, 3)
    })),
    scales: scales.map((scale) => ({
      ...scale,
      includedDegrees: normalizeScaleDegrees(scale.includedDegrees, safeCycleLength)
    })),
    activeScaleIdHex: scales.find((scale) => scale.objectIdHex === bundle.activeScaleIdHex)?.objectIdHex ?? scales[0].objectIdHex
  };
}

function colorToCss(color: ScaleDegreeColor): string {
  const hue = color.hueTenthDegrees / 10;
  const saturation = Math.round((color.saturation / 255) * 100);
  const lightness = Math.round(18 + ((color.value / 255) * 46));
  return `hsl(${hue}deg ${saturation}% ${lightness}%)`;
}

function scaleDegreeColorToHex(color: ScaleDegreeColor): string {
  const hue = (((color.hueTenthDegrees / 10) % 360) + 360) % 360;
  const saturation = color.saturation / 255;
  const value = color.value / 255;
  const chroma = value * saturation;
  const huePrime = hue / 60;
  const intermediate = chroma * (1 - Math.abs((huePrime % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    red = chroma;
    green = intermediate;
  } else if (huePrime < 2) {
    red = intermediate;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = intermediate;
  } else if (huePrime < 4) {
    green = intermediate;
    blue = chroma;
  } else if (huePrime < 5) {
    red = intermediate;
    blue = chroma;
  } else {
    red = chroma;
    blue = intermediate;
  }

  return [red, green, blue]
    .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
    .join("")
    .replace(/^/, "#");
}

function hexToScaleDegreeColor(hex: string, fallback: ScaleDegreeColor): ScaleDegreeColor {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : null;
  if (!normalized) {
    return fallback;
  }
  const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0 && max === red) {
    hue = 60 * (((green - blue) / delta) % 6);
  } else if (delta !== 0 && max === green) {
    hue = 60 * (((blue - red) / delta) + 2);
  } else if (delta !== 0) {
    hue = 60 * (((red - green) / delta) + 4);
  }

  return clampScaleDegreeColor({
    degree: fallback.degree,
    hueTenthDegrees: Math.round((((hue + 360) % 360) * 10)),
    saturation: max === 0 ? 0 : Math.round((delta / max) * 255),
    value: Math.round(max * 255)
  });
}

function fileBaseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "Imported Tuning";
}

function downloadTextFile(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function upsertOverride(
  overrides: LayoutBundleButtonOverride[],
  buttonIndex: number,
  patch: Partial<LayoutBundleButtonOverride>
): LayoutBundleButtonOverride[] {
  const existing = overrides.find((override) => override.buttonIndex === buttonIndex);
  const next = {
    buttonIndex,
    role: existing?.role ?? (isHexBoardCommandIndex(buttonIndex) ? "command" : "note"),
    ...existing,
    ...patch
  } satisfies LayoutBundleButtonOverride;
  return [...overrides.filter((override) => override.buttonIndex !== buttonIndex), next]
    .sort((left, right) => left.buttonIndex - right.buttonIndex);
}

function removeOverrideColor(override: LayoutBundleButtonOverride): LayoutBundleButtonOverride {
  const { hueTenthDegrees, saturation, value, ...rest } = override;
  void hueTenthDegrees;
  void saturation;
  void value;
  return rest;
}

function isRoleDefault(buttonIndex: number, role: LayoutBundleButtonOverride["role"]): boolean {
  return role === (isHexBoardCommandIndex(buttonIndex) ? "command" : "note");
}

function hexBoardKeyAtCoord(coordRow: number, coordCol: number): HexBoardKey | undefined {
  return hexBoardGeometry.find((key) => key.coordRow === coordRow && key.coordCol === coordCol);
}

function formatIntegerList(values: number[]): string {
  return values.join(", ");
}

function formatLabelList(labels: string[]): string {
  return labels.join(", ");
}

function parseLabelList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function validateKeyLabelsInput(text: string, cycleLength: number): { labels: string[] } | { error: string } {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  const labels = parseLabelList(text);
  if (labels.length !== safeCycleLength) {
    return { error: `Note labels must include exactly ${safeCycleLength} labels.` };
  }
  const invalidLabel = labels.find((label) => label.length > 8 || !/^[A-Za-z0-9+#b-]+$/.test(label));
  if (invalidLabel) {
    return { error: `Invalid note label "${invalidLabel}". Use letters, numbers, +, #, b, or -.` };
  }
  return { labels };
}

function validateIncludedDegreesInput(text: string, cycleLength: number): { degrees: number[] } | { error: string } {
  const safeCycleLength = Math.max(1, Math.round(cycleLength));
  const trimmed = text.trim();
  if (!trimmed) {
    return { error: "Included degrees needs at least one degree." };
  }

  const parts = trimmed.split(/[\s,]+/).filter(Boolean);
  const degrees: number[] = [];
  for (const part of parts) {
    if (!/^-?\d+$/.test(part)) {
      return { error: `Invalid included degree "${part}". Use whole numbers separated by commas or spaces.` };
    }
    const degree = Number.parseInt(part, 10);
    if (degree < 0 || degree >= safeCycleLength) {
      return { error: `Included degrees must be between 0 and ${safeCycleLength - 1}.` };
    }
    degrees.push(degree);
  }

  return { degrees: normalizeScaleDegrees(degrees, safeCycleLength) };
}

export function TuningLayoutEditor() {
  const [bundles, setBundles] = useState<LayoutBundle[]>(() => loadStoredBundles());
  const [activeBundleId, setActiveBundleId] = useState("");
  const [selectedButton, setSelectedButton] = useState(65);
  const [layoutGuideFocus, setLayoutGuideFocus] = useState<LayoutGuideFocus | null>(null);
  const [activeEditorTab, setActiveEditorTab] = useState<GeometryEditorTab>("tuning");
  const [paintbrushMode, setPaintbrushMode] = useState(false);
  const [paintbrushColor, setPaintbrushColor] = useState<ScaleDegreeColor>(() => createDefaultDegreeColors(1)[0]);
  const [keyLabelsDraft, setKeyLabelsDraft] = useState("");
  const [keyLabelsError, setKeyLabelsError] = useState("");
  const [includedDegreesDraft, setIncludedDegreesDraft] = useState("");
  const [includedDegreesError, setIncludedDegreesError] = useState("");
  const [status, setStatus] = useState("Ready");
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const scalaInputRef = useRef<HTMLInputElement>(null);
  const keyLabelsInputRef = useRef<HTMLInputElement>(null);
  const includedDegreesInputRef = useRef<HTMLInputElement>(null);
  const paintStrokeActiveRef = useRef(false);
  const lastPaintedButtonRef = useRef<number | null>(null);

  const activeBundle = bundles.find((bundle) => bundle.objectIdHex === activeBundleId) ?? bundles[0] ?? createDefaultLayoutBundle();
  const activeLayout = activeBundle.layouts.find((layout) => layout.objectIdHex === activeBundle.activeLayoutIdHex) ??
    activeBundle.layouts[0] ??
    createDefaultLayout(tuningCycleLength(activeBundle.tuning));
  const activeScale = activeBundle.scales.find((scale) => scale.objectIdHex === activeBundle.activeScaleIdHex) ??
    activeBundle.scales[0] ??
    createAllNotesScale(tuningCycleLength(activeBundle.tuning));

  useEffect(() => {
    setIncludedDegreesDraft(formatIntegerList(activeScale.includedDegrees));
    setIncludedDegreesError("");
  }, [activeScale.objectIdHex, activeBundle.tuning.cycleLength]);

  useEffect(() => {
    if (activeBundle.tuning.kind === "scala") {
      setKeyLabelsDraft("");
      setKeyLabelsError("");
      return;
    }
    setKeyLabelsDraft(formatLabelList(activeBundle.tuning.keyLabels));
    setKeyLabelsError("");
  }, [activeBundle.tuning]);

  function setBundlesAndPersist(nextBundles: LayoutBundle[]) {
    setBundles(nextBundles);
    persistBundles(nextBundles);
  }

  function updateActiveBundle(updater: (bundle: LayoutBundle) => LayoutBundle) {
    const targetId = activeBundle.objectIdHex;
    const nextBundles = bundles.map((bundle) => bundle.objectIdHex === targetId ? updater(bundle) : bundle);
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(targetId);
  }

  function addNewBundle() {
    const next = createUntitledBundle();
    const nextBundles = [...bundles, next];
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(next.objectIdHex);
    setSelectedButton(next.layouts[0]?.centerButton ?? 65);
    setStatus("Created new geometry bundle");
  }

  function deleteActiveBundle() {
    if (bundles.length <= 1) {
      setStatus("Keep at least one geometry bundle in the library");
      return;
    }
    const nextBundles = bundles.filter((bundle) => bundle.objectIdHex !== activeBundle.objectIdHex);
    setBundlesAndPersist(nextBundles);
    setActiveBundleId(nextBundles[0]?.objectIdHex ?? "");
    setSelectedButton(nextBundles[0]?.layouts[0]?.centerButton ?? 65);
    setStatus(`Deleted ${activeBundle.name}`);
  }

  function updateBundleName(name: string) {
    updateActiveBundle((bundle) => ({ ...bundle, name }));
  }

  function updateActiveLayout(updater: (layout: LayoutBundleLayout) => LayoutBundleLayout) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      layouts: bundle.layouts.map((layout) => layout.objectIdHex === bundle.activeLayoutIdHex ? updater(layout) : layout)
    }));
  }

  function updateLayout(patch: Partial<LayoutBundleLayout>) {
    updateActiveLayout((layout) => ({
      ...layout,
      ...patch
    }));
  }

  function addNewLayout() {
    const layout = {
      ...activeLayout,
      objectIdHex: objectIdToHex(deterministicObjectId(`${activeBundle.objectIdHex}:layout:${Date.now()}`)),
      name: "New Layout",
      buttonOverrides: []
    };
    updateActiveBundle((bundle) => ({
      ...bundle,
      layouts: [...bundle.layouts, layout],
      activeLayoutIdHex: layout.objectIdHex
    }));
    setSelectedButton(layout.centerButton);
  }

  function deleteActiveLayout() {
    if (activeBundle.layouts.length <= 1) {
      setStatus("Keep at least one layout in the bundle");
      return;
    }
    updateActiveBundle((bundle) => {
      const layouts = bundle.layouts.filter((layout) => layout.objectIdHex !== activeLayout.objectIdHex);
      return {
        ...bundle,
        layouts,
        activeLayoutIdHex: layouts[0].objectIdHex
      };
    });
  }

  function setActiveLayoutId(layoutId: string) {
    const layout = activeBundle.layouts.find((candidate) => candidate.objectIdHex === layoutId);
    updateActiveBundle((bundle) => ({
      ...bundle,
      activeLayoutIdHex: layoutId
    }));
    if (layout) {
      setSelectedButton(layout.centerButton);
    }
  }

  function updateActiveScale(updater: (scale: LayoutBundleScale) => LayoutBundleScale) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      scales: bundle.scales.map((scale) => scale.objectIdHex === bundle.activeScaleIdHex ? updater(scale) : scale)
    }));
  }

  function addNewScale() {
    const scale = {
      ...createAllNotesScale(tuningCycleLength(activeBundle.tuning)),
      objectIdHex: objectIdToHex(deterministicObjectId(`${activeBundle.objectIdHex}:scale:${Date.now()}`)),
      name: "New Scale"
    };
    updateActiveBundle((bundle) => ({
      ...bundle,
      scales: [...bundle.scales, scale],
      activeScaleIdHex: scale.objectIdHex
    }));
  }

  function deleteActiveScale() {
    if (activeBundle.scales.length <= 1) {
      setStatus("Keep at least one scale in the bundle");
      return;
    }
    updateActiveBundle((bundle) => {
      const scales = bundle.scales.filter((scale) => scale.objectIdHex !== activeScale.objectIdHex);
      return {
        ...bundle,
        scales,
        activeScaleIdHex: scales[0].objectIdHex
      };
    });
  }

  function commitIncludedDegrees(text: string) {
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    const result = validateIncludedDegreesInput(text, cycleLength);
    if ("error" in result) {
      setIncludedDegreesError(result.error);
      setStatus(result.error);
      return;
    }
    setIncludedDegreesError("");
    setIncludedDegreesDraft(formatIntegerList(result.degrees));
    updateActiveScale((scale) => ({
      ...scale,
      includedDegrees: result.degrees
    }));
  }

  function commitKeyLabels(text: string) {
    if (activeBundle.tuning.kind === "scala") {
      return;
    }
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    const result = validateKeyLabelsInput(text, cycleLength);
    if ("error" in result) {
      setKeyLabelsError(result.error);
      setStatus(result.error);
      return;
    }
    setKeyLabelsError("");
    setKeyLabelsDraft(formatLabelList(result.labels));
    if (activeBundle.tuning.kind === "edo") {
      updateEdoTuning({ keyLabels: result.labels });
    } else {
      updateEqualStepTuning({ keyLabels: result.labels });
    }
  }

  function commitIncludedDegreesIfLeaving(target: EventTarget | null) {
    const labelsInput = keyLabelsInputRef.current;
    if (labelsInput && typeof document !== "undefined" && document.activeElement === labelsInput && target !== labelsInput) {
      commitKeyLabels(labelsInput.value);
    }

    const input = includedDegreesInputRef.current;
    if (!input || typeof document === "undefined" || document.activeElement !== input || target === input) {
      return;
    }
    commitIncludedDegrees(input.value);
  }

  function commitKeyLabelsOnKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Tab") {
      commitKeyLabels(event.currentTarget.value);
    }
  }

  function commitIncludedDegreesOnKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === "Tab") {
      commitIncludedDegrees(event.currentTarget.value);
    }
  }

  function updateEdoTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "edo" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "edo" ? bundle.tuning : {
        kind: "edo" as const,
        name: bundle.tuning.name,
        edoDivisions: tuningCycleLength(bundle.tuning),
        periodCents: tuningPeriodCents(bundle.tuning),
        cycleLength: tuningCycleLength(bundle.tuning),
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz,
        keyLabels: bundle.tuning.kind === "scala" ? defaultKeyLabels(tuningCycleLength(bundle.tuning)) : bundle.tuning.keyLabels
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.edoDivisions = clampInteger(tuning.edoDivisions, 1, 255);
      tuning.cycleLength = tuning.edoDivisions;
      tuning.keyLabels = normalizeKeyLabels(tuning.keyLabels, tuning.cycleLength);
      tuning.referenceHz = Number.isFinite(tuning.referenceHz) && tuning.referenceHz > 0 ? tuning.referenceHz : 440;
      return withCycleColors({ ...bundle, tuning }, tuning.cycleLength);
    });
  }

  function updateEqualStepTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "equal-step" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "equal-step" ? bundle.tuning : {
        kind: "equal-step" as const,
        name: bundle.tuning.name,
        stepCents: bundle.tuning.kind === "edo"
          ? bundle.tuning.periodCents / bundle.tuning.edoDivisions
          : tuningPeriodCents(bundle.tuning) / tuningCycleLength(bundle.tuning),
        cycleLength: tuningCycleLength(bundle.tuning),
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz,
        keyLabels: bundle.tuning.kind === "scala" ? defaultKeyLabels(tuningCycleLength(bundle.tuning)) : bundle.tuning.keyLabels
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.cycleLength = clampInteger(tuning.cycleLength, 1, 255);
      tuning.keyLabels = normalizeKeyLabels(tuning.keyLabels, tuning.cycleLength);
      tuning.referenceHz = Number.isFinite(tuning.referenceHz) && tuning.referenceHz > 0 ? tuning.referenceHz : 440;
      return withCycleColors({ ...bundle, tuning }, tuning.cycleLength);
    });
  }

  function updateScalaTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "scala" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "scala" ? bundle.tuning : {
        kind: "scala" as const,
        name: bundle.tuning.name,
        description: bundle.tuning.name,
        cents: [1200],
        periodCents: 1200,
        cycleLength: 1,
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.periodCents = tuning.cents[tuning.cents.length - 1] ?? 1200;
      tuning.cycleLength = clampInteger(tuning.cents.length, 1, 255);
      return withCycleColors({ ...bundle, tuning }, tuning.cycleLength);
    });
  }

  function setTuningKind(kind: LayoutBundleTuning["kind"]) {
    if (kind === "edo") {
      updateEdoTuning({});
    } else if (kind === "equal-step") {
      updateEqualStepTuning({});
    } else {
      updateScalaTuning({});
    }
  }

  function updateDegreeColor(degree: number, patch: Partial<ScaleDegreeColor>) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      palette: {
        ...bundle.palette,
        degreeColors: normalizeScaleDegreeColors(bundle.palette.degreeColors, tuningCycleLength(bundle.tuning)).map((color) =>
          color.degree === degree ? clampScaleDegreeColor({ ...color, ...patch }) : color
        )
      }
    }));
  }

  function updateButtonOverride(buttonIndex: number, patch: Partial<LayoutBundleButtonOverride>) {
    updateActiveLayout((layout) => ({
      ...layout,
      buttonOverrides: upsertOverride(layout.buttonOverrides, buttonIndex, patch)
    }));
  }

  function paintButtonColorOverride(buttonIndex: number) {
    if (lastPaintedButtonRef.current === buttonIndex) {
      return;
    }
    lastPaintedButtonRef.current = buttonIndex;
    updateButtonOverride(buttonIndex, {
      hueTenthDegrees: paintbrushColor.hueTenthDegrees,
      saturation: paintbrushColor.saturation,
      value: paintbrushColor.value
    });
    setStatus(`Painted button ${buttonIndex}`);
  }

  function previewButtonIndexFromPointer(event: PointerEvent<HTMLElement>): number | undefined {
    if (typeof document === "undefined") {
      return undefined;
    }
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const button = target?.closest("[data-preview-button-index]") as HTMLElement | null;
    const buttonIndex = Number(button?.dataset.previewButtonIndex);
    return Number.isInteger(buttonIndex) ? buttonIndex : undefined;
  }

  function beginPaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (!paintbrushMode) {
      return;
    }
    const buttonIndex = previewButtonIndexFromPointer(event);
    if (buttonIndex === undefined) {
      return;
    }
    event.preventDefault();
    paintStrokeActiveRef.current = true;
    lastPaintedButtonRef.current = null;
    paintButtonColorOverride(buttonIndex);
  }

  function continuePaintStroke(event: PointerEvent<HTMLDivElement>) {
    if (!paintbrushMode || !paintStrokeActiveRef.current) {
      return;
    }
    const buttonIndex = previewButtonIndexFromPointer(event);
    if (buttonIndex !== undefined) {
      paintButtonColorOverride(buttonIndex);
    }
  }

  function endPaintStroke() {
    paintStrokeActiveRef.current = false;
    lastPaintedButtonRef.current = null;
  }

  function resetButtonOverride(buttonIndex: number) {
    updateActiveLayout((layout) => ({
      ...layout,
      buttonOverrides: layout.buttonOverrides.filter((override) => override.buttonIndex !== buttonIndex)
    }));
  }

  function clearButtonColor(buttonIndex: number) {
    updateActiveLayout((layout) => {
      const override = layout.buttonOverrides.find((candidate) => candidate.buttonIndex === buttonIndex);
      if (!override) {
        return layout;
      }
      const withoutColor = removeOverrideColor(override);
      const shouldRemove = isRoleDefault(buttonIndex, withoutColor.role) && withoutColor.stepsFromC === undefined;
      return {
        ...layout,
        buttonOverrides: shouldRemove
          ? layout.buttonOverrides.filter((candidate) => candidate.buttonIndex !== buttonIndex)
          : layout.buttonOverrides.map((candidate) => candidate.buttonIndex === buttonIndex ? withoutColor : candidate)
      };
    });
  }

  function clearButtonNote(buttonIndex: number) {
    updateActiveLayout((layout) => {
      const override = layout.buttonOverrides.find((candidate) => candidate.buttonIndex === buttonIndex);
      if (!override) {
        return layout;
      }
      const { stepsFromC, ...withoutNote } = override;
      void stepsFromC;
      const shouldRemove = isRoleDefault(buttonIndex, withoutNote.role) && withoutNote.hueTenthDegrees === undefined;
      return {
        ...layout,
        buttonOverrides: shouldRemove
          ? layout.buttonOverrides.filter((candidate) => candidate.buttonIndex !== buttonIndex)
          : layout.buttonOverrides.map((candidate) => candidate.buttonIndex === buttonIndex ? withoutNote : candidate)
      };
    });
  }

  async function importBundleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const imported = parseLayoutBundleFile(JSON.parse(await file.text()));
      const nextBundles = [...bundles.filter((bundle) => bundle.objectIdHex !== imported.objectIdHex), imported];
      setBundlesAndPersist(nextBundles);
      setActiveBundleId(imported.objectIdHex);
      setSelectedButton(imported.layouts.find((layout) => layout.objectIdHex === imported.activeLayoutIdHex)?.centerButton ?? imported.layouts[0]?.centerButton ?? 65);
      setStatus(`Imported ${imported.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to import layout bundle");
    } finally {
      event.target.value = "";
    }
  }

  async function importScalaFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      const parsed = parseScalaScale(await file.text());
      updateActiveBundle((bundle) => withCycleColors({
        ...bundle,
        tuning: {
          kind: "scala",
          name: fileBaseName(file.name),
          description: parsed.description,
          cents: parsed.cents,
          periodCents: parsed.periodCents,
          cycleLength: parsed.count,
          referenceMidiNote: bundle.tuning.referenceMidiNote,
          referenceHz: bundle.tuning.referenceHz
        }
      }, parsed.count));
      setStatus(`Imported Scala tuning ${file.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to import Scala tuning");
    } finally {
      event.target.value = "";
    }
  }

  const previewKeys = useMemo<PreviewKey[]>(() => {
    const cycleLength = tuningCycleLength(activeBundle.tuning);
    const scaleDegrees = new Set(normalizeScaleDegrees(activeScale.includedDegrees, cycleLength));
    return hexBoardGeometry.map((key) => {
      const override = activeLayout.buttonOverrides.find((candidate) => candidate.buttonIndex === key.index);
      const role = override?.role ?? key.role;
      const generatedStepsFromC = Math.round(computeVectorLayoutSteps(key, activeLayout));
      const stepsFromC = override?.stepsFromC ?? generatedStepsFromC;
      const resolvedColor = resolveLayoutBundleButtonColor({
        degreeColors: activeBundle.palette.degreeColors,
        cycleLength,
        stepsFromC,
        override
      });
      return {
        key,
        role,
        generatedStepsFromC,
        stepsFromC,
        degree: resolvedColor.degree,
        inScale: role !== "note" || scaleDegrees.has(resolvedColor.degree),
        color: resolvedColor.color,
        colorSource: resolvedColor.colorSource,
        noteSource: override?.stepsFromC === undefined ? "generated" : "button",
        override
      };
    });
  }, [activeBundle, activeLayout, activeScale]);

  const selectedPreview = previewKeys.find((item) => item.key.index === selectedButton) ?? previewKeys[0];
  const selectedDegreeColor = normalizeScaleDegreeColors(activeBundle.palette.degreeColors, tuningCycleLength(activeBundle.tuning))
    .find((color) => color.degree === selectedPreview.degree) ?? createDefaultDegreeColors(1)[0];
  const axisLabels = layoutAxisLabels(activeLayout.rotationSteps);
  const centerGuideKey = hexBoardGeometry.find((key) => key.index === activeLayout.centerButton);
  const guideTargetIndex = (() => {
    if (!layoutGuideFocus || !centerGuideKey) {
      return undefined;
    }
    if (layoutGuideFocus === "center") {
      return centerGuideKey.index;
    }
    if (layoutGuideFocus === "across") {
      return hexBoardKeyAtCoord(centerGuideKey.coordRow, centerGuideKey.coordCol + 2)?.index;
    }
    return hexBoardKeyAtCoord(centerGuideKey.coordRow - 1, centerGuideKey.coordCol + 1)?.index;
  })();
  const guideOriginIndex = layoutGuideFocus === "across" || layoutGuideFocus === "upRight"
    ? centerGuideKey?.index
    : undefined;
  const guideHalos = useMemo<GuideHalo[]>(() => {
    const halos: GuideHalo[] = [];
    if (guideTargetIndex !== undefined) {
      const target = hexBoardGeometry.find((key) => key.index === guideTargetIndex);
      if (target) {
        halos.push({ key: target, tone: "green" });
      }
    }
    if (guideOriginIndex !== undefined) {
      const origin = hexBoardGeometry.find((key) => key.index === guideOriginIndex);
      if (origin) {
        halos.push({ key: origin, tone: "red" });
      }
    }
    return halos;
  }, [guideOriginIndex, guideTargetIndex]);
  function layoutGuideProps(field: LayoutGuideFocus) {
    return {
      onFocus: () => setLayoutGuideFocus(field),
      onBlur: () => setLayoutGuideFocus((current) => current === field ? null : current)
    };
  }
  function setSelectedColorSource(colorSource: PreviewKey["colorSource"]) {
    if (colorSource === "degree") {
      clearButtonColor(selectedPreview.key.index);
      return;
    }
    updateButtonOverride(selectedPreview.key.index, {
      hueTenthDegrees: selectedPreview.color.hueTenthDegrees,
      saturation: selectedPreview.color.saturation,
      value: selectedPreview.color.value
    });
  }
  function setSelectedNoteSource(noteSource: PreviewKey["noteSource"]) {
    if (noteSource === "generated") {
      clearButtonNote(selectedPreview.key.index);
      return;
    }
    updateButtonOverride(selectedPreview.key.index, {
      stepsFromC: selectedPreview.stepsFromC
    });
  }
  const encodedBundle = useMemo(() => {
    const stepsByButton = new Map(previewKeys.map((item) => [item.key.index, item.stepsFromC]));
    return encodeLayoutBundle({
      ...activeBundle,
      layouts: activeBundle.layouts.map((layout) => layout.objectIdHex === activeLayout.objectIdHex
        ? {
            ...layout,
            buttonOverrides: layout.buttonOverrides.map((override) => ({
              ...override,
              stepsFromC: override.stepsFromC ?? stepsByButton.get(override.buttonIndex)
            }))
          }
        : layout)
    });
  }, [activeBundle, activeLayout.objectIdHex, previewKeys]);
  const encodedPreview = encodedBundle.objects
    .map((object) => `${object.name}: ${formatByteLength(object.body)} CRC ${crc32(object.body).toString(16).toUpperCase()}`)
    .join("\n");

  return (
    <section className="layoutEditorWorkspace" onPointerDownCapture={(event) => commitIncludedDegreesIfLeaving(event.target)}>
      <aside className="panel stack layoutEditorSidebar">
        <div className="row between">
          <h2>Geometry Bundles</h2>
          <span className="countBadge">{bundles.length}</span>
        </div>
        <div className="row">
          <button type="button" onClick={addNewBundle}>New</button>
          <button type="button" onClick={() => downloadTextFile(`${activeBundle.name}.hexboard-layout.json`, serializeLayoutBundle(activeBundle))}>
            Export
          </button>
          <button type="button" onClick={() => bundleInputRef.current?.click()}>Import</button>
        </div>
        <input ref={bundleInputRef} className="hiddenFileInput" type="file" accept="application/json,.json" onChange={(event) => void importBundleFile(event)} />
        <input ref={scalaInputRef} className="hiddenFileInput" type="file" accept=".scl,text/plain" onChange={(event) => void importScalaFile(event)} />
        <ul className="list">
          {bundles.map((bundle) => (
            <li className={bundle.objectIdHex === activeBundle.objectIdHex ? "listItem activeListItem" : "listItem"} key={bundle.objectIdHex}>
              <button type="button" className="textButton" onClick={() => setActiveBundleId(bundle.objectIdHex)}>
                <strong>{bundle.name}</strong>
                <span>{bundle.tuning.name}</span>
              </button>
            </li>
          ))}
        </ul>

        <label className="field">
          <span>Bundle name</span>
          <input value={activeBundle.name} onChange={(event) => updateBundleName(event.target.value)} />
        </label>
        <button className="warning" type="button" onClick={deleteActiveBundle}>Delete Bundle</button>

        <div className="sidebarTabs" role="tablist" aria-label="Geometry bundle sections">
          <button
            aria-selected={activeEditorTab === "tuning"}
            className={activeEditorTab === "tuning" ? "active" : ""}
            onClick={() => setActiveEditorTab("tuning")}
            role="tab"
            type="button"
          >
            Tuning
          </button>
          <button
            aria-selected={activeEditorTab === "layouts"}
            className={activeEditorTab === "layouts" ? "active" : ""}
            onClick={() => setActiveEditorTab("layouts")}
            role="tab"
            type="button"
          >
            Layouts
          </button>
          <button
            aria-selected={activeEditorTab === "scales"}
            className={activeEditorTab === "scales" ? "active" : ""}
            onClick={() => setActiveEditorTab("scales")}
            role="tab"
            type="button"
          >
            Scales
          </button>
        </div>

        {activeEditorTab === "tuning" ? (
          <section className="editorSection">
            <h3>Tuning</h3>
            <label className="field">
              <span>Type</span>
              <select value={activeBundle.tuning.kind} onChange={(event) => setTuningKind(event.target.value as LayoutBundleTuning["kind"])}>
                <option value="edo">EDO</option>
                <option value="equal-step">Cents per step</option>
                <option value="scala">Scala .scl</option>
              </select>
            </label>
            <TuningControls
              tuning={activeBundle.tuning}
              onEdoChange={updateEdoTuning}
              onEqualStepChange={updateEqualStepTuning}
              onScalaChange={updateScalaTuning}
              onImportScala={() => scalaInputRef.current?.click()}
              keyLabelsDraft={keyLabelsDraft}
              keyLabelsError={keyLabelsError}
              keyLabelsInputRef={keyLabelsInputRef}
              onKeyLabelsBlur={commitKeyLabels}
              onKeyLabelsChange={(text) => {
                setKeyLabelsDraft(text);
                setKeyLabelsError("");
              }}
              onKeyLabelsKeyDown={commitKeyLabelsOnKey}
            />
          </section>
        ) : null}

        {activeEditorTab === "layouts" ? (
          <section className="editorSection">
            <h3>Layouts</h3>
            <div className="fieldGrid">
              <label className="field">
                <span>Active layout</span>
                <select value={activeLayout.objectIdHex} onChange={(event) => setActiveLayoutId(event.target.value)}>
                  {activeBundle.layouts.map((layout) => (
                    <option value={layout.objectIdHex} key={layout.objectIdHex}>{layout.name}</option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button type="button" onClick={addNewLayout}>New Layout</button>
                <button className="warning" type="button" onClick={deleteActiveLayout}>Delete Layout</button>
              </div>
              <label className="field">
                <span>Layout name</span>
                <input value={activeLayout.name} onChange={(event) => updateLayout({ name: event.target.value })} />
              </label>
              <label className="field">
                <span>Center key</span>
                <input
                  min={0}
                  max={139}
                  type="number"
                  value={activeLayout.centerButton}
                  onChange={(event) => updateLayout({ centerButton: clampInteger(Number(event.target.value), 0, 139) })}
                  {...layoutGuideProps("center")}
                />
              </label>
              <label className="field">
                <span>{axisLabels.across}</span>
                <input
                  type="number"
                  value={activeLayout.acrossSteps}
                  onChange={(event) => updateLayout({ acrossSteps: Number(event.target.value) })}
                  {...layoutGuideProps("across")}
                />
              </label>
              <label className="field">
                <span>{axisLabels.upRight}</span>
                <input
                  type="number"
                  value={activeLayout.upRightSteps}
                  onChange={(event) => updateLayout({ upRightSteps: Number(event.target.value) })}
                  {...layoutGuideProps("upRight")}
                />
              </label>
              <label className="field">
                <span>Rotation</span>
                <select value={activeLayout.rotationSteps} onChange={(event) => updateLayout({ rotationSteps: Number(event.target.value) })}>
                  <option value={0}>0°</option>
                  <option value={1}>90°</option>
                  <option value={2}>180°</option>
                  <option value={3}>270°</option>
                </select>
              </label>
            </div>
          </section>
        ) : null}

        {activeEditorTab === "scales" ? (
          <section className="editorSection">
            <h3>Scales</h3>
            <div className="fieldGrid">
              <label className="field">
                <span>Active scale</span>
                <select
                  value={activeScale.objectIdHex}
                  onChange={(event) => updateActiveBundle((bundle) => ({ ...bundle, activeScaleIdHex: event.target.value }))}
                >
                  {activeBundle.scales.map((scale) => (
                    <option value={scale.objectIdHex} key={scale.objectIdHex}>{scale.name}</option>
                  ))}
                </select>
              </label>
              <div className="row">
                <button type="button" onClick={addNewScale}>New Scale</button>
                <button className="warning" type="button" onClick={deleteActiveScale}>Delete Scale</button>
              </div>
              <label className="field">
                <span>Scale name</span>
                <input value={activeScale.name} onChange={(event) => updateActiveScale((scale) => ({ ...scale, name: event.target.value }))} />
              </label>
              <label className={includedDegreesError ? "field invalidField" : "field"}>
                <span>Included degrees</span>
                <input
                  aria-invalid={includedDegreesError ? "true" : "false"}
                  onBlurCapture={(event) => commitIncludedDegrees(event.target.value)}
                  onChange={(event) => {
                    setIncludedDegreesDraft(event.target.value);
                    setIncludedDegreesError("");
                  }}
                  onKeyDown={commitIncludedDegreesOnKey}
                  ref={includedDegreesInputRef}
                  value={includedDegreesDraft}
                />
                {includedDegreesError ? <small className="fieldError">{includedDegreesError}</small> : null}
              </label>
            </div>
          </section>
        ) : null}
      </aside>

      <div className="layoutEditorMainColumn">
        <main className="panel stack boardPanel">
          <div className="row between">
            <div>
              <h2>HexBoard Preview</h2>
              <span className="muted">{status}</span>
            </div>
            <button type="button" onClick={() => updateLayout({ centerButton: selectedButton })}>Use Selected As Center</button>
          </div>
          <div className="brushToolbar">
            <button
              aria-pressed={paintbrushMode}
              className={paintbrushMode ? "primary" : ""}
              type="button"
              onClick={() => {
                endPaintStroke();
                setPaintbrushMode((current) => !current);
              }}
            >
              Paintbrush
            </button>
            <label className="brushColorField">
              <span>Brush color</span>
              <input
                aria-label="Brush color"
                type="color"
                value={scaleDegreeColorToHex(paintbrushColor)}
                onChange={(event) => setPaintbrushColor((current) => hexToScaleDegreeColor(event.target.value, current))}
              />
            </label>
            <div className="brushSwatch" style={{ backgroundColor: colorToCss(paintbrushColor) }} />
            <button type="button" onClick={() => setPaintbrushColor(selectedPreview.color)}>
              Use Selected Color
            </button>
          </div>
          <div className="hexBoardScroll">
            <div
              className={paintbrushMode ? "hexBoardSurface paintbrushSurface" : "hexBoardSurface"}
              aria-label="HexBoard key layout preview"
              onPointerCancel={endPaintStroke}
              onPointerDown={beginPaintStroke}
              onPointerLeave={endPaintStroke}
              onPointerMove={continuePaintStroke}
              onPointerUp={endPaintStroke}
              style={{ transform: `rotate(${activeLayout.rotationSteps * 90}deg)` }}
            >
              {guideHalos.map((halo) => (
                <div
                  aria-hidden="true"
                  className={`hexGuideHalo ${halo.tone === "red" ? "redGuideHalo" : "greenGuideHalo"}`}
                  key={`${halo.tone}-${halo.key.index}`}
                  style={{
                    left: `${previewHexInset + (halo.key.coordCol * previewHexHalfStepX)}px`,
                    top: `${previewHexInset + (halo.key.row * previewHexRowStepY)}px`
                  }}
                />
              ))}
              {previewKeys.map((item) => (
                <button
                  aria-label={`Button ${item.key.index}, ${item.role}, step ${item.stepsFromC}`}
                  className={[
                    "hexKey",
                    item.role === "command" ? "commandKey" : "",
                    item.role === "unused" ? "unusedKey" : "",
                    !item.inScale ? "outOfScaleKey" : "",
                    item.colorSource === "button" ? "manualColorKey" : "",
                    item.noteSource === "button" ? "manualNoteKey" : "",
                    item.key.index === selectedButton ? "selectedKey" : "",
                    item.key.index === activeLayout.centerButton ? "centerKey" : "",
                    item.key.index === guideOriginIndex ? "guideOriginKey" : "",
                    item.key.index === guideTargetIndex ? "guideTargetKey" : ""
                  ].filter(Boolean).join(" ")}
                  data-preview-button-index={item.key.index}
                  key={item.key.index}
                  onClick={() => {
                    if (!paintbrushMode) {
                      setSelectedButton(item.key.index);
                    }
                  }}
                  style={{
                    left: `${previewHexInset + (item.key.coordCol * previewHexHalfStepX)}px`,
                    top: `${previewHexInset + (item.key.row * previewHexRowStepY)}px`,
                    backgroundColor: colorToCss(item.color)
                  }}
                  type="button"
                >
                  <span className="hexKeyLabel" style={{ transform: `rotate(${-activeLayout.rotationSteps * 90}deg)` }}>
                    <span>{item.key.index}</span>
                    <small>{item.role === "note" ? item.degree : item.role.slice(0, 3)}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </main>

        <aside className="panel stack selectedKeyPanel">
          <h2>Selected Key</h2>
          <div className="status">
            Button {selectedPreview.key.index} · row {selectedPreview.key.row} · col {selectedPreview.key.column}
          </div>
          <div className="fieldGrid">
            <label className="field">
              <span>Role</span>
              <select value={selectedPreview.role} onChange={(event) => updateButtonOverride(selectedPreview.key.index, { role: event.target.value as LayoutBundleButtonOverride["role"] })}>
                <option value="note">Note</option>
                <option value="command">Command</option>
                <option value="unused">Unused</option>
              </select>
            </label>
            <label className="field">
              <span>Generated step</span>
              <input readOnly value={selectedPreview.generatedStepsFromC} />
            </label>
            <label className="field">
              <span>Note source</span>
              <select value={selectedPreview.noteSource} onChange={(event) => setSelectedNoteSource(event.target.value as PreviewKey["noteSource"])}>
                <option value="generated">Generated layout</option>
                <option value="button">Button override</option>
              </select>
            </label>
            <label className="field">
              <span>Current step</span>
              <input
                readOnly={selectedPreview.noteSource === "generated"}
                type="number"
                value={selectedPreview.stepsFromC}
                onChange={(event) => updateButtonOverride(selectedPreview.key.index, { stepsFromC: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Scale degree</span>
              <input readOnly value={selectedPreview.degree} />
            </label>
            <label className="field">
              <span>Scale membership</span>
              <input readOnly value={selectedPreview.inScale ? "In scale" : "Out of scale"} />
            </label>
            <label className="field">
              <span>Color source</span>
              <select value={selectedPreview.colorSource} onChange={(event) => setSelectedColorSource(event.target.value as PreviewKey["colorSource"])}>
                <option value="degree">Scale degree</option>
                <option value="button">Button override</option>
              </select>
            </label>
          </div>

          {selectedPreview.colorSource === "degree" ? (
            <section className="editorSection">
              <h3>Scale Degree Color</h3>
              <ColorFields
                color={selectedDegreeColor}
                onChange={(patch) => updateDegreeColor(selectedPreview.degree, patch)}
              />
            </section>
          ) : (
            <section className="editorSection">
              <h3>Button Override</h3>
              <ColorFields
                color={selectedPreview.color}
                onChange={(patch) => updateButtonOverride(selectedPreview.key.index, patch)}
              />
              <div className="row">
                <button type="button" onClick={() => resetButtonOverride(selectedPreview.key.index)}>
                  Reset Key
                </button>
              </div>
            </section>
          )}
        </aside>
      </div>

      <section className="panel stack protocolDebugPanel">
        <h2>Object Debug</h2>
        <pre className="dataPreview">{encodedPreview}</pre>
      </section>
    </section>
  );
}

interface TuningControlsProps {
  tuning: LayoutBundleTuning;
  onEdoChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "edo" }>>) => void;
  onEqualStepChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "equal-step" }>>) => void;
  onScalaChange: (patch: Partial<Pick<Extract<LayoutBundleTuning, { kind: "scala" }>, "name" | "description">>) => void;
  onImportScala: () => void;
  keyLabelsDraft: string;
  keyLabelsError: string;
  keyLabelsInputRef: RefObject<HTMLInputElement | null>;
  onKeyLabelsBlur: (text: string) => void;
  onKeyLabelsChange: (text: string) => void;
  onKeyLabelsKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function TuningControls({
  tuning,
  onEdoChange,
  onEqualStepChange,
  onScalaChange,
  onImportScala,
  keyLabelsDraft,
  keyLabelsError,
  keyLabelsInputRef,
  onKeyLabelsBlur,
  onKeyLabelsChange,
  onKeyLabelsKeyDown
}: TuningControlsProps) {
  if (tuning.kind === "edo") {
    return (
      <div className="fieldGrid">
        <label className="field">
          <span>Name</span>
          <input value={tuning.name} onChange={(event) => onEdoChange({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Divisions</span>
          <input min={1} max={255} type="number" value={tuning.edoDivisions} onChange={(event) => onEdoChange({ edoDivisions: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Period cents</span>
          <input type="number" value={tuning.periodCents} onChange={(event) => onEdoChange({ periodCents: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>A = x Hz</span>
          <input min={0.01} step={0.01} type="number" value={tuning.referenceHz} onChange={(event) => onEdoChange({ referenceHz: Number(event.target.value) })} />
        </label>
        <label className={keyLabelsError ? "field invalidField" : "field"}>
          <span>Note labels</span>
          <input
            aria-invalid={keyLabelsError ? "true" : "false"}
            onBlurCapture={(event) => onKeyLabelsBlur(event.target.value)}
            onChange={(event) => onKeyLabelsChange(event.target.value)}
            onKeyDown={onKeyLabelsKeyDown}
            ref={keyLabelsInputRef}
            value={keyLabelsDraft}
          />
          {keyLabelsError ? <small className="fieldError">{keyLabelsError}</small> : null}
        </label>
      </div>
    );
  }

  if (tuning.kind === "equal-step") {
    return (
      <div className="fieldGrid">
        <label className="field">
          <span>Name</span>
          <input value={tuning.name} onChange={(event) => onEqualStepChange({ name: event.target.value })} />
        </label>
        <label className="field">
          <span>Step cents</span>
          <input type="number" value={tuning.stepCents} onChange={(event) => onEqualStepChange({ stepCents: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Cycle length</span>
          <input min={1} max={255} type="number" value={tuning.cycleLength} onChange={(event) => onEqualStepChange({ cycleLength: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>A = x Hz</span>
          <input min={0.01} step={0.01} type="number" value={tuning.referenceHz} onChange={(event) => onEqualStepChange({ referenceHz: Number(event.target.value) })} />
        </label>
        <label className={keyLabelsError ? "field invalidField" : "field"}>
          <span>Note labels</span>
          <input
            aria-invalid={keyLabelsError ? "true" : "false"}
            onBlurCapture={(event) => onKeyLabelsBlur(event.target.value)}
            onChange={(event) => onKeyLabelsChange(event.target.value)}
            onKeyDown={onKeyLabelsKeyDown}
            ref={keyLabelsInputRef}
            value={keyLabelsDraft}
          />
          {keyLabelsError ? <small className="fieldError">{keyLabelsError}</small> : null}
        </label>
      </div>
    );
  }

  return (
    <div className="stack compact">
      <div className="row">
        <button type="button" onClick={onImportScala}>Import .scl</button>
        <span className="muted">{tuning.cents.length} intervals</span>
      </div>
      <label className="field">
        <span>Name</span>
        <input value={tuning.name} onChange={(event) => onScalaChange({ name: event.target.value })} />
      </label>
      <label className="field">
        <span>Description</span>
        <input value={tuning.description} onChange={(event) => onScalaChange({ description: event.target.value })} />
      </label>
    </div>
  );
}

interface ColorFieldsProps {
  color: ScaleDegreeColor;
  onChange: (patch: Partial<ScaleDegreeColor>) => void;
}

function ColorFields({ color, onChange }: ColorFieldsProps) {
  return (
    <div className="colorEditor">
      <div className="largeSwatch" style={{ backgroundColor: colorToCss(color) }} />
      <label className="field rangeField">
        <span>Hue {Math.round(color.hueTenthDegrees / 10)}°</span>
        <input min={0} max={3599} type="range" value={color.hueTenthDegrees} onChange={(event) => onChange({ hueTenthDegrees: Number(event.target.value) })} />
      </label>
      <label className="field rangeField">
        <span>Saturation {color.saturation}</span>
        <input min={0} max={255} type="range" value={color.saturation} onChange={(event) => onChange({ saturation: Number(event.target.value) })} />
      </label>
      <label className="field rangeField">
        <span>Value {color.value}</span>
        <input min={0} max={255} type="range" value={color.value} onChange={(event) => onChange({ value: Number(event.target.value) })} />
      </label>
    </div>
  );
}

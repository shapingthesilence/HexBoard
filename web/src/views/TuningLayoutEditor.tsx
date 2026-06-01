import { useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  clampScaleDegreeColor,
  computeVectorLayoutSteps,
  createDefaultDegreeColors,
  createDefaultLayoutBundle,
  deterministicObjectId,
  encodeLayoutBundle,
  hexBoardGeometry,
  isHexBoardCommandIndex,
  normalizeScaleDegreeColors,
  objectIdToHex,
  parseLayoutBundleFile,
  parseLayoutBundleLibrary,
  parseScalaScale,
  resolveLayoutBundleButtonColor,
  serializeLayoutBundle,
  type HexBoardKey,
  type LayoutBundle,
  type LayoutBundleButtonOverride,
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

const layoutAxisDirectionLabels = [
  { across: "Right", upRight: "Up-right" },
  { across: "Down", upRight: "Down-right" },
  { across: "Left", upRight: "Down-left" },
  { across: "Up", upRight: "Up-left" }
] as const;

interface PreviewKey {
  key: HexBoardKey;
  role: "note" | "command" | "unused";
  stepsFromC: number;
  degree: number;
  color: ScaleDegreeColor;
  colorSource: "button" | "degree";
  override?: LayoutBundleButtonOverride;
}

interface GuideHalo {
  key: HexBoardKey;
  tone: "green" | "red";
}

function createUntitledBundle(): LayoutBundle {
  const base = createDefaultLayoutBundle();
  const objectIdHex = objectIdToHex(deterministicObjectId(`layout-bundle:${Date.now()}`));
  return {
    ...base,
    objectIdHex,
    name: "Untitled Geometry",
    tuning: {
      ...base.tuning,
      name: "19 EDO"
    }
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

function layoutAxisLabels(rotationSteps: number): typeof layoutAxisDirectionLabels[number] {
  const index = ((Math.round(rotationSteps) % 4) + 4) % 4;
  return layoutAxisDirectionLabels[index];
}

function withCycleColors(bundle: LayoutBundle, cycleLength: number): LayoutBundle {
  return {
    ...bundle,
    layout: {
      ...bundle.layout,
      rotationSteps: clampInteger(bundle.layout.rotationSteps ?? 0, 0, 3)
    },
    degreeColors: normalizeScaleDegreeColors(bundle.degreeColors, cycleLength)
  };
}

function colorToCss(color: ScaleDegreeColor): string {
  const hue = color.hueTenthDegrees / 10;
  const saturation = Math.round((color.saturation / 255) * 100);
  const lightness = Math.round(18 + ((color.value / 255) * 46));
  return `hsl(${hue}deg ${saturation}% ${lightness}%)`;
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

export function TuningLayoutEditor() {
  const [bundles, setBundles] = useState<LayoutBundle[]>(() => loadStoredBundles());
  const [activeBundleId, setActiveBundleId] = useState("");
  const [selectedButton, setSelectedButton] = useState(65);
  const [layoutGuideFocus, setLayoutGuideFocus] = useState<LayoutGuideFocus | null>(null);
  const [status, setStatus] = useState("Ready");
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const scalaInputRef = useRef<HTMLInputElement>(null);

  const activeBundle = bundles.find((bundle) => bundle.objectIdHex === activeBundleId) ?? bundles[0] ?? createDefaultLayoutBundle();

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
    setSelectedButton(next.layout.centerButton);
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
    setSelectedButton(nextBundles[0]?.layout.centerButton ?? 65);
    setStatus(`Deleted ${activeBundle.name}`);
  }

  function updateBundleName(name: string) {
    updateActiveBundle((bundle) => ({ ...bundle, name }));
  }

  function updateLayout(patch: Partial<LayoutBundle["layout"]>) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      layout: {
        ...bundle.layout,
        ...patch
      }
    }));
  }

  function updateEdoTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "edo" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "edo" ? bundle.tuning : {
        kind: "edo" as const,
        name: bundle.tuning.name,
        edoDivisions: tuningCycleLength(bundle.tuning),
        periodCents: bundle.tuning.periodCents,
        cycleLength: tuningCycleLength(bundle.tuning),
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.edoDivisions = clampInteger(tuning.edoDivisions, 1, 255);
      tuning.cycleLength = tuning.edoDivisions;
      return withCycleColors({ ...bundle, tuning }, tuning.cycleLength);
    });
  }

  function updateEqualStepTuning(patch: Partial<Extract<LayoutBundleTuning, { kind: "equal-step" }>>) {
    updateActiveBundle((bundle) => {
      const current = bundle.tuning.kind === "equal-step" ? bundle.tuning : {
        kind: "equal-step" as const,
        name: bundle.tuning.name,
        stepCents: bundle.tuning.kind === "edo" ? bundle.tuning.periodCents / bundle.tuning.edoDivisions : 100,
        periodCents: bundle.tuning.periodCents,
        cycleLength: tuningCycleLength(bundle.tuning),
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.cycleLength = clampInteger(tuning.cycleLength, 1, 255);
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
        periodCents: bundle.tuning.periodCents,
        cycleLength: tuningCycleLength(bundle.tuning),
        referenceMidiNote: bundle.tuning.referenceMidiNote,
        referenceHz: bundle.tuning.referenceHz
      };
      const tuning = {
        ...current,
        ...patch
      };
      tuning.cycleLength = clampInteger(tuning.cycleLength, 1, 255);
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
      degreeColors: normalizeScaleDegreeColors(bundle.degreeColors, tuningCycleLength(bundle.tuning)).map((color) =>
        color.degree === degree ? clampScaleDegreeColor({ ...color, ...patch }) : color
      )
    }));
  }

  function updateButtonOverride(buttonIndex: number, patch: Partial<LayoutBundleButtonOverride>) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      buttonOverrides: upsertOverride(bundle.buttonOverrides, buttonIndex, patch)
    }));
  }

  function resetButtonOverride(buttonIndex: number) {
    updateActiveBundle((bundle) => ({
      ...bundle,
      buttonOverrides: bundle.buttonOverrides.filter((override) => override.buttonIndex !== buttonIndex)
    }));
  }

  function clearButtonColor(buttonIndex: number) {
    updateActiveBundle((bundle) => {
      const override = bundle.buttonOverrides.find((candidate) => candidate.buttonIndex === buttonIndex);
      if (!override) {
        return bundle;
      }
      const withoutColor = removeOverrideColor(override);
      const shouldRemove = isRoleDefault(buttonIndex, withoutColor.role);
      return {
        ...bundle,
        buttonOverrides: shouldRemove
          ? bundle.buttonOverrides.filter((candidate) => candidate.buttonIndex !== buttonIndex)
          : bundle.buttonOverrides.map((candidate) => candidate.buttonIndex === buttonIndex ? withoutColor : candidate)
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
      setSelectedButton(imported.layout.centerButton);
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
    return hexBoardGeometry.map((key) => {
      const override = activeBundle.buttonOverrides.find((candidate) => candidate.buttonIndex === key.index);
      const role = override?.role ?? key.role;
      const stepsFromC = Math.round(computeVectorLayoutSteps(key, activeBundle.layout));
      const resolvedColor = resolveLayoutBundleButtonColor({
        degreeColors: activeBundle.degreeColors,
        cycleLength,
        stepsFromC,
        override
      });
      return {
        key,
        role,
        stepsFromC,
        degree: resolvedColor.degree,
        color: resolvedColor.color,
        colorSource: resolvedColor.colorSource,
        override
      };
    });
  }, [activeBundle]);

  const selectedPreview = previewKeys.find((item) => item.key.index === selectedButton) ?? previewKeys[0];
  const selectedDegreeColor = normalizeScaleDegreeColors(activeBundle.degreeColors, tuningCycleLength(activeBundle.tuning))
    .find((color) => color.degree === selectedPreview.degree) ?? createDefaultDegreeColors(1)[0];
  const axisLabels = layoutAxisLabels(activeBundle.layout.rotationSteps);
  const centerGuideKey = hexBoardGeometry.find((key) => key.index === activeBundle.layout.centerButton);
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
  const encodedBundle = useMemo(() => {
    const stepsByButton = new Map(previewKeys.map((item) => [item.key.index, item.stepsFromC]));
    return encodeLayoutBundle({
      ...activeBundle,
      buttonOverrides: activeBundle.buttonOverrides.map((override) => ({
        ...override,
        stepsFromC: stepsByButton.get(override.buttonIndex) ?? override.stepsFromC
      }))
    });
  }, [activeBundle, previewKeys]);
  const encodedPreview = encodedBundle.objects
    .map((object) => `${object.name}: ${formatByteLength(object.body)} CRC ${crc32(object.body).toString(16).toUpperCase()}`)
    .join("\n");

  return (
    <section className="layoutEditorWorkspace">
      <aside className="panel stack">
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
          />
        </section>

        <section className="editorSection">
          <h3>Layout</h3>
          <div className="fieldGrid">
            <label className="field">
              <span>Center key</span>
              <input
                min={0}
                max={139}
                type="number"
                value={activeBundle.layout.centerButton}
                onChange={(event) => updateLayout({ centerButton: clampInteger(Number(event.target.value), 0, 139) })}
                {...layoutGuideProps("center")}
              />
            </label>
            <label className="field">
              <span>{axisLabels.across}</span>
              <input
                type="number"
                value={activeBundle.layout.acrossSteps}
                onChange={(event) => updateLayout({ acrossSteps: Number(event.target.value) })}
                {...layoutGuideProps("across")}
              />
            </label>
            <label className="field">
              <span>{axisLabels.upRight}</span>
              <input
                type="number"
                value={activeBundle.layout.upRightSteps}
                onChange={(event) => updateLayout({ upRightSteps: Number(event.target.value) })}
                {...layoutGuideProps("upRight")}
              />
            </label>
            <label className="field">
              <span>Rotation</span>
              <select value={activeBundle.layout.rotationSteps} onChange={(event) => updateLayout({ rotationSteps: Number(event.target.value) })}>
                <option value={0}>0°</option>
                <option value={1}>90°</option>
                <option value={2}>180°</option>
                <option value={3}>270°</option>
              </select>
            </label>
          </div>
        </section>
      </aside>

      <main className="panel stack boardPanel">
        <div className="row between">
          <div>
            <h2>HexBoard Preview</h2>
            <span className="muted">{status}</span>
          </div>
          <button type="button" onClick={() => updateLayout({ centerButton: selectedButton })}>Use Selected As Center</button>
        </div>
        <div className="hexBoardScroll">
          <div
            className="hexBoardSurface"
            aria-label="HexBoard key layout preview"
            style={{ transform: `rotate(${activeBundle.layout.rotationSteps * 90}deg)` }}
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
                  item.colorSource === "button" ? "manualColorKey" : "",
                  item.key.index === selectedButton ? "selectedKey" : "",
                  item.key.index === activeBundle.layout.centerButton ? "centerKey" : "",
                  item.key.index === guideOriginIndex ? "guideOriginKey" : "",
                  item.key.index === guideTargetIndex ? "guideTargetKey" : ""
                ].filter(Boolean).join(" ")}
                key={item.key.index}
                onClick={() => setSelectedButton(item.key.index)}
                style={{
                  left: `${previewHexInset + (item.key.coordCol * previewHexHalfStepX)}px`,
                  top: `${previewHexInset + (item.key.row * previewHexRowStepY)}px`,
                  backgroundColor: colorToCss(item.color)
                }}
                type="button"
              >
                <span className="hexKeyLabel" style={{ transform: `rotate(${-activeBundle.layout.rotationSteps * 90}deg)` }}>
                  <span>{item.key.index}</span>
                  <small>{item.role === "note" ? item.degree : item.role.slice(0, 3)}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
        <pre className="dataPreview">{encodedPreview}</pre>
      </main>

      <aside className="panel stack">
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
            <input readOnly value={selectedPreview.stepsFromC} />
          </label>
          <label className="field">
            <span>Scale degree</span>
            <input readOnly value={selectedPreview.degree} />
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
    </section>
  );
}

interface TuningControlsProps {
  tuning: LayoutBundleTuning;
  onEdoChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "edo" }>>) => void;
  onEqualStepChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "equal-step" }>>) => void;
  onScalaChange: (patch: Partial<Extract<LayoutBundleTuning, { kind: "scala" }>>) => void;
  onImportScala: () => void;
}

function TuningControls({ tuning, onEdoChange, onEqualStepChange, onScalaChange, onImportScala }: TuningControlsProps) {
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
          <span>Period cents</span>
          <input type="number" value={tuning.periodCents} onChange={(event) => onEqualStepChange({ periodCents: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Cycle length</span>
          <input min={1} max={255} type="number" value={tuning.cycleLength} onChange={(event) => onEqualStepChange({ cycleLength: Number(event.target.value) })} />
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
      <div className="fieldGrid">
        <label className="field">
          <span>Period cents</span>
          <input type="number" value={tuning.periodCents} onChange={(event) => onScalaChange({ periodCents: Number(event.target.value) })} />
        </label>
        <label className="field">
          <span>Cycle length</span>
          <input min={1} max={255} type="number" value={tuning.cycleLength} onChange={(event) => onScalaChange({ cycleLength: Number(event.target.value) })} />
        </label>
      </div>
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

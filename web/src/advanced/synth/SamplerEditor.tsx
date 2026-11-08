import {MotionEditor} from "./sampler/MotionEditor.tsx";
import {useAutosave} from '../../editor/useAutosave.ts';
import {motionSettings} from "./sampler/motion.mjs";
import {InstrumentSetup,InstrumentResources,type SustainDesign} from './sampler/InstrumentSetup.tsx';
import { SamplerWorkspace } from "./sampler/SamplerWorkspace.tsx";
import { SamplerAudition } from "./sampler/SamplerAudition.tsx";
import { WorkspaceDialog } from "./sampler/WorkspaceDialog.tsx";
import { TuningAudition } from "./sampler/TuningAudition.ts";
import { hzForMidi } from "./sampler/analysis.ts";
import type { LoopCandidate } from "./sampler/analysis.ts";
import { useTuningTargets } from "../../editor/tuningTargets.ts";
import { readCompactPatch, compactLimits } from "./sampler/compact.mjs";
import { ClassicSamplerClient, newSamplerSound } from "./sampler/classicClient.ts";
import { decodeHexSound, encodeHexSound, hexSoundTitle, HEXSOUND_EXTENSION } from "../../catalogs/hexSound.ts";
import { HEXBOARD_PRESET_NAME_MAX_BYTES } from "../../catalogs/hexboardPresetCapacity.ts";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { BasicSoundBank } from "spessasynth_core";
import type { MidiTransport } from "../../midi/types.ts";
import {
  PhysicalSynthClient,
  type SamplerInstrument,
} from "./client.ts";
import {SamplerLoadingStatus} from "./sampler/SamplerLoadingStatus.tsx";
import { samplerDrafts, draftWorthSaving } from "./sampler/draftStorage.ts";
import type {
  Patch,
  Recording,
  Prepared,
  Settings,
  Zone,
} from "./sampler/prepare.mjs";
import { crc32 } from "./sampler/prepare.mjs";
import { defaults, defaultPerformance } from "./sampler/encode.mjs";
import {
  openSoundFont,
  convertSoundFont,
  importSFZ,
  normalizePath,
  noteName,
  type PresetChoice,
  type ImportedPatch,
} from "./sampler/import.mjs";
import { readBank } from "./sampler/bank.mjs";
import { PatchPreview } from "./sampler/preview.ts";
import { RegionEnvelope, changeRegionEnvelope } from "./sampler/RegionEnvelope.tsx";
import { SourceAudition } from "./sampler/sourceAudition.ts";
import { ArpeggiatorEditor } from "./ArpeggiatorEditor.tsx";
import { Knob } from "./SynthControls.tsx";
import { SamplerKeyPreview } from "./SamplerKeyPreview.tsx";
import { SliceStrip } from "./sampler/SliceStrip.tsx";
import {
  assignSequentially,
  mappedZones,
  sliceAt,
  findHits,
  equalSlicePoints,
  assignToFreeKeys,
  type KeyMap,
} from "./sampler/mapping.ts";
import "./PhysicalSynthEditor.css";
import "./SynthIdentity.css";
import "./SamplerEditor.css";
function LoopReviewDialog({children, onClose}: {children: ReactNode; onClose: () => void}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="sampler-review-dialog" aria-labelledby="samplerLoopReviewTitle" onCancel={event => { event.preventDefault(); onClose(); }}>{children}</dialog>;
}
const empty = (): Patch => ({
  name: "New instrument",
  assets: [],
  zones: [],
  settings: { ...defaults },
  velocityEngine: 0,
  performance: defaultPerformance(),
});
function automatic(assets: Recording[]): Zone[] {
  const sorted = assets
    .map((a, asset) => ({ asset, root: a.rootMidi }))
    .sort((a, b) => a.root - b.root);
  return sorted.map((a, i) => ({
    asset: a.asset,
    lowMidi: i ? (sorted[i - 1].root + a.root) / 2 : -0.5,
    highMidi: i + 1 < sorted.length ? (a.root + sorted[i + 1].root) / 2 : 127.5,
  }));
}
function followsRootMap(assets:Recording[], zones:Zone[]) {
  const expected=automatic(assets);
  return zones.length===expected.length && zones.every((z,i)=>z.asset===expected[i].asset&&z.lowMidi===expected[i].lowMidi&&z.highMidi===expected[i].highMidi&&Object.keys(z).every(k=>["asset","lowMidi","highMidi"].includes(k)));
}
export function appendSamplerRecordings(patch:Patch,recordings:Recording[]):Patch {
  const assets=[...patch.assets,...recordings];
  return {...patch,assets,zones:followsRootMap(patch.assets,patch.zones??[])?automatic(assets):(patch.zones??[])};
}
/** Remove one recording, keeping the remaining map (or rebuilding an automatic one). */
export function removeSamplerRecording(patch:Patch,index:number):Patch {
  const assets=patch.assets.filter((_,i)=>i!==index),zones=patch.zones??[];
  return {...patch,assets,zones:followsRootMap(patch.assets,zones)?automatic(assets):zones.filter(z=>z.asset!==index).map(z=>z.asset>index?{...z,asset:z.asset-1}:z)};
}
export function samplerFilename(name: string) {
  const base = name
    .trim()
    .replace(/[^\x20-\x7e]|[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 60)
    .replace(/[. ]+$/, "");
  return `${base || "Instrument"}.hbs`;
}
const bytes = (n: number) =>
  n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MiB`
    : `${Math.round(n / 1024)} KiB`;
/** A Classic sampler sound whose instrument the editor replaces: its settings
 *  stay, and sending or saving keeps its name, folder and object id. */
export interface SamplerSoundTarget { name: string; folderPath: string; presetBody: Uint8Array; instrument: Uint8Array }

export function SamplerEditor({ transport, target = "advanced", sound }: { transport?: MidiTransport; target?: "advanced" | "classic"; sound?: SamplerSoundTarget }) {
  const classic = target === "classic";
  const compactClient = useMemo(() => classic && transport ? new ClassicSamplerClient(transport) : undefined, [classic, transport]);
  // Classic: an instrument lives inside its sound. Sending makes or updates one sound.
  const [soundTarget, setSoundTarget] = useState<SamplerSoundTarget | undefined>(sound);
  const [presetName, setPresetName] = useState("");
  const [presetFolder, setPresetFolder] = useState("Instruments");
  const [presetStatus, setPresetStatus] = useState("");
  const [preparationMessage, setPreparationMessage] = useState("");
  const [preparationError, setPreparationError] = useState("");
  const [preparationRevision, setPreparationRevision] = useState(0);
  const fittedAudio = useRef<{ source: Patch; converted: Patch } | undefined>(undefined);
  const [auditionVersion, setAuditionVersion] = useState<"source" | "converted">("converted");
  const filename = (name: string) => samplerFilename(name).replace(/\.hbs$/, classic ? ".hbc" : ".hbs");
  const [patch, setPatch] = useState<Patch>(empty),
    [template, setTemplate] = useState("instrument"),
    [selected, setSelected] = useState(0),
    [zoneIndex, setZoneIndex] = useState(0),
    [selectedKey, setSelectedKey] = useState(0),
    [slices, setSlices] = useState(16),
    [history, setHistory] = useState<Patch[]>([]),
    [redo, setRedo] = useState<Patch[]>([]),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [prepared, setPrepared] = useState<Prepared>(),
    [report, setReport] = useState<string[]>([]),
    [velocity, setVelocity] = useState(100),
    [lift, setLift] = useState(64),
    [pressure, setPressure] = useState(1),
    [bend, setBend] = useState(0),
    [octave, setOctave] = useState(4),
    [arpOpen, setArpOpen] = useState(false),
    [library, setLibrary] = useState<ImportedPatch[]>([]),
    [search, setSearch] = useState("");
  const [workspaceView,setWorkspaceView]=useState("sample");
  const [setupOpen,setSetupOpen]=useState(false);
  const [soundPage,setSoundPage]=useState("voice");
  const [sliceMode,setSliceMode]=useState<"hits"|"equal">("hits");
  const [sliceSensitivity,setSliceSensitivity]=useState(.5);
  const [draftNotice,setDraftNotice]=useState("");
  const [draftError,setDraftError]=useState("");
  const [draftReady,setDraftReady]=useState(false);
  const savedDraft=useRef<{patch:Patch;template:string;id:string}|undefined>(undefined);
  const draftId=classic?"classic":"advanced";
  const [sustainDesign,setSustainDesign]=useState<SustainDesign>("natural");
  const [loopCycles,setLoopCycles]=useState(4);
  const [exportOpen,setExportOpen]=useState(false);
  const [loopAuditionError, setLoopAuditionError] = useState("");
  const [loopSelection, setLoopSelection] = useState<boolean[]>([]);
  const loopAudition = useRef<TuningAudition | undefined>(undefined);
  const [loopSuggestions, setLoopSuggestions] = useState<(LoopCandidate | null)[] | undefined>();
  const [bank, setBank] = useState<{
      source?: BasicSoundBank;
      presets: PresetChoice[];
      selected: number[];
      sfz?: Map<string, File>;
      paths?: string[];
    }>(),
    [chooserSearch, setChooserSearch] = useState(""),
    [auditionChoice, setAuditionChoice] = useState(0),
    [adaptation, setAdaptation] = useState<"faithful" | "compact">(classic ? "compact" : "faithful"),
    [sourceNote, setSourceNote] = useState(60),
    [exportFolder, setExportFolder] = useState("My instruments"),
    [deviceSpace, setDeviceSpace] = useState(0),
    [deviceSettings, setDeviceSettings] = useState(false),
    [loadedSource, setLoadedSource] = useState(-1);
  const [folders, setFolders] = useState<SamplerInstrument[]>([]),
    [instruments, setInstruments] = useState<SamplerInstrument[]>([]),
    [folder, setFolder] = useState(0),
    [sdSource, setSdSource] = useState(0),
    [playing, setPlaying] = useState(false);
  const tuningTargets = useTuningTargets();
  const [tuningStop, setTuningStop] = useState(0);
  const gesture = useRef(false);
  const effectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
      undefined,
    ),
    lastSpace = useRef(0.18),
    lastDeviceSpace = useRef(0.18);
  const patchRef = useRef(patch);
  patchRef.current = patch;
  const client = useRef<PhysicalSynthClient | undefined>(undefined),
    preview = useRef<PatchPreview | undefined>(undefined),
    source = useRef<SourceAudition | undefined>(undefined),
    worker = useRef<Worker | undefined>(undefined);
  preview.current ??= new PatchPreview();
  source.current ??= new SourceAudition();
  useEffect(() => {
    if (!classic || !patch.assets.length) { setPreparationMessage(""); setPreparationError(""); return; }
    if (!patch.zones?.length || patch.zones.length > compactLimits.zones || new Set(patch.zones.map(z => z.asset)).size > compactLimits.assets) {
      setPreparationMessage(""); setPreparationError("Classic supports up to 16 recordings and 32 regions. Use fewer recordings or a smaller preset."); return;
    }
    let alive = true, preparationWorker: Worker | undefined;
    setPreparationMessage("Updating instrument…"); setPreparationError("");
    const timer = setTimeout(() => {
      preparationWorker = new Worker(new URL("./sampler/prepare.worker.ts", import.meta.url), { type: "module" });
      preparationWorker.onmessage = event => {
        if (!alive || patchRef.current !== patch) return;
        if (event.data.progress) { setPreparationMessage(event.data.progress.label); return; }
        preparationWorker?.terminate(); setPreparationMessage("");
        if (event.data.error) { setPreparationError(event.data.error); return; }
        const result = event.data.result as Prepared;
        if (result.auditionPatch) fittedAudio.current = { source: patch, converted: result.auditionPatch };
        setPrepared(result);
        setReport([...new Set([...((patch as ImportedPatch).report ?? []), ...result.warnings])]);
      };
      preparationWorker.onerror = event => {
        if (!alive || patchRef.current !== patch) return;
        preparationWorker?.terminate(); setPreparationMessage(""); setPreparationError(event.message);
      };
      preparationWorker.postMessage({ operation: "prepare", patch, target: "classic" });
    }, 250);
    return () => { alive = false; clearTimeout(timer); preparationWorker?.terminate(); };
  }, [classic, patch, preparationRevision]);

  useEffect(() => {
    let alive = true;
    setDraftReady(false);
    if (typeof indexedDB === "undefined") { setDraftReady(true); return; }
    samplerDrafts.load(draftId).then(draft => {
      if (!alive || !draft || !draftWorthSaving(draft.patch) || patchRef.current.assets.length) return;
      savedDraft.current={patch:draft.patch,template:draft.template,id:draftId};
      setPatch(draft.patch); setTemplate(draft.template); setSelected(0); setZoneIndex(0);
      setDraftNotice(`Restored your unsaved instrument from ${new Date(draft.savedAt).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}.`);
    }).catch(e => { if (alive) setDraftError(`Couldn’t restore the autosaved instrument: ${e instanceof Error ? e.message : e}`); })
      .finally(() => { if(alive)setDraftReady(true); });
    return () => { alive = false; };
  }, [draftId]);
  useAutosave(async () => {
    if (!draftReady || typeof indexedDB === "undefined" || patchRef.current!==patch) return;
    const old=savedDraft.current;
    if(old?.id===draftId&&old.patch===patch&&old.template===template)return;
    await (draftWorthSaving(patch) ? samplerDrafts.save(draftId, patch, template) : samplerDrafts.remove(draftId));
    savedDraft.current={patch,template,id:draftId};setDraftError("");
  }, [patch, template, draftId, draftReady], e => setDraftError(e instanceof DOMException && e.name === "QuotaExceededError" ? "This instrument is too large to autosave in the browser. Export it to keep it." : `Autosave failed: ${e instanceof Error ? e.message : e}`), 800);
  useEffect(() => {
    client.current = transport && !classic ? new PhysicalSynthClient(transport) : undefined;
    return () => client.current?.close();
  }, [transport, classic]);
  useEffect(
    () => () => {
      loopAudition.current?.close();
      preview.current?.close();
      source.current?.close();
      worker.current?.terminate();
      if (effectTimer.current) clearTimeout(effectTimer.current);
    },
    [],
  );

  const edit = (next: Patch, remember = true) => {
    if (remember) {
      setHistory((h) => [...h.slice(-39), patchRef.current]);
      setRedo([]);
    }
    loopAudition.current?.stop();
    setLoopSuggestions(undefined);
    setDraftNotice("");
    setPatch({ ...next, preparedSource: undefined });
    setPrepared(undefined);
  };
  const undo = () => {
    if (!history.length) return;
    preview.current!.clear();
    setRedo((r) => [...r, patch]);
    const restored=history.at(-1)!;setPatch(restored);setTemplate(restored.zones?.some(z=>z.key!==undefined&&z.key!==65535)?(template==="slices"?"slices":"kit"):"instrument");
    setHistory((h) => h.slice(0, -1));
    setPrepared(undefined);
  };
  // Opening a sound's instrument from Sounds.
  useEffect(() => {
    if (!classic || !sound) return;
    setSoundTarget(sound);
    restore({ ...readCompactPatch(sound.instrument), report: [`Opened the instrument of “${sound.name}”.`] });
  }, [sound]);
  const restore = (p: ImportedPatch) => {
    preview.current!.clear();
    edit(p);
    setReport(p.report ?? []);
    setSelected(0);
    setZoneIndex(0);
    setTemplate(
      !classic && p.zones?.some((z) => z.key !== undefined && z.key !== 65535)
        ? "kit"
        : "instrument",
    );
  };
  const newInstrument = () => {
    preview.current!.clear();
    edit(empty());
    setTemplate("instrument"); setSelected(0); setZoneIndex(0); setSelectedKey(0);
    setReport([]); setWorkspaceView("sample"); setError("");
  };
  const removeRecording = (index: number) => {
    preview.current!.clear();
    const next = removeSamplerRecording(patch, index), at = Math.max(0, Math.min(index, next.assets.length - 1));
    edit(next); setSelected(at); setZoneIndex((next.zones ?? []).findIndex(z => z.asset === at));
  };
  const pitchMatters = template === "instrument";
  const zones = patch.zones ?? [],
    sample = patch.assets[selected],
    zone = template!=="instrument"
      ? zones.find(z=>z.key===selectedKey&&z.asset===selected)
      : zones[zoneIndex]?.asset === selected
        ? zones[zoneIndex]
        : zones.find((z) => z.asset === selected),
    map = useMemo<KeyMap>(
      () =>
        Object.fromEntries(
          zones
            .filter((z) => z.key !== undefined && z.key !== 65535)
            .map((z) => [
              z.key!,
              { asset: z.asset, color: z.color ?? "#658eda" },
            ]),
        ),
      [zones],
    );
  const changeSample = (change: Partial<Recording>, remember = true) => {
    if (!sample) return;
    const assets = patch.assets.map((a, i) => i === selected ? { ...a, ...change, ...(change.rootMidi !== undefined ? {pitchSource: "manual" as const} : {}) } : a);
    const followsRoots = template === "instrument" && followsRootMap(patch.assets,zones);
    const nextZones = change.rootMidi !== undefined && followsRoots ? automatic(assets) : zones;
    edit({ ...patch, assets, zones: nextZones }, remember);
    if (nextZones !== zones) setZoneIndex(nextZones.findIndex(z => z.asset === selected));
  };
  const changeZone = (change: Partial<Zone>) => {
    const index = zone ? zones.indexOf(zone) : -1;
    if (index >= 0)
      edit({
        ...patch,
        zones: zones.map((z, i) => (i === index ? { ...z, ...change } : z)),
      });
  };
  const editMap = (next: KeyMap) =>
    edit({ ...patch, zones: mappedZones(next, patch.assets.length, zones) });
  const global = (key: keyof Settings, value: number) => {
    if (!gesture.current) {
      setHistory((h) => [...h.slice(-39), patchRef.current]);
      setRedo([]);
      gesture.current = true;
    }
    let nextZones = zones;
    const override = (
      {
        attack: "attack",
        decay: "decay",
        sustain: "sustain",
        release: "release",
      } as Partial<Record<keyof Settings, keyof Zone>>
    )[key];
    if (override) nextZones = zones.map((z) => ({ ...z, [override]: value }));
    edit(
      {
        ...patch,
        zones: nextZones,
        settings: { ...patch.settings, [key]: value },
      },
      false,
    );
  };
  const run = <T,>(request: Record<string, unknown>) =>
    new Promise<T>((resolve, reject) => {
      const w = new Worker(
        new URL("./sampler/prepare.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = w;
      w.onmessage = (e) => {
        if (e.data.progress) {
          setBusy(e.data.progress.label);
          return;
        }
        w.terminate();
        worker.current = undefined;
        e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
      };
      w.onerror = (e) => {
        w.terminate();
        worker.current = undefined;
        reject(Error(e.message));
      };
      w.postMessage({ ...request, target });
    });
  async function importFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    setError("");
    setBusy("Reading instrument…");
    try {
      const all = Array.from(files),
        soundfont = all.find((f) => /\.sf[23]$/i.test(f.name)),
        sfzs = all.filter((f) => /\.sfz$/i.test(f.name));
      if (soundfont) {
        const data = await soundfont.arrayBuffer(),
          opened = await openSoundFont(data);
        await source.current!.load(data);
        setBank({ source: opened.bank, presets: opened.presets, selected: [] });
        setAuditionChoice(0);
        setChooserSearch("");
        return;
      }
      if (sfzs.length) {
        const paths = new Map<string, File>();
        for (const f of all) {
          const path = normalizePath(
            f.webkitRelativePath || f.name,
          ).toLowerCase();
          if (paths.has(path))
            throw Error(`Ambiguous imported filename: ${path}`);
          paths.set(path, f);
        }
        const names = sfzs.map((f) =>
          normalizePath(f.webkitRelativePath || f.name),
        );
        setBank({
          source: undefined,
          presets: names.map((path, id) => ({
            id,
            name: path.split("/").at(-1)!,
            bank: 0,
            program: id,
            drums: false,
          })),
          selected: [],
          sfz: paths,
          paths: names,
        });
        setChooserSearch("");
        return;
      }
      const hexSound = classic ? all.find((f) => f.name.toLowerCase().endsWith(HEXSOUND_EXTENSION)) : undefined;
      if (hexSound) {
        const decoded = decodeHexSound(new Uint8Array(await hexSound.arrayBuffer()));
        const title = hexSoundTitle(decoded.presetBody);
        setSoundTarget({ ...title, ...decoded });
        restore({ ...readCompactPatch(decoded.instrument), report: [`Opened the instrument of “${title.name}”.`] });
        return;
      }
      const hbc = all.find((f) => /\.hbc$/i.test(f.name));
      if (hbc) { setSoundTarget(undefined); restore({ ...readCompactPatch(new Uint8Array(await hbc.arrayBuffer())), report: ["Opened Classic mono instrument."] }); return; }
      const hbs = all.find((f) => /\.hbs$/i.test(f.name));
      if (hbs) {
        restore({
          ...readBank(new Uint8Array(await hbs.arrayBuffer())),
          report: [
            "Opened prepared audio. Editing and exporting prepares a new device instrument.",
          ],
        });
        return;
      }
      const wavs = all.filter((f) => /\.wav$/i.test(f.name));
      if (!wavs.length)
        throw Error("Choose SF2, SF3, an SFZ folder, HBS, or WAV recordings.");
      const recordings = await run<Recording[]>({
          operation: "import",
          files: await Promise.all(
            wavs.map(async (f) => ({
              name: f.name,
              bytes: await f.arrayBuffer(),
            })),
          ),
        }),
        assets = [...patch.assets, ...recordings];
      const nextZones = template === "instrument" ? appendSamplerRecordings(patch,recordings).zones??[] : mappedZones(assignSequentially(assets.length),assets.length);
      edit({...patch,assets,zones:nextZones});
      setSelected(patch.assets.length);
      setZoneIndex(nextZones.findIndex(z => z.asset === patch.assets.length));
      setLoopSuggestions(undefined);
      setReport([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function suggestCompactLoops() {
    const sourcePatch = patch;
    setBusy("Finding compact loops…"); setError("");
    try {
      const result = await run<(LoopCandidate | null)[]>({operation: "suggestLoops", assets: sourcePatch.assets});
      if (patchRef.current !== sourcePatch) throw Error("The instrument changed during analysis. Try again.");
      setLoopAuditionError("");
      setLoopSelection(result.map(Boolean));
      setLoopSuggestions(result);
    } catch (e) { setError(String(e)); } finally { setBusy(""); }
  }
  function applyCompactLoops() {
    if (!loopSuggestions) return;
    const assets = patch.assets.map((a, i) => {
      const c = loopSuggestions[i];
      return c && loopSelection[i] && ![1, 3].includes(a.mode ?? 0) ? {...a, mode: 1 as const, loopStart: c.start, loopEnd: c.end, crossfade: c.crossfade} : a;
    });
    edit({...patch, assets}); setLoopSuggestions(undefined);
  }
  async function importChosen() {
    if (!bank?.selected.length) return;
    setBusy("Converting selected presets…");
    setError("");
    try {
      const converted: ImportedPatch[] = [];
      for (const id of bank.selected) {
        setBusy(`Importing ${bank.presets[id].name}…`);
        converted.push(
          bank.sfz
            ? await importSFZ(bank.paths![id], bank.sfz, (p) =>
                setBusy(p.label),
              )
            : await convertSoundFont(
                bank.source!,
                id,
                (p) => setBusy(p.label),
                {
                  adaptation: classic ? "compact" : adaptation,
                },
              ),
        );
      }
      setLibrary((l) => [...l, ...converted]);
      restore(converted[0]);
      source.current!.off();
      setBank(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function exportPatch(usb = false, prepareOnly = false) {
    if (!patch.assets.length) return;
    const preparingPatch = patch;
    setBusy(classic ? "Preparing instrument…" : "Preparing pitch protection…");
    setError("");
    try {
      const result =
        prepared ?? (await run<Prepared>({ operation: "prepare", patch, target }));
      if (patchRef.current !== preparingPatch) throw Error("The instrument changed during preparation. Prepare it again before sending.");
      setPrepared(result);
      if (classic) setAuditionVersion("converted");
      setReport((r) => [...new Set([...r, ...result.warnings])]);
      if (prepareOnly) return;
      if (classic) {
        const made = soundTarget
          ? { name: soundTarget.name, folderPath: soundTarget.folderPath, sound: encodeHexSound(soundTarget.presetBody, result.bytes) }
          : newSamplerSound(result.bytes, { name: presetName || patch.name || "", folderPath: presetFolder });
        if (usb) {
          if (!compactClient) throw Error("Connect HexBoard first.");
          setPresetStatus("");
          await compactClient.sendSound(made.sound, { play: true, progress: (n,total)=>setBusy(`Copying sound · ${Math.round(n/total*100)}%`) });
          setPresetStatus(`Saved sound “${made.name}” in ${made.folderPath === "/" ? "the root folder" : made.folderPath} on HexBoard.`);
        } else download(made.sound, `${made.name.replace(/[\\/:*?"<>|]/g, "_") || "Sound"}${HEXSOUND_EXTENSION}`);
        return;
      }
      if (usb) {
        if (result.bytes.length > 8 * 1048576)
          throw Error(
            "Export this instrument and copy it to sampler/instruments on the SD card. USB is intended for files under 8 MiB.",
          );
        if (!client.current) throw Error("Connect HexBoard first.");
        const targetName = samplerFilename(patch.name ?? "Instrument");
        const folderList = await client.current.samplerLibrary(true, 32),
          existingFolder = folderList.find((f) => f.name === exportFolder);
        const entries = existingFolder
          ? await client.current.samplerLibrary(true, existingFolder.id)
          : [];
        if (!existingFolder && folderList.length >= 32)
          throw Error(
            "The card already has 32 instrument folders. Choose an existing USB folder or copy directly to SD.",
          );
        if (entries.some((item) => item.name === targetName.slice(0, -4)))
          throw Error(
            "An instrument with this name already exists in that folder. Choose a new name.",
          );
        if (entries.length >= 32)
          throw Error(
            "This folder already shows 32 instruments. Choose a new USB folder so the instrument stays visible in the menu.",
          );
        await client.current.uploadSamplerNamed(
          result.bytes,
          exportFolder,
          targetName,
          (n, total) =>
            setBusy(`Copying to SD · ${Math.round((n / total) * 100)}%`),
        );
        setPlaying(false);
        const refreshed = await client.current.samplerLibrary(true, 32);
        setFolders(refreshed);
        const target = refreshed.find((f) => f.name === exportFolder);
        if (target) {
          const list = await client.current.samplerLibrary(true, target.id);
          setFolder(target.id);
          setInstruments(list);
          const item = list.find((i) => i.name === targetName.slice(0, -4));
          if (item) setSdSource(item.id);
        }
      } else
        download(result.bytes, samplerFilename(patch.name ?? "Instrument"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  function download(data: Uint8Array, name: string) {
    const url = URL.createObjectURL(new Blob([data.slice().buffer]));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function refresh() {
    setBusy("Reading SD library…");
    try {
      const f = await client.current!.samplerLibrary(true, 32);
      setFolders(f);
      const id = f.some((x) => x.id === folder) ? folder : (f[0]?.id ?? 0);
      setFolder(id);
      setInstruments(await client.current!.samplerLibrary(true, id));
      setPlaying(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  async function devicePlay(value = sdSource) {
    if (effectTimer.current) clearTimeout(effectTimer.current);
    setPlaying(false);
    setBusy("Loading instrument…");
    setError("");
    try {
      await client.current!.samplerInstrument(value);
      if (value !== 1) {
        const header = await client.current!.samplerSettings();
        const savedSpace =
          new DataView(header.buffer, header.byteOffset).getUint16(62, true) /
          65535;
        setDeviceSpace(savedSpace);
        lastDeviceSpace.current = savedSpace > 0 ? savedSpace : 0.18;
        setDeviceSettings(true);
      } else {
        setDeviceSpace(0);
        setDeviceSettings(false);
      }
      await client.current!.start(6);
      setLoadedSource(value);
      setPlaying(true);
    } catch (e) {
      setError(String(e));
      setPlaying(false);
    } finally {
      setBusy("");
    }
  }
  const changeDeviceSpace = (amount: number) => {
    setDeviceSpace(amount);
    if (amount > 0) lastDeviceSpace.current = amount;
    if (effectTimer.current) clearTimeout(effectTimer.current);
    if (playing && client.current)
      effectTimer.current = setTimeout(() => {
        void client.current
          ?.samplerParameter(12, Math.round(amount * 65535))
          .catch((e) => setError(String(e)));
      }, 30);
  };
  async function saveDeviceSpace() {
    if (!client.current || !deviceSettings || loadedSource !== sdSource) return;
    setBusy("Saving instrument reverb…");
    setError("");
    const resume = playing;
    try {
      if (effectTimer.current) clearTimeout(effectTimer.current);
      const header = await client.current.samplerSettings();
      setPlaying(false);
      const v = new DataView(
        header.buffer,
        header.byteOffset,
        header.byteLength,
      );
      v.setUint16(62, Math.round(deviceSpace * 65535), true);
      v.setUint32(36, 0, true);
      v.setUint32(36, crc32(header), true);
      await client.current.samplerSettings(header);
      if (resume) {
        await client.current.start(6);
        setPlaying(true);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
  }
  const on = (key: string, note: number, physical?: number) => {
      void preview
        .current!.on(key, note, velocity, physical)
        .catch((e) => setError(String(e)));
    },
    off = (key: string) => preview.current!.off(key, lift);
  const number = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    min: number,
    max: number,
    step = 1,
    hint?: string,
  ) => (
    <label key={label}>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0}
        onChange={(e) => {
          if (e.target.value !== "")
            onChange(Math.max(min, Math.min(max, +e.target.value)));
        }}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
  const slicePlan = useMemo(() => {
    if (template !== "slices" || !sample) return { points: [] as number[], error: "" };
    try { return { points: sliceMode === "hits" ? findHits(sample, 64, sliceSensitivity) : equalSlicePoints(sample, slices), error: "" }; }
    catch (e) { return { points: [] as number[], error: e instanceof Error ? e.message : String(e) }; }
  }, [template, sample, sliceMode, sliceSensitivity, slices]);
  const addSlices = () => {
    if (!sample) return;
    try {
      const pieces = sliceAt(sample, slicePlan.points), first = patch.assets.length, assets = [...patch.assets, ...pieces];
      const nextMap = assignToFreeKeys(map, first, pieces.length);
      edit({ ...patch, assets, zones: mappedZones(nextMap, assets.length, zones) });
      const firstKey = Object.entries(nextMap).find(([, a]) => a.asset === first)?.[0];
      setSelected(first); if (firstKey !== undefined) setSelectedKey(+firstKey);
    } catch (e) { setError(String(e)); }
  };
  const selectedAssignment = map[selectedKey],
    settings = { ...defaults, ...patch.settings };
  const editingControls = (<>
      <div className="sampler-studio" inert={!!busy}>
        <aside className="sampler-browser">
          <h3>Recordings{patch.assets.length > 0 && <small> · {patch.assets.length}</small>}</h3>
          {patch.assets.length > 8 && <input
            aria-label="Find recording"
            placeholder="Find a recording…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />}
          {pitchMatters && patch.assets.some(a => a.pitchSource === "fallback") && <p role="status" className="sampler-error">Some pitches couldn’t be detected. Check the marked recordings.</p>}
          <div className="sampler-recordings">
            {patch.assets.map(
              (a, i) =>
                a.name?.toLowerCase().includes(search.toLowerCase()) && (
                  <button
                    key={i}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/x-hexboard-sampler-recording",
                        String(i),
                      );
                      setSelected(i);
                    }}
                    aria-pressed={i === selected}
                    onClick={() => {
                      setSelected(i);
                      setZoneIndex(zones.findIndex((z) => z.asset === i));
                    }}
                  >
                    <i
                      style={{ background: `hsl(${(i * 47) % 360} 45% 64%)` }}
                    />
                    <span>
                      <strong>{a.name}</strong>
                      <small>
                        {((a.end ?? a.channels[0].length) - (a.start ?? 0)) /
                          a.rate <
                        1
                          ? "Short sample"
                          : `${(((a.end ?? a.channels[0].length) - (a.start ?? 0)) / a.rate).toFixed(1)} s`}{" "}
                        · {noteName(a.rootMidi)}{!zones.some(z=>z.asset===i)&&" · unmapped"}{pitchMatters && a.pitchSource === "fallback" && <em> · check pitch</em>}
                      </small>
                    </span>
                  </button>
                ),
            )}
          </div>
          {!patch.assets.length && (
            <p className="panel-note">
              No recordings yet.
            </p>
          )}
          {patch.assets.length > 0 && <div className="sampler-loop-batch">
            <button disabled={!!busy} title="Find short sustain loops for every recording that doesn’t loop yet" onClick={() => void suggestCompactLoops()}>Suggest loops for all…</button>
            {loopSuggestions && <LoopReviewDialog onClose={() => { loopAudition.current?.stop(); setLoopSuggestions(undefined); }}><h3 id="samplerLoopReviewTitle">Loop suggestions</h3><p>{loopSuggestions.filter(Boolean).length} found. Recordings that already loop are left alone. Listen, then apply the ones you like.</p>
              {loopSuggestions.map((c, i) => c && <div className="sampler-loop-review-row" key={i}><label><input type="checkbox" checked={!!loopSelection[i]} onChange={event => setLoopSelection(current => current.map((v, n) => n === i ? event.target.checked : v))}/>{patch.assets[i].name}: {((c.end-c.start)/patch.assets[i].rate*1000).toFixed(1)} ms · {c.analysis.hz ? `${c.changeCents?.toFixed(1)} cents pitch change` : "pitch uncertain"}</label>
                <button aria-label={`Hear ${patch.assets[i].name} loop`} onClick={() => { const a = patch.assets[i]; loopAudition.current ??= new TuningAudition(); setLoopAuditionError(""); void loopAudition.current.play({...a, mode: 1, loopStart: c.start, loopEnd: c.end, crossfade: c.crossfade}, hzForMidi(a.rootMidi), "sample", true).catch(e => setLoopAuditionError(String(e))); }}>Listen</button></div>)}
              {loopAuditionError && <p role="alert">{loopAuditionError}</p>}
              <button disabled={!loopSelection.some(Boolean)} onClick={applyCompactLoops}>Apply selected loops</button>
              <button onClick={() => { loopAudition.current?.stop(); setLoopSuggestions(undefined); }}>Cancel</button></LoopReviewDialog>}
          </div>}
          {library.length > 0 && (
            <>
              <h3>Imported instruments</h3>
              {library.map((p, i) => (
                <button key={i} onClick={() => restore(p)}>
                  {p.name}
                </button>
              ))}
            </>
          )}
        </aside>
        <main className="sampler-canvas"><SamplerWorkspace target={target} view={workspaceView} onViewChange={setWorkspaceView} recording={sample} onChange={changeSample} targets={tuningTargets} preparedBytes={prepared?.bytes.length} stopSignal={tuningStop} design={sustainDesign} cycles={loopCycles} onDesign={setSustainDesign} onCycles={setLoopCycles} level={zone?.gain??1} onLevel={gain=>changeZone({gain})} onRemove={sample?()=>removeRecording(selected):undefined} pitchMatters={pitchMatters} mapping={<>
      {!classic && <>
      <div className="sampler-tabs sampler-map-modes" role="group" aria-label="Mapping mode">
        {["instrument", "kit", "slices"].map((mode) => (
          <button
            key={mode}
            aria-pressed={template === mode}
            onClick={() => {
              setTemplate(mode);
              if (mode === "instrument" && template !== "instrument") edit({...patch,zones:automatic(patch.assets)});
              else if (mode !== "instrument" && !Object.keys(map).length) editMap(assignSequentially(patch.assets.length));
            }}
          >
            {mode === "instrument" ? "Instrument" : mode === "kit" ? "Kit" : "Slices"}
          </button>
        ))}
        <span>
          {patch.assets.length} recordings · {zones.length} regions
        </span>
      </div>
      <p className="panel-note sampler-mode-hint">
        {template === "instrument"
          ? "Each recording plays a range of notes, repitched from its original pitch."
          : template === "kit"
            ? "Each HexBoard key plays its own recording. Good for drums and effects."
            : "Cut a recording at its hits, or into equal parts, and lay the slices across the keys."}
      </p></>}

          {template === "instrument" ? (
            <fieldset>
              <legend>Key & velocity map</legend>
              <div
                className="sampler-zone-map"
                role="group"
                aria-label="Sample key and velocity regions"
              >
                {zones.map((z, i) => (
                  <button
                    key={i}
                    aria-label={`${patch.assets[z.asset]?.name}, notes ${noteName(z.lowMidi ?? 0)} to ${noteName((z.highMidi ?? 128) - 1)}, velocity ${z.velocityLow ?? 1} to ${z.velocityHigh ?? 127}`}
                    aria-pressed={i === zoneIndex}
                    style={
                      {
                        left: `${(((z.lowMidi ?? -0.5) + 0.5) / 128) * 100}%`,
                        width: `${(((z.highMidi ?? 127.5) - (z.lowMidi ?? -0.5)) / 128) * 100}%`,
                        bottom: `${(((z.velocityLow ?? 1) - 1) / 127) * 100}%`,
                        height: `${(((z.velocityHigh ?? 127) - (z.velocityLow ?? 1) + 1) / 127) * 100}%`,
                        "--zone-color": `hsl(${(z.asset * 47) % 360} 45% 64%)`,
                      } as CSSProperties
                    }
                    onClick={() => {
                      setSelected(z.asset);
                      setZoneIndex(i);
                    }}
                  >
                    {patch.assets[z.asset]?.name}
                  </button>
                ))}
              </div>
              <div className="sampler-map-axis">
                <small>C−1</small>
                <small>C2</small>
                <small>C4</small>
                <small>C6</small>
                <small>G9</small>
              </div>
              <p className="panel-note">Notes run left to right; louder velocities sit higher. Select a region to edit it.</p>
              {zones.some(z => (z.highMidi ?? 127.5) <= (z.lowMidi ?? -0.5)) && <p className="sampler-error" role="status">A region has no notes. Check its range or use Map by original pitch.</p>}
              {zone ? (
                <div className="sampler-region-editor">
                  <strong>{patch.assets[zone.asset]?.name}</strong>
                  <div className="sampler-fields">
                    {number(
                      "Range start (MIDI)",
                      zone.lowMidi ?? -0.5,
                      (v) => changeZone({ lowMidi: v }),
                      -0.5,
                      (zone.highMidi ?? 127.5) - 0.01,
                      0.01,
                      `from ${noteName(Math.max(0, Math.ceil(zone.lowMidi ?? -0.5)))}`,
                    )}
                    {number(
                      "Range end (MIDI)",
                      zone.highMidi ?? 127.5,
                      (v) => changeZone({ highMidi: v }),
                      (zone.lowMidi ?? -0.5) + 0.01,
                      127.5,
                      0.01,
                      `up to ${noteName(Math.min(127, Math.ceil(zone.highMidi ?? 127.5) - 1))}`,
                    )}
                    {number(
                      "Lowest velocity",
                      zone.velocityLow ?? 1,
                      (v) => changeZone({ velocityLow: v }),
                      1,
                      zone.velocityHigh ?? 127,
                    )}
                    {number(
                      "Highest velocity",
                      zone.velocityHigh ?? 127,
                      (v) => changeZone({ velocityHigh: v }),
                      zone.velocityLow ?? 1,
                      127,
                    )}
                  </div>
                  <div className="sampler-fields">
                    <button
                      disabled={(zone.velocityHigh ?? 127) <= (zone.velocityLow ?? 1)}
                      title="Split this region into soft and loud halves"
                      onClick={() => {
                        const mid = Math.floor(((zone.velocityLow ?? 1) + (zone.velocityHigh ?? 127)) / 2);
                        edit({
                          ...patch,
                          zones: [
                            ...zones.map((z) => z === zone ? { ...z, velocityHigh: mid } : z),
                            { ...zone, velocityLow: mid + 1 },
                          ],
                        });
                        setZoneIndex(zones.length);
                      }}
                    >
                      Split velocity layer
                    </button>
                    <button onClick={() => edit({ ...patch, zones: zones.filter((z) => z !== zone) })}>
                      Remove region
                    </button>
                  </div>
                </div>
              ) : <p className="panel-note">Select a region on the map.</p>}
              <div className="sampler-fields sampler-map-actions">
                <button
                  disabled={!sample}
                  title="Rebuild the map so each recording covers the notes nearest its original pitch"
                  onClick={() => { const next = automatic(patch.assets); edit({ ...patch, zones: next }); setZoneIndex(next.findIndex(z => z.asset === selected)); }}
                >
                  Map by original pitch
                </button>
              </div>
            </fieldset>
          ) : (
            <fieldset className="sampler-mapping">
              <legend>
                {template === "kit" ? "Key assignments" : "Slice assignments"}
              </legend>
              <div>
                <p className="panel-note">
                  Drag recordings from the list onto keys, or select a key and choose its sound.
                </p>
                {template === "slices" && (
                  <div className="sampler-slicer">
                    <div className="sampler-fields">
                      <div className="sampler-segmented" role="group" aria-label="Slice by">
                        <button aria-pressed={sliceMode === "hits"} onClick={() => setSliceMode("hits")}>At hits</button>
                        <button aria-pressed={sliceMode === "equal"} onClick={() => setSliceMode("equal")}>Equal parts</button>
                      </div>
                      {sliceMode === "equal"
                        ? number("Slices", slices, setSlices, 2, 64)
                        : <label>Sensitivity<input aria-label="Hit sensitivity" type="range" min={0} max={1} step={0.05} value={sliceSensitivity} onChange={(e) => setSliceSensitivity(+e.target.value)} /></label>}
                    </div>
                    {sample && <SliceStrip recording={sample} points={slicePlan.points} />}
                    <p className="panel-note">
                      {!sample ? "Select a recording to slice." : slicePlan.error || (slicePlan.points.length < 2 ? "No separate hits found. Raise the sensitivity or use equal parts." : `${slicePlan.points.length} slices from ${sample.name}. They’re added as new recordings on free keys; the original stays.`)}
                    </p>
                    <button className="primary" disabled={!sample || slicePlan.points.length < 2} onClick={addSlices}>
                      Add {slicePlan.points.length >= 2 ? slicePlan.points.length : ""} slices
                    </button>
                  </div>
                )}
                <div className="sampler-fields">
                  <label>
                    Sound for key {selectedKey + 1}
                    <select
                      aria-label="Sound for selected key"
                      value={selectedAssignment?.asset ?? ""}
                      onChange={(e) => {
                        const next = { ...map };
                        if (e.target.value === "") delete next[selectedKey];
                        else {
                          next[selectedKey] = {
                            asset: +e.target.value,
                            color: next[selectedKey]?.color ?? "#658eda",
                          };
                          setSelected(+e.target.value);
                        }
                        editMap(next);
                      }}
                    >
                      <option value="">Unassigned</option>
                      {patch.assets.map((a, i) => (
                        <option value={i} key={i}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Color
                    <input
                      type="color"
                      aria-label="Key color"
                      disabled={!selectedAssignment}
                      value={selectedAssignment?.color ?? "#658eda"}
                      onChange={(e) =>
                        editMap({
                          ...map,
                          [selectedKey]: { ...selectedAssignment, color: e.target.value },
                        })
                      }
                    />
                  </label>
                </div>
                <div className="sampler-fields">
                  <button
                    disabled={!selectedAssignment}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      on("mapped", patch.assets[selectedAssignment?.asset]?.rootMidi ?? 60, selectedKey);
                    }}
                    onPointerUp={() => off("mapped")}
                    onPointerCancel={() => off("mapped")}
                    onLostPointerCapture={() => off("mapped")}
                  >
                    Hold to hear key
                  </button>
                  <button
                    title="Assign every recording to consecutive keys"
                    onClick={() => editMap(assignSequentially(patch.assets.length))}
                  >
                    Map in order
                  </button>
                </div>
              </div>
              <SamplerKeyPreview
                map={map}
                names={patch.assets.map((a) => a.name ?? "Recording")}
                selected={selectedKey}
                onSelect={(key) => {
                  setSelectedKey(key);
                  if (map[key]) setSelected(map[key].asset);
                }}
                onPress={(key) => on(`hex:${key}`, patch.assets[map[key]?.asset]?.rootMidi ?? 60, key)}
                onRelease={(key) => off(`hex:${key}`)}
                onAssign={(key, asset) => {
                  setSelectedKey(key);setSelected(asset);
                  editMap({
                    ...map,
                    [key]: { asset, color: map[key]?.color ?? "#658eda" },
                  });
                }}
              />
            </fieldset>
          )}
</>} sound={<>
          <nav className="sampler-tabs sampler-sound-pages" aria-label="Sound sections">{([['voice','Envelope'],...(!classic?[['response','Touch & release']]:[]),['motion','Motion'],['room','Room']] as [string,string][]).map(([id,label])=><button key={id} aria-pressed={soundPage===id} onClick={()=>setSoundPage(id)}>{label}</button>)}</nav>
          <div className="sampler-sound-page" hidden={soundPage!=='voice'}>
            <RegionEnvelope zones={zones} index={zone ? zones.indexOf(zone) : -1} names={patch.assets.map(a => a.name ?? "Recording")} settings={settings}
            onSelect={index => { setZoneIndex(index); setSelected(zones[index].asset);if(zones[index].key!==undefined&&zones[index].key!==65535)setSelectedKey(zones[index].key!); }}
            onChange={(change, all, remember) => {
              const current = patchRef.current;
              edit({ ...current, zones: changeRegionEnvelope(current.zones ?? [], zone ? zones.indexOf(zone) : -1, change, all) }, remember);
            }} onShape={classic ? undefined : (key, bend) => global(key, bend)}/>
            <fieldset className="sampler-region-card">
              <legend>Region{zone && sample ? ` · ${sample.name}` : ""}</legend>
              {zone ? (
                <>
                  <div className="sampler-fields">
                    {!classic && number("Pan", zone.pan ?? 0, (v) => changeZone({ pan: v }), -1, 1, 0.01, "−1 left · +1 right")}
                    {number("Key tracking %", (zone.keyTrack ?? 1) * 100, (v) => changeZone({ keyTrack: v / 100 }), 0, 200, 1, "100 = normal pitch")}
                    {!classic && number("Round robin", zone.roundRobin ?? 0, (v) => changeZone({ roundRobin: v }), 0, 15, 1, "0 = off")}
                    {!classic && number("Choke group", zone.choke ?? 0, (v) => changeZone({ choke: v }), 0, 16, 1, "0 = off")}
                    {!classic && <label>
                      Velocity curve
                      <select value={zone.velocityCurve ?? 0} onChange={(e) => changeZone({ velocityCurve: +e.target.value })}>
                        <option value={0}>Linear</option>
                        <option value={1}>Squared</option>
                        <option value={2}>Constant / pressure</option>
                        <option value={103}>SFZ 100%</option>
                      </select>
                    </label>}
                  </div>
                  <details>
                    <summary>Delay, hold & filter</summary>{classic&&<p className="panel-note">Heard in the browser only; Classic export omits filters.</p>}
                    <div className="sampler-fields">
                      {([["delay","Delay (ms)"],["hold","Hold (ms)"],["cutoff","Filter cutoff (Hz)"]] as const).map(([key,label]) =>
                        number(
                          label,
                          zone[key] ?? (key in settings ? settings[key as keyof Settings] : 0) ?? 0,
                          (v) => changeZone({ [key]: v }),
                          key === "cutoff" ? 40 : 0,
                          key === "delay" ? 10000 : 20000,
                          1,
                        ),
                      )}
                      {number("Resonance",zone.resonance??settings.resonance,v=>changeZone({resonance:v}),.5,4,.01)}
                    </div>
                  </details>
                </>
              ) : (
                <p className="panel-note">Select a region in Map.</p>
              )}
            </fieldset>
          </div>
          {!classic && <div className="sampler-sound-page" hidden={soundPage!=='response'}>
            <div className="sampler-shaping">
              {[
                {
                  title: "Touch & tone",
                  controls: [
                    ["cutoff", "Tone", 40, 20000, "Hz"],
                    ["pressure", "Pressure → tone", 0, 1, ""],
                    ["pressureGain", "Pressure → level", 0, 1, ""],
                  ],
                },
                {
                  title: "Key release",
                  controls: [
                    ["fastRelease", "Fast lift", 5, 1000, "ms"],
                    ["releaseResponse", "Lift response", 0, 1, ""],
                    ["releaseCurve", "Lift curve", 0.25, 4, ""],
                    ["pedalRelease", "Pedal up", 5, 1000, "ms"],
                  ],
                },
              ].map((group) => (
                <fieldset key={group.title}>
                  <legend>{group.title}</legend>
                  <div className="knob-bank">
                    {group.controls.map(([k, label, min, max, unit]) => (
                      <label className="sampler-knob" key={k}>
                        <span>{label}</span>
                        <Knob
                          label={String(label)}
                          min={Number(min)}
                          max={Number(max)}
                          value={settings[k as keyof Settings]}
                          onChange={(v) => global(k as keyof Settings, v)}
                          onRelease={() => {
                            gesture.current = false;
                          }}
                        />
                        <output>
                          {settings[k as keyof Settings].toFixed(Number(max) <= 4 ? 2 : 0)} {unit}
                        </output>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
              <fieldset>
                <legend>Patch response</legend>
                <div className="sampler-fields">
                  <label>
                    Velocity engine
                    <select value={patch.velocityEngine ?? 0} onChange={(e) => edit({ ...patch, velocityEngine: +e.target.value })}>
                      {["Threshold Strike", "Expressive", "Distance", "Gesture", "Fixed"].map((label, i) => (
                        <option value={i} key={label}>{label}</option>
                      ))}
                    </select>
                  </label>
                  <button aria-pressed={!!patch.performance?.values[0]} onClick={() => setArpOpen(true)}>
                    Arpeggiator · {patch.performance?.values[0] ? "On" : "Off"}
                  </button>
                </div>
                <p className="panel-note">Saved with the instrument. Recalled when HexBoard’s Follow preset setting is on.</p>
              </fieldset>
            </div>
          </div>}
          <div className="sampler-sound-focus" hidden={soundPage!=='motion'}>{zone?<MotionEditor classic={classic} value={{...patch.motion,...zone?.motion}} onEnd={()=>{gesture.current=false;}} onChange={change=>{if(!zone)return;const m=motionSettings({...patch.motion,...zone.motion,...change});edit({...patch,zones:zones.map(z=>z===zone?{...z,motion:m}:z)},!gesture.current);gesture.current=true;}} onApplyAll={()=>{const m=motionSettings({...patch.motion,...zone?.motion});edit({...patch,motion:m,zones:zones.map(z=>({...z,motion:m}))});}}/>:<p className="panel-note">Select a recording with a mapped region to edit its motion.</p>}</div>
          <div className="sampler-sound-focus" hidden={soundPage!=='room'}><fieldset><legend>Room</legend><button aria-pressed={settings.space>0} onClick={()=>{if(settings.space>0)lastSpace.current=settings.space;global('space',settings.space>0?0:lastSpace.current);gesture.current=false;}}>Room · {settings.space>0?'On':'Off'}</button>
            <p className="panel-note">{classic?'Heard in the browser only; Classic export omits reverb.':'One shared reverb for the whole instrument.'}</p>
            <div className="knob-bank">{([['space','Amount',0,1,''],['roomDecay','Decay',200,8000,'ms'],['roomTone','Tone',0,1,''],['roomWidth','Width',0,1,'']] as const).map(([k,label,min,max,unit])=><label className="sampler-knob" key={k}><span>{label}</span><Knob label={'Room '+label} min={min} max={max} value={settings[k]} onChange={v=>global(k,v)} onRelease={()=>{gesture.current=false;}}/><output>{settings[k].toFixed(max>1?0:2)} {unit}</output></label>)}</div></fieldset></div>
      </>}/></main>
      </div>

  </>);
  const panic=()=>{preview.current!.clear();source.current!.off();loopAudition.current?.stop();setTuningStop(n=>n+1);};
  const auditionControls = <SamplerAudition preview={preview.current!} patch={patch} selected={selected} zoneIndex={zone?zones.indexOf(zone):-1} transport={transport} prepared={prepared} classic={classic} onPanic={panic}/>;
  return (
    <section
      className="physical-editor card sampler-editor"
      aria-label="Sampler editor"
      aria-busy={!!busy}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && !setupOpen && e.dataTransfer.files.length)
          void importFiles(e.dataTransfer.files);
      }}
    >
      <div className="instrument-title">
        <h2>Sampler</h2>
        {classic && <span>One instrument · eight voices</span>}
        {(busy || draftError || draftNotice) && <p role="status" className={!busy && draftError ? "error" : ""}>{busy || draftError || draftNotice}</p>}
      </div>
      <div className="sampler-toolbar">
        <input
          aria-label="Instrument name"
          disabled={!!busy}
          value={patch.name ?? ""}
          maxLength={32}
          onChange={(e) => edit({ ...patch, name: e.target.value }, false)}
        />
        <button disabled={!!busy || (!patch.assets.length && patch.name === "New instrument")} title="Start an empty instrument (Undo brings this one back)" onClick={newInstrument}>New</button>
        <label className="sampler-file primary" title="WAV recordings, SF2/SF3 SoundFonts, SFZ or saved instruments">
          Add recordings or instrument
          <input
            aria-label="Add recordings or instrument"
            type="file"
            multiple
            accept={classic ? `.sf2,.sf3,.sfz,.wav,.hbs,.hbc,${HEXSOUND_EXTENSION}` : ".sf2,.sf3,.sfz,.wav,.hbs"}
            disabled={!!busy}
            onChange={(e) => {
              void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="sampler-file" title="Choose a folder containing an SFZ file and its samples">
          SFZ folder…
          <input
            aria-label="Import SFZ folder"
            type="file"
            multiple
            {...{ webkitdirectory: "" }}
            disabled={!!busy}
            onChange={(e) => {
              void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <span className="sampler-toolbar-group" role="group" aria-label="Edit history">
          <button disabled={!history.length || !!busy} title="Undo" onClick={undo}>
            Undo
          </button>
          <button
            disabled={!redo.length || !!busy}
            title="Redo"
            onClick={() => {
              preview.current!.clear();
              setHistory((h) => [...h, patch]);
              const restored=redo.at(-1)!;setPatch(restored);setTemplate(restored.zones?.some(z=>z.key!==undefined&&z.key!==65535)?(template==="slices"?"slices":"kit"):"instrument");
              setRedo((r) => r.slice(0, -1));
              setPrepared(undefined);
            }}
          >
            Redo
          </button>
        </span>
        <InstrumentResources patch={patch} classic={classic} disabled={!!busy} onSetup={()=>setSetupOpen(true)}/>
        <button className="sampler-toolbar-end" disabled={!!busy} onClick={()=>setExportOpen(true)}>Save / export…</button>
      </div>
      {classic && <section className="sampler-workflow" aria-label="Prepare and send instrument">
        <div>
          <strong>{prepared ? "Ready for HexBoard" : preparationMessage || "Import an instrument"}</strong>
          <p>{prepared
            ? `${bytes(prepared.residentBytes)} of 48 KiB sample RAM · ${prepared.auditionPatch?.assets.length ?? 0} mono recordings`
            : "48 KiB sample RAM · conversion updates automatically as you edit."}</p>
        </div>
        <div className="sampler-fields">
          {preparationError && <button disabled={!!busy} onClick={() => setPreparationRevision(value => value + 1)}>Retry conversion</button>}
          <button className={prepared ? "primary" : ""} disabled={!transport || !prepared || !!busy} onClick={() => void exportPatch(true)}>Send to HexBoard</button>
          <button disabled={!prepared || !!busy} onClick={() => void exportPatch()}>Save sound file</button>
        </div>
        {soundTarget
          ? <div className="sampler-fields" aria-label="HexBoard sound">
              <p>Replaces the instrument in “{soundTarget.name}” ({soundTarget.folderPath === "/" ? "root folder" : soundTarget.folderPath}); its settings stay.</p>
              <button disabled={!!busy} onClick={() => { setSoundTarget(undefined); setPresetName(soundTarget.name); }}>Make a new sound instead</button>
            </div>
          : <div className="sampler-fields" aria-label="HexBoard sound">
              <label>Sound name<input aria-label="HexBoard sound name" value={presetName} placeholder={patch.name ?? "Instrument"} maxLength={HEXBOARD_PRESET_NAME_MAX_BYTES} onChange={e=>setPresetName(e.target.value)}/></label>
              <label>Folder<input aria-label="HexBoard sound folder" value={presetFolder} maxLength={47} placeholder="Root" onChange={e=>setPresetFolder(e.target.value)}/></label>
            </div>}
        {presetStatus && <p role="status">{presetStatus}</p>}
      </section>}
      {(error || preparationError) && <p className="sampler-error" role="alert">{error || preparationError}</p>}
      {setupOpen&&<InstrumentSetup patch={patch} classic={classic} design={sustainDesign} cycles={loopCycles} mode={template} onClose={()=>setSetupOpen(false)} onApply={(next,design,cycles,mode)=>{preview.current!.clear();const zones=mode!==template?(mode==="instrument"?automatic(next.assets):mappedZones(assignSequentially(next.assets.length),next.assets.length)):next.zones;edit({...next,zones});setTemplate(mode);setSustainDesign(design);setLoopCycles(cycles);if(mode!==template)setWorkspaceView(mode==="instrument"?"sample":"mapping");}}/>}
      {editingControls}
      {auditionControls}
      {exportOpen&&<WorkspaceDialog title="Save, export and HexBoard library" onClose={()=>setExportOpen(false)}><div className="sampler-bottom">
        <label className="sampler-export-name">Instrument name<input aria-label="Export instrument name" value={patch.name??""} maxLength={32} onChange={e=>edit({...patch,name:e.target.value},false)}/></label>
        {!classic && <fieldset>
          <legend>Export instrument</legend>
          <div className="sampler-fields">
            <label>
              Pitch quality
              <select
                value={patch.pitchQuality ?? "balanced"}
                onChange={(e) =>
                  edit({
                    ...patch,
                    pitchQuality: e.target.value as Patch["pitchQuality"],
                  })
                }
              >
                <option value="balanced">
                  Balanced · gentle bend aliasing
                </option>
                <option value="clean">Clean · protect ±2 bend</option>
                <option value="character">Character · allow aliasing</option>
              </select>
            </label>
            <label>
              Storage
              <select
                value={patch.storage ?? "auto"}
                onChange={(e) =>
                  edit({
                    ...patch,
                    storage: e.target.value as Patch["storage"],
                  })
                }
              >
                <option value="auto">Automatic</option>
                <option value="resident">Resident · stereo</option>
                <option value="streaming">SD · long recordings</option>
              </select>
            </label>
            <label>
              USB folder
              <input
                aria-label="USB folder"
                value={exportFolder}
                maxLength={32}
                onChange={(e) => setExportFolder(e.target.value)}
              />
            </label>
            {pitchMatters && patch.assets.some(a => a.pitchSource === "fallback") && <p className="sampler-error" role="status">Review uncertain pitches before exporting.</p>}
            <button
              className="primary"
              disabled={!patch.assets.length || !!busy}
              onClick={() => void exportPatch()}
            >
              Export {filename(patch.name ?? "Instrument")}
            </button>
            <button
              disabled={!transport || !patch.assets.length || !!busy}
              onClick={() => void exportPatch(true)}
            >
              Send to HexBoard SD over USB
            </button>
          </div>
          {!transport&&<p className="panel-note">Connect your HexBoard in Sync to send over USB.</p>}
          <p className="panel-note">
            {prepared ? `${bytes(prepared.bytes.length)} prepared. ` : ""}USB
            works for instruments under 8 MiB. For larger ones, copy the HBS
            file into a folder under sampler/instruments on the SD card. Each
            folder holds up to 32 instruments.
          </p>
        </fieldset>}
        {!classic && <fieldset>
          <legend>HexBoard library</legend>
          <div className="sampler-fields">
            <button
              disabled={!transport || !!busy}
              onClick={() => void refresh()}
            >
              Refresh library
            </button>
            <select
              aria-label="SD folder"
              disabled={!transport || !!busy}
              value={folder}
              onChange={(e) => {
                const id = +e.target.value;
                setFolder(id);
                setBusy("Reading folder…");
                void client.current
                  ?.samplerLibrary(true, id)
                  .then(setInstruments)
                  .catch((e) => setError(String(e)))
                  .finally(() => {
                    setBusy("");
                    setPlaying(false);
                  });
              }}
            >
              {!folders.length && <option value={0}>Choose a folder</option>}
              {folders.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              aria-label="SD instrument"
              disabled={!transport || !!busy}
              value={sdSource}
              onChange={(e) => {
                const id = +e.target.value;
                setSdSource(id);
                if (playing) void devicePlay(id);
              }}
            >
              <option value={0}>Saved sampler patch</option>
              <option value={1}>KW upright · compact</option>
              {instruments.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <button
              disabled={!transport || !!busy}
              onClick={() => {
                if (effectTimer.current) clearTimeout(effectTimer.current);
                if (playing)
                  void client
                    .current!.stopAndWait()
                    .then(() => setPlaying(false));
                else void devicePlay();
              }}
            >
              {playing ? "Stop HexBoard" : "Play on HexBoard"}
            </button>
          </div>
          <div className="sampler-fields sampler-device-reverb">
            <button
              disabled={!playing || !!busy}
              aria-pressed={deviceSpace > 0}
              onClick={() =>
                changeDeviceSpace(deviceSpace > 0 ? 0 : lastDeviceSpace.current)
              }
            >
              HexBoard room reverb · {deviceSpace > 0 ? "On" : "Off"}
            </button>
            <label>
              Amount
              <input
                aria-label="HexBoard reverb amount"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={deviceSpace}
                disabled={!playing || !!busy}
                onChange={(e) => changeDeviceSpace(+e.target.value)}
              />
            </label>
            <button
              disabled={
                !deviceSettings ||
                loadedSource !== sdSource ||
                !!busy ||
                !transport
              }
              onClick={() => void saveDeviceSpace()}
            >
              Save effect to instrument
            </button>
          </div>
          <p className="panel-note">
            Try reverb on the instrument playing from the SD card, then save it
            to that instrument.
          </p>
          <SamplerLoadingStatus client={client} playing={playing}/>
        </fieldset>}
      </div>
      {report.length > 0 && (
        <details className="sampler-report" open>
          <summary>
            Conversion notes · {report.length}
          </summary>
          <ul>
            {report.map((line, i) => (
              <li key={i}>{line}{patch.assets.map((a,index)=>a.name&&line.includes(a.name)&&<button key={index} aria-label={`Review ${a.name}`} onClick={()=>{setSelected(index);setZoneIndex(zones.findIndex(z=>z.asset===index));setWorkspaceView("sample");setExportOpen(false);}}>Review</button>)}</li>
            ))}
          </ul>
          <button
            onClick={() =>
              download(
                new TextEncoder().encode(
                  JSON.stringify(
                    {
                      instrument: patch.name,
                      source: patch.provenance,
                      changes: report,
                    },
                    null,
                    2,
                  ),
                ),
                `${patch.name} - conversion report.json`,
              )
            }
          >
            Download report
          </button>
        </details>
      )}
      </WorkspaceDialog>}

      {bank && (
        <div className="sampler-modal-backdrop">
          <div
            className="sampler-preset-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Choose presets to import"
          >
            <header>
              <div>
                <h2>Choose your instruments</h2>
                <p>
                  Audition the original, then import only the presets you want.
                </p>
              </div>
              <button
                disabled={!!busy}
                onClick={() => {
                  source.current!.off();
                  setBank(undefined);
                }}
              >
                Close
              </button>
            </header>
            <input
              autoFocus
              aria-label="Find preset"
              placeholder="Search presets…"
              value={chooserSearch}
              onChange={(e) => setChooserSearch(e.target.value)}
            />
            {number("Source audition MIDI", sourceNote, setSourceNote, 0, 127)}
            {!classic && <label>
              Complex preset adaptation
              <select
                value={adaptation}
                onChange={(e) =>
                  setAdaptation(e.target.value as "faithful" | "compact")
                }
              >
                <option value="faithful">
                  Capture source motion · closer match
                </option>
                <option value="compact">
                  Keep source samples · compact, simpler modulation
                </option>
              </select>
            </label>}
            <div className="sampler-preset-list">
              {bank.presets
                .filter((p) =>
                  p.name.toLowerCase().includes(chooserSearch.toLowerCase()),
                )
                .map((p) => (
                  <div
                    key={p.id}
                    className={p.id === auditionChoice ? "selected" : ""}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={bank.selected.includes(p.id)}
                        disabled={!!busy}
                        onChange={(e) => {
                          setBank({
                            ...bank,
                            selected: e.target.checked
                              ? [...bank.selected, p.id]
                              : bank.selected.filter((id) => id !== p.id),
                          });
                          setAuditionChoice(p.id);
                        }}
                      />
                      <span>
                        <strong>{p.name}</strong>
                        <small>
                          {bank.sfz
                            ? "SFZ instrument"
                            : `Bank ${p.bank} · program ${p.program}${p.drums ? " · drums" : ""}`}
                        </small>
                      </span>
                    </label>
                    {!bank.sfz && (
                      <button
                        disabled={!!busy}
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          setAuditionChoice(p.id);
                          void source
                            .current!.on(p, sourceNote, velocity)
                            .catch((e) => setError(String(e)));
                        }}
                        onPointerUp={() => source.current!.off()}
                        onPointerCancel={() => source.current!.off()}
                        onLostPointerCapture={() => source.current!.off()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.repeat)
                            void source.current!.on(p, sourceNote, velocity);
                        }}
                        onKeyUp={() => source.current!.off()}
                      >
                        Hold to hear original
                      </button>
                    )}
                  </div>
                ))}
            </div>
            <p className="panel-note">
              Layered or modulated presets are adapted with a change report.
              Source audition preserves the original SoundFont. You can compare
              the imported result before exporting.
            </p>
            <footer>
              <span>{bank.selected.length} selected</span>
              <button
                disabled={!bank.selected.length || !!busy}
                onClick={() => void importChosen()}
              >
                Import selected presets
              </button>
            </footer>
            {busy && <p role="status">{busy}</p>}
            {error && <p role="alert">{error}</p>}
          </div>
        </div>
      )}
      {arpOpen && (
        <ArpeggiatorEditor
          config={patch.performance ?? defaultPerformance()}
          disabled={!!busy}
          physical={false}
          browserAudition
          connected={false}
          saved={false}
          error=""
          onChange={(performance) => edit({ ...patch, performance }, false)}
          onClose={() => setArpOpen(false)}
          onClear={() => preview.current!.clear()}
          onSave={() => setArpOpen(false)}
        />
      )}
    </section>
  );
}

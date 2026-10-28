import { readCompactPatch, compactLimits } from "./sampler/compact.mjs";
import { ClassicSamplerLibrary } from "./sampler/ClassicSamplerLibrary.tsx";
import { ClassicSamplerClient } from "./sampler/classicClient.ts";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { BasicSoundBank } from "spessasynth_core";
import type { MidiTransport } from "../../midi/types.ts";
import {
  PhysicalSynthClient,
  type SamplerLoadingState,
  type SamplerInstrument,
} from "./client.ts";
import { samplerLoadingLabel } from "./sampler/loading.ts";
import { waveformPath } from "./sampleEditing.ts";
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
import { PatchPreview, editedCompactAudition } from "./sampler/preview.ts";
import { RegionEnvelope, changeRegionEnvelope } from "./sampler/RegionEnvelope.tsx";
import { SourceAudition } from "./sampler/sourceAudition.ts";
import { ArpeggiatorEditor } from "./ArpeggiatorEditor.tsx";
import { Knob } from "./SynthControls.tsx";
import { SamplerKeyPreview } from "./SamplerKeyPreview.tsx";
import {
  assignSequentially,
  mappedZones,
  sliceRecording,
  type KeyMap,
} from "./sampler/mapping.ts";
import "./PhysicalSynthEditor.css";
import "./SamplerEditor.css";
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
export function SamplerEditor({ transport, target = "advanced" }: { transport?: MidiTransport; target?: "advanced" | "classic" }) {
  const classic = target === "classic";
  const compactClient = useMemo(() => classic && transport ? new ClassicSamplerClient(transport) : undefined, [classic, transport]);
  const [libraryRevision, setLibraryRevision] = useState(0);
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
    [playing, setPlaying] = useState(false),
    [loading, setLoading] = useState<SamplerLoadingState>();
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
  const convertedAudition = classic && fittedAudio.current
    ? editedCompactAudition(patch, fittedAudio.current.source, fittedAudio.current.converted) : undefined;
  useEffect(() => {
    preview.current!.setPatch(classic && auditionVersion === "converted" ? prepared?.auditionPatch ?? convertedAudition ?? patch : patch);
  }, [patch, classic, prepared, auditionVersion, convertedAudition]);
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
    preview.current!.expression(pressure, bend);
  }, [pressure, bend]);
  useEffect(() => {
    client.current = transport && !classic ? new PhysicalSynthClient(transport) : undefined;
    return () => client.current?.close();
  }, [transport, classic]);
  useEffect(
    () => () => {
      preview.current?.close();
      source.current?.close();
      worker.current?.terminate();
      if (effectTimer.current) clearTimeout(effectTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (!playing) return;
    let alive = true,
      inFlight = false;
    const read = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const p = await client.current?.samplerLoading();
        if (alive) setLoading(p);
      } catch (e) {
        if (alive) setError(String(e));
      } finally {
        inFlight = false;
      }
    };
    void read();
    const t = setInterval(() => void read(), 400);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [playing]);
  const edit = (next: Patch, remember = true) => {
    if (classic && next.assets !== patchRef.current.assets) preview.current!.clear();
    if (remember) {
      setHistory((h) => [...h.slice(-39), patchRef.current]);
      setRedo([]);
    }
    setPatch({ ...next, preparedSource: undefined });
    setPrepared(undefined);
  };
  const undo = () => {
    if (!history.length) return;
    preview.current!.clear();
    setRedo((r) => [...r, patch]);
    setPatch(history.at(-1)!);
    setHistory((h) => h.slice(0, -1));
    setPrepared(undefined);
  };
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
  const zones = patch.zones ?? [],
    sample = patch.assets[selected],
    zone =
      zones[zoneIndex]?.asset === selected
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
  const wave = useMemo(
    () => (sample ? waveformPath(sample.channels[0]) : ""),
    [sample?.channels[0]],
  );
  const changeSample = (change: Partial<Recording>) => {
    if (!sample) return;
    edit({
      ...patch,
      assets: patch.assets.map((a, i) =>
        i === selected ? { ...a, ...change } : a,
      ),
    });
  };
  const changeZone = (change: Partial<Zone>) => {
    const index = zone ? zones.indexOf(zone) : -1;
    if (index >= 0)
      edit({
        ...patch,
        zones: zones.map((z, i) => (i === index ? { ...z, ...change } : z)),
      });
  };
  const waveEdit = (i: number, value: number) => {
    if (!sample) return;
    const n = Math.round(value),
      start = sample.start ?? 0,
      end = sample.end ?? sample.channels[0].length,
      ls = sample.loopStart ?? start,
      le = sample.loopEnd ?? end;
    let change: Partial<Recording> = {};
    if (i === 0) {
      const v = Math.max(0, Math.min(end - 4, n));
      change = { start: v, loopStart: Math.max(ls, v) };
    } else if (i === 1) {
      const v = Math.max(start + 4, Math.min(sample.channels[0].length, n));
      change = { end: v, loopEnd: Math.min(le, v) };
    } else if (i === 2)
      change = { loopStart: Math.max(start, Math.min(le - 1, n)) };
    else change = { loopEnd: Math.max(ls + 1, Math.min(end, n)) };
    edit(
      {
        ...patch,
        assets: patch.assets.map((a, j) =>
          j === selected ? { ...a, ...change } : a,
        ),
      },
      false,
    );
  };
  const editMap = (next: KeyMap) =>
    edit({ ...patch, zones: mappedZones(next, patch.assets.length) });
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
      const hbc = all.find((f) => /\.hbc$/i.test(f.name));
      if (hbc) { restore({ ...readCompactPatch(new Uint8Array(await hbc.arrayBuffer())), report: ["Opened Classic mono instrument."] }); return; }
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
      edit({
        ...patch,
        assets,
        zones:
          template === "instrument"
            ? automatic(assets)
            : mappedZones(assignSequentially(assets.length), assets.length),
      });
      setSelected(patch.assets.length);
      setReport([]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy("");
    }
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
        if (usb) {
          if (!compactClient) throw Error("Connect HexBoard first.");
          const slot = await compactClient.upload(result.bytes, (n,total)=>setBusy(`Copying instrument · ${Math.round(n/total*100)}%`));
          await compactClient.select(slot);
          setLibraryRevision(n=>n+1);
        } else download(result.bytes, filename(patch.name ?? "Instrument"));
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
    </label>
  );
  const selectedAssignment = map[selectedKey],
    settings = { ...defaults, ...patch.settings };
  const editingControls = (<>
      <div className="sampler-tabs" role="group" aria-label="Mapping mode">
        {(!classic ? ["instrument", "kit", "slices"] : []).map((mode) => (
          <button
            key={mode}
            aria-pressed={template === mode}
            onClick={() => {
              setTemplate(mode);
              if (mode !== "instrument" && !Object.keys(map).length)
                editMap(assignSequentially(patch.assets.length));
            }}
          >
            {mode === "instrument"
              ? "Instrument"
              : mode === "kit"
                ? "Kit"
                : "Slices"}
          </button>
        ))}
        <span>
          {patch.assets.length} recordings · {zones.length} regions · continuous
          pitch · {classic ? "native-rate mono preparation" : "pitch copies prepared on export"}
        </span>
      </div>
      <div className="sampler-studio">
        <aside className="sampler-browser">
          <h3>Recordings</h3>
          <input
            aria-label="Find recording"
            placeholder="Find a recording…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
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
                        · {noteName(a.rootMidi)}
                      </small>
                    </span>
                  </button>
                ),
            )}
          </div>
          {!patch.assets.length && (
            <p className="panel-note">
              Drop a SoundFont, an SFZ sample folder, or a recording here.
            </p>
          )}
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
        <main className="sampler-canvas">
          <fieldset className="sampler-wave-panel">
            <legend>Sample</legend>
            {sample ? (
              <>
                <div className="sampler-wave-heading">
                  <strong>{sample.name}</strong>
                  <small>
                    {sample.channels.length === 2 ? "Stereo" : "Mono"} ·{" "}
                    {(sample.rate / 1000).toFixed(1)} kHz ·{" "}
                    {sample.channels[0].length.toLocaleString()} frames
                  </small>
                </div>
                <svg
                  className="sampler-wave"
                  viewBox="0 0 560 110"
                  role="group"
                  aria-label={`Waveform of ${sample.name}`}
                >
                  <path d={wave} />
                  {[
                    sample.start ?? 0,
                    sample.end ?? sample.channels[0].length,
                    sample.loopStart ?? 0,
                    sample.loopEnd ?? sample.channels[0].length,
                  ].map((n, i) => (
                    <g
                      key={i}
                      role="slider"
                      tabIndex={0}
                      aria-label={`${["Trim start", "Trim end", "Loop start", "Loop end"][i]} handle`}
                      aria-valuenow={n}
                      aria-valuemin={0}
                      aria-valuemax={sample.channels[0].length}
                      className="sampler-wave-handle"
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId);
                        setHistory((h) => [...h.slice(-39), patch]);
                        setRedo([]);
                      }}
                      onPointerMove={(e) => {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                          const rect =
                            e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                          waveEdit(
                            i,
                            ((e.clientX - rect.left) / rect.width) *
                              sample.channels[0].length,
                          );
                        }
                      }}
                      onPointerUp={(e) => {
                        if (e.currentTarget.hasPointerCapture(e.pointerId))
                          e.currentTarget.releasePointerCapture(e.pointerId);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                          e.preventDefault();
                          setHistory((h) => [...h.slice(-39), patch]);
                          waveEdit(
                            i,
                            n +
                              (e.key === "ArrowLeft" ? -1 : 1) *
                                (e.shiftKey ? 100 : 1),
                          );
                        }
                      }}
                    >
                      <line
                        x1={(n / sample.channels[0].length) * 560}
                        x2={(n / sample.channels[0].length) * 560}
                        y1="0"
                        y2="110"
                        className={i < 2 ? "trim" : "loop"}
                      />
                      <rect
                        x={(n / sample.channels[0].length) * 560 - 5}
                        y={i < 2 ? 0 : 90}
                        width="10"
                        height="20"
                        rx="2"
                        className={i < 2 ? "trim-grip" : "loop-grip"}
                      />
                    </g>
                  ))}
                </svg>
                <div className="sampler-fields">
                  {number(
                    "Root MIDI",
                    sample.rootMidi,
                    (v) => changeSample({ rootMidi: v }),
                    0,
                    127,
                    0.01,
                  )}
                  <label>
                    Playback
                    <select
                      value={sample.mode ?? 0}
                      onChange={(e) =>
                        changeSample({ mode: +e.target.value as 0 | 1 | 2 | 3 })
                      }
                    >
                      <option value={0}>Hold / natural end</option>
                      <option value={1}>Loop + envelope release</option>
                      <option value={3}>Loop until release → tail</option>
                      <option value={2}>One shot</option>
                    </select>
                  </label>
                  {number(
                    "Trim start",
                    sample.start ?? 0,
                    (v) => changeSample({ start: Math.round(v) }),
                    0,
                    (sample.end ?? sample.channels[0].length) - 4,
                  )}
                  {number(
                    "Trim end",
                    sample.end ?? sample.channels[0].length,
                    (v) => changeSample({ end: Math.round(v) }),
                    (sample.start ?? 0) + 4,
                    sample.channels[0].length,
                  )}
                  {[1, 3].includes(sample.mode ?? 0) && (
                    <>
                      {number(
                        "Loop start",
                        sample.loopStart ?? sample.start ?? 0,
                        (v) => changeSample({ loopStart: Math.round(v) }),
                        sample.start ?? 0,
                        (sample.loopEnd ??
                          sample.end ??
                          sample.channels[0].length) - 1,
                      )}
                      {number(
                        "Loop end",
                        sample.loopEnd ??
                          sample.end ??
                          sample.channels[0].length,
                        (v) => changeSample({ loopEnd: Math.round(v) }),
                        (sample.loopStart ?? sample.start ?? 0) + 1,
                        sample.end ?? sample.channels[0].length,
                      )}
                      {number(
                        "Crossfade ms",
                        sample.crossfade ?? 0,
                        (v) => changeSample({ crossfade: v }),
                        0,
                        2000,
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="sampler-empty">
                <span>▁▃▆▃▂▇▅▂</span>
                <h3>A small sound can become something big.</h3>
                <p>Import an SF2 / SF3 bank and choose a preset to begin.</p>
              </div>
            )}
          </fieldset>
          <RegionEnvelope zones={zones} index={zone ? zones.indexOf(zone) : -1} names={patch.assets.map(a => a.name ?? "Recording")} settings={settings}
            onSelect={index => { setZoneIndex(index); setSelected(zones[index].asset); }}
            onChange={(change, all, remember) => {
              const current = patchRef.current;
              edit({ ...current, zones: changeRegionEnvelope(current.zones ?? [], zone ? zones.indexOf(zone) : -1, change, all) }, remember);
            }}/>
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
              <div className="sampler-fields">
                {zone && (
                  <>
                    {number(
                      "Low MIDI",
                      zone.lowMidi ?? -0.5,
                      (v) => changeZone({ lowMidi: v }),
                      -0.5,
                      (zone.highMidi ?? 127.5) - 0.01,
                      0.01,
                    )}
                    {number(
                      "High MIDI (exclusive)",
                      zone.highMidi ?? 127.5,
                      (v) => changeZone({ highMidi: v }),
                      (zone.lowMidi ?? -0.5) + 0.01,
                      127.5,
                      0.01,
                    )}
                    {number(
                      "Low velocity",
                      zone.velocityLow ?? 1,
                      (v) => changeZone({ velocityLow: v }),
                      1,
                      zone.velocityHigh ?? 127,
                    )}
                    {number(
                      "High velocity",
                      zone.velocityHigh ?? 127,
                      (v) => changeZone({ velocityHigh: v }),
                      zone.velocityLow ?? 1,
                      127,
                    )}
                  </>
                )}
                <button
                  disabled={!sample}
                  onClick={() =>
                    edit({ ...patch, zones: automatic(patch.assets) })
                  }
                >
                  Map by root notes
                </button>
                <button
                  disabled={
                    !zone ||
                    (zone.velocityHigh ?? 127) <= (zone.velocityLow ?? 1)
                  }
                  onClick={() => {
                    if (!zone) return;
                    const mid = Math.floor(
                      ((zone.velocityLow ?? 1) + (zone.velocityHigh ?? 127)) /
                        2,
                    );
                    edit({
                      ...patch,
                      zones: [
                        ...zones.map((z) =>
                          z === zone ? { ...z, velocityHigh: mid } : z,
                        ),
                        { ...zone, velocityLow: mid + 1 },
                      ],
                    });
                    setZoneIndex(zones.length);
                  }}
                >
                  Split velocity layer
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
                  Drag recordings onto HexBoard keys. Select a key to assign its
                  sound and color.
                </p>
                {template === "slices" && (
                  <div className="sampler-fields">
                    {number("Slices", slices, setSlices, 2, 64)}
                    <button
                      disabled={!sample}
                      onClick={() => {
                        try {
                          const assets = sliceRecording(sample, slices);
                          edit({
                            ...patch,
                            assets,
                            zones: mappedZones(
                              assignSequentially(assets.length),
                              assets.length,
                            ),
                          });
                          setSelected(0);
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                    >
                      Slice recording
                    </button>
                  </div>
                )}
                <label>
                  Key {selectedKey + 1}
                  <select
                    value={selectedAssignment?.asset ?? ""}
                    onChange={(e) => {
                      const next = { ...map };
                      if (e.target.value === "") delete next[selectedKey];
                      else
                        next[selectedKey] = {
                          asset: +e.target.value,
                          color: next[selectedKey]?.color ?? "#658eda",
                        };
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
                  Key color
                  <input
                    type="color"
                    disabled={!selectedAssignment}
                    value={selectedAssignment?.color ?? "#658eda"}
                    onChange={(e) =>
                      editMap({
                        ...map,
                        [selectedKey]: {
                          ...selectedAssignment,
                          color: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <button
                  disabled={!sample}
                  onClick={() =>
                    editMap({
                      ...map,
                      [selectedKey]: {
                        asset: selected,
                        color: selectedAssignment?.color ?? "#658eda",
                      },
                    })
                  }
                >
                  Assign selected recording
                </button>
                <button
                  disabled={!selectedAssignment}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
                    on(
                      "mapped",
                      patch.assets[selectedAssignment?.asset]?.rootMidi ?? 60,
                      selectedKey,
                    );
                  }}
                  onPointerUp={() => off("mapped")}
                  onPointerCancel={() => off("mapped")}
                  onLostPointerCapture={() => off("mapped")}
                >
                  Hold to audition key
                </button>
                <button
                  onClick={() =>
                    editMap(assignSequentially(patch.assets.length))
                  }
                >
                  Map in order
                </button>
              </div>
              <SamplerKeyPreview
                map={map}
                names={patch.assets.map((a) => a.name ?? "Recording")}
                selected={selectedKey}
                onSelect={(key) => {
                  setSelectedKey(key);
                  if (map[key]) setSelected(map[key].asset);
                }}
                onAssign={(key, asset) => {
                  setSelectedKey(key);
                  editMap({
                    ...map,
                    [key]: { asset, color: map[key]?.color ?? "#658eda" },
                  });
                }}
              />
            </fieldset>
          )}
        </main>
        <aside className="sampler-inspector">
          <fieldset>
            <legend>Region</legend>
            {zone ? (
              <>
                <strong>{sample?.name}</strong>
                <div className="sampler-fields">
                  {number(
                    "Level",
                    zone.gain ?? 1,
                    (v) => changeZone({ gain: v }),
                    0,
                    1.99,
                    0.01,
                  )}
                  {!classic && number(
                    "Pan",
                    zone.pan ?? 0,
                    (v) => changeZone({ pan: v }),
                    -1,
                    1,
                    0.01,
                  )}
                  {number(
                    "Key tracking %",
                    (zone.keyTrack ?? 1) * 100,
                    (v) => changeZone({ keyTrack: v / 100 }),
                    0,
                    200,
                  )}
                  {!classic && number(
                    "Round robin",
                    zone.roundRobin ?? 0,
                    (v) => changeZone({ roundRobin: v }),
                    0,
                    15,
                  )}
                  {!classic && number(
                    "Choke group",
                    zone.choke ?? 0,
                    (v) => changeZone({ choke: v }),
                    0,
                    16,
                  )}
                </div>
                <details>
                  <summary>{classic ? "Delay & hold" : "Timing & tone"}</summary>
                  <div className="sampler-fields">
                    {(
                      [
                        "delay",
                        "hold",
                        "cutoff",
                      ] as const
                    ).filter(key => !classic || key !== "cutoff").map((key) =>
                      number(
                        key,
                        zone[key] ??
                          (key in settings
                            ? settings[key as keyof Settings]
                            : 0) ??
                          0,
                        (v) => changeZone({ [key]: v }),
                        key === "cutoff" ? 40 : 0,
                        key === "delay" ? 10000 : 20000,
                        1,
                      ),
                    )}
                    {!classic && <label>
                      Velocity curve
                      <select
                        value={zone.velocityCurve ?? 0}
                        onChange={(e) =>
                          changeZone({ velocityCurve: +e.target.value })
                        }
                      >
                        <option value={0}>Linear</option>
                        <option value={1}>Squared</option>
                        <option value={2}>Constant / pressure</option>
                        <option value={103}>SFZ 100%</option>
                      </select>
                    </label>}
                  </div>
                </details>
                <button
                  onClick={() =>
                    edit({ ...patch, zones: zones.filter((z) => z !== zone) })
                  }
                >
                  Remove region
                </button>
              </>
            ) : (
              <p className="panel-note">Select a region on the map.</p>
            )}
          </fieldset>
          {!classic && <fieldset>
            <legend>Patch response</legend>
            <label>
              Velocity engine
              <select
                value={patch.velocityEngine ?? 0}
                onChange={(e) =>
                  edit({ ...patch, velocityEngine: +e.target.value })
                }
              >
                {[
                  "Threshold Strike",
                  "Expressive",
                  "Distance",
                  "Gesture",
                  "Fixed",
                ].map((label, i) => (
                  <option value={i} key={label}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              aria-pressed={!!patch.performance?.values[0]}
              onClick={() => setArpOpen(true)}
            >
              Arpeggiator · {patch.performance?.values[0] ? "On" : "Off"}
            </button>
            <p className="panel-note">
              Saved with the patch. HexBoard’s global Follow preset setting
              controls velocity-engine recall.
            </p>
          </fieldset>}
        </aside>
      </div>
      <div className="sampler-shaping">
        {[
          {
            title: "Touch & tone",
            controls: [
              ["cutoff", "Tone", 40, 20000, "Hz"],
              ["pressure", "Pressure → tone", 0, 1, ""],
              ["pressureGain", "Pressure → level", 0, 1, ""],
              ["space", "Reverb", 0, 1, ""],
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
        ].filter(() => !classic).map((group) => (
          <fieldset key={group.title}>
            <legend>{group.title}</legend>
            {group.title === "Touch & tone" && (
              <button
                type="button"
                aria-pressed={settings.space > 0}
                onClick={() => {
                  if (settings.space > 0) lastSpace.current = settings.space;
                  global("space", settings.space > 0 ? 0 : lastSpace.current);
                  gesture.current = false;
                }}
              >
                Room reverb · {settings.space > 0 ? "On" : "Off"}
              </button>
            )}
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
                    {settings[k as keyof Settings].toFixed(
                      Number(max) <= 4 ? 2 : 0,
                    )}{" "}
                    {unit}
                  </output>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
  </>);
  const auditionControls = (
      <fieldset className="sampler-audition">
        <legend>{classic ? "Compare & audition" : "Browser audition · edited instrument"}</legend>
        {classic && <div className="sampler-tabs" role="group" aria-label="Audition version">
          {(["source", "converted"] as const).map(version => <button key={version} aria-pressed={auditionVersion === version} disabled={version === "converted" && !prepared && !convertedAudition} onClick={() => { preview.current!.clear(); setAuditionVersion(version); }}>
            {version === "source" ? "Original recordings" : "Converted for HexBoard"}
          </button>)}
        </div>}
        <div className="sampler-fields">
          {number("Octave", octave, setOctave, 0, 6)}
          {number("Strike velocity", velocity, setVelocity, 1, 127)}
          {!classic && number("Release velocity", lift, setLift, 0, 127)}
          {!classic && <label>
            Pressure
            <input
              aria-label="Audition pressure"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={pressure}
              onChange={(e) => setPressure(+e.target.value)}
            />
          </label>}
          <label>
            Pitch bend ±2
            <input
              aria-label="Pitch bend"
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={bend}
              onChange={(e) => setBend(+e.target.value)}
              onDoubleClick={() => setBend(0)}
            />
          </label>
          {!classic && <button
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              preview.current!.pedal(true);
            }}
            onPointerUp={() => preview.current!.pedal(false)}
            onPointerCancel={() => preview.current!.pedal(false)}
            onLostPointerCapture={() => preview.current!.pedal(false)}
          >
            Hold sustain
          </button>}
        </div>
        <div className="sampler-keyboard">
          {Array.from({ length: 25 }, (_, i) => octave * 12 + 12 + i).map(
            (note) => (
              <button
                className={[1, 3, 6, 8, 10].includes(note % 12) ? "black" : ""}
                disabled={!patch.assets.length || template !== "instrument" || (classic && auditionVersion === "converted" && !prepared && !convertedAudition)}
                key={note}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  on(`key-${note}`, note);
                }}
                onPointerUp={() => off(`key-${note}`)}
                onPointerCancel={() => off(`key-${note}`)}
                onLostPointerCapture={() => off(`key-${note}`)}
                onKeyDown={(e) => {
                  if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                    e.preventDefault();
                    on(`key-${note}`, note);
                  }
                }}
                onKeyUp={(e) => {
                  if (e.key === " " || e.key === "Enter") off(`key-${note}`);
                }}
              >
                {noteName(note)}
              </button>
            ),
          )}
        </div>
        <p className="panel-note">
          {classic ? (prepared ? "Compare the original recordings with the prepared instrument. Browser interpolation and output protection differ from the board." : "Conversion updates automatically. Envelope edits can be auditioned immediately; sample edits finish preparing in the background.") : "Hold a note while shaping tone and pressure. New notes use edited mappings, loops and envelopes. Browser effects and interpolation differ slightly from the device."}
        </p>
      </fieldset>
  );
  return (
    <section
      className="physical-editor card sampler-editor"
      aria-label="Sampler editor"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (!busy && e.dataTransfer.files.length)
          void importFiles(e.dataTransfer.files);
      }}
    >
      <div className="instrument-title">
        <h2>Sampler</h2>
        <span>{classic ? "One instrument · eight voices" : "Recordings into instruments"}</span>
        <p>{busy || "Audition here. Copy when it feels right."}</p>
      </div>
      <div className="sampler-toolbar">
        <input
          aria-label="Instrument name"
          value={patch.name ?? ""}
          maxLength={32}
          onChange={(e) => edit({ ...patch, name: e.target.value }, false)}
        />
        <label className="sampler-file primary">
          Import SoundFont / samples
          <input
            type="file"
            multiple
            accept={classic ? ".sf2,.sf3,.sfz,.wav,.hbs,.hbc" : ".sf2,.sf3,.sfz,.wav,.hbs"}
            disabled={!!busy}
            onChange={(e) => {
              void importFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="sampler-file">
          Import SFZ folder
          <input
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
        <button disabled={!history.length || !!busy} onClick={undo}>
          Undo
        </button>
        <button
          disabled={!redo.length || !!busy}
          onClick={() => {
            preview.current!.clear();
            setHistory((h) => [...h, patch]);
            setPatch(redo.at(-1)!);
            setRedo((r) => r.slice(0, -1));
            setPrepared(undefined);
          }}
        >
          Redo
        </button>
        <button onClick={() => preview.current!.clear()}>All notes off</button>
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
          <button disabled={!prepared || !!busy} onClick={() => void exportPatch()}>Save HBC file</button>
        </div>
      </section>}
      {(error || preparationError) && <p className="sampler-error" role="alert">{error || preparationError}</p>}
      {classic && auditionControls}
      {editingControls}
      {!classic && auditionControls}
      <div className="sampler-bottom">
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
              Copy small patch over USB
            </button>
          </div>
          <p className="panel-note">
            {prepared ? `${bytes(prepared.bytes.length)} prepared. ` : ""}For
            larger instruments, copy the HBS file into a named folder under
            sampler/instruments on your SD card. USB uses the folder above;
            existing names are protected. Use another named folder when one
            reaches 32 instruments.
          </p>
        </fieldset>}
        {classic && <ClassicSamplerLibrary transport={transport} revision={libraryRevision} download={download} locked={!!busy}/>}
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
            A warm stereo room. Patch Reverb above is included in exported
            sounds; the HexBoard control auditions the selected SD instrument.
          </p>
          {playing && <p role="status">{samplerLoadingLabel(loading)}</p>}
        </fieldset>}
      </div>
      {report.length > 0 && (
        <details className="sampler-report" open={!classic}>
          <summary>
            Import / conversion report · {report.length}{" "}
            {report.length === 1 ? "change" : "changes"}
          </summary>
          <ul>
            {report.map((line, i) => (
              <li key={i}>{line}</li>
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
      {busy && (
        <p role="status" aria-live="polite">
          {busy}
        </p>
      )}
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

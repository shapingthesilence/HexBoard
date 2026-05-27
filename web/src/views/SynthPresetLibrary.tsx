import { useMemo, useState } from "react";
import { createSynthPresetCatalog, createSynthPresetObject, deterministicObjectId, sampleSynthCatalog } from "../catalogs/index.ts";
import { crc32 } from "../protocol/crc32.ts";
import { formatByteLength, formatHex } from "./format.ts";

export function SynthPresetLibrary() {
  const [selectedFolder, setSelectedFolder] = useState("Pads/Warm");
  const [draftName, setDraftName] = useState("Soft String Pad");
  const [favorite, setFavorite] = useState(true);

  const draftPreset = useMemo(
    () =>
      createSynthPresetObject({
        objectId: deterministicObjectId(`synth:${selectedFolder}:${draftName}`),
        name: draftName,
        folderPath: selectedFolder,
        category: selectedFolder.includes("Pad") ? "Pad" : "Lead",
        favorite,
        values: {
          PlaybackMode: selectedFolder.includes("Lead") ? 1 : 3,
          Waveform: selectedFolder.includes("Lead") ? 3 : 6,
          SynthDrive: selectedFolder.includes("Lead") ? 2 : 0,
          SynthModTarget: 0,
          SynthModAmount: 127,
          SynthVibratoSpeed: 5,
          EnvelopeAttackIndex: selectedFolder.includes("Lead") ? 0 : 12,
          EnvelopeHoldIndex: 0,
          EnvelopeDecayIndex: 8,
          EnvelopeSustainLevel: 96,
          EnvelopeReleaseIndex: selectedFolder.includes("Lead") ? 5 : 14
        }
      }),
    [draftName, favorite, selectedFolder]
  );

  const catalog = useMemo(
    () => createSynthPresetCatalog([...sampleSynthCatalog.presets, draftPreset]),
    [draftPreset]
  );

  const folders = Array.from(new Set(["Pads/Warm", "Leads", ...catalog.folders])).sort();
  const visiblePresets = catalog.presets.filter((preset) => preset.folderPath === selectedFolder);

  return (
    <section className="workspace">
      <aside className="panel stack">
        <h2>Folders</h2>
        <ul className="list">
          {folders.map((folder) => (
            <li className="listItem" key={folder}>
              <button
                className={folder === selectedFolder ? "primary" : ""}
                type="button"
                onClick={() => setSelectedFolder(folder)}
              >
                {folder}
              </button>
              <span>{catalog.presets.filter((preset) => preset.folderPath === folder).length}</span>
            </li>
          ))}
        </ul>
      </aside>

      <div className="panel stack">
        <h2>Synth Presets</h2>
        <div className="fieldGrid">
          <label className="field">
            <span>Draft name</span>
            <input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
          </label>
          <label className="field">
            <span>Folder</span>
            <input value={selectedFolder} onChange={(event) => setSelectedFolder(event.target.value)} />
          </label>
          <label className="field">
            <span>Favorite</span>
            <select value={favorite ? "yes" : "no"} onChange={(event) => setFavorite(event.target.value === "yes")}>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        </div>
        <ul className="list">
          {visiblePresets.map((preset) => (
            <li className="listItem" key={`${preset.folderPath}/${preset.name}`}>
              <div>
                <strong>{preset.name}</strong>
                <span>
                  {formatByteLength(preset.body)} CRC {crc32(preset.body).toString(16).toUpperCase()}
                </span>
              </div>
              <span>{preset.folderPath}</span>
            </li>
          ))}
        </ul>
        <pre className="dataPreview">{formatHex(draftPreset.body)}</pre>
      </div>
    </section>
  );
}


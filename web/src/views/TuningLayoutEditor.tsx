import { useMemo, useState } from "react";
import { ObjectType } from "../protocol/constants.ts";
import { crc32 } from "../protocol/crc32.ts";
import {
  createGeneratedEdoTuning,
  createScaleColorMap,
  createVectorLayout,
  deterministicObjectId,
  objectIdToHex,
  sampleLayoutsCatalog
} from "../catalogs/index.ts";
import { formatByteLength, formatHex } from "./format.ts";

export function TuningLayoutEditor() {
  const [name, setName] = useState("19 EDO");
  const [edoDivisions, setEdoDivisions] = useState(19);
  const [centerButton, setCenterButton] = useState(65);
  const [acrossSteps, setAcrossSteps] = useState(3);
  const [downLeftSteps, setDownLeftSteps] = useState(-11);
  const [portrait, setPortrait] = useState(true);

  const tuning = useMemo(
    () =>
      createGeneratedEdoTuning({
        objectId: deterministicObjectId(`tuning:${name}:${edoDivisions}`),
        name,
        edoDivisions
      }),
    [edoDivisions, name]
  );

  const layout = useMemo(
    () =>
      createVectorLayout({
        objectId: deterministicObjectId(`layout:${name}:${centerButton}:${acrossSteps}:${downLeftSteps}`),
        name: `${name} Vector`,
        tuningRef: {
          objectType: ObjectType.UserTuning,
          handle: 0,
          objectId: tuning.objectId
        },
        centerButton,
        acrossSteps,
        downLeftSteps,
        portrait
      }),
    [acrossSteps, centerButton, downLeftSteps, name, portrait, tuning.objectId]
  );

  const colorMap = useMemo(
    () =>
      createScaleColorMap({
        objectId: deterministicObjectId(`colors:${name}`),
        name: `${name} Degree Colors`,
        tuningRef: {
          objectType: ObjectType.UserTuning,
          handle: 0,
          objectId: tuning.objectId
        },
        cycleLength: edoDivisions,
        defaultColorMode: 0,
        degreeColors: [
          { degree: 0, hueTenthDegrees: 0, saturation: 220, value: 210 },
          { degree: Math.floor(edoDivisions / 3), hueTenthDegrees: 1200, saturation: 200, value: 205 },
          { degree: Math.floor((edoDivisions * 2) / 3), hueTenthDegrees: 2400, saturation: 205, value: 215 }
        ]
      }),
    [edoDivisions, name, tuning.objectId]
  );

  const preview = `Tuning ${formatByteLength(tuning.body)} CRC ${crc32(tuning.body).toString(16).toUpperCase()}
Layout ${formatByteLength(layout.body)} CRC ${crc32(layout.body).toString(16).toUpperCase()}
Color map ${formatByteLength(colorMap.body)} CRC ${crc32(colorMap.body).toString(16).toUpperCase()}

${formatHex(tuning.body)}`;

  return (
    <section className="workspace">
      <aside className="panel stack">
        <h2>Generated Tuning</h2>
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="field">
          <span>EDO divisions</span>
          <input
            min={5}
            max={127}
            type="number"
            value={edoDivisions}
            onChange={(event) => setEdoDivisions(Number(event.target.value))}
          />
        </label>
        <div className="status">Object {objectIdToHex(tuning.objectId).slice(0, 12)}</div>
      </aside>

      <div className="panel stack">
        <h2>Vector Layout</h2>
        <div className="fieldGrid">
          <label className="field">
            <span>Center button</span>
            <input
              min={0}
              max={139}
              type="number"
              value={centerButton}
              onChange={(event) => setCenterButton(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Across steps</span>
            <input type="number" value={acrossSteps} onChange={(event) => setAcrossSteps(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Down-left steps</span>
            <input
              type="number"
              value={downLeftSteps}
              onChange={(event) => setDownLeftSteps(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Orientation</span>
            <select value={portrait ? "portrait" : "landscape"} onChange={(event) => setPortrait(event.target.value === "portrait")}>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </label>
        </div>

        <h3>Catalog</h3>
        <ul className="list">
          <li className="listItem">
            <strong>Tunings</strong>
            <span>{sampleLayoutsCatalog.tunings.length + 1}</span>
          </li>
          <li className="listItem">
            <strong>Layouts</strong>
            <span>{sampleLayoutsCatalog.layouts.length + 1}</span>
          </li>
          <li className="listItem">
            <strong>Scale colors</strong>
            <span>{sampleLayoutsCatalog.scaleColorMaps.length + 1}</span>
          </li>
        </ul>
        <pre className="dataPreview">{preview}</pre>
      </div>
    </section>
  );
}


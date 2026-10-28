import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { RegionEnvelope, regionEnvelope, changeRegionEnvelope } from "./RegionEnvelope.tsx";
import { editedCompactAudition } from "./preview.ts";
import type { Patch, Zone } from "./prepare.mjs";

describe("Direct region ADSR editing", () => {
  const zones: Zone[] = [{ asset: 0, attack: 0, sustain: 0, gain: .4 }, { asset: 1, attack: 200, release: 900, lowMidi: 60 }];
  it("resolves inherited envelopes without replacing explicit zero values", () => {
    expect(regionEnvelope(zones[0], { attack: 50, decay: 100, sustain: 1, release: 200 })).toEqual({ attack: 0, decay: 100, sustain: 0, release: 200 });
  });
  it("edits the selected region or all regions without altering mapping/gain", () => {
    const selected = changeRegionEnvelope(zones, 1, { attack: 12, gain: 1 }, false);
    expect(selected[0]).toBe(zones[0]); expect(selected[1]).toEqual({ ...zones[1], attack: 12 });
    const all = changeRegionEnvelope(zones, 0, regionEnvelope(zones[0], {}), true);
    expect(all[1].attack).toBe(0); expect(all[1].sustain).toBe(0); expect(all[1].lowMidi).toBe(60); expect(all[0].gain).toBe(.4);
    expect(zones[1].attack).toBe(200);
  });
  it("keeps ADSR, precise units, region selection and apply-all visible", () => {
    const html = renderToStaticMarkup(createElement(RegionEnvelope, { zones, index: 0, names: ["Low", "High"], settings: {}, onSelect: () => {}, onChange: () => {} }));
    for (const name of ["Region ADSR", "Envelope region", "Copy ADSR to all", "Edit all regions", "Region attack ms", "Region sustain percent", "ADSR envelope shape"]) expect(html).toContain(name);
    expect(html).not.toContain("<details");
  });
  it("auditions envelope changes immediately using the already converted PCM", () => {
    const original: Patch = { assets: [], zones };
    const converted: Patch = { assets: [], zones: zones.map(z => ({ ...z, asset: 1 - z.asset })) };
    const edited = { ...original, zones: changeRegionEnvelope(zones, 0, { attack: 25, release: 0 }, false) };
    const preview = editedCompactAudition(edited, original, converted)!;
    expect(preview.assets).toBe(converted.assets); expect(preview.zones![0].asset).toBe(1);
    expect(preview.zones![0].attack).toBe(25); expect(preview.zones![0].release).toBe(4);
    expect(editedCompactAudition({ ...edited, assets: [] }, original, converted)).toBeUndefined();
    expect(editedCompactAudition({ ...edited, zones: [zones[1], zones[0]] }, original, converted)).toBeUndefined();
  });
});

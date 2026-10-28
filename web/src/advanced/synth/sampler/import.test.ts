import { reverbImpulse } from "./reverb.mjs";
import sf3Fixture from "./fixtures/synthetic-sf3.json";
import { describe, it, expect } from "vitest";
import {
  BasicSoundBank,
  BasicSample,
  BasicInstrument,
  BasicPreset,
  GeneratorTypes as G,
} from "spessasynth_core";
import {
  directSoundFont,
  openSoundFont,
  validateRIFF,
  bakeSoundFont,
  sfzRegions,
  sfzNote,
  expandSFZ,
  importSFZ,
} from "./import.mjs";
import { readBank } from "./bank.mjs";
import { preparePatch } from "./prepare.mjs";
import {
  defaultPerformance,
  performanceRecord,
  decodePerformance,
} from "./encode.mjs";
import { releaseSeconds } from "./preview.ts";
function fixture(layered = false) {
  const bank = new BasicSoundBank(),
    sample = new BasicSample("Odd game loop", 22050, 60, 7, 1, 3, 103);
  sample.setAudioData(
    Float32Array.from(
      { length: 111 },
      (_, i) => 0.4 * Math.sin((i * 2 * Math.PI) / 25),
    ),
    22050,
  );
  const inst = new BasicInstrument();
  inst.name = "Fixture";
  const z = inst.createZone(sample);
  z.setGenerator(G.sampleModes, 3);
  z.keyRange.min = 60;
  z.keyRange.max = 64;
  z.velRange.min = 20;
  z.velRange.max = 100;
  z.setGenerator(G.scaleTuning, 50);
  inst.globalZone.setGenerator(G.attackVolEnv, -1200);
  const p = new BasicPreset(bank);
  p.name = "Synthetic orchestra";
  p.program = 7;
  p.createZone(inst);
  if (layered) p.createZone(inst);
  bank.addSamples(sample);
  bank.addInstruments(inst);
  bank.addPresets(p);
  return bank;
}
function wave() {
  const b = new ArrayBuffer(44 + 128 * 2),
    v = new DataView(b),
    u = new Uint8Array(b);
  for (const [at, s] of [
    [0, "RIFF"],
    [8, "WAVE"],
    [12, "fmt "],
    [36, "data"],
  ] as const)
    u.set(new TextEncoder().encode(s), at);
  v.setUint32(4, b.byteLength - 8, true);
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 22050, true);
  v.setUint32(28, 44100, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  v.setUint32(40, 256, true);
  return b;
}
describe("Sampler source conversion", () => {
  it("builds a finite stereo room tail and softer default lift response", () => {
    const impulse = reverbImpulse();
    let first = 0,
      last = 0,
      difference = 0;
    for (let i = 0; i < impulse[0].length; i++) {
      expect(Number.isFinite(impulse[0][i])).toBe(true);
      if (i < 44100) first += impulse[0][i] ** 2 + impulse[1][i] ** 2;
      if (i > 132300) last += impulse[0][i] ** 2 + impulse[1][i] ** 2;
      difference += Math.abs(impulse[0][i] - impulse[1][i]);
    }
    expect(first).toBeGreaterThan(0.01);
    expect(last).toBeLessThan(first * 0.01);
    expect(difference).toBeGreaterThan(0.1);
    expect(
      releaseSeconds({ release: 1000 }, { asset: 0 }, 127),
    ).toBeGreaterThan(0.12);
  });

  it("lists presets before conversion and rejects damaged RIFF bounds", async () => {
    const bytes = fixture().writeSF2(),
      parsed = await openSoundFont(bytes);
    expect(parsed.presets).toHaveLength(1);
    expect(parsed.presets[0].name).toBe("Synthetic orchestra");
    const damaged = bytes.slice(0);
    new DataView(damaged).setUint32(16, 0xffffffff, true);
    expect(() => validateRIFF(damaged)).toThrow(/chunk/);
  });
  it("decodes SF3 Vorbis samples before exposing the selected map", async () => {
    const b = Uint8Array.from(atob(sf3Fixture.base64), (c) => c.charCodeAt(0));
    const opened = await openSoundFont(b.buffer);
    const result = directSoundFont(opened.bank, 0);
    expect(result.patch.assets[0].channels[0].length).toBeGreaterThan(2000);
    expect(
      result.patch.assets[0].channels[0].some((x) => Math.abs(x) > 0.1),
    ).toBe(true);
  });
  it("merges inherited generators, tuning, ranges and sustain-loop endpoints", () => {
    const r = directSoundFont(fixture(), 0);
    expect(r.complex).toBe(false);
    expect(r.patch.assets[0].loopStart).toBe(3);
    expect(r.patch.assets[0].loopEnd).toBe(103);
    expect(r.patch.assets[0].rate).toBeCloseTo(22050 * 2 ** (7 / 1200));
    expect(r.patch.zones![0]).toMatchObject({
      lowMidi: 59.5,
      highMidi: 64.5,
      velocityLow: 20,
      velocityHigh: 100,
      keyTrack: 0.5,
      attack: 500,
    });
  });
  it("reports simultaneous layers and renders an audible adapted patch", async () => {
    const b = fixture(true);
    expect(directSoundFont(b, 0).complex).toBe(true);
    const p = await bakeSoundFont(b, 0, () => {}, { layers: 1, seconds: 0.1 });
    expect(p.report.join(" ")).toContain("layers");
    expect(p.assets.length).toBeGreaterThan(0);
    expect(b.presets).toHaveLength(1);
    expect(directSoundFont(b, 0).patch.assets.length).toBeGreaterThan(0);
    expect(
      p.assets.some((a) => a.channels[0].some((x) => Math.abs(x) > 0.0001)),
    ).toBe(true);
  }, 30000);
  it("parses SFZ section inheritance and note spellings", () => {
    expect(sfzNote("Db4")).toBe(61);
    expect(
      sfzRegions(
        "<control> default_path=Samples/\n<global> ampeg_release=1\n<group> lovel=20\n<region> sample=Cello soft.wav key=C4\n<region> sample=Other.wav key=D4",
      ),
    ).toEqual([
      {
        default_path: "Samples/",
        ampeg_release: "1",
        lovel: "20",
        sample: "Cello soft.wav",
        key: "C4",
      },
      {
        default_path: "Samples/",
        ampeg_release: "1",
        lovel: "20",
        sample: "Other.wav",
        key: "D4",
      },
    ]);
  });
  it("resolves includes/macros and case-insensitive paths; errors name missing files", async () => {
    const files = new Map([
      [
        "bank/main.sfz",
        new File(['#define $S Samples/\n#include "map.sfz"'], "main.sfz"),
      ],
      [
        "bank/map.sfz",
        new File(
          [
            "<control> default_path=$S\n<region> sample=cellO.wav key=C4 loop_mode=loop_sustain loop_start=5 loop_end=100 ampeg_release=0.8",
          ],
          "map.sfz",
        ),
      ],
      ["bank/samples/cello.wav", new File([wave()], "Cello.wav")],
    ]);
    const patch = await importSFZ("bank/main.sfz", files);
    expect(patch.assets[0]).toMatchObject({
      mode: 3,
      loopStart: 5,
      loopEnd: 101,
    });
    expect(patch.zones![0].release).toBe(800);
    files.delete("bank/samples/cello.wav");
    await expect(importSFZ("bank/main.sfz", files)).rejects.toThrow(
      /Missing recording/,
    );
    files.set("bank/map.sfz", new File(['#include "main.sfz"'], "map.sfz"));
    await expect(expandSFZ("bank/main.sfz", files)).rejects.toThrow(
      /Recursive/,
    );
  });
  it("round trips v3 response/arp and source loop settings", async () => {
    const perf = defaultPerformance();
    perf.values[0] = 1;
    perf.steps[2].ratchets = 3;
    const p = await preparePatch({
      name: "Round trip",
      assets: [
        {
          name: "a",
          channels: [new Float32Array(1024)],
          rate: 44100,
          rootMidi: 60,
          mode: 3,
          loopStart: 128,
          loopEnd: 640,
        },
      ],
      zones: [
        {
          asset: 0,
          lowMidi: 50,
          highMidi: 70,
          attack: 123,
          decay: 450,
          sustain: 0.6,
          delay: 25,
          hold: 80,
          keyTrack: 0.5,
        },
      ],
      velocityEngine: 1,
      performance: perf,
      settings: { pressureGain: 0.75, fastRelease: 60, pedalRelease: 140 },
    });
    const decoded = readBank(p.bytes);
    expect(new DataView(p.bytes.buffer).getUint16(4, true)).toBe(3);
    expect(decoded.velocityEngine).toBe(1);
    expect(decoded.performance).toEqual(perf);
    expect(decoded.settings!.pressureGain).toBeCloseTo(0.75, 4);
    expect(decoded.assets[0].mode).toBe(3);
    expect(decoded.zones![0]).toMatchObject({
      attack: 123,
      decay: 450,
      delay: 25,
      hold: 80,
      keyTrack: 0.5,
    });
    const damaged = performanceRecord(1, perf);
    damaged[5] ^= 1;
    expect(() => decodePerformance(damaged)).toThrow(/checksum/);
  });
  it("keeps very short interior loops exportable at wide stretches", async () => {
    const p = await preparePatch({
      storage: "streaming",
      zones: [{ asset: 0, lowMidi: 0, highMidi: 117.5 }],
      assets: [
        {
          channels: [new Float32Array(256)],
          rate: 44100,
          rootMidi: 60,
          mode: 1,
          loopStart: 240,
          loopEnd: 256,
        },
      ],
    });
    const parsed = readBank(p.bytes);
    expect(
      parsed.assets.some((a) => (a.loopEnd ?? 0) - (a.loopStart ?? 0) < 4),
    ).toBe(true);
    expect(parsed.assets.every((a) => a.channels[0].length >= 4)).toBe(true);
  });
  it("rejects silently overlapping raw regions", async () => {
    await expect(
      preparePatch({
        assets: [
          { channels: [new Float32Array(32)], rate: 44100, rootMidi: 60 },
        ],
        zones: [{ asset: 0 }, { asset: 0 }],
      }),
    ).rejects.toThrow(/overlap/);
  });
  it("renders simultaneous SFZ layers with a change report", async () => {
    const files = new Map([
      [
        "layers.sfz",
        new File(
          [
            "<group> key=C4 loop_mode=no_loop <region> sample=a.wav <region> sample=a.wav volume=-6",
          ],
          "layers.sfz",
        ),
      ],
      ["a.wav", new File([wave()], "a.wav")],
    ]);
    const p = await importSFZ("layers.sfz", files);
    expect(p.report.join(" ")).toContain("Simultaneous SFZ");
    expect(p.zones![0].lowMidi).toBe(59.5);
    expect(p.zones![0].highMidi).toBe(60.5);
  }, 30000);
  it("uses release velocity and separate sustain-pedal damping", () => {
    expect(
      releaseSeconds(
        { release: 1000, fastRelease: 60, releaseResponse: 1 },
        { asset: 0 },
        0,
      ),
    ).toBeCloseTo(1);
    expect(
      releaseSeconds(
        { release: 1000, fastRelease: 60, releaseResponse: 1 },
        { asset: 0 },
        127,
      ),
    ).toBeCloseTo(0.06);
    expect(
      releaseSeconds(
        { release: 1000, pedalRelease: 140 },
        { asset: 0 },
        0,
        true,
      ),
    ).toBeCloseTo(0.14);
    expect(
      releaseSeconds({ release: 1000, releaseResponse: 0 }, { asset: 0 }, 127),
    ).toBeCloseTo(1);
  });
  it("protects a single wide sample with continuous region boundaries and reports character mode", async () => {
    const asset = {
      channels: [
        Float32Array.from({ length: 441 }, (_, i) => 0.2 * Math.sin(i * 0.2)),
      ],
      rate: 44100,
      rootMidi: 60,
      mode: 1 as const,
    };
    for (const quality of ["balanced", "clean", "character"] as const) {
      const p = await preparePatch({
        assets: [asset],
        zones: [{ asset: 0, lowMidi: 0, highMidi: 108 }],
        storage: "streaming",
        pitchQuality: quality,
      });
      const b = readBank(p.bytes),
        zs = b.zones!;
      expect(zs[0].lowMidi).toBeCloseTo(0);
      expect(zs.at(-1)!.highMidi).toBeCloseTo(108);
      for (let i = 1; i < zs.length; i++)
        expect(zs[i].lowMidi).toBeCloseTo(zs[i - 1].highMidi!, 5);
      expect(p.warnings.join(" ").includes("Character")).toBe(
        quality === "character",
      );
    }
  }, 30000);
});

import {renderToStaticMarkup} from "react-dom/server";
import {expect, test} from "vitest";
import {PianoMixPanel} from "./PianoMixPanel.tsx";
import {preparePatch} from "./prepare.mjs";
import {readBank} from "./bank.mjs";
import {decodePianoMix, encodePianoMix, pianoMixDefaults} from "./pianoMix.mjs";

test("piano levels round trip at the HBS boundary; legacy banks get quiet defaults", async () => {
  expect(decodePianoMix(1)).toEqual(pianoMixDefaults);
  const authored = {...pianoMixDefaults, pianoKeyNoise: 0, pianoResonance: 127};
  expect(() => encodePianoMix(true, {...authored, pianoKeyNoise: 122})).toThrow(/mixer/);
  const recording = {rootMidi: 60, rate: 44100, channels: [Float32Array.from({length: 4096}, (_, n) => .2 * Math.sin(n * .04))]};
  for (const storage of ["resident","streaming"] as const) {
    const result = await preparePatch({storage, assets: [recording], settings: {pianoDamper: 1, ...authored}});
    expect(readBank(result.bytes).settings).toMatchObject(authored);
    expect(new DataView(result.bytes.buffer).getUint32(44, true) & 1).toBe(+(storage === "streaming"));
  }
});

test("piano audition exposes separate room and resonance bypass and accessible levels", () => {
  const markup = renderToStaticMarkup(<PianoMixPanel mix={pianoMixDefaults}
    room={{amount: .2, onChange: () => {}, onToggle: () => {}}}/>);
  expect(markup).toContain('aria-pressed="true">Room</button>');
  expect(markup).toContain('aria-pressed="true">Sympathetic resonance</button>');
  expect(markup).toMatch(/aria-label="Key return"[^>]*aria-valuetext="-20.0 dB"/);
  expect(markup).toMatch(/aria-label="Pedal noise"[^>]*aria-valuetext="-22.0 dB"/);
  expect(markup).toMatch(/aria-label="Room amount"[^>]*aria-valuetext="20%"/);
});

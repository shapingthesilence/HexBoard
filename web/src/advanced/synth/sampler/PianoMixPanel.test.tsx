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

test("piano mix strips expose bypass, accessible faders and the diagram", () => {
  const markup = renderToStaticMarkup(<PianoMixPanel mix={{...pianoMixDefaults, pianoKeyNoise: 0}}
    room={{amount: .2, onChange: () => {}, onToggle: () => {}}}/>);
  expect(markup).toMatch(/aria-pressed="true" aria-label="Room amount on">On<\/button>/);
  expect(markup).toMatch(/aria-pressed="true" aria-label="Resonance on">On<\/button>/);
  expect(markup).toMatch(/aria-pressed="false" aria-label="Key return on">Off<\/button>/);
  expect(markup).toMatch(/role="slider"[^>]*aria-label="Key return"[^>]*aria-valuetext="Off"/);
  expect(markup).toMatch(/role="slider"[^>]*aria-label="Pedal noise"[^>]*aria-valuetext="-22.0 dB"/);
  expect(markup).toMatch(/role="slider"[^>]*aria-label="Resonance"[^>]*aria-valuemax="127"/);
  expect(markup).toMatch(/role="slider"[^>]*aria-label="Room amount"[^>]*aria-valuetext="20%"/);
  expect(markup).toContain('aria-label="Piano sound sources"');
  // Solo is a live firmware audition, so the offline editor never offers it.
  expect(markup).not.toContain(">Solo</button>");
});

test("resonance boost and live solo are marked in the strip and diagram", () => {
  const markup = renderToStaticMarkup(<PianoMixPanel mix={{...pianoMixDefaults, pianoResonance: 127}}
    solo={{active: true, onToggle: () => {}}}/>);
  expect(markup).toMatch(/aria-pressed="true"[^>]*>\+36 dB<\/button>/);
  expect(markup).toMatch(/aria-pressed="true"[^>]*>Solo<\/button>/);
  expect(markup).toContain('class="is-audition">+36.0 dB</output>');
  expect(markup).toContain("piano-diagram is-solo is-boosted");
  expect(markup).toMatch(/piano-strip[^"]*is-silent/);
  expect(markup).toContain("only the sympathetic strings are heard");
  const muted = renderToStaticMarkup(<PianoMixPanel mix={{...pianoMixDefaults, pianoResonance: 0}}
    solo={{active: true, onToggle: () => {}}}/>);
  expect(muted).toContain("resonance is off, so nothing is heard");
});

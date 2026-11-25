// HBS byte 44 retains its storage bit. The optional mix stores four 7-bit
// half-decibel trims, with zero reserved for mute.
export const pianoMixDefaults = Object.freeze({
  pianoKeyNoise: 57,
  pianoPedalNoise: 53,
  pianoStringRelease: 97,
  pianoResonance: 97,
});
export const pianoMixKeys = Object.freeze(Object.keys(pianoMixDefaults));
export const pianoMixMax = 121;
export const pianoResonanceMax = 127;
export const pianoMixMaximum = key => key === "pianoResonance" ? pianoResonanceMax : pianoMixMax;
export const pianoMixParameter = 22;

export function decodePianoMix(descriptor) {
  if (!(descriptor & 0x80000000)) {
    if (descriptor > 1) throw Error("Invalid piano mix descriptor.");
    return {...pianoMixDefaults};
  }
  if (descriptor & 0x60000000) throw Error("Invalid piano mix descriptor.");
  return Object.fromEntries(pianoMixKeys.map((key, i) => {
    const value = descriptor >>> (1 + 7 * i) & 127;
    if (value > pianoMixMaximum(key)) throw Error("Invalid piano mixer level.");
    return [key, value];
  }));
}

export function encodePianoMix(streaming, mix) {
  const values = pianoMixKeys.map(key => mix[key] ?? pianoMixDefaults[key]);
  if (values.some((v, i) => !Number.isInteger(v) || v < 0 || v > pianoMixMaximum(pianoMixKeys[i])))
    throw Error("Invalid piano mixer level.");
  if (values.every((v, i) => v === pianoMixDefaults[pianoMixKeys[i]])) return +streaming;
  return values.reduce((word, value, i) => word | value << (1 + 7 * i), 0x80000000 | +streaming) >>> 0;
}

export function pianoMixText(value) {
  if (!value) return "Off";
  const db = value <= pianoMixMax ? (value - 97) / 2 : 12 + 4 * (value - pianoMixMax);
  return `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

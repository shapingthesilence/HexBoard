export const pianoMixKeys: readonly ["pianoKeyNoise", "pianoPedalNoise", "pianoStringRelease", "pianoResonance"];
export type PianoMixKey = typeof pianoMixKeys[number];
export type PianoMix = Record<PianoMixKey, number>;
export const pianoMixDefaults: Readonly<PianoMix>;
export const pianoMixMax: number;
export const pianoMixParameter: number;
export function decodePianoMix(descriptor: number): PianoMix;
export function encodePianoMix(streaming: boolean, mix: Partial<PianoMix>): number;
export function pianoMixText(value: number): string;

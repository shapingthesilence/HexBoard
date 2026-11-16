export type ColorProfile = { gain: number[]; gamma: number[]; hue: number[] };
export const colorDefaults = (): ColorProfile => ({ gain: [1000, 1000, 1000], gamma: [260, 260, 260], hue: [0, 0, 0, 0, 0, 0] });
export const colorTargets = [
  { name: 'White', rgb: [255, 255, 255] }, { name: 'Mid gray', rgb: [180, 180, 180] }, { name: 'Dim gray', rgb: [128, 128, 128] },
  { name: 'Red', rgb: [255, 0, 0] }, { name: 'Yellow', rgb: [255, 255, 0] }, { name: 'Green', rgb: [0, 255, 0] },
  { name: 'Cyan', rgb: [0, 255, 255] }, { name: 'Blue', rgb: [0, 0, 255] }, { name: 'Magenta', rgb: [255, 0, 255] },
  { name: 'Orange', rgb: [255, 128, 0] }, { name: 'Pink', rgb: [255, 128, 180] },
];
export function colorProfile(record: Record<string, string>): ColorProfile {
  if (record.version !== '1') throw Error('Unsupported color calibration version.');
  const p = { gain: record.gain?.split(':').map(Number), gamma: record.gamma?.split(':').map(Number), hue: record.hue?.split(':').map(Number) };
  if (!p.gain || !p.gamma || !p.hue) throw Error('Incomplete color calibration.');
  colorSetCommand(p as ColorProfile); return p as ColorProfile;
}
export function colorSetCommand(p: ColorProfile) {
  if (p.gain.length !== 3 || p.gamma.length !== 3 || p.hue.length !== 6 ||
      p.gain.some(v => !Number.isInteger(v) || v < 0 || v > 1000) || p.gamma.some(v => !Number.isInteger(v) || v < 100 || v > 400) ||
      p.hue.some(v => !Number.isInteger(v) || v < -25 || v > 25)) throw Error('Invalid color calibration.');
  return `led color set ${[...p.gain, ...p.gamma, ...p.hue].join(' ')}`;
}

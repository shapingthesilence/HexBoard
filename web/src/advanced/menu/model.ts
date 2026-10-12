export const categories = ['Presets', 'Layout', 'Tuning', 'Scale', 'Colors', 'Settings'] as const;
export type Category = typeof categories[number];
export const choices: Record<Category, string[]> = {
  Presets: ['Warm strings', 'Glass keys', 'Soft pluck'],
  Layout: ['Wicki-Hayden', 'Harmonic table', 'Chromatic'],
  Tuning: ['12 EDO', '19 EDO', '31 EDO'],
  Scale: ['All notes', 'Major', 'Minor', 'Pentatonic'],
  Colors: ['Spectrum', 'Ocean', 'Ember'],
  Settings: ['Joystick', 'Live preview', 'Sound controls'],
};
export type Selection = Record<Category, number>;
export const defaults: Selection = { Presets: 0, Layout: 0, Tuning: 0, Scale: 0, Colors: 0, Settings: 0 };
export interface Calibration { centerX: number; centerY: number; minX: number; maxX: number; minY: number; maxY: number; deadZone: number; signX: number; signY: number }
export const defaultCalibration: Calibration = { centerX: 0, centerY: 0, minX: -1, maxX: 1, minY: -1, maxY: 1, deadZone: .16, signX: 1, signY: 1 };
export function calibrate(center: [number, number], samples: [number, number][], deadZone: number): Calibration | undefined {
  if (!samples.length || [...center, deadZone, ...samples.flat()].some(v => !Number.isFinite(v)) || deadZone < .03 || deadZone > .4) return;
  const minX = Math.min(...samples.map(p => p[0])), maxX = Math.max(...samples.map(p => p[0]));
  const minY = Math.min(...samples.map(p => p[1])), maxY = Math.max(...samples.map(p => p[1]));
  if (center[0] - minX < .3 || maxX - center[0] < .3 || center[1] - minY < .3 || maxY - center[1] < .3) return;
  return { centerX: center[0], centerY: center[1], minX, maxX, minY, maxY, deadZone, signX: 1, signY: 1 };
}
export function normalize(x: number, y: number, c: Calibration): [number, number] {
  if (![x, y, ...Object.values(c)].every(Number.isFinite)) return [0, 0];
  const axis = (v: number, center: number, min: number, max: number) => Math.max(-1, Math.min(1, (v-center)/Math.max(.001, v < center ? center-min : max-center)));
  const nx = axis(x, c.centerX, c.minX, c.maxX), ny = axis(y, c.centerY, c.minY, c.maxY), r = Math.hypot(nx, ny);
  if (r <= c.deadZone) return [0, 0];
  const scaled = Math.min(1, (r-c.deadZone)/(1-c.deadZone));
  return [nx/r*scaled*c.signX, ny/r*scaled*c.signY];
}
// Screen coordinates: sector 0 is upper right, then clockwise in 60-degree steps.
export function sector(x: number, y: number): number | null {
  if (Math.hypot(x, y) < .38) return null;
  return (Math.floor((Math.atan2(y, x)*180/Math.PI+60+360)/60))%6;
}
export type Page = 'performance' | 'pie' | 'list' | 'joystick' | 'preview' | 'sound';
export interface MenuState { page: Page; category: Category; cursor: number; applied: Selection }
export const initialMenu: MenuState = { page: 'performance', category: 'Layout', cursor: 0, applied: { ...defaults } };
export type Action = { type: 'toggle' | 'back' | 'apply' } | { type: 'open'; category: Category } | { type: 'browse'; delta: number };
export function reduceMenu(s: MenuState, a: Action): MenuState {
  if (a.type === 'toggle') return { ...s, page: s.page === 'performance' ? 'pie' : 'performance' };
  if (a.type === 'open') return { ...s, page: 'list', category: a.category, cursor: s.applied[a.category] };
  if (a.type === 'back') return { ...s, page: s.page === 'list' ? 'pie' : s.page === 'pie' ? 'performance' : 'list' };
  if (a.type === 'browse' && s.page === 'list') return { ...s, cursor: Math.max(0, Math.min(choices[s.category].length-1, s.cursor+a.delta)) };
  if (a.type === 'apply' && s.page === 'list') {
    if (s.category === 'Settings') return { ...s, page: (['joystick', 'preview', 'sound'] as const)[s.cursor] };
    return { ...s, applied: { ...s.applied, [s.category]: s.cursor } };
  }
  return s;
}
export function displayedSelection(s: MenuState, enabled: boolean): Selection {
  return enabled && s.page === 'list' && s.category !== 'Settings' ? { ...s.applied, [s.category]: s.cursor } : s.applied;
}

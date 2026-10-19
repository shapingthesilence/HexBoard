// RP2350A 250 MHz / 44.1 kHz. Replace these estimates from the checked-in
// main-USB switching measurements (Advanced docs/juno-dx7-load-times.json); completion always requires device readiness.
export const engineNames: Record<number, string> = { 2: 'Physical Strings', 3: 'Physical Strings', 4: 'Juno', 5: 'DX7', 6: 'Sampler' };
export const prepareTimeMs: Record<number, number> = { "2": 3050, "4": 2850, "5": 3050, "3": 3050 };
export const switchTimeMs: Record<string, number> = { "2:4": 3300, "2:5": 3500, "4:2": 3600, "4:5": 3550, "5:2": 3600, "5:4": 3300 };
export function prepareEstimate(engine: number, voices = 8) { const base = prepareTimeMs[engine] ?? 4000; return 1615 + Math.max(0, base - 1615) * (Math.max(8, voices) + 2) / 10; }
export function switchEstimate(from: number, to: number, voices = 8) { return (switchTimeMs[`${from}:${to}`] ?? 4000) + prepareEstimate(to, voices) - (prepareTimeMs[to] ?? 4000); }
export function estimatedProgress(elapsed: number, expected: number) { const x = Math.max(0, elapsed) / Math.max(1, expected); return x <= 1 ? .95 * x : .95 + .04 * (1 - Math.exp(1 - x)); }

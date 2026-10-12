import { expect, it } from "vitest";
import { parseHallPeaks, peakColor } from "./HallPeakMap.tsx";
it("parses exactly one bounded raw peak for each key", () => {
  const line = 'cal,peaks,' + Array.from({length:133}, (_,i)=>i).join(',');
  expect(parseHallPeaks([line])).toHaveLength(133);
  expect(parseHallPeaks([line])[132]).toBe(132);
  expect(parseHallPeaks([line+',4'])).toEqual([]);
  expect(parseHallPeaks([line.replace(',132',',4096')])).toEqual([]);
});
it("keeps zero neutral and clamps color without wrapping", () => {
  expect(peakColor(0)).toBe('var(--surface-muted)');
  expect(peakColor(1600)).toBe(peakColor(4095));
  expect(peakColor(800)).not.toBe(peakColor(1200));
});

import { parseHallRests, restBounds } from "./HallPeakMap.tsx";
it("maps rest variation without treating missing legacy baselines as low keys", () => {
  expect(restBounds([0, 2200, 2400, 2300])).toEqual([2200,2400]);
  expect(restBounds([0,0])).toEqual([0,0]);
  expect(restBounds([2200,2200])).toEqual([2200,2200]);
  expect(parseHallRests(['cal,rests,'+Array(133).fill(2250).join(',')])[100]).toBe(2250);
});

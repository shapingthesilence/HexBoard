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

import { parseHallRaw } from "./HallPeakMap.tsx";
it("reads complete live frames including valid zero ADC readings", () => {
  const first = 'cal,raw,' + Array(133).fill(2200).join(',');
  const next = 'cal,raw,' + [0, 4095, ...Array(131).fill(2300)].join(',');
  expect(parseHallRaw([first])[0]).toBe(2200);
  expect(parseHallRaw([next]).slice(0, 2)).toEqual([0, 4095]);
  expect(restBounds(parseHallRaw([next]), true)).toEqual([0, 4095]);
  expect(parseHallRaw(['cal,raw,waiting'])).toEqual([]);
  expect(parseHallRaw([next + ',1'])).toEqual([]);
  expect(parseHallRaw([next.replace('4095', '4096')])).toEqual([]);
});

import { draggedPeak, parseHallLimits } from "./HallPeakMap.tsx";
it("drags peaks vertically within the device's per-key raw ADC bounds", () => {
  expect(draggedPeak(1000, 25, 20, 1800)).toBe(1100);
  expect(draggedPeak(1000, -25, 20, 1800)).toBe(900);
  expect(draggedPeak(1000, 1000, 20, 1800)).toBe(1800);
  expect(draggedPeak(1000, -1000, 20, 1800)).toBe(20);
  expect(parseHallLimits(['cal,limits,'+Array(133).fill(1800).join(',')])[0]).toBe(1800);
});

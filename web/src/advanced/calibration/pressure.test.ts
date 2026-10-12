import { describe, expect, it } from "vitest";
import { parsePressure, pressurePercent } from "./pressure.mjs";

describe("live pressure endpoint semantics", () => {
  const line = "pressure,61,100,200,3300,65535,32768,1,2,55705,65535,52428";
  it("accepts a raw damper endpoint percentage below the nominal onset fraction", () => {
    expect(parsePressure(line, true)?.damperEnd).toBe(52428);
    expect(parsePressure(line)).toBeNull();
  });
  it("uses each key’s measured maximum for full travel and retains legacy records", () => {
    const sample = parsePressure("pressure,61,100,200,3300,24000,32768,1,1,55705,65535,65535,48000", true);
    expect(sample?.firmTravel).toBe(48000);
    expect(pressurePercent(24000, 1, 55705, 65535, 65535, 48000)).toBe(50);
    expect(pressurePercent(48000, 1, 55705, 65535, 65535, 48000)).toBe(100);
    expect(pressurePercent(24000, 1, 55705, 65535, 65535, 0)).toBe(0);
    expect(parsePressure(line, true)?.firmTravel).toBeUndefined();
  });
  it("rejects a zero firm endpoint scale", () => {
    expect(parsePressure(line.replace(/52428$/, "0"), true)).toBeNull();
  });
});

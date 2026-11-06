import { describe, expect, it } from "vitest";
import { beatClockPulse, clickAccent, clickPlan, countInClick, countInLabel } from "./meterClicks.ts";

describe("meter-aware clicks", () => {
  it("keeps the four-click count-in for common time", () => {
    const plan = clickPlan();
    expect(plan).toEqual({ unit: 1, barClicks: 4, groupClicks: 1, countInClicks: 4, countInBeats: 4 });
    expect([0, 1, 2, 3, 4].map(click => clickAccent(plan, click))).toEqual(["bar", "beat", "beat", "beat", "bar"]);
    expect(countInLabel(plan)).toBe("Four count-in clicks");
  });
  it("counts in one bar of three and stresses each downbeat in 3/4", () => {
    const plan = clickPlan({ numerator: 3, denominator: 4 });
    expect(plan.countInClicks).toBe(3);
    expect(plan.countInBeats).toBe(3);
    expect([0, 1, 2, 3, 4, 5, 6].map(click => clickAccent(plan, click))).toEqual(["bar", "beat", "beat", "bar", "beat", "beat", "bar"]);
  });
  it("clicks eighths in compound meter, grouped ONE-two-three FOUR-five-six", () => {
    const plan = clickPlan({ numerator: 6, denominator: 8 });
    expect(plan).toMatchObject({ unit: 0.5, barClicks: 6, groupClicks: 3, countInClicks: 6, countInBeats: 3 });
    expect([0, 1, 2, 3, 4, 5].map(click => clickAccent(plan, click))).toEqual(["bar", "beat", "beat", "group", "beat", "beat"]);
  });
  it("repeats short bars so the count-in is never rushed", () => {
    expect(clickPlan({ numerator: 2, denominator: 4 })).toMatchObject({ countInClicks: 4, countInBeats: 4 });
    expect(clickPlan({ numerator: 3, denominator: 8 })).toMatchObject({ unit: 0.5, countInClicks: 6, countInBeats: 3 });
  });
  it("counts and flashes on the eighth clicks of a 6/8 count-in", () => {
    const run = { startAt: 10000, periodMs: 1000, clicks: clickPlan({ numerator: 6, denominator: 8 }) };
    expect(countInClick(run, 7000)).toBe(1);
    expect(countInClick(run, 9600)).toBe(6);
    expect(beatClockPulse(run, 7500)).toBe(true);
    expect(beatClockPulse(run, 7300)).toBe(false);
  });
});

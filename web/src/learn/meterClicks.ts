// BPM always counts quarter notes. The click follows the written meter:
// quarter clicks for simple meters, eighth clicks grouped in threes for
// compound meters, with the first beat of each bar stressed. The count-in is
// whole bars, so beat 0 of the lesson always falls on a downbeat; a pickup is
// written as a leading rest.
export interface Meter { numerator: number; denominator: number }
export type ClickAccent = "bar" | "group" | "beat";
export interface ClickPlan {
  /** Quarter-note beats between clicks. */
  unit: number;
  barClicks: number;
  /** Clicks per felt pulse: 3 in compound meters, otherwise 1. */
  groupClicks: number;
  countInClicks: number;
  /** Count-in length in quarter-note beats. */
  countInBeats: number;
}

const commonTime: Meter = { numerator: 4, denominator: 4 };

export function clickPlan(meter: Meter = commonTime): ClickPlan {
  const barBeats = meter.numerator * 4 / meter.denominator;
  const compound = meter.denominator >= 8 && meter.numerator > 3 && meter.numerator % 3 === 0;
  const unit = meter.denominator > 4 ? 4 / meter.denominator : 1;
  const barClicks = Math.max(1, Math.round(barBeats / unit));
  // Short bars repeat so every count-in gives at least three quarter beats.
  const bars = Math.max(1, Math.ceil(3 / barBeats - 1e-9));
  return { unit, barClicks, groupClicks: compound ? 3 : 1, countInClicks: bars * barClicks, countInBeats: bars * barBeats };
}

/** Accent for a click counted from the first count-in click. */
export function clickAccent(plan: ClickPlan, click: number): ClickAccent {
  const position = click % plan.barClicks;
  return position === 0 ? "bar" : plan.groupClicks > 1 && position % plan.groupClicks === 0 ? "group" : "beat";
}

const numberWords = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
export function countInLabel(plan: ClickPlan) {
  const count = numberWords[plan.countInClicks] ?? String(plan.countInClicks);
  return `${count} count-in click${plan.countInClicks === 1 ? "" : "s"}`;
}

interface ClickClock { startAt: number; periodMs: number; clicks: ClickPlan }
/** 1-based count-in click for the on-screen counter. */
export function countInClick(run: ClickClock, now: number) {
  const remaining = Math.ceil((run.startAt - now) / (run.clicks.unit * run.periodMs));
  return Math.max(1, Math.min(run.clicks.countInClicks, run.clicks.countInClicks + 1 - remaining));
}
export function beatClockPulse(run: ClickClock, now: number, flashMs = 120) {
  return (now - run.startAt + run.clicks.countInBeats * run.periodMs) % (run.clicks.unit * run.periodMs) < flashMs;
}

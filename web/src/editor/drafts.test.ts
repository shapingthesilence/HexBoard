import { describe, expect, it } from "vitest";
import { readDraftState, sameContent } from "./drafts.ts";

type Sound = { name: string; value: number };
const validate = (value: unknown): value is Sound => !!value && typeof value === "object" && "name" in value && typeof value.name === "string" && "value" in value && typeof value.value === "number";

describe("editor draft recovery", () => {
  it("preserves independent drafts and their discard baselines across a reload", () => {
    const original = { active: "device:a", entries: {
      "browser:a": { base: { name: "Sound A", value: 1 }, value: { name: "Renamed A", value: 2 } },
      "device:a": { base: { name: "Device A", value: 3 }, value: { name: "Device A", value: 4 } }
    } };
    const restored = readDraftState(JSON.stringify(original), validate);
    expect(restored).toEqual(original);
    expect(sameContent(restored.entries["browser:a"].base, restored.entries["browser:a"].value)).toBe(false);
    expect(restored.entries["device:a"].base.value).toBe(3);
  });
  it("retains valid work when another saved draft is malformed", () => {
    const valid = { base: { name: "A", value: 1 }, value: { name: "A", value: 2 } };
    const restored = readDraftState(JSON.stringify({ active: "good", entries: { good: valid, broken: { value: null } } }), validate);
    expect(restored.entries).toEqual({ good: valid });
  });
  it("recovers an empty state from corrupt or missing storage", () => {
    for (const raw of [null, "not json", "null", "[]", '{"active":42}']) {
      expect(readDraftState(raw, validate)).toEqual({ active: "", entries: {} });
    }
  });
});

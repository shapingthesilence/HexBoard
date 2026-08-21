import { describe, expect, it } from "vitest";
import { organizationActionLabel } from "./OrganizeLibraryItemDialog.tsx";

describe("library organization action labels", () => {
  it("describes rename and move operations precisely", () => {
    expect(organizationActionLabel(true, false, false)).toBe("Rename");
    expect(organizationActionLabel(false, true, false)).toBe("Move");
    expect(organizationActionLabel(true, true, false)).toBe("Rename and move");
  });

  it("makes replacement explicit whenever the destination is occupied", () => {
    expect(organizationActionLabel(true, false, true)).toBe("Overwrite and continue");
    expect(organizationActionLabel(false, true, true)).toBe("Overwrite and continue");
  });
});

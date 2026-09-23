import { describe, expect, it } from "vitest";
import { HEXBOARD_COMMAND_INDICES } from "../catalogs/hexBoardGeometry.ts";
import { courseControl, courseControlLight, courseControls } from "./courseControls.ts";
import { decodeDelegatedKey } from "./delegatedSession.ts";

describe("course side controls", () => {
  it("spaces four actions across the seven physical command keys", () => {
    expect(courseControls.map(control=>control.index)).toEqual(HEXBOARD_COMMAND_INDICES.filter((_,position)=>position%2===0));
    for(const control of courseControls){
      const channel=Math.floor(control.index/100),note=control.index%100;
      expect(decodeDelegatedKey(Uint8Array.of(0x90|channel,note,127))).toEqual({index:control.index,pressed:true});
      expect(courseControl(control.index)).toBe(control);
      expect(courseControlLight(control.index,true)).toEqual(control.color);
      expect(courseControlLight(control.index,false).value).toBe(0);
    }
    expect(courseControlLight(80,true,false).value).toBe(0);
    for(const index of [20,60,100])expect(courseControl(index)).toBeUndefined();
    expect(courseControl(65)).toBeUndefined();
  });
});

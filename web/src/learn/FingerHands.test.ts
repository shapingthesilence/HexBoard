import {createElement} from "react";
import {describe,it,expect} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
import {FingerHands} from "./FingerHands.tsx";
describe("shared finger visualization",()=>{
  const color=()=>({fill:"rgb(255 0 0)",text:"white"});
  it("colors a finger assigned to one pitch in the player and editor",()=>{
    const cues=[{note:60,hand:"left" as const,finger:2}];
    const markup=renderToStaticMarkup(createElement(FingerHands,{cues,color}));
    expect(markup).toContain('fill:rgb(255 0 0)');
    expect(markup).toContain('handFinger selected');
    expect(markup).not.toContain('role="button"');
    expect(renderToStaticMarkup(createElement(FingerHands,{cues,color,onChoose:()=>{}}))).toContain('aria-pressed="true"');
  });
  it("keeps shared fingers neutral when assigned multiple pitches",()=>{
    const markup=renderToStaticMarkup(createElement(FingerHands,{cues:[{note:60,hand:"left",finger:2},{note:64,hand:"left",finger:2}],color}));
    expect(markup).toContain('handFinger selected');
    expect(markup).not.toContain('fill:rgb(255 0 0)');
  });
});

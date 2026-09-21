import {afterEach,describe,it,expect,vi} from "vitest";
import {NoteAudition} from "./noteAudition.ts";
const audio=()=>({start:vi.fn(async()=>{}),noteOn:vi.fn(async(_pitch:number)=>{}),allNotesOff:vi.fn(),close:vi.fn(async()=>{})});
afterEach(()=>vi.useRealTimers());
describe("piano roll audition",()=>{
 it("reuses the engine, plays fractional pitches, and releases short previews",async()=>{
  vi.useFakeTimers();const synth=audio(),create=vi.fn(()=>synth),preview=new NoteAudition(create);
  await preview.play(60.25);await vi.advanceTimersByTimeAsync(100);await preview.play(62);
  expect(create).toHaveBeenCalledTimes(1);expect(synth.noteOn.mock.calls).toEqual([[60.25],[62]]);
  const releases=synth.allNotesOff.mock.calls.length;
  await vi.advanceTimersByTimeAsync(150);expect(synth.allNotesOff).toHaveBeenCalledTimes(releases);
  await vi.advanceTimersByTimeAsync(70);expect(synth.allNotesOff).toHaveBeenCalledTimes(releases+1);preview.stop();
 });
 it("only sounds the latest pitch when startup is slow",async()=>{
  let ready!:()=>void;const synth=audio();synth.start.mockImplementation(()=>new Promise<void>(resolve=>{ready=resolve;}));
  const preview=new NoteAudition(()=>synth),first=preview.play(60),second=preview.play(64);ready();await Promise.all([first,second]);
  expect(synth.noteOn.mock.calls).toEqual([[64]]);preview.stop();
 });
 it("cancels pending startup and closes audio when stopped",async()=>{
  let ready!:()=>void;const synth=audio();synth.start.mockImplementation(()=>new Promise<void>(resolve=>{ready=resolve;}));
  const preview=new NoteAudition(()=>synth),pending=preview.play(60);preview.stop();ready();await pending;
  expect(synth.noteOn).not.toHaveBeenCalled();expect(synth.close).toHaveBeenCalledOnce();
 });
});

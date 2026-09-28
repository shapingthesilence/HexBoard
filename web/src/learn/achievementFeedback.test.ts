import {afterEach,describe,it,expect,vi} from "vitest";
import {AchievementSound,earnedAchievement} from "./achievementFeedback.ts";
import type {LessonProgress} from "./beginnerCourse.ts";

const result:LessonProgress={attempts:1,bestMistakes:0,independent:false,lastPlayed:"2026-09-24T00:00:00Z"};
class Context {
  static latest:Context;
  state="running";currentTime=1;destination={};
  nodes:{stop:ReturnType<typeof vi.fn>;start:ReturnType<typeof vi.fn>;frequency:{value:number}}[]=[];
  resume=vi.fn(async()=>{});close=vi.fn(async()=>{this.state="closed";});
  constructor(){Context.latest=this;}
  createOscillator(){const node={type:"",frequency:{value:0},connect:vi.fn(),disconnect:vi.fn(),start:vi.fn(),stop:vi.fn(),onended:()=>{}};this.nodes.push(node);return node;}
  createGain(){return {gain:{setValueAtTime:vi.fn(),linearRampToValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};}
}
afterEach(()=>vi.unstubAllGlobals());
describe("achievement feedback",()=>{
  it("celebrates each new completion and independence upgrade once",()=>{
    expect(earnedAchievement(undefined,result)).toBe("completed");
    expect(earnedAchievement(result,{...result,attempts:2})).toBeUndefined();
    expect(earnedAchievement(result,{...result,independent:true})).toBe("independent");
    expect(earnedAchievement(undefined,{...result,independent:true})).toBe("independent");
    expect(earnedAchievement({...result,independent:true},{...result,independent:true,attempts:3})).toBeUndefined();
  });
  it("schedules distinct short sounds and stops pending voices on cleanup",async()=>{
    vi.stubGlobal("AudioContext",Context);
    const sound=new AchievementSound();await sound.unlock();
    sound.play("completed");
    const context=Context.latest,first=[...context.nodes];
    expect(first).toHaveLength(3);
    expect(first.every(node=>node.stop.mock.calls[0][0]<1.7)).toBe(true);
    sound.play("independent");
    expect(first.every(node=>node.stop.mock.calls.length===2)).toBe(true);
    expect(context.nodes).toHaveLength(7);
    sound.close();
    expect(context.close).toHaveBeenCalledOnce();
    sound.play("completed");
    expect(context.nodes).toHaveLength(7);
  });
  it("fails quietly when audio is unavailable or suspended",async()=>{
    vi.stubGlobal("AudioContext",class{constructor(){throw new Error("audio blocked");}});
    const blocked=new AchievementSound();await expect(blocked.unlock()).resolves.toBeUndefined();
    expect(()=>blocked.play("completed")).not.toThrow();
    vi.stubGlobal("AudioContext",Context);
    const sound=new AchievementSound();await sound.unlock();Context.latest.state="suspended";
    sound.play("independent");expect(Context.latest.nodes).toHaveLength(0);sound.close();
  });
});

import { describe, expect, it } from "vitest";
import { beginnerLessons, CourseRun, parseCourseProgress, recordCourseRun } from "./beginnerCourse.ts";
import { courseFormat, parseCourse, readCourseFile, readCourseLibrary, parsePhrase, lessonCues, cueAccepts, courseKeyLight, courseProgressId, type UserCourse } from "./courseFiles.ts";
import { starterLayouts, resolveLessonKeys } from "./majorScale.ts";
import { BeatScaleRun } from "./scalePractice.ts";
import { lessonLedColor } from "./lessonColors.ts";
import { PhraseRecorder } from "./phraseRecorder.ts";
import nineteen from "../../../factory-library/geometry/19 EDO.json";
import { parseTuningBundleFile } from "../catalogs/layoutsCatalog.ts";

const layouts = starterLayouts();
const bundle = { ...layouts[0].bundle, layouts: layouts.map(item => item.layout) };
function fixture(): UserCourse { return { format: courseFormat, id: "my-course", revision: 1, title: "A short song", author: "Student", bundle: structuredClone(bundle), lessons: structuredClone([...beginnerLessons]) }; }
const harmonic = layouts.find(item => item.layout.name === "Harmonic Table")!;
const duplicates = resolveLessonKeys(harmonic).filter(key => key.note === 60);
function fingered(acceptDuplicates: boolean) {
  return { id: "fingering", title: "Fingering", section: "Songs", instruction: "Play C.", targets: [[60]], fingerings: [{layoutId: harmonic.layout.objectIdHex, steps: [[{note:60,button:duplicates[0].key.index,hand:"left" as const,finger:1,acceptDuplicates}]]}] };
}

describe("portable courses", () => {
  it("preserves microtonal pitches and embedded key assignments", () => {
    const bundle = parseTuningBundleFile(nineteen);
    const layout = bundle.layouts[0];
    const key = resolveLessonKeys({ id: layout.objectIdHex, label: layout.name, bundle, layout }).find(key => key.note !== null && !Number.isInteger(key.note))!;
    const course = { ...fixture(), bundle, layoutId: layout.objectIdHex, lessons: [{ id: "microtonal", title: "19 EDO phrase", instruction: "Play this tuning step.", section: "Songs", targets: [[key.note!]], fingerings: [{layoutId:layout.objectIdHex,steps:[[{note:key.note!,button:key.key.index}]]}] }] };
    const loaded = readCourseFile(JSON.stringify(course));
    expect(loaded.bundle.tuning.cycleLength).toBe(19);
    expect(loaded.lessons[0].targets[0][0]).toBe(key.note);
    const run = new CourseRun(loaded.lessons[0], layout.objectIdHex);
    run.press(key.key.index, key.note!, 100);
    expect(run.complete).toBe(true);
  });
  it("round-trips its tuning, layouts, fingering and timing without a device library", () => {
    const course = fixture(); course.layoutId = harmonic.layout.objectIdHex;
    course.lessons = [{ ...fingered(true), timing:{goalBpm:90,beats:[0.5]} }];
    const loaded = readCourseFile(JSON.stringify(course));
    expect(loaded.layoutId).toBe(course.layoutId);
    expect(loaded.bundle.tuning).toEqual(course.bundle.tuning);
    expect(loaded.bundle.layouts).toEqual(course.bundle.layouts);
    expect(loaded.lessons[0].timing).toEqual({goalBpm:90,beats:[0.5]});
    const keys = resolveLessonKeys({ id:"course",label:"course",bundle:loaded.bundle,layout:loaded.bundle.layouts.find(layout => layout.objectIdHex === loaded.layoutId)! });
    expect(keys[duplicates[0].key.index].note).toBe(60);
  });
  it("rejects incompatible keys, unknown layouts, empty content and invalid timing", () => {
    const course = fixture(); course.lessons = [fingered(true)];
    course.lessons[0].fingerings![0].steps[0][0].button = 0;
    expect(() => parseCourse(course)).toThrow(/Preferred key/);
    expect(() => parseCourse({...fixture(),layoutId:"unknown"})).toThrow(/required layout/);
    expect(() => parseCourse({...fixture(),lessons:[]})).toThrow(/1–100/);
    const invalid = {...fingered(true),timing:{goalBpm:0,beats:[1]}};
    expect(() => parseCourse({...fixture(),lessons:[invalid]})).toThrow(/Timing/);
    expect(() => parseCourse({...fixture(),lessons:[{...fingered(true),targets:[[]]}]})).toThrow(/played note/);
    expect(readCourseLibrary(JSON.stringify([fixture(), {format:"bad"}]))).toHaveLength(1);
  });
  it("preserves progress across course revisions but separates course identities", () => {
    const course = fixture();
    const key = courseProgressId(course, "home");
    const progress = recordCourseRun({},key,"layout",0,false);
    expect(parseCourseProgress(JSON.stringify(progress))).toEqual(progress);
    expect(courseProgressId({...course,revision:2},"home")).toBe(key);
    expect(courseProgressId({...course,id:"another"},"home")).not.toBe(key);
  });
  it("supports small-song phrase entry with sharps, flats, chords, rests and subdivisions", () => {
    expect(parsePhrase("C4 D4:0.5 Eb4:0.5 [C4 E4 G4]:2 -:1 C5")).toEqual({targets:[[60],[62],[63],[60,64,67],[],[72]],beats:[1,0.5,0.5,2,1,1]});
    for (const phrase of ["C", "C4:0.3", "[C4 C4]", "C4:9", "C20", "[C4 G4"]) expect(() => parsePhrase(phrase)).toThrow();
  });
});

describe("layout-specific preferred keys", () => {
  it("dims duplicate hints while optionally accepting equivalent pitches", () => {
    const lesson = fingered(true), cues = lessonCues(lesson,harmonic.layout.objectIdHex,0);
    expect(courseKeyLight(duplicates[0],cues,"target")).toBe("target");
    expect(courseKeyLight(duplicates[1],cues,"target")).toBe("alternate");
    expect(lessonLedColor(60,"alternate").value).toBeLessThan(lessonLedColor(60,"target").value);
    const run = new CourseRun(lesson,harmonic.layout.objectIdHex);
    run.press(duplicates[1].key.index,60,100);
    expect(run.complete).toBe(true);
  });
  it("requires the chosen key when duplicates are disabled, only on its layout", () => {
    const lesson = fingered(false), run = new CourseRun(lesson,harmonic.layout.objectIdHex);
    run.press(duplicates[1].key.index,60,100);
    expect(run.complete).toBe(false);
    expect(run.mistakes).toBe(1);
    run.press(duplicates[0].key.index,60,200);
    expect(run.complete).toBe(true);
    const other = new CourseRun(lesson,"another-layout");
    other.press(duplicates[1].key.index,60,100);
    expect(other.complete).toBe(true);
  });
});

describe("timed course passages", () => {
  it("scores a chord, a rest and a short melody at authored beat positions", () => {
    const targets = [[60,64,67],[],[62],[64]], beats=[2,1,0.5,0.5];
    const run = new BeatScaleRun([60,-1,62,64],10000,60,undefined,{targets,beats});
    run.press(0,60,10000); run.press(1,64,10000); run.press(2,67,10000);
    expect(run.step).toBe(1);
    run.release(0,10100); run.release(1,10100); run.release(2,10100);
    run.tick(12500);
    run.press(0,62,13000); run.release(0,13100); run.press(0,64,13500);
    run.tick(run.endAt);
    expect(run.complete).toBe(true);
    expect(run.result()).toMatchObject({score:100,hits:4,missed:0,extras:0});
  });
  it("grades chord spread without cancelling early/late attacks and requires simultaneity", () => {
    const run = new BeatScaleRun([60],10000,60,undefined,{targets:[[60,64,67]],beats:[1]});
    run.press(0,60,9900); run.press(1,64,10000); run.press(2,67,10100);
    expect(run.errors[0]).toBe(-100);
    expect(run.result().score).toBe(80);
    const rolled = new BeatScaleRun([60],10000,60,undefined,{targets:[[60,64,67]],beats:[1]});
    rolled.press(0,60,10000); rolled.release(0,10050); rolled.press(1,64,10060); rolled.press(2,67,10070);
    expect(rolled.result().missed).toBe(1);
  });
  it("penalizes attacks during rests and does not accept an old beat during a long gap", () => {
    const run = new BeatScaleRun([60,-1,62],10000,60,undefined,{targets:[[60],[],[62]],beats:[2,1,1]});
    run.press(0,60,11000); run.release(0,11100);
    run.press(1,64,12000); run.release(1,12100);
    run.tick(run.endAt);
    expect(run.result()).toMatchObject({extras:2,missed:2});
  });
  it("keeps subdivision windows separate and enforces preferred keys", () => {
    const cues = fingered(false).fingerings[0].steps[0];
    const run = new BeatScaleRun([60,62],10000,60,undefined,{targets:[[60],[62]],beats:[0.25,0.25],accepts:(_,index,note)=>cueAccepts(cues,index,note)});
    run.press(duplicates[1].key.index,60,10000);
    expect(run.result().hits).toBe(0);
    run.press(duplicates[0].key.index,60,10000);
    run.press(139,62,10250);
    expect(run.result().hits).toBe(2);
    expect(run.endAt).toBe(10375);
  });
});

describe("HexBoard phrase capture", () => {
  it("records legato melody attacks and quarter-beat timing with the actual keys", () => {
    const recorder = new PhraseRecorder("melody",60);
    recorder.press(64,60,1000); recorder.press(64,60,1001);
    recorder.press(65,62,1500); recorder.release(64,1600);
    recorder.press(66,64,2500); recorder.release(65,2600); recorder.release(66,3000);
    expect(recorder.targets).toEqual([[60],[62],[64]]);
    expect(recorder.beats).toEqual([0.5,1,0.5]);
    expect(recorder.cues[0][0]).toEqual({note:60,button:64,acceptDuplicates:true});
  });
  it("collects chords until release and retains a partial final capture when stopped", () => {
    const recorder = new PhraseRecorder("chords",60);
    recorder.press(64,60,1000); recorder.press(66,64,1050); recorder.press(54,67,1100);
    recorder.release(64,1900); recorder.release(66,1950);
    expect(recorder.targets).toHaveLength(0);
    recorder.release(54,2000);
    expect(recorder.targets).toEqual([[60,64,67]]);
    recorder.press(52,63,2500); recorder.flush();
    expect(recorder.targets).toEqual([[60,64,67],[63]]);
    expect(recorder.beats[0]).toBe(1.5);
  });
});

describe("recording snap",()=>{
  it("defaults to eighth notes and supports quarter and sixteenth note recording",()=>{
    for(const [snap,expected] of [[1,1],[0.5,0.5],[0.25,0.25]]){
      const recorder=new PhraseRecorder("melody",60,snap);
      recorder.press(1,60,0);recorder.release(1,320);recorder.press(2,62,320);
      expect(recorder.beats[0]).toBe(expected);
      expect(recorder.holdBeats[0][0]).toBe(expected);
    }
    expect(new PhraseRecorder("melody",80).snap).toBe(0.5);
    const free=new PhraseRecorder("melody",undefined,0.25);
    free.press(1,60,0);free.press(2,62,320);
    expect(free.beats).toEqual([1,1]);
  });
});

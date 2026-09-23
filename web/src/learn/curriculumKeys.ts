import type {CourseLesson, KeyCue} from "./beginnerCourse.ts";
import {resolveLessonKeys, starterLayouts} from "./majorScale.ts";

// Axial (across, up-right) offsets, measured from the root on the physical
// board. Scale routes follow the compact diagrams in the three layout manuals;
// interval routes can choose a different duplicate from the scale route.
const scaleRoutes: Record<string, Record<number, readonly [number, number]>> = {
  "Wicki-Hayden": {0:[0,0],1:[-3,1],2:[1,0],3:[-2,1],4:[2,0],5:[-1,1],7:[0,1],9:[1,1],11:[2,1],12:[-1,2]},
  "Harmonic Table": {0:[0,0],1:[-1,2],2:[-2,4],3:[0,-1],4:[-1,1],5:[-2,3],7:[-1,0],9:[-3,4],11:[-2,1],12:[-3,3]},
  "Gerhard": {0:[0,0],1:[-1,0],2:[-2,0],3:[0,1],4:[-1,1],5:[-2,1],7:[-1,2],9:[-3,2],11:[-2,3],12:[-3,3]},
};
export interface RouteBlock {
  /** Number of consecutive target steps using this translated route. */
  steps: number;
  root: number;
  /** Select the next central placement of the same pitches for duplicate work. */
  position?: number;
  shape?: "scale" | "interval";
}

export function recommendCourseRoute(lesson: CourseLesson, blocks: RouteBlock[] = [{steps:lesson.targets.length,root:60}]): CourseLesson {
  if (blocks.reduce((sum, block) => sum + block.steps, 0) !== lesson.targets.length) throw new Error(`Route length: ${lesson.id}`);
  return {...lesson, fingerings:starterLayouts().map(layout => {
    const keys = resolveLessonKeys(layout);
    const steps: KeyCue[][] = [];
    for (const block of blocks) {
      const pattern = {...scaleRoutes[layout.layout.name]};
      if (block.shape === "interval" && layout.layout.name === "Harmonic Table") pattern[2] = [1,-3];
      const targets = lesson.targets.slice(steps.length, steps.length + block.steps);
      const pitches = [...new Set(targets.flat())];
      const placements = keys.filter(key => key.note === block.root).map(anchor => {
        const buttons = new Map<number, number>();
        for (const note of pitches) {
          const offset = pattern[note - block.root];
          if (!offset) return undefined;
          const [across, up] = offset;
          const key = keys.find(key => key.note === note && key.key.coordCol === anchor.key.coordCol + 2*across + up && key.key.row === anchor.key.row - up);
          if (!key) return undefined;
          buttons.set(note, key.key.index);
        }
        // Place a complete shape centrally; never fold a missing note or change
        // its internal geometry to squeeze it past the edge or a command key.
        const distance = (anchor.key.coordCol - 9.5)**2 + 3*(anchor.key.row - 6.5)**2;
        return {buttons, distance};
      }).filter(item => item !== undefined).sort((a,b) => a.distance-b.distance);
      const placement = placements[block.position ?? 0];
      if (!placement) throw new Error(`No complete ${layout.layout.name} route for ${lesson.id} at ${block.root}.`);
      steps.push(...targets.map(target => target.map(note => ({note,button:placement.buttons.get(note)!,acceptDuplicates:true}))));
    }
    return {layoutId:layout.layout.objectIdHex,steps};
  })};
}

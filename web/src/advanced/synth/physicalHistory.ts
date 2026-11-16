import type {PhysicalPreset} from './schema.ts';
const emptyControllerRoutes=Array(66).fill(0);
const numbersEqual = (a: number[], b: number[]) => a === b || a.length === b.length && a.every((v, i) => v === b[i]);
/** Ignore qualification metadata and avoid traversing shared sample PCM on edits. */
export function samePhysicalSound(a: PhysicalPreset, b: PhysicalPreset) {
  return (a.mono?.flags??0)===(b.mono?.flags??0)&&(a.mono?.glideMs??0)===(b.mono?.glideMs??0)&&a.name === b.name && a.velocityEngine === b.velocityEngine &&
    numbersEqual(a.parameters, b.parameters) && numbersEqual(a.routes, b.routes) &&
    numbersEqual(a.controllerRoutes??emptyControllerRoutes,b.controllerRoutes??emptyControllerRoutes) && numbersEqual(a.tiltRoutes, b.tiltRoutes) && numbersEqual(a.modulation.settings, b.modulation.settings) &&
    numbersEqual(a.modulation.routes, b.modulation.routes) && JSON.stringify(a.effects) === JSON.stringify(b.effects) &&
    numbersEqual(a.sample.frames, b.sample.frames) &&
    JSON.stringify({...a.sample, frames: undefined}) === JSON.stringify({...b.sample, frames: undefined});
}

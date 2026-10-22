import type {PhysicalPreset} from './schema.ts';

export const targetSourceLimit = 4;
export function targetDepths(preset: PhysicalPreset, id: number): number[] {
  return [...preset.routes.slice(id * 3, id * 3 + 3),
    ...preset.tiltRoutes.slice(id * 2, id * 2 + 2),
    ...preset.modulation.routes.slice(id * 2, id * 2 + 2),
    ...(preset.controllerRoutes??Array(66).fill(0)).slice(id*2,id*2+2)];
}
export function canAssignTarget(preset: PhysicalPreset, id: number, source: number): boolean {
  const depths = targetDepths(preset, id);
  return depths[source] !== 0 || depths.filter(Boolean).length < targetSourceLimit;
}

import { computeVectorLayoutSteps, type HexBoardKey } from "./hexBoardGeometry.ts";
import type { TuningBundleLayout } from "./layoutsCatalog.ts";

// Shared by the editor preview and lessons: manual pitch overrides have the
// same precedence over the generated layout in both views.
export function resolveLayoutKey(key: HexBoardKey, layout: TuningBundleLayout) {
  const override = layout.buttonOverrides.find((candidate) => candidate.buttonIndex === key.index);
  const generatedStepsFromC = Math.round(computeVectorLayoutSteps(key, layout));
  return { override, generatedStepsFromC, stepsFromC: override?.stepsFromC ?? generatedStepsFromC };
}

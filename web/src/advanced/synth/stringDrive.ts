// Bridge saturation of the Advanced Physical Strings loop, mirroring
// HexBoard_Advanced physical_model.cpp (saturateWave and its per-block
// thresholds). UI-only: it draws pictures and never feeds DSP or the transport.

export type DriveCharacter = 0 | 1 | 2; // Warm, Edge, Fold

/** Drive knob (0..1) to the wet blend the engine uses. */
export const driveWet = (drive: number) => drive * drive;

/** Above 75% Drive the thresholds shrink by up to 20%, so the upper quarter bites harder. */
export function driveScale(drive: number) {
  return 1 - .2 * Math.max(0, Math.min(1, (driveWet(drive) - .5625) / .4375));
}

/** All three shapes are bounded by this output level; quieter signal passes almost clean. */
export const driveCeiling = (drive: number) => .25 * driveScale(drive);

/** The saturated shape alone, before blending with the dry loop signal. */
export function saturate(value: number, character: DriveCharacter, scale: number) {
  const edge = .25 * scale;
  if (character === 1) return Math.max(-edge, Math.min(edge, value));
  if (character === 2) {
    const magnitude = Math.min(Math.abs(value), .75 * scale), folded = edge - Math.abs(magnitude - edge);
    return value < 0 ? -folded : folded;
  }
  const x = Math.max(-.375 * scale, Math.min(.375 * scale, value)), cubic = (64 / 27) / (scale * scale);
  return x - cubic * x * x * x;
}

/** One pass through the bridge: the dry loop signal blended toward its saturated shape. */
export function stringDrive(value: number, drive: number, character: DriveCharacter) {
  const wet = driveWet(drive);
  return wet ? value + wet * (saturate(value, character, driveScale(drive)) - value) : value;
}

export const driveCharacter = (normalized: number) => Math.round(normalized * 2) as DriveCharacter;

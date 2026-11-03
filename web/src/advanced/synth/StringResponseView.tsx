import {useCallback, useMemo} from 'react';
import {CanvasPlot, type PlotColors} from './CanvasPlot.tsx';
import {PreviewValues} from './SynthVisualPreview.tsx';
import {releaseSeconds} from './schema.ts';
import {driveCeiling, driveCharacter, driveWet, saturate, stringDrive, type DriveCharacter} from './stringDrive.ts';

// Ring time, Release time, Drive, Saturation character, Irregularity.
const inputIds = [0, 3, 26, 27, 28] as const;
const characterNames = ['Warm', 'Edge', 'Fold'];
// Plot geometry in viewBox units: the transfer square on the left, the ring on the right.
const width = 600, height = 124, top = 10, size = 104, ringX = 138, ringWidth = 454;
const ringSamples = 640, curvePoints = 97, peak = .9, cycles = 26;
// Redraws follow audible changes, not floating-point jitter from modulation.
const settle = (value: number) => Math.round(value * 1000) / 1000;

/** Bridge saturation and decay of a struck note: shape at each level, then how it rings out. */
export function StringResponseView({disabled}: {disabled: boolean}) {
  return <PreviewValues ids={inputIds}>{([ring, release, drive, character, irregularity]) =>
    <ResponsePlot ring={settle(ring)} release={settle(release)} drive={settle(drive)} character={driveCharacter(character)} irregularity={settle(irregularity)} disabled={disabled}/>}
  </PreviewValues>;
}

function ResponsePlot({ring, release, drive, character, irregularity, disabled}: {ring: number; release: number; drive: number; character: DriveCharacter; irregularity: number; disabled: boolean}) {
  const ringSeconds = .15 * Math.exp(4.38202663 * ring), releaseTime = releaseSeconds(release * 65535);
  // Fixed-size buffers, rebuilt only when an input changes.
  const data = useMemo(() => {
    // Hold long enough to see the ring, then show the release down to about −40 dB.
    const hold = Math.min(ringSeconds * .2, 2.5), after = Math.min(ringSeconds, releaseTime), total = hold + after * .67;
    const clean = new Float32Array(ringSamples), driven = new Float32Array(ringSamples), curve = new Float32Array(curvePoints);
    const wander = irregularity * irregularity * .12;
    let phase = 0;
    for (let i = 0; i < ringSamples; ++i) {
      const t = i / (ringSamples - 1) * total;
      const level = t <= hold ? Math.exp(-6.907755 * t / ringSeconds) : Math.exp(-6.907755 * hold / ringSeconds - 6.907755 * (t - hold) / after);
      phase += 2 * Math.PI * cycles / ringSamples * (1 + wander * Math.sin(i / ringSamples * 2 * Math.PI * 2.3));
      const value = peak * level * (Math.sin(phase) + .3 * Math.sin(2 * phase) + .15 * Math.sin(3 * phase)) / 1.25;
      clean[i] = value; driven[i] = stringDrive(value, drive, character);
    }
    for (let i = 0; i < curvePoints; ++i) curve[i] = stringDrive(peak * (2 * i / (curvePoints - 1) - 1), drive, character);
    return {clean, driven, curve, noteOff: hold / total, ceiling: driveCeiling(drive), wet: driveWet(drive)};
  }, [ringSeconds, releaseTime, drive, character, irregularity]);

  const paint = useCallback((ctx: CanvasRenderingContext2D, c: PlotColors) => {
    const {clean, driven, curve, noteOff, ceiling, wet} = data, mid = top + size / 2, unit = size / 2 / peak;
    const gradient = (x0: number, x1: number) => { const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, c.trace); g.addColorStop(1, c.accent); return g; };
    ctx.lineCap = ctx.lineJoin = 'round';
    // Frames and the zero line.
    ctx.strokeStyle = c.border; ctx.lineWidth = 1;
    ctx.strokeRect(8.5, top + .5, size - 1, size - 1);
    ctx.beginPath(); ctx.moveTo(ringX, mid); ctx.lineTo(ringX + ringWidth, mid); ctx.stroke();
    // The output ceiling every shape is bounded by.
    if (wet) {
      ctx.strokeStyle = c.accent; ctx.globalAlpha = .55; ctx.setLineDash([3, 4]); ctx.beginPath();
      for (const y of [mid - ceiling * unit, mid + ceiling * unit]) { ctx.moveTo(8, y); ctx.lineTo(8 + size, y); ctx.moveTo(ringX, y); ctx.lineTo(ringX + ringWidth, y); }
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    // Transfer: the clean diagonal and the driven curve.
    ctx.strokeStyle = c.text; ctx.globalAlpha = .35; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(8, top + size); ctx.lineTo(8 + size, top); ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = disabled ? .4 : 1; ctx.strokeStyle = gradient(8, 8 + size); ctx.lineWidth = 2.6; ctx.beginPath();
    for (let i = 0; i < curvePoints; ++i) { const x = 8 + i * size / (curvePoints - 1), y = mid - curve[i] * unit; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    // Ring: the clean note behind, the driven note on top.
    const trace = (wave: Float32Array) => { ctx.beginPath(); for (let i = 0; i < ringSamples; ++i) { const x = ringX + i * ringWidth / (ringSamples - 1), y = mid - wave[i] * unit; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); };
    if (wet) { ctx.globalAlpha = .28; ctx.strokeStyle = c.text; ctx.lineWidth = 1; trace(clean); }
    ctx.globalAlpha = disabled ? .45 : 1; ctx.strokeStyle = gradient(ringX, ringX + ringWidth); ctx.lineWidth = 1.7; trace(driven);
    // Note-off marker and labels.
    const offX = ringX + noteOff * ringWidth;
    ctx.globalAlpha = .6; ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(offX, top); ctx.lineTo(offX, top + size); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = c.text; ctx.globalAlpha = .85; ctx.font = `9px ${c.font}`;
    ctx.fillText('in → out', 12, top + size - 4);
    ctx.fillText('note off', offX + 4, top + size - 4);
    ctx.fillText(wet ? 'driven · clean behind' : 'clean', ringX + 4, top + 9);
    if (wet) { ctx.textAlign = 'right'; ctx.fillStyle = c.accent; ctx.fillText('ceiling', ringX + ringWidth - 2, mid - ceiling * unit - 3); }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }, [data, disabled]);

  const label = `String response: ${characterNames[character]} drive ${Math.round(drive * 100)}%, ring ${ringSeconds.toFixed(2)} s, release ${releaseTime < 1 ? `${Math.round(releaseTime * 1000)} ms` : `${releaseTime.toFixed(2)} s`}`;
  return <CanvasPlot className="string-response-plot" width={width} height={height} role="img" aria-label={label} paint={paint}/>;
}

/** Static button glyphs: each character's shape at full Drive. */
export const driveGlyphs = ([0, 1, 2] as DriveCharacter[]).map(character => {
  let path = '';
  for (let i = 0; i <= 24; ++i) {
    const value = saturate(.75 * (i / 12 - 1), character, .8);
    path += `${i ? 'L' : 'M'}${i} ${(7 - value / .2 * 5).toFixed(1)}`;
  }
  return path;
});

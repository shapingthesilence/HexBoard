import {useCallback, useMemo} from 'react';
import {CanvasPlot, type PlotColors} from './CanvasPlot.tsx';
import {PreviewValues} from './SynthVisualPreview.tsx';
import {springDirection, springResponse, springSigned, springSource, springSourceNames, springWords} from './pitchSpring.ts';

// Plot geometry in viewBox units: the bend lane above the gesture that causes it.
const width = 600, height = 104, left = 8, plotWidth = 560, top = 8, lane = 64, mid = top + lane / 2, gestureTop = 78, gestureHeight = 14;
/** Displacement shown at the lane edge; Bounce overshoots past one Amount. */
const range = (peak: number) => Math.max(1.15, peak * 1.08);
const signed = (cents: number) => `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${Math.abs(cents).toFixed(Math.abs(cents) < 10 ? 1 : 0)} ct`;

/** How the bend answers a standard gesture, with the selected note's live bend beside it. */
export function PitchSpringView({settings}: {settings: number[]}) {
  // Only the spring's own words reshape the picture; other edits reuse it.
  const key = [springWords.source, springWords.return, springWords.bounce, springWords.weight, springWords.direction].map(i => settings[i]).join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const response = useMemo(() => springResponse(settings), [key]);
  const amount = 200 * springSigned(settings[springWords.amount]), source = springSourceNames[springSource(settings)], scale = range(response.peak);
  const paint = useCallback((ctx: CanvasRenderingContext2D, c: PlotColors) => {
    const {bend, gesture, marks} = response, unit = lane / 2 / scale, flip = amount < 0 ? -1 : 1, x = (i: number, n: number) => left + i * plotWidth / (n - 1);
    ctx.lineCap = ctx.lineJoin = 'round'; ctx.font = `9px ${c.font}`;
    // Zero line and the ±Amount guides the curve is measured against.
    ctx.strokeStyle = c.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, mid); ctx.lineTo(left + plotWidth, mid); ctx.stroke();
    ctx.strokeStyle = c.text; ctx.globalAlpha = .3; ctx.setLineDash([2, 4]); ctx.beginPath();
    for (const y of [mid - unit, mid + unit]) { ctx.moveTo(left, y); ctx.lineTo(left + plotWidth, y); }
    ctx.stroke(); ctx.setLineDash([]);
    // The gesture: pressure, or the board's angle for Rock.
    ctx.fillStyle = c.text; ctx.globalAlpha = .2; ctx.beginPath(); ctx.moveTo(left, gestureTop + gestureHeight);
    for (let i = 0; i < gesture.length; ++i) ctx.lineTo(x(i, gesture.length), gestureTop + gestureHeight - gesture[i] * gestureHeight);
    ctx.lineTo(left + plotWidth, gestureTop + gestureHeight); ctx.closePath(); ctx.fill();
    // Stage markers tie each lobe of the bend to what the hand did.
    ctx.globalAlpha = .45; ctx.strokeStyle = c.text; ctx.setLineDash([2, 3]); ctx.beginPath();
    for (const mark of marks) if (mark.at > 0) { const at = left + mark.at * plotWidth; ctx.moveTo(at, top); ctx.lineTo(at, gestureTop + gestureHeight); }
    ctx.stroke(); ctx.setLineDash([]);
    ctx.globalAlpha = .85; ctx.fillStyle = c.text;
    for (const mark of marks) ctx.fillText(mark.label, left + mark.at * plotWidth + 4, gestureTop + gestureHeight + 9);
    ctx.fillText(amount ? signed(amount) : 'no bend', left + 2, mid - unit - 3);
    if (amount) ctx.fillText(signed(-amount), left + 2, mid + unit + 10);
    ctx.textAlign = 'right'; ctx.fillText(laneNames[springSource(settings)], left + plotWidth - 14, gestureTop + 8); ctx.textAlign = 'left';
    // The bend itself; muted while Amount is zero so the shape still reads.
    const gradient = ctx.createLinearGradient(left, 0, left + plotWidth, 0); gradient.addColorStop(0, c.trace); gradient.addColorStop(1, c.accent);
    ctx.globalAlpha = amount ? 1 : .35; ctx.strokeStyle = amount ? gradient : c.text; ctx.lineWidth = 2.2; ctx.beginPath();
    for (let i = 0; i < bend.length; ++i) { const y = mid - flip * bend[i] * unit; if (i) ctx.lineTo(x(i, bend.length), y); else ctx.moveTo(x(i, bend.length), y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, amount, scale]);
  const direction = springDirectionNames[springDirection(settings)].toLowerCase();
  const label = `Pitch spring response to ${source}: ${amount ? `${signed(amount)} at full travel` : 'no bend'}, ${direction}`;
  // Live bend on the same axis as the curve; the base Amount sets one unit.
  const axis = (Math.abs(amount) || 200) * scale;
  return <div className="pitch-spring-view">
    <CanvasPlot className="pitch-spring-plot" width={width} height={height} role="img" aria-label={label} paint={paint}/>
    <PreviewValues ids={[35]}>{([cents]) => <div className="pitch-spring-meter" title="Approximation for the displayed note" role="meter" aria-label="Pitch spring gesture preview" aria-valuemin={-350} aria-valuemax={350} aria-valuenow={Math.round(cents)} aria-valuetext={signed(cents)}>
      <i style={{top: `${top / height * 100}%`, height: `${lane / height * 100}%`}}/>
      <span style={{top: `${(mid - Math.max(-1, Math.min(1, cents / axis)) * lane / 2) / height * 100}%`}}/>
      <output>{signed(cents)}</output>
    </div>}</PreviewValues>
  </div>;
}

const laneNames = ['pressure', 'board angle'];
export const springDirectionNames = ['Both ways', 'Up only', 'Down only'];
/** Button glyphs: which side of the tuned pitch the bend may reach. */
export const directionGlyphs = ['M1 7 C4 7 4 2 7 2 S10 7 12 7 S15 12 17 12 S21 7 23 7', 'M1 10 C6 10 7 3 12 3 S18 10 23 10', 'M1 4 C6 4 7 11 12 11 S18 4 23 4'];
/** Pressure: a press onto the key; Rock: a rocking arc. */
export const springSourceGlyphs = ['M12 1 V8 M8.5 5 L12 8.5 L15.5 5 M4 12.5 H20', 'M3 10 Q12 1 21 10 M3 10 L3.5 6 M3 10 L7 10.5 M21 10 L20.5 6 M21 10 L17 10.5'];
export const springSourceHelp = [
  'Pressure on each key: pressing in bends, holding settles, easing off bends back',
  'Rocking the board kicks every sounding note; Return sets how long the kick lingers. Holding it tilted does nothing'];

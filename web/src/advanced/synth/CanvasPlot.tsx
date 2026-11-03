import {useLayoutEffect, useRef, type CanvasHTMLAttributes} from 'react';
import {canvasSize} from './canvasSize.ts';

export interface PlotColors {
  trace: string; accent: string; frame: string; spread: string; scope: string;
  border: string; edge: string; raised: string; brand: string; text: string; foreground: string;
  font: string;
}
type Props = Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'width' | 'height'> & {
  width: number; height: number;
  paint: (context: CanvasRenderingContext2D, colors: PlotColors) => void;
};

/** Reuse one bounded backing surface. Live plots do not create SVG path/style objects. */
export function CanvasPlot({width, height, paint, style, ...props}: Props) {
  const root = useRef<HTMLCanvasElement>(null), draw = useRef(paint), repaint = useRef<() => void>(() => {});
  draw.current = paint;
  useLayoutEffect(() => {
    const canvas = root.current!, context = canvas.getContext('2d');
    if (!context) return;
    let colors: PlotColors, visible = true;
    const theme = () => {
      const css = getComputedStyle(canvas), value = (key: string, fallback: string) => css.getPropertyValue(key).trim() || fallback;
      // Engine identity colors (SynthIdentity.css); Wavetable's --wt-* tokens alias these.
      colors = {trace: value('--synth-1', '#8a3ff0'), accent: value('--synth-2', '#d0459c'), frame: value('--wt-frame', '#8f86a8'), spread: value('--wt-spread', '#b79cff'), scope: value('--synth-scope', '#f6f3fc'), border: value('--border', '#ccc'), edge: value('--border-strong', '#999'), raised: value('--surface-raised', '#fff'), brand: value('--brand', '#6b45c9'), text: value('--text-soft', '#666'), foreground: css.color, font: css.fontFamily};
    };
    const render = () => {
      if (!visible || document.hidden) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.save();
      // Match SVG's default xMidYMid meet, including fixed-height FX strips.
      const scale = Math.min(canvas.width / width, canvas.height / height);
      context.translate((canvas.width - width * scale) / 2, (canvas.height - height * scale) / 2);
      context.scale(scale, scale);
      try { draw.current(context, colors); } finally { context.restore(); }
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;
      const size = canvasSize(bounds.width, bounds.height, window.devicePixelRatio || 1);
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      render();
    };
    theme(); repaint.current = render;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const intersection = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) render();
    });
    intersection.observe(canvas);
    const themes = new MutationObserver(() => { theme(); render(); });
    themes.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme']});
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', render);
    resize();
    return () => {
      observer.disconnect(); intersection.disconnect(); themes.disconnect(); window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', render);
      repaint.current = () => {};
      // Release GPU/backing pixels promptly even if a detached React tree survives GC.
      canvas.width = canvas.height = 1;
    };
  }, [width, height]);
  useLayoutEffect(() => repaint.current(), [paint]);
  return <canvas {...props} ref={root} width={width} height={height} style={{...style, aspectRatio: `${width} / ${height}`}}/>;
}

function traceWave(context: Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo'>, wave: readonly number[], x: number, y: number, width: number, height: number, scale: number) {
  for (let i = 0; i < wave.length; ++i) {
    const px = Math.round((x + i * width / (wave.length - 1)) * 10) / 10, py = Math.round((y - wave[i] / scale * height) * 10) / 10;
    if (i) context.lineTo(px, py); else context.moveTo(px, py);
  }
}
export function strokeWave(context: CanvasRenderingContext2D, wave: readonly number[], x: number, y: number, width: number, height: number, scale: number) {
  context.beginPath(); traceWave(context, wave, x, y, width, height, scale);
}
/** Static contours own a fixed native path instead of rebuilding commands each frame. */
export function wavePath(wave: readonly number[], x: number, y: number, width: number, height: number, scale: number) {
  const path = new Path2D(); traceWave(path, wave, x, y, width, height, scale); return path;
}
export function plotDot(context: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  context.beginPath(); context.arc(x, y, radius, 0, 2 * Math.PI); context.fill();
}

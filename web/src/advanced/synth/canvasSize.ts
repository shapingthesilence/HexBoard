/** At most 8 MiB of RGBA pixels per plot, including on large/high-DPI displays. */
export function canvasSize(width: number, height: number, pixelRatio: number) {
  const scale = Math.min(Math.max(1, pixelRatio), 2, 2048 / Math.max(1, width), 1024 / Math.max(1, height));
  return {width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale))};
}

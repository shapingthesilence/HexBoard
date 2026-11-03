/** One visible animation loop, with no catch-up work after a slow or hidden frame. */
export function startVisibleAnimation(element: Element, paint: (now: number) => void) {
  let frame: number | undefined, last = -1, visible = true, disposed = false;
  const cancel = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; };
  const tick = (now: number) => {
    frame = undefined;
    if (disposed || document.hidden || !visible) return;
    // One update per 1/60-second bucket, including on 120/144 Hz displays.
    const bucket = Math.floor((now + .001) * 60 / 1000);
    if (bucket !== last) { last = bucket; paint(now); }
    schedule();
  };
  const schedule = () => {
    if (!disposed && !document.hidden && visible && frame === undefined) frame = requestAnimationFrame(tick);
  };
  const visibility = () => { cancel(); schedule(); };
  const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    visibility();
  });
  observer?.observe(element);
  document.addEventListener('visibilitychange', visibility);
  schedule();
  return () => { disposed = true; cancel(); observer?.disconnect(); document.removeEventListener('visibilitychange', visibility); };
}

/** CSS ease-in-out (cubic-bezier(.42, 0, .58, 1)) for clock-driven decorations. */
export function animationEase(position: number) {
  const x = Math.max(0, Math.min(1, position));
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; ++i) {
    const t = (lo + hi) / 2, inverse = 1 - t;
    const time = 3 * inverse * inverse * t * .42 + 3 * inverse * t * t * .58 + t * t * t;
    if (time < x) lo = t; else hi = t;
  }
  const t = (lo + hi) / 2;
  return t * t * (3 - 2 * t);
}

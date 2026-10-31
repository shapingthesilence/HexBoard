// Impulse response for the same fixed room used by the 44.1 kHz device bus.
// Delay times and damping scale to the browser context; no external audio assets.
export function reverbImpulse(sampleRate = 44100, seconds = 4, settings = {}) {
  const lengths = [1493, 1777, 1999, 2377, 113, 173, 263, 359].map((n) =>
      Math.max(1, Math.round((n * sampleRate) / 44100)),
    ),
    lines = lengths.map((n) => new Float32Array(n)),
    positions = new Uint32Array(8),
    damp = new Float32Array(4),
    alpha = 1 - Math.pow(1 - (.02+.88*Math.max(0,Math.min(1,settings.roomTone??.34090909))), 44100 / sampleRate),
    feedbackGain=.5*Math.exp(-6.907755279*(1911.5/44100)/Math.max(.2,Math.min(8,(settings.roomDecay??1600)/1000))),
    width=Math.max(0,Math.min(1,settings.roomWidth??1)),
    frames = Math.round(sampleRate * seconds),
    left = new Float32Array(frames),
    right = new Float32Array(frames);
  for (let n = 0; n < frames; n++) {
    let x = n === 0 ? 1 : 0;
    for (let i = 4; i < 8; i++) {
      const at = positions[i],
        y = lines[i][at] - 0.65 * x;
      lines[i][at] = x + 0.65 * y;
      positions[i] = (at + 1) % lengths[i];
      x = y;
    }
    x *= 0.4;
    for (let i = 0; i < 4; i++)
      damp[i] += alpha * (lines[i][positions[i]] - damp[i]);
    const [a, b, c, d] = damp;
    const feedback = [
      x + feedbackGain * (a + b + c + d),
      x + feedbackGain * (a - b + c - d),
      -x + feedbackGain * (a + b - c - d),
      -x + feedbackGain * (a - b - c + d),
    ];
    for (let i = 0; i < 4; i++) {
      lines[i][positions[i]] = feedback[i];
      positions[i] = (positions[i] + 1) % lengths[i];
    }
    const l=(a+c)*.5,r=(b+d)*.5,mid=(l+r)*.5,side=(l-r)*.5*width;left[n]=mid+side;right[n]=mid-side;
  }
  return [left, right];
}

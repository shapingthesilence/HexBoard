import { pagedLimits, residentLimits } from "./limits.mjs";
// One authoring contract for voice admission, browser audition and HBS export.
export function playbackLimits(patch, classic = false) {
  if (classic) return {voices:8,tails:0};
  const max = patch.storage === "resident" ? residentLimits.held : pagedLimits.held;
  const voices = patch.playback?.voices ?? residentLimits.held;
  const tails = patch.playback?.tails ?? 4;
  if (!Number.isInteger(voices) || voices < 1 || voices > max || !Number.isInteger(tails) || tails < 0 || tails > 4)
    throw Error(`Choose 1–${max} held voices and 0–4 release tails for Advanced.`);
  return { voices, tails };
}
export function resourceSummary(patch, classic = false) {
  const limits = playbackLimits(patch, classic);
  const pcm = patch.assets.reduce((n,a)=>n+((a.end??a.channels[0].length)-(a.start??0))*a.channels.length*2,0);
  const stereo = patch.assets.some(a=>a.channels.length===2);
  const streaming = !classic;
  return {...limits,pcm,stereo,streaming,readers:limits.voices+limits.tails,room:!!patch.settings?.space};
}

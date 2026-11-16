// One authoring contract for voice admission, browser audition and HBS export.
export function playbackLimits(patch, classic = false) {
  if (classic) return {voices:8,tails:0};
  const voices = patch.playback?.voices ?? 16;
  const tails = patch.playback?.tails ?? (classic ? 0 : 4);
  if (!Number.isInteger(voices) || voices < 1 || voices > (classic ? 8 : 16) || !Number.isInteger(tails) || tails < 0 || tails > (classic ? 0 : 4))
    throw Error('Choose 1–16 held voices and 0–4 release tails for Advanced.');
  return { voices, tails };
}
export function resourceSummary(patch, classic = false) {
  const limits = playbackLimits(patch, classic);
  const pcm = patch.assets.reduce((n,a)=>n+((a.end??a.channels[0].length)-(a.start??0))*a.channels.length*2,0);
  const stereo = patch.assets.some(a=>a.channels.length===2);
  const interior = patch.assets.some(a=>[1,3].includes(a.mode??0)&&((a.loopStart??0)!==(a.start??0)||(a.loopEnd??a.channels[0].length)!==(a.end??a.channels[0].length)));
  const sd = !classic && (patch.storage==='streaming'||(patch.storage!=='resident'&&(pcm*2>5.5*1048576||interior)));
  return {...limits,pcm,stereo,sd,readers:limits.voices+limits.tails,room:!!patch.settings?.space};
}

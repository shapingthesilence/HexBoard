// Wet impulse of the shared AMY stereo-reverb network (delay.c).
// Browser audition uses float arithmetic; device playback uses fixed point.
export function reverbImpulse(sampleRate=44100,seconds=4,settings={}) {
 const lengths=[2586,3062,3286,3798,3319,1920,1138,855,722,602].map(n=>Math.max(1,Math.round(n*sampleRate/44100)));
 const lines=lengths.map(n=>new Float32Array(n)),position=new Uint32Array(10),filter=new Float32Array(4),d=new Float64Array(4);
 const decay=Math.max(.2,Math.min(8,(settings.roomDecay??1600)/1000)),color=Math.max(0,Math.min(1,settings.roomTone??.34090909));
 const liveness=Math.exp(-6.907755279*(3183/44100)/decay),coefficient=Math.min(1,2*Math.PI*3000/sampleRate),bright=.1+.8*color;
 const width=Math.max(0,Math.min(1,settings.roomWidth??1)),frames=Math.round(sampleRate*seconds),left=new Float32Array(frames),right=new Float32Array(frames);
 const read=i=>lines[i][position[i]];
 const write=(i,x)=>{lines[i][position[i]]=x;position[i]=(position[i]+1)%lengths[i];};
 for(let n=0;n<frames;n++) {
  let r=n===0?.0625:0,l=r;
  for(let i=4;i<9;i++){write(i,l);const delayed=read(i);l=r-delayed;r+=delayed;}
  write(9,l);l=read(9);
  for(let i=0;i<4;i++){const x=read(i);filter[i]+=coefficient*(x-filter[i]);d[i]=.5*liveness*(filter[i]+bright*(x-filter[i]));}
  d[0]+=r;d[1]+=l;
  write(0,d[0]+d[1]+d[2]+d[3]);write(1,d[0]-d[1]+d[2]-d[3]);write(2,d[0]+d[1]-d[2]-d[3]);write(3,d[0]-d[1]-d[2]+d[3]);
  const mid=(d[0]+d[1])*.5,side=(d[0]-d[1])*.5*width;left[n]=mid+side;right[n]=mid-side;
 }
 return [left,right];
}

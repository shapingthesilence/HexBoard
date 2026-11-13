// Offline asset preparation; runtime imports only the generated PCM JSON.
import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
import {StbVorbis} from 'stb-vorbis';
import {prepareSamplePCM,sampleChecksum} from '../src/advanced/synth/sampleEditing.ts';
const base=new URL('../src/advanced/synth/attack-samples/',import.meta.url),sources=JSON.parse(await readFile(new URL('sources.json',base),'utf8'));
await StbVorbis.ready;const output=[];
for(const row of sources){
 const bytes=await readFile(new URL('sources/'+row.file,base));if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('Changed attack source '+row.file);
 const decoded=StbVorbis.decode(bytes),mono=Float32Array.from(decoded.channels[0],(_,i)=>decoded.channels.reduce((s,c)=>s+c[i],0)/decoded.channels.length);
 const peak=mono.reduce((p,v)=>Math.max(p,Math.abs(v)),0);let onset=mono.findIndex(v=>Math.abs(v)>peak*.015);onset=Math.max(0,onset-Math.round(decoded.sampleRate*.001));
 const ratio=decoded.sampleRate/16000,cutoff=.45/Math.max(1,ratio),count=Math.min(4096,Math.floor((mono.length-onset)/ratio)),radius=32;
 const resampled=Float32Array.from({length:count},(_,i)=>{const at=onset+i*ratio,center=Math.floor(at);let sum=0,weight=0;for(let j=center-radius;j<=center+radius;++j){const d=j-at;if(Math.abs(d)>radius)continue;const x=2*cutoff*d,k=2*cutoff*(Math.abs(x)<1e-10?1:Math.sin(Math.PI*x)/(Math.PI*x))*(.5+.5*Math.cos(Math.PI*d/radius));weight+=k;if(j>=0&&j<mono.length)sum+=mono[j]*k;}return sum/weight;});
 const frames=prepareSamplePCM(resampled,true,1,5);output.push({name:row.name,frames,source:row,crc:sampleChecksum(frames)});console.log(`${row.name}: ${frames.length} frames / ${(frames.length/16).toFixed(1)} ms`);
}
await writeFile(new URL('factory-attacks.json',base),JSON.stringify(output)+'\n');

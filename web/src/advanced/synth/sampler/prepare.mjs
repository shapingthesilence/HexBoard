// Pure browser/Node preparation. No WebAudio resampling assumptions; output
// duration and each level's source-time scale are explicit in HBS2.
export const rate=44100,magic=0x32534248;
export function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (~crc)>>>0;}
const align=n=>Math.ceil(n/512)*512;
const sinc=x=>Math.abs(x)<1e-12?1:Math.sin(Math.PI*x)/(Math.PI*x);
function window(x){return .35875+.48829*Math.cos(Math.PI*x)+.14128*Math.cos(2*Math.PI*x)+.01168*Math.cos(3*Math.PI*x);}
function wrap(n,length){return ((n%length)+length)%length;}
export function downsample(channels,periodic=false){
  const length=channels[0].length,out=channels.map(()=>new Float32Array(Math.ceil(length/2))),half=128,weights=[];
  let sum=0;for(let k=-half;k<=half;k++){const w=.45*sinc(.45*k)*window(k/half);weights.push(w);sum+=w;}
  for(let c=0;c<channels.length;c++)for(let n=0;n<out[c].length;n++){
    let v=0;if(periodic){const position=n*length/out[c].length,center=Math.floor(position),cutoff=.45*out[c].length/length;let norm=0;
      for(let k=center-half;k<=center+half;k++){const d=k-position,w=2*cutoff*sinc(2*cutoff*d)*window(d/half);v+=channels[c][wrap(k,length)]*w;norm+=w;}out[c][n]=v/norm;
    }else{for(let k=-half;k<=half;k++){const i=2*n+k;v+=(i>=0&&i<length?channels[c][i]:0)*weights[k+half];}out[c][n]=v/sum;}
  }
  return out;
}
export function resample(channels,inputRate,periodic=false){
  if(!Number.isFinite(inputRate)||inputRate<8000||inputRate>384000||channels.length<1||channels.length>2||channels.some(c=>!(c instanceof Float32Array)||c.length!==channels[0].length||c.some(v=>!Number.isFinite(v))))throw Error('Invalid recording.');
  if(inputRate===rate)return channels.map(c=>c.slice());
  const length=Math.round(channels[0].length*rate/inputRate),out=channels.map(()=>new Float32Array(length)),cutoff=.46*Math.min(1,rate/inputRate),radius=Math.ceil(64/Math.min(1,rate/inputRate));
  for(let n=0;n<length;n++){
    const at=n*inputRate/rate,center=Math.floor(at);let norm=0;const sums=channels.map(()=>0);
    for(let k=center-radius;k<=center+radius;k++){const d=k-at,w=2*cutoff*sinc(2*cutoff*d)*window(d/radius);norm+=w;for(let c=0;c<channels.length;c++)sums[c]+=(periodic?channels[c][wrap(k,channels[c].length)]:k>=0&&k<channels[c].length?channels[c][k]:0)*w;}
    for(let c=0;c<out.length;c++)out[c][n]=sums[c]/norm;
  }return out;
}
export function wav(bytes){
  const v=new DataView(bytes),tag=at=>String.fromCharCode(...new Uint8Array(bytes,at,4));
  if(v.byteLength<12||tag(0)!=='RIFF'||tag(8)!=='WAVE'||v.getUint32(4,true)+8>v.byteLength)throw Error('Choose a complete PCM or float WAV file.');
  let fmt,data;for(let at=12;at+8<=v.byteLength;){const size=v.getUint32(at+4,true),end=at+8+size;if(end>v.byteLength)throw Error('Truncated WAV chunk.');if(tag(at)==='fmt '){if(size<16)throw Error('Invalid WAV format.');fmt={kind:v.getUint16(at+8,true),channels:v.getUint16(at+10,true),rate:v.getUint32(at+12,true),block:v.getUint16(at+20,true),bits:v.getUint16(at+22,true)};}if(tag(at)==='data')data={at:at+8,size};at=end+(size&1);}
  // Public multisample libraries commonly use WAVE_FORMAT_EXTENSIBLE for
  // ordinary stereo PCM24. Validate its GUID and channel layout explicitly.
  if(fmt?.kind===65534){
    let at=12;while(at+8<=v.byteLength&&tag(at)!=='fmt ')at+=8+v.getUint32(at+4,true)+(v.getUint32(at+4,true)&1);
    const size=v.getUint32(at+4,true),base=at+8,tail=[0,0,0,0,16,0,128,0,0,170,0,56,155,113];
    if(size<40||v.getUint16(base+16,true)!==22||v.getUint16(base+18,true)!==fmt.bits||tail.some((x,i)=>v.getUint8(base+26+i)!==x)||![0,fmt.channels===1?4:3].includes(v.getUint32(base+20,true)))throw Error('Unsupported extensible WAV layout.');
    fmt.kind=v.getUint16(base+24,true);
  }
  if(!fmt||!data||![1,2].includes(fmt.channels)||!(fmt.kind===1&&[16,24,32].includes(fmt.bits)||fmt.kind===3&&fmt.bits===32)||fmt.block!==fmt.channels*fmt.bits/8||data.size%fmt.block)throw Error('Use mono/stereo PCM16, PCM24, PCM32 or float32 WAV.');
  const channels=Array.from({length:fmt.channels},()=>new Float32Array(data.size/fmt.block));
  for(let n=0;n<channels[0].length;n++)for(let c=0;c<fmt.channels;c++){const at=data.at+n*fmt.block+c*fmt.bits/8;let value;if(fmt.kind===3)value=v.getFloat32(at,true);else if(fmt.bits===16)value=v.getInt16(at,true)/32768;else if(fmt.bits===32)value=v.getInt32(at,true)/2147483648;else{let x=v.getUint8(at)|(v.getUint8(at+1)<<8)|(v.getUint8(at+2)<<16);if(x&0x800000)x-=0x1000000;value=x/8388608;}if(!Number.isFinite(value))throw Error('Recording contains invalid samples.');channels[c][n]=value;}
  return {channels,rate:fmt.rate};
}
const logPitch=midi=>Math.round((Math.log2(440)+(midi-69)/12)*2**24);
export function suggestRoot(channels){
  // Advisory autocorrelation only. Anti-aliasing never depends on this result.
  const data=channels[0],count=Math.min(8192,data.length),begin=Math.min(Math.floor(data.length*.1),Math.max(0,data.length-count));
  if(count<1024)return undefined;
  let best=0,lag=0;for(let k=22;k<=Math.min(1102,Math.floor(count/3));k++){let cross=0,a=0,b=0;for(let i=0;i<count-k;i+=2){const x=data[begin+i],y=data[begin+i+k];cross+=x*y;a+=x*x;b+=y*y;}const score=cross/Math.sqrt(a*b+1e-30);if(score>best){best=score;lag=k;}if(best>.98&&k>lag*1.1)break;}
  if(best<.85)return undefined;const hz=rate/lag;return {midi:69+12*Math.log2(hz/440),confidence:best};
}
export async function preparePatch(input,onProgress=()=>{}){
  if(!input||!Array.isArray(input.assets)||!input.assets.length||input.assets.length>128)throw Error('Choose 1–128 recordings.');
  let levelCount=0;const assets=[];
  for(let a=0;a<input.assets.length;a++){
    const src=input.assets[a];if(!Number.isFinite(src.rootMidi)||src.rootMidi<0||src.rootMidi>127||![0,1,2].includes(src.mode??0))throw Error('Invalid sample root or playback mode.');
    let channels=resample(src.channels,src.rate,src.mode===1);if(channels[0].length<4||channels[0].length>rate*1800)throw Error('Choose a recording between four frames and 30 minutes.');
    if(src.mode!==1){const fade=Math.min(Math.floor(channels[0].length/2),Math.round(rate*.002));channels=channels.map(c=>Float32Array.from(c,(x,i)=>x*Math.min(1,i/Math.max(1,fade),(c.length-1-i)/Math.max(1,fade))));}
    const floatLevels=[],firstLevel=levelCount,frames=channels[0].length,channelCount=channels.length;
    for(let n=0;n<12;n++){
      onProgress({asset:a,total:input.assets.length,level:n,label:`Preparing ${src.name??'recording'} · level ${n+1}`});
      floatLevels.push(channels);levelCount++;
      if(channels[0].length<=4)break;
      channels=downsample(channels,src.mode===1);
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    // One gain for every representation. FIR overshoot must never be clipped
    // independently: clipping a pruned level would create new harmonics.
    let peak=0;for(const level of floatLevels)for(const c of level)for(const x of c)peak=Math.max(peak,Math.abs(x));
    const gain=src.normalize&&peak>0?.95/peak:Math.min(1,.98/(peak||1));
    const levels=floatLevels.map((data,n)=>{
      const pcm=new Int16Array(data[0].length*channelCount);let seed=(a+1)*0x12345+n+1;
      const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
      for(let i=0;i<data[0].length;i++)for(let c=0;c<channelCount;c++)pcm[i*channelCount+c]=Math.round(data[c][i]*gain*32768+(random()-random())*.5);
      return pcm;
    });
    assets.push({...src,frames,channels:channels.length,firstLevel,levels});
  }
  const zones=input.zones??assets.map((a,i)=>({asset:i,lowMidi:0,highMidi:127,key:65535,velocityLow:1,velocityHigh:127,gain:1,pan:0}));
  if(!zones.length||zones.length>256)throw Error('Use 1–256 sample zones.');
  const metadata=align(128+assets.length*48+levelCount*16+zones.length*32);let total=metadata;
  for(const a of assets)for(const pcm of a.levels)total=align(total+pcm.byteLength);
  if(total>0x40000000)throw Error('Prepared patch exceeds 1 GiB.');
  const bytes=new Uint8Array(total),v=new DataView(bytes.buffer),u16=(at,x)=>v.setUint16(at,x,true),u32=(at,x)=>v.setUint32(at,x,true);
  u32(0,magic);u16(4,1);u16(6,128);u32(8,rate);u16(12,assets.length);u16(14,levelCount);u16(16,zones.length);u32(20,total);u32(24,metadata);
  const s=input.settings??{},settings=[s.attack??5,s.decay??150,Math.round((s.sustain??.8)*65535),s.release??300,s.cutoff??18000,Math.round(((s.resonance??.7)-.5)/3.5*65535),Math.round((s.pressure??.5)*65535),Math.round((s.space??.1)*65535)];
  if(settings.some(x=>!Number.isFinite(x)||x<0||x>65535)||settings[0]>10000||settings[1]>20000||settings[3]>20000||settings[4]<40||settings[4]>20000)throw Error('Invalid sound controls.');
  settings.forEach((x,i)=>u16(48+2*i,Math.round(x)));bytes.set(new TextEncoder().encode(input.name??'New sampler').slice(0,32),64);
  let pcmAt=metadata,levelIndex=0;
  assets.forEach((a,i)=>{const at=128+i*48;u32(at,a.frames);u32(at+4,logPitch(a.rootMidi));if(a.mode===1)u32(at+12,a.frames);u16(at+20,a.firstLevel);u16(at+22,a.levels.length);bytes[at+24]=a.channels;bytes[at+25]=a.mode??0;
    for(const pcm of a.levels){const record=128+assets.length*48+levelIndex++*16;u32(record,pcmAt);u32(record+4,pcm.length/a.channels);const pcmBytes=new Uint8Array(pcm.buffer);bytes.set(pcmBytes,pcmAt);u32(record+8,crc32(pcmBytes));pcmAt=align(pcmAt+pcm.byteLength);}
  });
  zones.forEach((z,i)=>{if(!Number.isInteger(z.asset)||!assets[z.asset]||![z.lowMidi??0,z.highMidi??127,z.gain??1,z.pan??0].every(Number.isFinite)||(z.lowMidi??0)>(z.highMidi??127)||(z.lowMidi??0)<-120||(z.highMidi??127)>180||(z.gain??1)<0||(z.gain??1)>=2||Math.abs(z.pan??0)>1||!Number.isInteger(z.key??65535)||!(z.key===undefined||z.key===65535||z.key>=0&&z.key<133)||!Number.isInteger(z.velocityLow??1)||!Number.isInteger(z.velocityHigh??127)||(z.velocityLow??1)<1||(z.velocityHigh??127)>127||(z.velocityLow??1)>(z.velocityHigh??127)||!Number.isInteger(z.choke??0)||(z.choke??0)<0||(z.choke??0)>16||!Number.isInteger(z.roundRobin??0)||(z.roundRobin??0)<0||(z.roundRobin??0)>15)throw Error('Invalid sample zone.');
    const at=128+assets.length*48+levelCount*16+i*32;u32(at,logPitch(z.lowMidi??0));u32(at+4,logPitch(z.highMidi??127));u16(at+8,z.asset);u16(at+10,z.key??65535);bytes[at+12]=z.velocityLow??1;bytes[at+13]=z.velocityHigh??127;bytes[at+14]=z.choke??0;bytes[at+15]=z.roundRobin??0;u16(at+16,Math.round((z.gain??1)*32768));v.setInt16(at+18,Math.round((z.pan??0)*32767),true);bytes[at+20]=z.fixed?1:0;if(z.color!==undefined){if(typeof z.color!=='string'||!/^#[0-9a-f]{6}$/i.test(z.color)||z.key===undefined||z.key===65535)throw Error('Key colors need a physical key and an RGB color.');const rgb=parseInt(z.color.slice(1),16);bytes[at+21]=rgb>>>16;bytes[at+22]=rgb>>>8&255;bytes[at+23]=rgb&255;bytes[at+24]=1;}
  });
  u32(28,crc32(bytes.subarray(128,metadata)));u32(32,crc32(bytes.subarray(metadata)));u32(36,crc32(bytes.subarray(0,128)));
  return {bytes,assets:assets.map(a=>({name:a.name,frames:a.frames,levels:a.levels.length,channels:a.channels})),sourceBytes:assets.reduce((n,a)=>n+a.frames*a.channels*2,0),residentBytes:assets.reduce((n,a)=>n+a.levels.reduce((m,pcm)=>m+pcm.byteLength,0),0)};
}

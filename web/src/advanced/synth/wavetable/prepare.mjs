// Pure preparation shared with native host contracts. No browser audio decoder:
// cycle counts and Serum/Vital CLM metadata must survive decoding exactly.
export const frameCount=16,levelBits=[10,10,9,9,8,8,7,7,6,6,5,5,5,5,5,5,5];
export const payloadBytes=levelBits.reduce((n,b)=>n+16*((1<<b)+1)*2,0),assetBytes=32+payloadBytes;
export function crc32(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
export function fft(re,im,inverse=false){
 const n=re.length;if(!n||(n&(n-1))||im.length!==n)throw Error('Invalid transform size.');
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len*=2){const a=(inverse?2:-2)*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let at=0;at<n;at+=len){let r=1,t=0;for(let j=0;j<len/2;j++){const b=at+j+len/2,k=at+j,x=re[b]*r-im[b]*t,y=re[b]*t+im[b]*r;re[b]=re[k]-x;im[b]=im[k]-y;re[k]+=x;im[k]+=y;const next=r*wr-t*wi;t=r*wi+t*wr;r=next;}}}
 if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
export function decodeTable(input,options={}){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length>32*1024*1024)throw Error('Choose a WAV table smaller than 32 MB.');
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),text=(p,n)=>String.fromCharCode(...bytes.subarray(p,p+n));
 if(bytes.length<12||text(0,4)!=='RIFF'||text(8,4)!=='WAVE')throw Error('Choose a WAV wavetable exported from Serum or Vital.');
 const end=v.getUint32(4,true)+8;if(end>bytes.length||end<12)throw Error('The WAV file is incomplete.');
 let format,offset=-1,size=0,metadataSize;
 for(let p=12;p+8<=end;){const id=text(p,4),n=v.getUint32(p+4,true),at=p+8;if(at+n>end)throw Error('The WAV contains a truncated chunk.');
  if(id==='fmt '){if(n<16)throw Error('Invalid WAV format.');let type=v.getUint16(at,true);if(type===0xfffe){const guid=[0,0,0,0,16,0,128,0,0,170,0,56,155,113];if(n<40||v.getUint16(at+16,true)<22||!guid.every((b,i)=>bytes[at+26+i]===b))throw Error('Invalid extended WAV format.');type=v.getUint16(at+24,true);}format={type,channels:v.getUint16(at+2,true),align:v.getUint16(at+12,true),bits:v.getUint16(at+14,true)};}
  if(id==='data'){offset=at;size=n;}
  if(id==='clm '){const match=text(at,Math.min(n,512)).match(/<!>\s*(\d+)/);if(match)metadataSize=+match[1];}
  p=at+n+(n&1);
 }
 if(!format||offset<0)throw Error('The WAV needs format and audio data chunks.');
 const {type,channels,align,bits}=format;
 if(![1,2].includes(channels)||!((type===1&&[8,16,24,32].includes(bits))||(type===3&&[32,64].includes(bits)))||align!==channels*bits/8||size%align)throw Error('Use mono/stereo PCM or floating-point WAV audio.');
 const samples=size/align,cycle=options.frameSize??metadataSize??(samples<2048?samples:2048);
 if(!Number.isInteger(cycle)||cycle<32||cycle>8192||(cycle&(cycle-1)))throw Error('Choose a frame size from 32 to 8192 samples (a power of two).');
 if(!samples||samples%cycle||samples/cycle>2048)throw Error(`The audio must contain whole ${cycle}-sample frames. Set the frame size in More options.`);
 const channel=options.channel??'left';if(!['left','right','mix'].includes(channel))throw Error('Invalid channel selection.');
 const result=new Float32Array(samples);
 function sample(p){if(type===3)return bits===32?v.getFloat32(p,true):v.getFloat64(p,true);if(bits===8)return (v.getUint8(p)-128)/128;if(bits===16)return v.getInt16(p,true)/32768;if(bits===32)return v.getInt32(p,true)/2147483648;let x=v.getUint8(p)|v.getUint8(p+1)<<8|v.getUint8(p+2)<<16;return (x&0x800000?x-0x1000000:x)/8388608;}
 for(let i=0;i<samples;i++){const at=offset+i*align,l=sample(at),r=channels===2?sample(at+bits/8):l;if(!Number.isFinite(l)||!Number.isFinite(r))throw Error('The table contains invalid audio samples.');result[i]=channel==='mix'?(l+r)/2:channel==='right'?r:l;}
 return {samples:result,frameSize:cycle,frames:samples/cycle,channels,detectedFrameSize:metadataSize,warnings:!metadataSize&&samples>=2048?['Using 2048 samples per frame, the usual Serum/Vital WAV layout.']:[]};
}
export function prepareTable(input,options={}){
 const source=decodeTable(input,options),first=options.firstFrame??0,last=options.lastFrame??source.frames-1;
 if(!Number.isInteger(first)||!Number.isInteger(last)||first<0||last<first||last>=source.frames)throw Error('Choose a valid source frame range.');
 const reduction=options.reduction??'blend',normalization=options.normalization??'table';
 if(!['blend','nearest','spectral'].includes(reduction)||!['table','preserve'].includes(normalization))throw Error('Invalid table preparation settings.');
 const spectra=new Map();
 function spectrum(f){if(spectra.has(f))return spectra.get(f);const n=source.frameSize,re=Float64Array.from(source.samples.subarray(f*n,(f+1)*n)),im=new Float64Array(n);fft(re,im);for(let h=0;h<n;h++){re[h]/=n;im[h]/=n;}if(options.removeDc!==false)re[0]=0;
  if(options.alignPhase){const phase=Math.atan2(im[1],re[1]);if(Math.hypot(re[1],im[1])>1e-9)for(let h=1;h<n/2;h++){const a=-h*phase,x=re[h]*Math.cos(a)-im[h]*Math.sin(a);im[h]=re[h]*Math.sin(a)+im[h]*Math.cos(a);re[h]=x;}}
  const out={re,im};spectra.set(f,out);return out;
 }
 const selected=[];
 for(let f=0;f<16;f++){let pos=first+(last-first)*f/15;if(reduction==='nearest')pos=Math.round(pos);const lo=Math.floor(pos),hi=Math.min(last,lo+1),t=pos-lo,a=spectrum(lo),b=spectrum(hi);const re=new Float64Array(257),im=new Float64Array(257);
  for(let h=0;h<=256&&h<source.frameSize/2;h++){
   if(reduction==='spectral'&&h){const ma=Math.hypot(a.re[h],a.im[h]),mb=Math.hypot(b.re[h],b.im[h]),pa=Math.atan2(a.im[h],a.re[h]),pb=Math.atan2(b.im[h],b.re[h]);let delta=pb-pa;delta-=2*Math.PI*Math.round(delta/(2*Math.PI));const phase=pa+delta*t,mag=ma+(mb-ma)*t;re[h]=mag*Math.cos(phase);im[h]=mag*Math.sin(phase);}
   else {re[h]=a.re[h]+t*(b.re[h]-a.re[h]);im[h]=a.im[h]+t*(b.im[h]-a.im[h]);}
  }selected.push({re,im});
 }
 if(options.smoothFrames){const old=selected.map(s=>({re:s.re.slice(),im:s.im.slice()}));for(let f=1;f<15;f++)for(let h=0;h<=256;h++){selected[f].re[h]=.25*old[f-1].re[h]+.5*old[f].re[h]+.25*old[f+1].re[h];selected[f].im[h]=.25*old[f-1].im[h]+.5*old[f].im[h]+.25*old[f+1].im[h];}}
 const rendered=[],preview=new Float32Array(16*1024);let peak=0;
 for(let level=0;level<17;level++){const n=1<<levelBits[level],cut=256/2**(level/2),start=Math.max(1,cut/2);
  for(let f=0;f<16;f++){const re=new Float64Array(n),im=new Float64Array(n);re[0]=selected[f].re[0]*n;
   for(let h=1;h<=Math.min(256,Math.floor(cut),n/2-1);h++){const taper=h<=start?1:.5+.5*Math.cos(Math.PI*Math.log2(h/(cut/2)));re[h]=selected[f].re[h]*n*taper;im[h]=selected[f].im[h]*n*taper;re[n-h]=re[h];im[n-h]=-im[h];}
   fft(re,im,true);for(const x of re)peak=Math.max(peak,Math.abs(x));rendered.push(re);
  }
 }
 if(!(peak>1e-9))throw Error('This frame range contains no audible waveform.');
 // One gain for every frame AND level; spectral pruning can increase peaks.
 const scale=(normalization==='table'?30000/32768:Math.min(peak,30000/32768))/peak;
 const bytes=new Uint8Array(assetBytes),v=new DataView(bytes.buffer);let at=32;
 for(let i=0;i<rendered.length;i++){const frame=rendered[i];for(let j=0;j<=frame.length;j++){const sample=Math.max(-32767,Math.min(32767,Math.round(frame[j%frame.length]*scale*32768)));v.setInt16(at,sample,true);at+=2;if(i<16&&j<1024)preview[i*1024+j]=sample/32768;}}
 const checksum=crc32(bytes.subarray(32));if(!checksum)throw Error('Please adjust the source range and prepare again.');
 for(const [offset,value] of [[0,0x31545748],[4,1],[8,payloadBytes],[12,checksum],[16,16],[20,17]])v.setUint32(offset,value,true);
 return {bytes,crc:checksum,preview,source,warnings:source.warnings};
}
export function validateAsset(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length!==assetBytes)throw Error('Invalid prepared table size.');const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(v.getUint32(0,true)!==0x31545748||v.getUint32(4,true)!==1||v.getUint32(8,true)!==payloadBytes||!v.getUint32(12,true)||v.getUint32(16,true)!==16||v.getUint32(20,true)!==17||v.getUint32(24,true)||v.getUint32(28,true)||crc32(bytes.subarray(32))!==v.getUint32(12,true))throw Error('The prepared table is damaged or uses another format.');
 let at=32;for(const b of levelBits)for(let f=0;f<16;f++){const end=at+(1<<b)*2;if(v.getInt16(at,true)!==v.getInt16(end,true))throw Error('Invalid table frame boundary.');at=end+2;}return v.getUint32(12,true);
}

import {preparePatch,wav,suggestRoot,resample,downsample,rate,type Patch} from './prepare.mjs';
self.onmessage=async(event:MessageEvent)=>{try{
 const request=event.data;
 if(request.operation==='import'){
  const recordings=request.files.map((file:{name:string;bytes:ArrayBuffer})=>{const decoded=wav(file.bytes),channels=resample(decoded.channels,decoded.rate),root=suggestRoot(channels);return {name:file.name.replace(/\.wav$/i,''),channels,rate,rootMidi:root?Math.round(root.midi*100)/100:60,confidence:root?.confidence??0,mode:0};});
  self.postMessage({result:recordings});return;
 }
 if(request.operation==='preview'){
  const asset=request.asset;let channels=resample(asset.channels,asset.rate,asset.mode===1),speed=2**((request.midi-asset.rootMidi)/12);
  while(speed>=2&&channels[0].length>4){channels=downsample(channels,asset.mode===1);speed/=2;}
  channels=channels.map(c=>c.subarray(0,Math.min(c.length,Math.ceil(rate*speed*2))));
  const result=resample(channels,rate*speed,asset.mode===1);self.postMessage({result});return;
 }
 const result=await preparePatch(request.patch as Patch,progress=>self.postMessage({progress}));self.postMessage({result}, {transfer:[result.bytes.buffer]});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};

import {reverbImpulse} from './reverb.mjs';
self.onmessage=(event:MessageEvent)=>{const {id,rate,settings}=event.data;const channels=reverbImpulse(rate,Math.max(4,(settings.roomDecay??1600)/1000*1.5),settings);self.postMessage({id,channels}, {transfer:channels.map(c=>c.buffer)});};

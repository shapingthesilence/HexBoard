import {fxRouteDepth} from './fxRouting.ts';import {fxSourceIds,type FxRack} from './schema.ts';
// UI-only frequency response of the same two-pole TPT design as the audio
// filter. Includes complex dry/wet summation; never feeds DSP or the transport.
export function filterResponse(cutoff:number,resonance:number,mix:number,mode:number,hz:number){
 const f=20*2**(9.813781*cutoff),k=2/(1+15*resonance),w=Math.tan(Math.PI*Math.min(20000,hz)/44100)/Math.tan(Math.PI*f/44100);
 const a=1-w*w,b=k*w,d=a*a+b*b;
 const real=mode===0?a/d:mode===1?b*b/d:-w*w*a/d,imag=mode===0?-b/d:mode===1?b*a/d:w*w*b/d;
 return Math.hypot(1-mix+mix*real,mix*imag);
}
export function FilterResponse({rack,sources=[]}:{rack:FxRack;sources?:number[]}){
 const values=rack.values[5].map((v,i)=>i===3?v:Math.max(0,Math.min(1,v/65535+fxSourceIds.reduce((sum,s)=>sum+fxRouteDepth(rack,20+i,s)*(sources[s]??0)/65536,0))));
 const [cutoff,resonance,mix,mode]=values,dbY=(amplitude:number)=>8+(18-Math.max(-42,Math.min(18,20*Math.log10(Math.max(1e-5,amplitude)))))/60*48;
 const path=Array.from({length:81},(_,i)=>{const x=8+i*224/80,hz=20*1000**(i/80);return `${i?'L':'M'}${x.toFixed(2)},${dbY(filterResponse(cutoff,resonance,mix,mode,hz)).toFixed(2)}`;}).join(' ');
 const cutoffX=8+Math.log(2**(9.813781*cutoff))/Math.log(1000)*224;
 return <svg className="fx-filter-response" viewBox="0 0 240 68" role="img" aria-label={`${['Low-pass','Band-pass','High-pass'][mode]} filter response preview`}>
  <path className="filter-grid" d="M8 22.4H232 M8 46.4H232 M60 8V56 M135 8V56 M210 8V56"/>
  <path className="filter-cutoff-line" d={`M${cutoffX} 8V56`}/><path className="filter-response-line" d={path}/>
  <text x="8" y="66">20 Hz</text><text x="232" y="66" textAnchor="end">20 kHz</text>
 </svg>;
}

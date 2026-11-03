import {fxRouteDepth} from './fxRouting.ts';import {fxSourceIds,type FxRack} from './schema.ts';
import {useMemo} from 'react';
import {PreviewSelect} from './SynthVisualPreview.tsx';
import {CanvasPlot} from './CanvasPlot.tsx';
// UI-only frequency response of the same two-pole TPT design as the audio
// filter. Includes complex dry/wet summation; never feeds DSP or the transport.
export function filterResponse(cutoff:number,resonance:number,mix:number,mode:number,hz:number){
 const f=20*2**(9.813781*cutoff),k=2/(1+15*resonance),w=Math.tan(Math.PI*Math.min(20000,hz)/44100)/Math.tan(Math.PI*f/44100);
 const a=1-w*w,b=k*w,d=a*a+b*b;
 const real=mode===0?a/d:mode===1?b*b/d:-w*w*a/d,imag=mode===0?-b/d:mode===1?b*a/d:w*w*b/d;
 return Math.hypot(1-mix+mix*real,mix*imag);
}
export function FilterResponse({rack,sources=[]}:{rack:FxRack;sources?:number[]}){
 const value=(i:number,sources:number[])=>Math.max(0,Math.min(1,rack.values[5][i]/65535+fxSourceIds.reduce((sum,s)=>sum+fxRouteDepth(rack,20+i,s)*(sources[s]??0)/65536,0)));
 return <PreviewSelect fallback={value(0,sources)} select={s=>value(0,s)}>{cutoff => <PreviewSelect fallback={value(1,sources)} select={s=>value(1,s)}>{resonance => <PreviewSelect fallback={value(2,sources)} select={s=>value(2,s)}>{mix => <FilterCurve cutoff={cutoff} resonance={resonance} mix={mix} mode={rack.values[5][3]}/>}</PreviewSelect>}</PreviewSelect>}</PreviewSelect>;
}
function FilterCurve({cutoff,resonance,mix,mode}:{cutoff:number;resonance:number;mix:number;mode:number}){
 const dbY=(amplitude:number)=>8+(18-Math.max(-42,Math.min(18,20*Math.log10(Math.max(1e-5,amplitude)))))/60*48;
 const values=useMemo(()=>Array.from({length:81},(_,i)=>Math.round(dbY(filterResponse(cutoff,resonance,mix,mode,20*1000**(i/80)))*100)/100),[cutoff,resonance,mix,mode]);
 const cutoffX=8+Math.log(2**(9.813781*cutoff))/Math.log(1000)*224;
 return <CanvasPlot className="fx-filter-response" width={240} height={68} role="img" aria-label={`${['Low-pass','Band-pass','High-pass'][mode]} filter response preview`} paint={(ctx,c)=>{
   ctx.strokeStyle=c.foreground;ctx.globalAlpha=.1;ctx.lineWidth=.7;ctx.beginPath();
   ctx.moveTo(8,22.4);ctx.lineTo(232,22.4);ctx.moveTo(8,46.4);ctx.lineTo(232,46.4);
   for(const x of [60,135,210]){ctx.moveTo(x,8);ctx.lineTo(x,56);}ctx.stroke();
   ctx.strokeStyle=c.brand;ctx.globalAlpha=.25;ctx.lineWidth=1;ctx.setLineDash([2,3]);ctx.beginPath();ctx.moveTo(cutoffX,8);ctx.lineTo(cutoffX,56);ctx.stroke();ctx.setLineDash([]);
   ctx.globalAlpha=1;ctx.lineWidth=2;ctx.lineCap=ctx.lineJoin='round';ctx.beginPath();values.forEach((y,i)=>{const x=Math.round((8+i*224/80)*100)/100;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
   ctx.fillStyle=c.foreground;ctx.globalAlpha=.6;ctx.font=`8px ${c.font}`;ctx.fillText('20 Hz',8,66);ctx.textAlign='right';ctx.fillText('20 kHz',232,66);
 }}/>;
}

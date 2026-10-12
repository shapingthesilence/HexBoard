import {useEffect,useRef,useState} from 'react';
import {modulationRate,modulationSeconds} from './schema.ts';
import {lfoWave} from './ModSourceEditor.tsx';
import type {PhysicalExpression} from './client.ts';
// Last-key visualization only; the instrument generates independent sources.
export function envelopePreview(settings:number[],age:number){
  const [a,d,s,,delay,hold]=settings;let t=age-modulationSeconds(delay);if(t<0)return 0;
  const attack=modulationSeconds(a),decay=modulationSeconds(d),held=modulationSeconds(hold);
  const curve=2*settings[6]/65535-1;
  const shape=(x:number)=>curve>=0?x+curve*(x*x-x):x-curve*((1-(1-x)*(1-x))-x);
  if(settings[7] && t>=attack+held+decay && attack+held+decay>0){const period=attack+held+decay;t%=period;}
  if(t<attack)return shape(t/attack);t-=attack;if(t<held)return 1;t-=held;
  return t<decay?1+(s/65535-1)*shape(t/decay):s/65535;
}
export function useSourcePreview(settings:number[],live?:PhysicalExpression){
  const inputs=useRef({settings,live});inputs.current={settings,live};
  const state=useRef({started:performance.now(),off:0,releaseFrom:0,held:false,key:null as number|null,env:0,lfo:0,origin:performance.now()});
  const [values,setValues]=useState([0,0]);
  useEffect(()=>{const timer=setInterval(()=>{
    const {settings:s,live:e}=inputs.current;const st=state.current,now=performance.now();const held=!!e?.held;
    if(held&&(!st.held||e!.key!==st.key)){st.started=now;st.off=0;}
    if(!held&&st.held){st.off=now;st.releaseFrom=st.env;}
    st.held=held;st.key=e?.key??null;
    const age=(now-st.started)/1000;
    st.env=held?envelopePreview(s,age):st.off?st.releaseFrom*Math.max(0,1-(now-st.off)/1000/Math.max(.001,modulationSeconds(s[3]))):0;
    const phase=((s[10]?now-st.started:now-st.origin)/1000)*modulationRate(s[8])+s[11]/65535;
    const wave=lfoWave(Math.round(s[9]/13107),phase);const delay=modulationSeconds(s[12]),fade=modulationSeconds(s[13]);
    const amount=age<delay?0:fade>0?Math.min(1,(age-delay)/fade):1;
    const target=(s[14]?(wave+1)/2:wave)*amount;const smoothing=.5*s[15]/65535;
    st.lfo+=(target-st.lfo)*(.05/(.05+smoothing));setValues([st.env,st.lfo]);
  },50);return()=>clearInterval(timer);},[]);
  return values;
}

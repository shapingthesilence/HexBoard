import {useEffect} from 'react';
import type {MidiTransport} from '../../midi/types.ts';
import {PhysicalSynthClient,type ControllerState} from './client.ts';
// Read device-owned controller inputs for modulation meters. No web settings.
export function ControllerControls({transport,disabled,onState}:{transport?:MidiTransport;disabled:boolean;onState:(state:ControllerState)=>void}){
 useEffect(()=>{if(!transport)return;const c=new PhysicalSynthClient(transport);let disposed=false,polling=false;const read=()=>{if(polling||disabled)return;polling=true;void c.controls().then(r=>{if(!disposed)onState(r);}).catch(()=>{}).finally(()=>polling=false);};read();const timer=setInterval(read,250);return()=>{disposed=true;clearInterval(timer);c.close();};},[transport,disabled,onState]);return null;
}

import type {PhysicalPreset} from './schema.ts';
export const springSourceNames=['Pressure','Tilt X','Tilt Y','Expression','Joystick Mod','Envelope','LFO'];
export const springSourceWords=[0,10922,21844,32766,43688,54610,65535];
export const springDefaults=[0,32768,23200,0,...Array(18).fill(32768)];
export const springSigned=(v:number)=>Math.max(-1,(v-32768)/32767);
export const springReturn=(v:number)=>.03+2.97*(v/65535)**2;
export const springRouteWord=(id:number,s:number)=>22+(id-33)*9+s;
export const springWord=(depth:number)=>Math.round(32768+Math.max(-1,Math.min(1,depth/65536))*32767);
export const springBase=(p:PhysicalPreset,id:number)=>p.modulation.settings[id===33?19:20];
export const springNames=[{name:'Pitch amount',describe:(v:number)=>`${(200*springSigned(v)).toFixed(1)} ct`,behavior:'More upward bend'}, {name:'Pitch return',describe:(v:number)=>`${Math.round(springReturn(v)*1000)} ms`,behavior:'Slower centering'}];
export function springEffective(settings:number[],sources:number[],target:number){let value=target===0?springSigned(settings[19]):settings[20]/65535;for(let s=0;s<9;++s)value+=springSigned(settings[22+target*9+s])*sources[s];value=Math.max(target===0?-1:0,Math.min(1,value));return target===0?(32768+value*32767)/65535:value;}
export function springEnabled(settings:number[]){return settings[19]!==32768||settings[21]!==0||settings.slice(22).some(v=>v!==32768);}
/** UI approximation for the selected note, never hardware pitch telemetry. */
export class PitchSpringPreview {
 private x=0;private center=0;private pressure=0;private ring1=0;private ring2=0;private source=-1;private key:unknown;private last=0;private pending=0;value=0;
 advance(settings:number[],sources:number[],now:number,key:unknown){
  const index=Math.round(settings[18]*6/65535),inputId=[1,3,4,8,7,5,6][index];let input=sources[inputId];if([1,2,4].includes(index))input=.5+.5*input;
  if(this.source!==index||this.key!==key||!springEnabled(settings)){const onset=this.key!==key;this.source=index;this.key=key;this.x=this.center=onset&&index===0?0:input;this.pressure=onset?0:sources[1];this.ring1=this.ring2=this.value=0;this.last=now;this.pending=0;}
  const dt=512/44100;this.pending+=Math.max(0,Math.min(.06,(now-this.last)/1000));this.last=now;
  while(this.pending>=dt){this.pending-=dt;this.x+=(input-this.x)*dt/(.01+dt);const gesture=this.x-this.center;
   const amount=springSigned(Math.round(springEffective(settings,sources,0)*65535)),ret=springEffective(settings,sources,1);
   this.center+=gesture*dt/(springReturn(ret*65535)/Math.LN10+dt);
   const r=1/(1+dt*18),ring=2*r*Math.cos(dt*8*2*Math.PI)*this.ring1-r*r*this.ring2+(sources[1]-this.pressure)*.55;
   this.ring2=this.ring1;this.ring1=settings[21]?Math.max(-1,Math.min(1,ring)):0;this.pressure=sources[1];this.value=200*amount*Math.max(-1,Math.min(1,gesture))+80*settings[21]/65535*this.ring1;
  }return Math.abs(this.value)<.002?0:this.value;
 }
}

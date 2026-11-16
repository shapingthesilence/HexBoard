export interface SamplerMidiSink {on:(id:string,note:number,velocity:number)=>void;off:(id:string,velocity:number,pedal?:boolean)=>void;expression:(id:string,pressure:number,bend:number)=>void;stop:(id:string)=>void;}
export class SamplerMidiInput {
 private channels=Array.from({length:16},()=>({bend:0,range:2,cents:0,pressure:1,sustain:false,rpn:[127,127],notes:new Map<number,number|undefined>()}));
 constructor(private sink:SamplerMidiSink,private input='hexboard'){}
 private id(c:number,n:number){return `${this.input}:${c}:${n}`;}
 receive(b:Uint8Array){const cmd=b[0]&240,c=b[0]&15,s=this.channels[c];if(b[0]<128||b[0]>=240||b.length!==(cmd===208?2:3)||b.slice(1).some(v=>v>127))return;const n=b[1],v=b[2];
 const update=()=>{for(const key of s.notes.keys())this.sink.expression(this.id(c,key),s.pressure,s.bend*(s.range+s.cents/100));};
 if(cmd===144&&v>0){if(s.notes.has(n))this.sink.stop(this.id(c,n));s.notes.set(n,undefined);this.sink.expression(this.id(c,n),s.pressure,s.bend*(s.range+s.cents/100));this.sink.on(this.id(c,n),n,v);}
 else if(cmd===128||cmd===144){if(!s.notes.has(n))return;if(s.sustain)s.notes.set(n,v);else{s.notes.delete(n);this.sink.off(this.id(c,n),v);}}
 else if(cmd===224){s.bend=((n|(v<<7))-8192)/8192;update();}
 else if(cmd===208){s.pressure=n/127;update();}
 else if(cmd===160){if(s.notes.has(n))this.sink.expression(this.id(c,n),v/127,s.bend*(s.range+s.cents/100));}
 else if(cmd===176){if(n===64){s.sustain=v>=64;if(!s.sustain)for(const [key,lift]of s.notes)if(lift!==undefined){s.notes.delete(key);this.sink.off(this.id(c,key),lift,true);}}
 else if(n===101)s.rpn[0]=v;else if(n===100)s.rpn[1]=v;else if(n===98||n===99)s.rpn=[127,127];else if((n===6||n===38)&&s.rpn[0]===0&&s.rpn[1]===0){if(n===6)s.range=v;else s.cents=Math.min(99,v);update();}
 else if(n===120||n===123){for(const key of s.notes.keys())this.sink.stop(this.id(c,key));s.notes.clear();s.sustain=false;}
 else if(n===121){s.bend=0;s.pressure=1;s.sustain=false;s.rpn=[127,127];for(const[key,lift]of s.notes)if(lift!==undefined){s.notes.delete(key);this.sink.off(this.id(c,key),lift,true);}update();}}
 }
 stop(){this.channels.forEach((s,c)=>{for(const n of s.notes.keys())this.sink.stop(this.id(c,n));s.notes.clear();s.sustain=false;s.bend=0;s.pressure=1;});}
}

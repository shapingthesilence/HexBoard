// Only note-on records, never command acknowledgements, enter the monitor.
export function parseVelocity(line){
  const p=line.split(',');
  if(p[0]==='engine'){
    if(p.length!==8||p.slice(1).some(v=>!/^\d+$/.test(v)))return null;
    const [key,velocity,engine,measurement,duration,travel,frame]=p.slice(1).map(Number);
    if(key>132||velocity<1||velocity>127||engine<1||engine>4||measurement>0xffffffff||duration>0xffffffff||travel>65535||frame>0xffffffff)return null;
    return {key,velocity,engine,measurement,duration,travel,frame,us:null,kind:'on'};
  }
  if(p.length!==9||!['velocity','velocity_off'].includes(p[0])||p.slice(1).some(v=>!/^\d+$/.test(v)))return null;
  const values=p.slice(1).map(Number);
  const [key,velocity,us,low,high,travel,frame,flags]=p[0]==='velocity'?values:[values[0],values[3],values[4],values[5],values[6],values[2],values[1],values[7]];
  if(key>132||velocity>127||us<1||[us,low,high,frame].some(v=>v>4294967295)||travel>65535||flags>255)return null;
  return {key,velocity,us,low,high,travel,frame,flags,kind:p[0]==='velocity'?'on':'off'};
}
export class LiveVelocity {
  constructor(kind='on'){this.kind=kind;this.events=[];this.paused=false;this.key=null;}
  clear(){this.events=[];}
  accept(line){const event=parseVelocity(line);if(!event||event.kind!==this.kind||this.paused||(this.key!==null&&event.key!==this.key))return false;this.events.push(event);if(this.events.length>32)this.events.shift();return true;}
  get latest(){return this.events.at(-1)??null;}
}

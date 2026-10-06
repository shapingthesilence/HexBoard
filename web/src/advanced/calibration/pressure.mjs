export function parsePressure(line){
 const p=line.split(',');if(![10,12].includes(p.length)||p[0]!=='pressure'||p.slice(1).some(v=>!/^\d+$/.test(v)))return null;
 const [key,frame,time,raw,travel,pressure,valid,mode,start,fullEnd=65535,damperEnd=65535]=p.slice(1).map(Number);
 if(key>132||frame>0xffffffff||time>0xffffffff||raw>4095||travel>65535||pressure>65535||valid>1||mode>2||start>65534||fullEnd<1||fullEnd>65535||damperEnd<=start||damperEnd>65535)return null;
 return {key,frame,time,raw,travel,pressure,valid:!!valid,mode,start,fullEnd,damperEnd};
}
export function pressurePercent(travel,mode,start,fullEnd=65535,damperEnd=65535){if(mode===0)return 0;const low=mode===1?0:start,end=mode===1?fullEnd:damperEnd;if(end<=low||travel<=low)return 0;return Math.min(100,(travel-low)/(end-low)*100);}

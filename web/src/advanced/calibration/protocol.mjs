// Same fixed profile as src/calibration/linearization_lut.cpp. Conversion is
// display-only; the board owns trigger detection and live musical behavior.
export const LUT=[[0,0],[18,3277],[38,6554],[58,9830],[82,13107],[109,16384],[139,19660],[173,22937],[212,26214],[256,29491],[305,32768],[360,36044],[427,39321],[498,42598],[590,45874],[687,49151],[818,52428],[965,55705],[1126,58982],[1262,62258],[1319,65535]];
export function travel16(delta){if(delta<=0)return 0;for(let i=1;i<LUT.length;i++){const [x,y]=LUT[i], [a,b]=LUT[i-1];if(delta<=x)return Math.floor(b+((delta-a)*(y-b)+(x-a)/2)/(x-a));}return 65535;}
export const mm = v=>v*4/65535;
export const to16 = v=>Math.round(v*65535/4);
export function rawAt(mmValue,channel){const value=to16(mmValue);for(let i=1;i<LUT.length;i++){const [x,y]=LUT[i], [a,b]=LUT[i-1];if(value<=y)return channel.baseline+channel.polarity*(a+(value-b)*(x-a)/(y-b));}return channel.baseline+channel.polarity*1319;}
export function crossing(points,threshold,start=1){for(let i=start;i<points.length;i++){const a=points[i-1],b=points[i];if(a.mm<threshold&&b.mm>=threshold&&b.mm>a.mm)return {time:a.time+(b.time-a.time)*(threshold-a.mm)/(b.mm-a.mm),index:i};}return null;}
export function windowTime(points,low,high){const a=crossing(points,low);if(!a)return null;for(let i=a.index;i<points.length;i++){const p=points[i-1],q=points[i];if(p.mm<high&&q.mm>=high){const end=p.time+(q.time-p.time)*(high-p.mm)/(q.mm-p.mm);return {low:a.time,high:end,us:Math.round((end-a.time)*1000)};}if(q.mm<low)return null;}return null;}
const integer=(s,min,max)=>{if(!/^\d+$/.test(s??''))throw Error('Malformed capture number');const n=Number(s);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Capture number out of range');return n;};
export class CaptureParser{
  constructor(){this.reset();}
  reset(){this.capture=null;this.next=0;}
  feed(line){const p=line.trim().split(',');if(p[0]!=='tr')return null;
    if(p[1]==='b'){if(p.length!==7||p[2]!=='1')throw Error('Unsupported capture protocol');this.capture={count:integer(p[3],0,1024),channelCount:integer(p[4],1,7),trigger:integer(p[5],0,1023),result:integer(p[6],0,4),channels:[],thresholds:null};this.next=0;return null;}
    const c=this.capture;if(!c)return null;
    if(p[1]==='t'){if(p.length!==5)throw Error('Malformed thresholds');c.thresholds=p.slice(2).map(x=>integer(x,0,65535));}
    if(p[1]==='k'){if(p.length!==7)throw Error('Malformed channel');const ch=integer(p[2],0,c.channelCount-1);if(c.channels[ch])throw Error('Duplicate channel');if(!['1','-1'].includes(p[5]))throw Error('Invalid sensor direction');c.channels[ch]={key:integer(p[3],0,132),baseline:integer(p[4],0,4095),polarity:Number(p[5]),valid:integer(p[6],0,1)===1,points:[]};}
    if(p[1]==='s'){if(p.length!==7)throw Error('Malformed sample');const i=integer(p[2],0,c.count-1),ch=integer(p[3],0,c.channelCount-1);if(i*c.channelCount+ch!==this.next++)throw Error('Missing or reordered sample');if(!c.channels[ch])throw Error('Missing channel metadata');c.channels[ch].points.push({frame:integer(p[4],0,0xffffffff),t:integer(p[5],0,0xffffffff),raw:integer(p[6],0,4095)});}
    if(p[1]==='e'){if(p.length!==3||integer(p[2],0,1024)!==c.count||this.next!==c.count*c.channelCount||!c.thresholds||c.channels.filter(Boolean).length!==c.channelCount)throw Error('Incomplete capture');if(c.count&&c.result===0&&c.trigger>=c.count)throw Error('Invalid trigger');let gaps=0;const origin=c.channels[0].points[0]?.t??0;
      for(const ch of c.channels){const before=ch.points.slice(0,Math.max(1,c.trigger));ch.rest=before.length?before.reduce((n,p)=>n+p.raw,0)/before.length:ch.baseline;let previous=null;for(const point of ch.points){if(previous&&((point.frame-previous.frame)>>>0)!==1)gaps++;if(previous&&(((point.t-previous.t)>>>0)>0x7fffffff||point.t===previous.t))throw Error('Non-monotonic timestamp');point.time=((point.t-origin)|0)/1000;point.mm=mm(travel16((point.raw-ch.baseline)*ch.polarity));point.delta=point.raw-ch.rest;previous=point;}}
      c.gaps=gaps;this.reset();return c;}
    return null;
  }
}

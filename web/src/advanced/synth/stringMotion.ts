// A bounded visual analogy of one reported key; no audio samples or transport.
import {releaseSeconds} from './schema.ts';
export interface MotionInput {values:number[];held:boolean;key:number|null;velocity:number;playing:boolean}
interface Ball {x:number;y:number;speed:number;energy:number;age:number;bounce:number}
export interface MotionFrame {path:string;amplitude:number;balls:{x:number;y:number;r:number;opacity:number}[];pickups:number[];bow:number;contact:boolean;active:boolean}
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
export class StringMotion {
  private held=false;private key:number|null=null;private last=0;private age=0;private tail=0;private energy=0;private seeded=false;
  private lastImpact=-100;private demoEnd=0;private nextDrop=0;private contact=false;private seed=1234567;private drift=0;private balls:Ball[]=[];
  private random(){this.seed^=this.seed<<13;this.seed^=this.seed>>>17;this.seed^=this.seed<<5;return (this.seed>>>0)/4294967296;}
  replay(now:number,v:number[]){this.begin(now,v,.8);this.held=true;this.demoEnd=now+1.2;}
  private begin(now:number,v:number[],velocity:number){this.seeded=true;this.age=0;this.tail=0;this.energy=v[21]>.5?0:clamp(velocity);this.lastImpact=-100;this.balls=[];this.contact=false;this.nextDrop=0;this.last=now;}
  reset(){this.seeded=false;this.held=false;this.demoEnd=0;this.energy=0;this.balls=[];this.contact=false;}
  frame(now:number,input:MotionInput):MotionFrame {
    const v=input.values,dt=clamp(now-this.last,0,.08);this.last=now;
    if(input.playing&&(!this.demoEnd||input.held)){
      this.demoEnd=0;
      if(input.held&&(!this.held||input.key!==this.key))this.begin(now,v,input.velocity);
      if(!input.held&&this.held)this.tail=0;
      this.held=input.held;this.key=input.key;
    }else if(this.demoEnd){if(now>=this.demoEnd){this.held=false;this.demoEnd=0;this.tail=0;}}
    else if(this.held){this.reset();}
    const bowed=v[21]>.5,mode=Math.round(v[8]*4),release=releaseSeconds(v[3]*65535);
    this.age+=dt;if(!this.held)this.tail+=dt;
    const alive=this.seeded&&(this.held||this.tail<release);
    const contact=alive&&mode>0&&(v[31]<=.5||!this.held);
    const newContact=contact&&!this.contact;if(newContact)this.nextDrop=0;this.contact=contact;
    const loss=v[1],ring=.15*Math.exp(4.382*v[0]);
    this.energy*=Math.exp(-dt*(1+2.5*loss)/(this.held?Math.max(.15,ring):Math.max(.12,release)));
    if(bowed&&this.held)this.energy+=(Math.pow(v[22],.65)-this.energy)*clamp(dt*10);
    if(contact&&mode===3)this.energy*=Math.exp(-dt*18*v[16]*(1-v[9]));
    if(!alive){this.energy*=Math.exp(-dt*15);this.balls=[];}
    if(contact&&v[16]>.001){
      this.nextDrop-=dt;
      const rate=mode===4?(v[17]>0?.5+29.5*v[17]:0):mode===2?8:2+4*v[11];
      if(rate&&this.nextDrop<=0){
        this.drift=.65*this.drift+.35*(2*this.random()-1);
        this.nextDrop+=Math.max(.025,(1+this.drift*v[20])/rate);
        const x=mode===4?clamp(.05+.9*v[18]+(2*this.random()-1)*.45*v[19],.05,.95):.92;
        if(mode!==3&&(mode===4||this.balls.length===0)){if(this.balls.length>=6)this.balls.shift();this.balls.push({x,y:mode===4?(newContact?77:8):50-30*v[9],speed:mode===4&&newContact?-90:0,energy:v[16],age:0,bounce:0});if(mode===4&&newContact){this.energy=clamp(this.energy+.35*v[16]);this.lastImpact=this.age;}}
      }
    }
    for(const b of this.balls){
      b.age+=dt;b.speed+=(200+550*v[11])*dt;b.y+=b.speed*dt;
      if(b.y>=77){b.y=77;b.speed=-Math.abs(b.speed)*(mode===2?.25:.4+.45*(mode===4?v[24]:v[2]))*(1-.5*v[13]);b.bounce++;this.lastImpact=this.age;this.energy=clamp(this.energy+.35*b.energy);b.energy*=.65;}
    }
    this.balls=this.balls.filter(b=>b.age<2.5&&b.energy>.03&&b.bounce<5);
    const amplitude=24*clamp(this.energy),time=this.age*(bowed?3+6*v[23]:4.5);
    const displacement=(x:number)=>{
      let wave=0;const hardness=bowed?v[23]:v[2],position=.05+.9*v[4];
      for(let n=1;n<=5;++n){const weight=n===1?1:(.08+.65*hardness)/n;wave+=weight*Math.sin(Math.PI*n*x)*Math.cos(time*n*(1+.09*v[6]*n*n))*Math.sin(Math.PI*n*position);}
      if(!bowed)wave+=.2*v[12]*Math.sin(Math.PI*7*x)*Math.cos(time*12)*Math.exp(-this.age*4);
      if(mode===4)wave+=.2*v[25]*Math.sin(Math.PI*9*x)*Math.cos(time*13)*Math.exp(-(this.age-this.lastImpact)*8);
      wave/=1.7;const drive=v[26]*v[26],shape=Math.round(v[27]*2);
      const shaped=shape===1?clamp(wave,-.3,.3)*2:shape===2?Math.sin(wave*7)*.8:Math.tanh(wave*3)*.8;
      wave+=drive*(shaped-wave);
      if(!bowed&&v[29]>0){wave+=(.4*v[29])*Math.sin(Math.PI*13*x)*Math.cos(time*8);wave*=1-.35*v[29];}
      return clamp(wave,-1,1)*amplitude;
    };
    const path=Array.from({length:65},(_,i)=>{const x=i/64;return `${i?'L':'M'}${(30+540*x).toFixed(1)},${(82+(i===0||i===64?0:displacement(x))).toFixed(1)}`;}).join(' ');
    return {path,amplitude,balls:this.balls.map(b=>({x:30+540*b.x,y:b.y,r:3+3*b.energy+(mode===4?0:3*v[10]),opacity:clamp(b.energy+.2)})),pickups:[82+displacement(.05+.9*v[5]),82+displacement(.05+.9*v[14])],bow:bowed&&this.held?Math.sin(time*2)*(4+10*v[23]):0,contact,active:amplitude>.08||this.balls.length>0||alive&&((bowed&&this.held&&v[22]>.001)||(contact&&v[16]>.001&&(mode===1||mode===2||mode===4&&v[17]>0)))};
  }
}

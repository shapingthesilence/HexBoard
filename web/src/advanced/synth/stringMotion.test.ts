import {it,expect} from 'vitest';
import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {StringMotion} from './stringMotion.ts';import {StringAnimation} from './StringAnimation.tsx';import {initialPreset} from './schema.ts';
const values=()=>initialPreset.parameters.map(v=>v/65535);
const input=(v:number[],held=true)=>({values:v,held,key:1,velocity:.8,playing:true});
it('starts strikes, sustains bow from force without a phantom pluck and changes character',()=>{
 const v=values(),s=new StringMotion();const first=s.frame(1,input(v));expect(first.amplitude).toBeGreaterThan(10);expect(first.path).not.toContain('NaN');
 const bright=new StringMotion();v[2]=1;v[6]=1;expect(bright.frame(1,input(v)).path).not.toEqual(first.path);
 v[21]=1;v[22]=0;const bow=new StringMotion();expect(bow.frame(1,input(v)).amplitude).toBe(0);for(let i=1;i<50;i++)expect(bow.frame(1+i/30,input(v)).amplitude).toBe(0);
 v[22]=1;expect(bow.frame(3,input(v)).amplitude).toBeGreaterThan(0);
});
it('shows note-off marbles only after release, with bounded drops and anchored endpoints',()=>{
 const v=values();v[8]=1;v[17]=1;v[16]=1;v[31]=1;v[3]=1;
 const s=new StringMotion();for(let i=0;i<60;i++){const f=s.frame(1+i/30,input(v));expect(f.balls).toHaveLength(0);expect(f.contact).toBe(false);}
 let seen=0;for(let i=0;i<200;i++){const f=s.frame(3+i/30,input(v,false));seen+=f.balls.length;expect(f.balls.length).toBeLessThanOrEqual(6);expect(f.path).toMatch(/^M30.0,82.0/);expect(f.path).toMatch(/L570.0,82.0$/);for(const b of f.balls){expect(b.x).toBeGreaterThanOrEqual(57);expect(b.x).toBeLessThanOrEqual(543);expect(b.y).toBeLessThanOrEqual(108);}}
 expect(seen).toBeGreaterThan(0);
});
it('allows an idle visual replay and ends its gesture without altering device input',()=>{
 const v=values(),s=new StringMotion(),idle={...input(v,false),playing:false};expect(s.frame(1,idle).active).toBe(false);s.replay(2,v);expect(s.frame(2,idle).amplitude).toBeGreaterThan(0);
 for(let i=0;i<1200;i++)s.frame(2+i/30,idle);expect(s.frame(43,idle).active).toBe(false);expect(idle.held).toBe(false);
 const liveIdle={...idle,playing:true};s.replay(44,v);expect(s.frame(44,liveIdle).amplitude).toBeGreaterThan(0);
});
it('is bounded through every contact/drive combination and renders a non-interactive SVG layer',()=>{
 for(let mode=0;mode<5;mode++)for(let drive=0;drive<3;drive++){
  const v=values();v[8]=mode/4;v[26]=1;v[27]=drive/2;v[16]=1;v[17]=1;v[29]=1;v[3]=1;
  const s=new StringMotion();for(let i=0;i<300;i++){const f=s.frame(1+i/30,input(v,i<120));expect(f.amplitude).toBeLessThanOrEqual(24);expect(f.path).not.toMatch(/NaN|Infinity/);expect(f.balls.length).toBeLessThanOrEqual(6);}
 }
 const html=renderToStaticMarkup(createElement(StringAnimation,{values:values(),signature:'test',playing:false,replay:0,enabled:true}));expect(html).toContain('aria-hidden="true"');expect(html).toContain('data-motion="wave"');expect(html).not.toContain('data-motion="pin"');
});

it('keeps high-rate marbles long enough to touch the moving string',()=>{
 const v=values();v[8]=v[17]=v[16]=v[11]=v[24]=1;
 const motion=new StringMotion();let hits=0;for(let i=0;i<180;i++){const f=motion.frame(1+i/30,input(v));for(const b of f.balls)if(b.touching){hits++;const points=[...f.path.matchAll(/[ML]([\d.]+),(-?[\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);const x=(b.x-30)/540*64,at=Math.max(0,Math.min(63,Math.floor(x)));const surface=points[at][1]+(points[at+1][1]-points[at][1])*(x-at);expect(Math.abs(b.y+b.r-surface)).toBeLessThan(1);}}
 expect(hits).toBeGreaterThan(15);
});

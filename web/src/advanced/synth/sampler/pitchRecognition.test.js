import {describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {analyzePitch,sourcePitchWindow,midiForHz,centsBetween} from './analysis.ts';
import {wav} from './prepare.mjs';
const data=readFileSync(new URL('./fixtures/iowa-bass-pizz-e2.wav',import.meta.url));
const buffer=()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
describe('real instrument pitch recognition',()=>{
 it('recognizes the pizzicato bass fundamental with full voiced coverage despite its decay',()=>{const a={...wav(buffer()),rootMidi:60};const result=analyzePitch(a,...sourcePitchWindow(a),4);expect(result.hz).not.toBeNull();expect(midiForHz(result.hz)).toBeGreaterThan(39.7);expect(midiForHz(result.hz)).toBeLessThan(40.2);expect(result.confidence).toBeGreaterThan(.9);expect(result.coverage).toBe(1);expect(result.spread).toBeLessThan(25);});
 it('uses the real audio on import rather than the file name or a C4 fallback',async()=>{const postMessage=vi.fn();vi.stubGlobal('self',{postMessage});try{await import('./prepare.worker.ts');self.onmessage({data:{operation:'import',files:[{name:'unknown.wav',bytes:buffer()}]}});const a=postMessage.mock.calls[0][0].result[0];expect(a.pitchSource).toBe('analysis');expect(a.rootMidi).toBeGreaterThan(39.7);expect(a.rootMidi).toBeLessThan(40.2);expect(a.pitchVariation).toBeGreaterThan(0);}finally{vi.unstubAllGlobals();}});
 for(const missing of [false,true])it(`handles a dominant second harmonic${missing?' and missing fundamental':''}`,()=>{const rate=44100,hz=82.406889,a={rootMidi:60,rate,channels:[Float32Array.from({length:44100},(_,i)=>{const t=i/rate;return Math.exp(-t*4)*((missing?0:.12)*Math.sin(2*Math.PI*hz*t)+.5*Math.sin(4*Math.PI*hz*t)+.35*Math.sin(6*Math.PI*hz*t)+.1*Math.sin(8*Math.PI*hz*t));})]};const result=analyzePitch(a,2205,24255,6);expect(result.hz).not.toBeNull();expect(Math.abs(centsBetween(result.hz,hz))).toBeLessThan(10);});
});

import {describe,it,expect} from "vitest";
import {SerialAudioUpload,serialCrc,serialFrame} from "./serialAudioUpload.ts";
describe("serial audio blocks",()=>{
 it("encodes signed PCM bytes unchanged and checks their complete frame",()=>{const pcm=Uint8Array.from({length:4096},(_,i)=>i*37);const frame=serialFrame(123,2,8192,pcm),v=new DataView(frame.buffer);expect(v.getUint32(0,true)).toBe(0x31414248);expect(v.getUint32(4,true)).toBe(123);expect(v.getUint32(8,true)).toBe(8192);expect(v.getUint16(12,true)).toBe(4096);expect(frame.slice(16,-4)).toEqual(pcm);expect(v.getUint32(frame.length-4,true)).toBe(serialCrc(frame.subarray(0,-4)));expect(serialCrc(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);});
 it("bounds one receiver credit",()=>{expect(()=>serialFrame(0,0,0,new Uint8Array(1))).toThrow();expect(()=>serialFrame(1,3,0,new Uint8Array(1))).toThrow();expect(()=>serialFrame(1,0,0,new Uint8Array())).toThrow();expect(()=>serialFrame(1,0,0,new Uint8Array(4097))).toThrow();});
});

function port(reject=false){
 let incoming:ReadableStreamDefaultController<Uint8Array>;const frames:Uint8Array[]=[],signals:boolean[]=[];let closed=false;
 const readable=new ReadableStream<Uint8Array>({start(c){incoming=c;}}),writable=new WritableStream<Uint8Array>({write(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes[0]===97){const [, ,token]=new TextDecoder().decode(bytes).trim().split(" ");incoming.enqueue(new TextEncoder().encode(`bulk,ready,Advanced Main,${token}\n`));return;}
  frames.push(bytes.slice());const ack=new Uint8Array(24),v=new DataView(ack.buffer);v.setUint32(0,0x43414248,true);v.setUint32(4,view.getUint32(4,true),true);v.setUint32(8,view.getUint32(8,true)+view.getUint16(12,true),true);v.setUint32(12,reject?1:0,true);v.setUint32(16,180000,true);v.setUint32(20,serialCrc(ack.subarray(0,20)),true);incoming.enqueue(ack);
 }});
 return {frames,signals,get closed(){return closed;},readable,writable,async open(){},async close(){closed=true;},async setSignals(s:{dataTerminalReady:boolean}){signals.push(s.dataTerminalReady);}};
}
it("streams bounded blocks and releases the serial session",async()=>{const p=port(),upload=new SerialAudioUpload(p),data=Uint8Array.from({length:9000},(_,i)=>i*31),progress:number[]=[];await upload.transfer(0,data,n=>progress.push(n));expect(p.frames.map(f=>f.length)).toEqual([4116,4116,828]);expect(progress).toEqual([4096,8192,9000]);expect(p.frames.flatMap(f=>Array.from(f.subarray(16,-4)))).toEqual(Array.from(data));expect(p.signals).toEqual([true,false]);expect(p.closed).toBe(true);expect(p.readable.locked||p.writable.locked).toBe(false);});
it("does not send another block after rejection",async()=>{const p=port(true),upload=new SerialAudioUpload(p);await expect(upload.transfer(0,new Uint8Array(8192))).rejects.toThrow(/rejected/);expect(p.frames).toHaveLength(1);expect(p.closed).toBe(true);expect(p.signals.at(-1)).toBe(false);});

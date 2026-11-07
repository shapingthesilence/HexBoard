import {describe,it,expect} from "vitest";
import {MockMidiTransport} from "../../../midi/mockTransport.ts";
import {ClassicSamplerClient,instrumentNameFromHbc} from "./classicClient.ts";
import {decodePresetSyncFrame,decodeDataChunkPayload,encodeDefaultPresetSyncFrame,encodeAckFrame,MessageType} from "../../../protocol/index.ts";

class Device extends MockMidiTransport {
  pending = false;
  chunks = 0;
  rejectCommit = false;
  slots = 64;
  used = new Set<number>();
  override async send(bytes:ArrayLike<number>) {
    await super.send(bytes);
    const frame=decodePresetSyncFrame(bytes);
    expect(this.pending).toBe(false);this.pending=true;
    setTimeout(()=>{
      this.pending=false;
      if(frame.message===MessageType.CompactSamplerRequest) {
        const op=frame.payload[0];
        if(op===1&&frame.payload[1]>=this.slots) {
          this.emit(encodeDefaultPresetSyncFrame(MessageType.Nack,frame.transactionId,[frame.message,1,0,0,0,0]));
          return;
        }
        const used=op===1&&this.used.has(frame.payload[1]);
        this.emit(encodeDefaultPresetSyncFrame(MessageType.CompactSamplerResponse,frame.transactionId,
          op===1?[1,frame.payload[1],used?1:0,0,0,0,used?1:0,...(used?[65]:[])]:[op,frame.payload[1]??127]));
      } else if(frame.message===MessageType.WriteCommit&&this.rejectCommit) {
        this.emit(encodeDefaultPresetSyncFrame(MessageType.Nack,frame.transactionId,[frame.message,13,0,0,0,0]));
      } else {
        if(frame.message===MessageType.WriteBegin)this.chunks=0;
        if(frame.message===MessageType.DataChunk){const chunk=decodeDataChunkPayload(frame.payload);expect(chunk.chunkIndex).toBe(this.chunks++);}
        this.emit(encodeAckFrame(frame.transactionId,frame.message,frame.message===MessageType.DataChunk?this.chunks:0));
      }
    },1);
  }
}
describe("Classic sampler transfer",()=>{
 it("saves a sampler preset whose id follows its folder and name",async()=>{
  const transport=new Device(),client=new ClassicSamplerClient(transport);
  const first=await client.savePreset({name:"  Felt Keys ",folderPath:"/Keys/",instrumentName:"Felt Piano"});
  expect(first).toEqual({name:"Felt Keys",folderPath:"Keys"});
  const chunks=transport.sentMessages.map(m=>decodePresetSyncFrame(m)).filter(f=>f.message===MessageType.DataChunk);
  expect(chunks.length).toBeGreaterThan(0);
  const begin=()=>transport.sentMessages.map(m=>decodePresetSyncFrame(m)).filter(f=>f.message===MessageType.WriteBegin);
  expect(begin()[0].payload[0]).toBe(7);  // synth preset object
  await client.savePreset({name:"A name that is much longer than the board shows",folderPath:"",instrumentName:"Felt Piano"});
  expect(begin().length).toBe(2);
 });
 it("reads the instrument name from an HBC header",()=>{
  const bytes=new Uint8Array(64);bytes.set(new TextEncoder().encode("Felt Piano"),32);
  expect(instrumentNameFromHbc(bytes)).toBe("Felt Piano");
 });
 it("finds the board's slot count and installs past the old 32-slot limit",async()=>{
  const transport=new Device();
  for(let i=0;i<40;++i)transport.used.add(i);
  const client=new ClassicSamplerClient(transport);
  expect(await client.upload(new Uint8Array(30))).toBe(40);
  expect(client.slotCount).toBe(64);
  transport.slots=32;transport.used=new Set(Array.from({length:32},(_,i)=>i));
  await expect(client.upload(new Uint8Array(30))).rejects.toThrow("All 32 sampler slots");
 });
 it("paces every chunk by ACK before returning the installed slot",async()=>{
  const transport=new Device(),client=new ClassicSamplerClient(transport);
  expect(await client.upload(new Uint8Array(300))).toBe(0);
  expect(transport.chunks).toBeGreaterThan(1);
  expect(decodePresetSyncFrame(transport.sentMessages.at(-1)!).message).toBe(MessageType.WriteCommit);
 });
 it("reports rejected installs and aborts their transfer",async()=>{
  const transport=new Device();transport.rejectCommit=true;
  await expect(new ClassicSamplerClient(transport).upload(new Uint8Array(30))).rejects.toThrow();
  expect(decodePresetSyncFrame(transport.sentMessages.at(-1)!).message).toBe(MessageType.TransferAbort);
 });
});

import {describe,it,expect} from "vitest";
import {MockMidiTransport} from "../../../midi/mockTransport.ts";
import {ClassicSamplerClient,instrumentNameFromHbc,newSamplerSound} from "./classicClient.ts";
import {decodePresetSyncFrame,decodeDataChunkPayload,encodeDefaultPresetSyncFrame,encodeAckFrame,MessageType,WriteFlag} from "../../../protocol/index.ts";
import {decodeHexSound,hexSoundTitle} from "../../../catalogs/hexSound.ts";
import {CommonTlv,decodeObjectBody} from "../../../protocol/tlv.ts";

class Device extends MockMidiTransport {
  pending = false;
  chunks = 0;
  rejectCommit = false;
  override async send(bytes:ArrayLike<number>) {
    await super.send(bytes);
    const frame=decodePresetSyncFrame(bytes);
    expect(this.pending).toBe(false);this.pending=true;
    setTimeout(()=>{
      this.pending=false;
      if(frame.message===MessageType.WriteCommit&&this.rejectCommit) {
        this.emit(encodeDefaultPresetSyncFrame(MessageType.Nack,frame.transactionId,[frame.message,13,0,0,0,0]));
      } else {
        if(frame.message===MessageType.WriteBegin)this.chunks=0;
        if(frame.message===MessageType.DataChunk){const chunk=decodeDataChunkPayload(frame.payload);expect(chunk.chunkIndex).toBe(this.chunks++);}
        this.emit(encodeAckFrame(frame.transactionId,frame.message,frame.message===MessageType.DataChunk?this.chunks:0));
      }
    },1);
  }
}
describe("Classic sampler sounds",()=>{
 const instrument=(name:string)=>{const bytes=new Uint8Array(300);bytes.set([0x48,0x42,0x43,0x31]);bytes.set(new TextEncoder().encode(name),32);return bytes;};
 it("makes a new sound whose id follows its folder and name",()=>{
  const first=newSamplerSound(instrument("Felt Piano"),{name:"  Felt Keys ",folderPath:"/Keys/"});
  expect([first.name,first.folderPath]).toEqual(["Felt Keys","Keys"]);
  const decoded=decodeHexSound(first.sound);
  expect(decoded.instrument).toEqual(instrument("Felt Piano"));
  expect(hexSoundTitle(decoded.presetBody)).toEqual({name:"Felt Keys",folderPath:"Keys"});
  const again=newSamplerSound(instrument("Other"),{name:"Felt Keys",folderPath:"Keys"});
  const id=(sound:Uint8Array)=>decodeObjectBody(decodeHexSound(sound).presetBody).records.find(r=>r.tag===CommonTlv.ObjectId)!.value;
  expect(id(again.sound)).toEqual(id(first.sound));
  // An empty name falls back to the instrument's name.
  expect(newSamplerSound(instrument("Felt Piano"),{name:"",folderPath:""}).name).toBe("Felt Piano");
 });
 it("reads the instrument name from an HBC header",()=>{
  const bytes=new Uint8Array(64);bytes.set(new TextEncoder().encode("Felt Piano"),32);
  expect(instrumentNameFromHbc(bytes)).toBe("Felt Piano");
 });
 it("sends a sound as one sampler-sound object, paced by ACK",async()=>{
  const transport=new Device(),client=new ClassicSamplerClient(transport);
  await client.sendSound(newSamplerSound(instrument("Felt Piano"),{name:"Felt",folderPath:"Keys"}).sound,{play:true});
  const frames=transport.sentMessages.map(m=>decodePresetSyncFrame(m));
  const begin=frames.find(f=>f.message===MessageType.WriteBegin)!;
  expect(begin.payload[0]).toBe(0x0e);
  expect(begin.payload[18]).toBe(WriteFlag.SaveToFlash|WriteFlag.ApplyToRuntime);
  expect(transport.chunks).toBeGreaterThan(1);
  expect(frames.at(-1)!.message).toBe(MessageType.WriteCommit);
 });
 it("reports rejected sounds and aborts their transfer",async()=>{
  const transport=new Device();transport.rejectCommit=true;
  await expect(new ClassicSamplerClient(transport).sendSound(newSamplerSound(instrument("A"),{name:"A",folderPath:""}).sound)).rejects.toThrow();
  expect(decodePresetSyncFrame(transport.sentMessages.at(-1)!).message).toBe(MessageType.TransferAbort);
 });
});

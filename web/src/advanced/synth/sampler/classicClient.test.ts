import {describe,it,expect} from "vitest";
import {MockMidiTransport} from "../../../midi/mockTransport.ts";
import {ClassicSamplerClient} from "./classicClient.ts";
import {decodePresetSyncFrame,decodeDataChunkPayload,encodeDefaultPresetSyncFrame,encodeAckFrame,MessageType} from "../../../protocol/index.ts";

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
      if(frame.message===MessageType.CompactSamplerRequest) {
        const op=frame.payload[0];
        this.emit(encodeDefaultPresetSyncFrame(MessageType.CompactSamplerResponse,frame.transactionId,
          op===1?[1,frame.payload[1],0,0,0,0,0]:[op,frame.payload[1]??127]));
      } else if(frame.message===MessageType.WriteCommit&&this.rejectCommit) {
        this.emit(encodeDefaultPresetSyncFrame(MessageType.Nack,frame.transactionId,[frame.message,13,0,0,0,0]));
      } else {
        if(frame.message===MessageType.DataChunk){const chunk=decodeDataChunkPayload(frame.payload);expect(chunk.chunkIndex).toBe(this.chunks++);}
        this.emit(encodeAckFrame(frame.transactionId,frame.message,frame.message===MessageType.DataChunk?this.chunks:0));
      }
    },1);
  }
}
describe("Classic sampler transfer",()=>{
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

type Reader={read:()=>Promise<ReadableStreamReadResult<Uint8Array>>;cancel:()=>Promise<void>;releaseLock:()=>void};
type Port={setSignals?:(signals:{dataTerminalReady:boolean})=>Promise<void>;open:(options:{baudRate:number})=>Promise<void>;close:()=>Promise<void>;readable:ReadableStream<Uint8Array>;writable:WritableStream<Uint8Array>};
const table=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
export function serialCrc(bytes:Uint8Array){let c=0xffffffff;for(const b of bytes)c=(c>>>8)^table[(c^b)&255];return (c^0xffffffff)>>>0;}
export function serialFrame(token:number,kind:number,offset:number,bytes:Uint8Array){
 if(!token||kind<0||kind>2||!bytes.length||bytes.length>4096)throw Error("Invalid audio block.");
 const frame=new Uint8Array(20+bytes.length),v=new DataView(frame.buffer);v.setUint32(0,0x31414248,true);v.setUint32(4,token,true);v.setUint32(8,offset,true);v.setUint16(12,bytes.length,true);v.setUint8(14,kind);frame.set(bytes,16);v.setUint32(frame.length-4,serialCrc(frame.subarray(0,-4)),true);return frame;
}
export class SerialAudioUpload {
 private reader?:Reader;private cancelled=false;
 constructor(private port:Port){}
 static async choose(){const serial=(navigator as Navigator&{serial?:{requestPort:()=>Promise<Port>}}).serial;if(!serial)throw Error("Fast USB uploads need a browser with Web Serial support, such as Chrome or Edge.");return new SerialAudioUpload(await serial.requestPort());}
 cancel(){this.cancelled=true;void this.reader?.cancel().catch(()=>{});}
 async transfer(kind:number,bytes:Uint8Array,progress?:(done:number,total:number)=>void){
  this.cancelled=false;let writer:WritableStreamDefaultWriter<Uint8Array>|undefined,opened=false,pending=new Uint8Array();
  const token=crypto.getRandomValues(new Uint32Array(1))[0]||1;
  const read=async()=>{if(this.cancelled)throw Error("Audio upload cancelled.");let timer:ReturnType<typeof setTimeout>|undefined;try{const value=await Promise.race([this.reader!.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error("Fast USB upload timed out. Close competing serial monitors and retry.")),15000);})]);if(value.done||!value.value)throw Error("Fast USB disconnected.");const next=new Uint8Array(pending.length+value.value.length);next.set(pending);next.set(value.value,pending.length);pending=next;}finally{clearTimeout(timer);}};
  try{
   await this.port.open({baudRate:115200});opened=true;await this.port.setSignals?.({dataTerminalReady:true});this.reader=this.port.readable.getReader();writer=this.port.writable.getWriter();
   await writer.write(new TextEncoder().encode(`assets serial ${token} ${kind}\n`));
   const marker=`bulk,ready,Advanced Main,${token}\n`;
   while(!new TextDecoder().decode(pending).includes(marker)){await read();if(pending.length>32768)throw Error("Select the Advanced main USB serial port.");}
   pending=new Uint8Array();
   for(let at=0;at<bytes.length;at+=4096){
    if(this.cancelled)throw Error("Audio upload cancelled.");const chunk=bytes.subarray(at,at+4096);await writer.write(serialFrame(token,kind,at,chunk));
    while(pending.length<24)await read();const ack=pending.slice(0,24);pending=pending.slice(24);const v=new DataView(ack.buffer);
    if(v.getUint32(0,true)!==0x43414248||v.getUint32(4,true)!==token||v.getUint32(20,true)!==serialCrc(ack.subarray(0,20))||v.getUint32(12,true)||v.getUint32(8,true)!==at+chunk.length)throw Error("Fast USB block was rejected. The previous published asset is preserved; retry the upload.");
    progress?.(at+chunk.length,bytes.length);
   }
  }finally{
   try{await this.reader?.cancel();}catch{}this.reader?.releaseLock();this.reader=undefined;writer?.releaseLock();if(opened){try{await this.port.setSignals?.({dataTerminalReady:false});}catch{}await this.port.close();}
  }
 }
}

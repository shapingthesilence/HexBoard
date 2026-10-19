import {initialClassic,classicFromUnknown,type ClassicPreset} from './classicSchema.ts';
// Yamaha VCED/VMEM layout, matching pinned AMY amy/fm.py. Decode on the host;
// firmware receives validated numeric state, never arbitrary SysEx commands.
function unpack(p:Uint8Array):number[]{
 const out:number[]=[];for(let op=0;op<6;op++){const x=p.slice(op*17,op*17+17);out.push(...x.slice(0,11),x[11]&3,(x[11]>>2)&3,x[12]&7,x[13]&3,(x[13]>>2)&7,x[14],x[15]&1,(x[15]>>1)&31,x[16],(x[12]>>3)&15);}
 const x=p.slice(102);out.push(...x.slice(0,8),x[8]&31,x[9]&7,(x[9]>>3)&1,...x.slice(10,14),x[14]&1,(x[14]>>1)&7,(x[14]>>4)&7,x[15],...x.slice(16,26));return out;
}
function voice(data:number[]):ClassicPreset{
 const p=initialClassic(5);p.name=String.fromCharCode(...data.slice(145,155)).replace(/[^\x20-\x7e]/g,' ').trim()||'Imported DX7';p.patch.parameters.splice(0,145,...data.slice(0,145));return classicFromUnknown(p);
}
export function importDx7(bytes:Uint8Array):ClassicPreset[]{
 if(bytes.length!==163&&bytes.length!==4104)throw Error('Choose a standard DX7 single voice or 32-voice bank SysEx file.');
 if(bytes[0]!==0xf0||bytes[1]!==0x43||bytes[2]>15||bytes[bytes.length-1]!==0xf7||bytes.slice(2,-1).some(v=>v>127))throw Error('Invalid Yamaha DX7 SysEx framing.');
 const length=bytes[4]*128+bytes[5],data=bytes.slice(6,-2);
 if(length!==data.length||(bytes[3]===0?length!==155:bytes[3]===9?length!==4096:true))throw Error('Unsupported DX7 SysEx format or length.');
 if((data.reduce((sum,v)=>sum+v,0)+bytes[bytes.length-2])%128!==0)throw Error('DX7 SysEx checksum mismatch.');
 return bytes[3]===0?[voice([...data])]:Array.from({length:32},(_,i)=>voice(unpack(data.slice(i*128,i*128+128))));
}

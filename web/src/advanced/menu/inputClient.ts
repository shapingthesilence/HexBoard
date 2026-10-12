import type { MidiTransport } from '../../midi/types.ts';
import { decodePresetSyncFrame, encodeDefaultPresetSyncFrame, decodeU14 } from '../../protocol/index.ts';
export interface JoystickReading { x: number; y: number; pressed: boolean; valid: boolean }
export function decodeJoystick(p: number[]): JoystickReading {
  if(p.length!==8 || p[0]!==1 || p[1]>1 || p[2]>1 || p[7]>1) throw Error('Unsupported joystick response. Update main and audio firmware.');
  const x=decodeU14(p.slice(3,5)),y=decodeU14(p.slice(5,7));
  if(x>4095||y>4095)throw Error('Invalid joystick reading.');
  return { x:x/2047.5-1, y:y/2047.5-1, pressed:!!p[2], valid:!!p[1] };
}
let transaction=12000;
export function readJoystick(transport: MidiTransport, signal: AbortSignal): Promise<JoystickReading> {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(Error('Joystick stopped.'));return;}
    const id=++transaction%16383+1;
    let unsubscribe=()=>{};
    const finish=(error?:Error,value?:JoystickReading)=>{clearTimeout(timer);unsubscribe();signal.removeEventListener('abort',abort);error?reject(error):resolve(value!);};
    const abort=()=>finish(Error('Joystick stopped.'));
    const timer=setTimeout(()=>finish(Error('No joystick response. Update both boards and reconnect.')),1500);
    signal.addEventListener('abort',abort,{once:true});
    unsubscribe=transport.subscribe(bytes=>{
      if(bytes[0]!==0xf0||bytes[1]!==0x7d||bytes[2]!==0x10)return;
      try {const f=decodePresetSyncFrame(bytes);if(f.transactionId!==id)return;
        if(f.message===7)finish(Error('Update Advanced firmware for joystick input.'));
        else if(f.message===0x3a)finish(undefined,decodeJoystick(f.payload));
      }catch(error){finish(error instanceof Error?error:Error('Invalid input.'));}
    });
    void transport.send(encodeDefaultPresetSyncFrame(0x39,id,[1])).catch(e=>finish(e instanceof Error?e:Error('Input disconnected.')));
  });
}

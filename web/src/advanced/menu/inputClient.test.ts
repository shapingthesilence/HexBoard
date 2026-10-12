import { describe, it, expect } from 'vitest';
import { decodeJoystick } from './inputClient.ts';
import { encodeU14 } from '../../protocol/index.ts';
describe('physical joystick decoding',()=>{
  it('decodes both axis endpoints and button state',()=>{
    const p=decodeJoystick([1,1,1,...encodeU14(0),...encodeU14(4095),0]);
    expect(p).toEqual({x:-1,y:1,pressed:true,valid:true});
  });
  it('rejects corrupt and unsupported payloads and keeps stale samples invalid',()=>{
    expect(()=>decodeJoystick([1,1,1,...encodeU14(4096),...encodeU14(1),0])).toThrow();
    expect(()=>decodeJoystick([2,1,1,...encodeU14(0),...encodeU14(0),0])).toThrow();
    expect(decodeJoystick([1,0,0,...encodeU14(2048),...encodeU14(2048),1]).valid).toBe(false);
  });
});

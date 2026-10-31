export interface Motion {delay:number;attack:number;hold:number;decay:number;sustain:number;release:number;pitch:number;filter:number;vibratoRate:number;vibratoDepth:number;vibratoDelay:number;vibratoFade:number;source:number;shape:number;lfoRate:number;lfoDelay:number;lfoFade:number;lfoPitch:number;lfoFilter:number;lfoVolume:number;volHoldKey:number;volDecayKey:number;modHoldKey:number;modDecayKey:number}
export const motionDefaults:Readonly<Motion>;
export function motionSettings(input?:Partial<Motion>):Motion;
export function encodeMotion(input?:Partial<Motion>):Uint8Array;
export function decodeMotion(bytes:Uint8Array):Motion;
export function motionActive(m:Partial<Motion>):boolean;
export function pitchBound(m:Partial<Motion>):number;
export function keyTime(ms:number,cents?:number,note?:number):number;
export function motionEnvelope(m:Motion,time:number,note?:number):number;
export function evaluateMotion(m:Motion,time:number,note?:number,pressure?:number,velocity?:number,released?:number,releasedValue?:number):{pitch:number;filter:number;gain:number};
export function motionWave(time:number,rate:number,delay:number,fade:number,shape:number):number;

export interface MonoConfig {flags:number;glideMs:number}
export const defaultMono=():MonoConfig=>({flags:0,glideMs:0});
export function validateMono(value:unknown):MonoConfig {
 const c=(value??defaultMono()) as MonoConfig;
 if(!Number.isInteger(c.flags)||c.flags<0||c.flags>127||(c.flags&3)>2||((c.flags>>2)&3)>2||!Number.isInteger(c.glideMs)||c.glideMs<0||c.glideMs>5000)throw Error('Invalid mono settings.');
 return {flags:c.flags,glideMs:c.glideMs};
}
export const monoEnabled=(p:{mono?:MonoConfig})=>!!((p.mono?.flags??0)&3);

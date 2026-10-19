export interface Recording {name?:string;channels:Float32Array[];rate:number;rootMidi:number;mode?:0|1|2;normalize?:boolean}
export interface Zone {asset:number;lowMidi?:number;highMidi?:number;key?:number;velocityLow?:number;velocityHigh?:number;gain?:number;pan?:number;choke?:number;roundRobin?:number;fixed?:boolean;color?:string}
export interface Settings {attack?:number;decay?:number;sustain?:number;release?:number;cutoff?:number;resonance?:number;pressure?:number;space?:number}
export interface Patch {name?:string;assets:Recording[];zones?:Zone[];settings?:Settings}
export interface Progress {label:string;asset:number;total:number;level:number}
export interface Prepared {bytes:Uint8Array;assets:{name?:string;frames:number;levels:number;channels:number}[];sourceBytes:number;residentBytes:number}
export const rate:number;
export function crc32(bytes:Uint8Array):number;
export function wav(bytes:ArrayBuffer):{channels:Float32Array[];rate:number};
export function suggestRoot(channels:Float32Array[]):{midi:number;confidence:number}|undefined;
export function resample(channels:Float32Array[],inputRate:number,periodic?:boolean):Float32Array[];
export function downsample(channels:Float32Array[],periodic?:boolean):Float32Array[];
export function preparePatch(patch:Patch,onProgress?:(progress:Progress)=>void):Promise<Prepared>;

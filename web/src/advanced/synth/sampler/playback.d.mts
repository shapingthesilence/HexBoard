import type {Patch} from './prepare.mjs';
export function playbackLimits(patch:Patch,classic?:boolean):{voices:number;tails:number};
export function resourceSummary(patch:Patch,classic?:boolean):{voices:number;tails:number;pcm:number;stereo:boolean;sd:boolean;readers:number;room:boolean};

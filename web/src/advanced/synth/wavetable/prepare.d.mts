export const frameCount:number,levelBits:number[],payloadBytes:number,assetBytes:number;
export interface TableOptions {frameSize?:number;channel?:'left'|'right'|'mix';firstFrame?:number;lastFrame?:number;reduction?:'blend'|'nearest'|'spectral';normalization?:'table'|'preserve';removeDc?:boolean;alignPhase?:boolean;smoothFrames?:boolean}
export interface TableSource {samples:Float32Array;frameSize:number;frames:number;channels:number;detectedFrameSize?:number;warnings:string[]}
export interface PreparedTable {bytes:Uint8Array;crc:number;preview:Float32Array;source:TableSource;warnings:string[]}
export function crc32(bytes:Uint8Array):number;
export function fft(re:Float64Array,im:Float64Array,inverse?:boolean):void;
export function decodeTable(bytes:ArrayBuffer|Uint8Array,options?:TableOptions):TableSource;
export function prepareTable(bytes:ArrayBuffer|Uint8Array,options?:TableOptions):PreparedTable;
export function validateAsset(bytes:Uint8Array):number;

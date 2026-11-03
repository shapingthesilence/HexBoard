import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {factoryTables} from './factory.ts';
import {validateAsset,decodeTable,assetBytes} from './prepare.mjs';
describe('Classic defaults from retained masters',()=>{
 it('ships the complete collection and original single cycles',()=>{expect(factoryTables).toHaveLength(23);expect(new Set(factoryTables.map(t=>t.id)).size).toBe(23);expect(factoryTables.filter(t=>t.group==='HexBoard Classic').map(t=>t.name).sort()).toEqual(['Classic','GlassyBells','HarshDigitalBois','NotPiano','RoundThe808','RustyBlade','Vowels'].sort());});
 for(const t of factoryTables)it(`checks ${t.name} source fidelity and prepared integrity`,()=>{const source=new Uint8Array(readFileSync(`public/advanced-wavetables/${t.file}.wav`)),prepared=new Uint8Array(readFileSync(`public/advanced-wavetables/${t.file}.hwt`));expect(createHash('sha256').update(source).digest('hex')).toBe(t.sourceSha256);if(t.source.endsWith('.wav'))expect(source).toEqual(new Uint8Array(readFileSync(`../${t.source}`)));expect(prepared.length).toBe(assetBytes);expect(validateAsset(prepared)).toBe(t.crc);const decoded=decodeTable(source,t.options);expect(decoded.frames).toBe(t.sourceFrames);expect(decoded.frameSize).toBe(t.sourceFrameSize);});
});

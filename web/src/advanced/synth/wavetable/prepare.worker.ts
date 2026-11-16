import {prepareTable} from './prepare.mjs';
self.onmessage=({data})=>{try {const result=prepareTable(data.bytes,data.options);self.postMessage({id:data.id,result},{transfer:[result.bytes.buffer,result.preview.buffer,result.source.samples.buffer]});} catch(error){self.postMessage({id:data.id,error:error instanceof Error?error.message:String(error)});}};

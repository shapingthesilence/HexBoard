import { analyzePitch, suggestLoops, verifyLoop } from './analysis.ts';
self.onmessage = (event: MessageEvent) => {
 try {const {recording,start,end,operation}=event.data;
 const analysis=operation==='verify'?verifyLoop(recording):analyzePitch(recording,start,end);
 self.postMessage({analysis,loops:operation==='analyze'?suggestLoops(recording,start,end,analysis):[]});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};

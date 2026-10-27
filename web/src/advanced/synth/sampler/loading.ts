import type {SamplerLoadingState} from '../client.ts';
export function samplerLoadingLabel(state?:SamplerLoadingState):string {
 if(!state||state.phase===0)return 'Checking sample loading…';
 if(state.phase===3)return `Loading stopped · ${state.ready}/${state.total} recordings ready. Stop and reload to retry.`;
 if(state.phase===2)return state.streaming?'Streaming from SD · 16 notes available':'Ready · 16 notes available';
 const percent=state.totalBytes?Math.min(99,Math.floor(state.loadedBytes/state.totalBytes*100)):0;
 return `${state.streaming?'Loading sample starts':'Loading'} · ${percent}% · ${state.ready}/${state.total} recordings ready · up to 4 notes while loading. New notes may wait for their recording.`;
}

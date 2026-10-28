import { useEffect, useMemo, useState } from "react";
import type { MidiTransport } from "../../../midi/types.ts";
import { ClassicSamplerClient, type ClassicInstrument } from "./classicClient.ts";

export function ClassicSamplerLibrary({ transport, revision, download, locked = false }: {
  transport?: MidiTransport; revision: number; download: (bytes:Uint8Array,name:string)=>void; locked?: boolean;
}) {
  const client = useMemo(()=>transport ? new ClassicSamplerClient(transport) : undefined,[transport]);
  const [entries,setEntries]=useState<ClassicInstrument[]>([]), [slot,setSlot]=useState(0), [active,setActive]=useState(127);
  const [busy,setBusy]=useState(false), [error,setError]=useState("");
  const unavailable = !client || busy || locked;
  async function refresh() {
    if (!client) return;
    setBusy(true); setError("");
    try { const rows=await client.library(), status=await client.status(); setEntries(rows); setActive(status.slot); setSlot(status.slot===127?(rows[0]?.id??0):status.slot); }
    catch(e) {setError(String(e));} finally {setBusy(false);}
  }
  useEffect(()=>{void refresh();},[client,revision]);
  async function perform(action:()=>Promise<void>) {setBusy(true);setError("");try{await action();}catch(e){setError(String(e));}finally{setBusy(false);}}
  return <fieldset><legend>HexBoard Classic library</legend>
    <div className="sampler-fields">
      <select aria-label="Classic instrument" value={slot} disabled={unavailable||!entries.length} onChange={e=>{const next=+e.target.value;void perform(async()=>{await client!.select(next);setSlot(next);setActive(next);});}}>
        {!entries.length&&<option value={0}>No imported instruments</option>}
        {entries.map(e=><option key={e.id} value={e.id}>{e.name} · {Math.ceil(e.bytes/1024)} KiB</option>)}
      </select>
      <button disabled={unavailable} onClick={()=>void perform(()=>client!.saveStartup())}>Save startup settings</button>
      <button disabled={unavailable} onClick={()=>void refresh()}>Refresh library</button>
      <button disabled={unavailable||active===127} onClick={()=>void perform(async()=>{await client!.select(127);setActive(127);})}>Use wavetable engine</button>
      <button disabled={unavailable||!entries.length} onClick={()=>void perform(async()=>{const e=entries.find(e=>e.id===slot)!;download(await client!.read(slot),`${e.name.replace(/[\\/:*?"<>|]/g,"_")}.hbc`);})}>Export selected</button>
      <button disabled={unavailable||!entries.length} onClick={()=>void perform(async()=>{await client!.remove(slot);await refresh();})}>Delete selected</button>
    </div>
    <p className="panel-note">Choose an instrument to play it immediately. Save startup settings stores your current settings in profile 1 without changing AutoSave.</p>
    {active!==127&&<p role="status">Sampler active: {entries.find(e=>e.id===active)?.name??`slot ${active+1}`}</p>}
    {error&&<p role="alert">{error}</p>}
  </fieldset>;
}

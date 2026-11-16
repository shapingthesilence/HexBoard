import {useEffect, useState, type RefObject} from 'react';
import type {PhysicalSynthClient, SamplerLoadingState} from '../client.ts';
import {samplerLoadingLabel} from './loading.ts';

/** Telemetry updates this status only; waveform/PCM authoring stays idle. */
export function SamplerLoadingStatus({client, playing}: {client: RefObject<PhysicalSynthClient | undefined>; playing: boolean}) {
  const [loading, setLoading] = useState<SamplerLoadingState>();
  const [error, setError] = useState('');
  useEffect(() => {
    setLoading(undefined); setError('');
    if (!playing) return;
    let alive = true, inFlight = false;
    const read = async () => {
      const current = client.current;
      if (!alive || !current || inFlight || document.hidden) return;
      inFlight = true;
      try { const state = await current.samplerLoading(); if (alive && current === client.current) { setLoading(state); setError(''); } }
      catch (error) { if (alive && current === client.current) setError(String(error)); }
      finally { inFlight = false; }
    };
    void read();
    const timer = setInterval(() => void read(), 400);
    return () => { alive = false; clearInterval(timer); };
  }, [client, playing]);
  return playing ? <p role={error ? 'alert' : 'status'} className={error ? 'sampler-error' : undefined}>{error || samplerLoadingLabel(loading)}</p> : null;
}

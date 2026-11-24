import {useEffect, useRef, useState, type RefObject} from 'react';
import type {PhysicalSynthClient, SamplerLoadingState} from '../client.ts';
import type {MidiTransport} from '../../../midi/types.ts';
import {PianoMixPanel, SamplerMixKnob} from './PianoMixPanel.tsx';
import {pianoMixDefaults, pianoMixKeys, pianoMixParameter} from './pianoMix.mjs';
import {samplerLoadingLabel} from './loading.ts';
import {mergeLegacySamplerEdits, outputEffects, readLiveSettings, roomAmount, sameSamplerSession} from './liveSettings.ts';

type Session = {loading: SamplerLoadingState; settings?: ReturnType<typeof readLiveSettings>};
type Props = {
  client: RefObject<PhysicalSynthClient | undefined>;
  transport?: MidiTransport;
  paused: boolean;
  onPlayback: (source?: number) => void;
  onBrowse: () => void;
};

export function LiveSamplerPanel({client, transport, paused, onPlayback, onBrowse}: Props) {
  const [live, setLive] = useState<Session>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedSource, setSavedSource] = useState<number>();
  const snapshot = useRef<Session>(undefined);
  useEffect(() => {
    snapshot.current = undefined;
    setLive(undefined);
    setError('');
    setSavedSource(undefined);
    onPlayback();
  }, [transport, onPlayback]);

  useEffect(() => {
    if (!transport || paused || saving) return;
    let active = true;
    let checking = false;
    async function read() {
      const connected = client.current;
      if (!active || !connected || checking || document.hidden) return;
      checking = true;
      try {
        const loading = await connected.liveSamplerLoading();
        if (!active) return;
        const current = snapshot.current;
        if (current?.settings && sameSamplerSession(current.loading, loading)) return;
        if (current?.loading.phase === 0 && loading.phase === 0) return;
        const next: Session = {loading};
        if (loading.phase === 2 && loading.source !== undefined) {
          if (loading.source === 1) {
            const words = new Map<number, number>(outputEffects.map(effect => [effect.id, effect.initial]));
            words.set(roomAmount, Math.round(.1 * 65535));
            next.settings = {name: 'KW upright · compact', piano: false, words};
          } else {
            const header = await connected.playingSamplerSettings(loading.session);
            if (loading.session === undefined && !sameSamplerSession(loading, await connected.liveSamplerLoading())) return;
            next.settings = readLiveSettings(header);
          }
        }
        if (!active) return;
        snapshot.current = next;
        setLive(next);
        setError('');
        onPlayback(loading.phase ? loading.source : undefined);
      } catch (error) {
        if (!active) return;
        snapshot.current = undefined;
        setLive(undefined);
        onPlayback();
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        checking = false;
      }
    }
    void read();
    const timer = setInterval(() => void read(), 600);
    return () => { active = false; clearInterval(timer); };
  }, [client, transport, paused, saving, onPlayback]);

  if (!transport) return null;
  const status = error || (live?.loading.phase ? samplerLoadingLabel(live.loading)
    : live ? 'No sampler sound playing.' : 'Checking HexBoard…');
  return <section className="sampler-live" aria-label="Playing on HexBoard">
    <header className="sampler-live-header">
      <div>
        <h3>Playing on HexBoard</h3>
        {live?.settings && <strong>{live.settings.name || 'Sampler sound'}</strong>}
        <p role={error ? 'alert' : 'status'}>{status}</p>
      </div>
      <button type="button" disabled={paused || saving} onClick={onBrowse}>Browse sounds</button>
    </header>
    {live?.settings && client.current && <LiveControls key={`${live.loading.source}:${live.loading.session}`}
      client={client.current} loading={live.loading} settings={live.settings} disabled={paused || saving}
      onSaving={setSaving} onSaved={source => { snapshot.current = undefined; setLive(undefined); setSavedSource(source); }}/>}
    {savedSource !== undefined && savedSource === live?.loading.source && <span role="status">Saved to sound.</span>}
  </section>;
}

function LiveControls({client, loading, settings, disabled, onSaving, onSaved}: {
  client: PhysicalSynthClient; loading: SamplerLoadingState; settings: ReturnType<typeof readLiveSettings>;
  disabled: boolean; onSaving: (saving: boolean) => void; onSaved: (source: number) => void;
}) {
  const [words, setWords] = useState(settings.words);
  const [feedback, setFeedback] = useState({text: '', error: false});
  const pending = useRef(new Map<number, number>());
  const applied = useRef(new Map<number, number>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sending = useRef<Promise<void> | undefined>(undefined);
  const active = useRef(true);
  const previousRoom = useRef(words.get(roomAmount) || Math.round(.18 * 65535));
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      clearTimeout(timer.current);
      pending.current.clear();
    };
  }, []);

  function flush() {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!sending.current) {
      sending.current = (async () => {
        while (active.current && pending.current.size) {
          if (loading.session === undefined && !sameSamplerSession(loading, await client.liveSamplerLoading())) {
            throw Error('The playing sound changed on HexBoard.');
          }
          if (!active.current) return;
          const [id, value] = pending.current.entries().next().value!;
          pending.current.delete(id);
          await client.samplerParameter(id, value, loading.session);
          applied.current.set(id, value);
        }
      })().catch(error => {
        pending.current.clear();
        if (active.current) {
          setWords(new Map([...settings.words, ...applied.current]));
          setFeedback({text: error instanceof Error ? error.message : String(error), error: true});
        }
        throw error;
      }).finally(() => { sending.current = undefined; });
    }
    return sending.current;
  }

  function change(id: number, value: number) {
    setWords(previous => new Map(previous).set(id, value));
    setFeedback({text: '', error: false});
    pending.current.set(id, value);
    if (!timer.current && !sending.current) timer.current = setTimeout(() => { void flush().catch(() => {}); }, 35);
  }

  async function save() {
    const source = loading.source;
    if (source === undefined) return;
    onSaving(true);
    setFeedback({text: 'Saving settings…', error: false});
    let stopped = false;
    try {
      await flush();
      if (!sameSamplerSession(loading, await client.liveSamplerLoading())) throw Error('The playing sound changed on HexBoard.');
      const header = await client.playingSamplerSettings(loading.session);
      await client.stopAndWait(loading.session);
      stopped = true;
      const selected = await client.samplerLoading(true);
      if (selected.phase || selected.source !== source) throw Error('The selected sound changed on HexBoard.');
      const saved = loading.session === undefined ? mergeLegacySamplerEdits(header, applied.current) : header;
      await client.writeStoppedSamplerSettings(saved, loading.session === undefined ? undefined : source);
      await client.start(6);
      stopped = false;
      onSaved(source);
    } catch (error) {
      if (stopped) {
        try {
          const selected = await client.samplerLoading(true);
          if (!selected.phase && selected.source === source && (await client.status()).state === 'stopped') await client.start(6);
        } catch { /* Keep the original save failure visible. */ }
      }
      setFeedback({text: error instanceof Error ? error.message : String(error), error: true});
    } finally {
      onSaving(false);
    }
  }

  const amount = words.get(roomAmount)!;
  const mix = {...pianoMixDefaults};
  pianoMixKeys.forEach((key, index) => { mix[key] = words.get(pianoMixParameter + index) ?? mix[key]; });
  return <>
    <PianoMixPanel mix={settings.piano ? mix : undefined} disabled={disabled}
      onChange={(key, value) => change(pianoMixParameter + pianoMixKeys.indexOf(key), value)}
      room={{
        amount: amount / 65535,
        onChange: ratio => {
          const value = Math.round(ratio * 65535);
          if (value) previousRoom.current = value;
          change(roomAmount, value);
        },
        onToggle: () => {
          if (amount) previousRoom.current = amount;
          change(roomAmount, amount ? 0 : previousRoom.current);
        },
      }}/>
    <details className="sampler-live-output">
      <summary>Output effects</summary>
      <fieldset className="sampler-piano-panel" disabled={disabled} aria-label="Output effects">
        <div className="knob-bank sampler-piano-knobs">
          {outputEffects.map(effect => {
            const value = words.get(effect.id)!;
            const decay = effect.id === 13;
            const toControl = (word: number) => decay ? Math.round(word / 10) : Math.round(word * 100 / 65535);
            return <SamplerMixKnob key={effect.id} label={effect.label} value={toControl(value)}
              min={toControl(effect.min)} max={toControl(effect.max)} neutral={toControl(effect.initial)}
              valueText={decay ? `${(value / 1000).toFixed(2)} s` : `${toControl(value)}%`}
              disabled={disabled} onChange={next => change(effect.id, decay ? next * 10 : Math.round(next * 65535 / 100))}/>;
          })}
        </div>
      </fieldset>
    </details>
    <div className="sampler-live-actions">
      {loading.source !== 1 && <button type="button" disabled={disabled || words === settings.words}
        title="Saving briefly pauses playback." onClick={() => void save()}>Save settings to sound</button>}
      {feedback.text && <span role={feedback.error ? 'alert' : 'status'}>{feedback.text}</span>}
    </div>
  </>;
}

import { useEffect, useRef, useState } from "react";
import { MidiSynthPreview } from "../audio/midiSynthPreview.ts";
import type { SynthPreviewController } from "../audio/synthPreview.ts";
import type { MidiTransport, WebMidiAccess, WebMidiInput } from "../midi/types.ts";
import { requestControllerMidiAccess, WebMidiTransport } from "../midi/webMidi.ts";
import { subscribeControllerInput } from "../midi/controllerInput.ts";

interface Props {
  transport: MidiTransport;
  connected: boolean;
  controller: () => SynthPreviewController;
  resetToken: number;
  onStatus: (status: string) => void;
  onMod: (value: number) => void;
}

export function SynthMidiPreview({ transport, connected, controller, resetToken, onStatus, onMod }: Props) {
  const [access, setAccess] = useState<WebMidiAccess | null>(null);
  const [inputs, setInputs] = useState<WebMidiInput[]>([]);
  const [source, setSource] = useState(connected ? "hexboard" : "none");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState(connected ? 48 : 2);
  const [status, setStatus] = useState("");
  const latest = useRef({ controller, onStatus, onMod });
  latest.current = { controller, onStatus, onMod };
  const router = useRef<MidiSynthPreview | null>(null);
  const generation = useRef(0);

  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { router.current?.stop(); }, [resetToken]);
  useEffect(() => { router.current?.setBendRange(range); }, [range]);
  useEffect(() => {
    generation.current++;
    setEnabled(false);
    setBusy(false);
  }, [transport, connected]);

  useEffect(() => {
    if (!access) return;
    const update = () => setInputs(Array.from(access.inputs.values()).filter(input => input.state !== "disconnected"));
    update();
    access.addEventListener?.("statechange", update);
    return () => access.removeEventListener?.("statechange", update);
  }, [access]);

  const selectedInput = inputs.find(input => `input:${input.id}` === source);
  const available = source === "hexboard" ? connected && transport instanceof WebMidiTransport && transport.hasInput : !!selectedInput;

  useEffect(() => {
    if (!available) {
      generation.current++;
      setEnabled(false);
      setBusy(false);
    }
  }, [available]);

  useEffect(() => {
    if (!enabled || !available) return;
    let disposed = false;
    const midi = new MidiSynthPreview({
      noteOn: (note, velocity, id, pitch) => {
        latest.current.onStatus(`MIDI note ${note}`);
        void latest.current.controller().noteOn(note, velocity, id, pitch).catch(error => {
          if (disposed) return;
          midi.stop();
          setEnabled(false);
          setStatus(error instanceof Error ? error.message : "Failed to play MIDI note");
        });
      },
      noteOff: (id, immediate) => latest.current.controller().noteOff(id, immediate),
      setPitch: (id, pitch) => latest.current.controller().setPitch(id, pitch),
      setMod: value => {
        latest.current.controller().setMod(value);
        latest.current.onMod(value);
      }
    }, range);
    router.current = midi;
    const receive = (bytes: Uint8Array) => {
      if (!disposed && !document.hidden && document.hasFocus()) midi.receive(bytes);
    };
    let unsubscribe = () => {};
    if (source === "hexboard") {
      unsubscribe = transport.subscribe(receive);
    } else if (selectedInput) {
      unsubscribe = subscribeControllerInput(selectedInput, receive, error => {
        if (disposed) return;
        setEnabled(false);
        setStatus(error instanceof Error ? error.message : "Cannot open MIDI input");
      });
    }
    return () => {
      disposed = true;
      unsubscribe();
      midi.stop();
      if (router.current === midi) router.current = null;
    };
    // Bend range changes update the active router without replacing its held notes.
  }, [enabled, available, source, selectedInput, transport]);

  async function findInputs() {
    const current = ++generation.current;
    setBusy(true);
    setStatus("Waiting for browser MIDI access…");
    try {
      const next = await requestControllerMidiAccess();
      if (current !== generation.current) return;
      setStatus("");
      setAccess(next);
      const ports = Array.from(next.inputs.values()).filter(input => input.state !== "disconnected");
      setInputs(ports);
      if ((source === "none" || !available) && ports[0]) chooseSource(`input:${ports[0].id}`, ports[0]);
      if (!ports.length) setStatus("No MIDI inputs found. Connect a controller and try again.");
    } catch (error) {
      if (current === generation.current) setStatus(error instanceof Error ? error.message : "Cannot access MIDI inputs");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  function chooseSource(value: string, input = inputs.find(port => `input:${port.id}` === value)) {
    generation.current++;
    setBusy(false);
    router.current?.stop();
    setEnabled(false);
    setSource(value);
    setRange(value === "hexboard" || /hexboard/i.test(input?.name ?? "") ? 48 : 2);
    setStatus("");
  }

  async function enable() {
    const current = ++generation.current;
    setBusy(true);
    setStatus("Starting browser audio…");
    try {
      // Audio must resume inside this button gesture, before any MIDI arrives.
      await latest.current.controller().start();
      if (current === generation.current) { setEnabled(true); setStatus(""); }
    } catch (error) {
      if (current === generation.current) setStatus(error instanceof Error ? error.message : "Cannot start browser audio");
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  return <div className="synthMidiPreview">
    <div className="row">
      <label className="field"><span>MIDI input</span>
        <select value={source} onChange={event => chooseSource(event.target.value)}>
          <option value="none">Typing / onscreen only</option>
          <option value="hexboard" disabled={!connected}>Connected HexBoard</option>
          {inputs.map(input => <option key={input.id} value={`input:${input.id}`}>{input.name ?? input.id}</option>)}
          {source.startsWith("input:") && !selectedInput && <option value={source}>Controller disconnected</option>}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={() => void findInputs()}>Find MIDI controllers</button>
      <button type="button" disabled={busy || !available} onClick={() => {
        if (enabled) { router.current?.stop(); setEnabled(false); }
        else void enable();
      }}>{enabled ? "Disable MIDI preview" : "Enable MIDI preview"}</button>
      <label className="field"><span>Pitch bend ± semitones</span>
        <input type="number" min={0} max={127} step={1} value={range} onChange={event => {
          const value = Number(event.target.value);
          if (Number.isFinite(value)) setRange(Math.max(0, Math.min(127, Math.round(value))));
        }} />
      </label>
    </div>
    <p className="muted" role="status">{status || (enabled && available ? "MIDI preview enabled" : "MIDI preview off")}</p>
    <p className="muted">Play the current draft through your browser. Match pitch bend to your controller (HexBoard MPE defaults to 48; ordinary MIDI to 2). MIDI bend-range messages override this per channel.</p>
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { record } from "./client.ts";
import { colorDefaults, colorProfile, colorSetCommand, colorTargets, type ColorProfile } from "./colorModel.ts";

type Execute = (command: string) => Promise<string[]>;
export function ColorCalibration({ execute, available }: { execute: Execute; available: boolean }) {
  const [profile, setProfile] = useState<ColorProfile>(colorDefaults);
  const [initial, setInitial] = useState<ColorProfile>(colorDefaults);
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  const [target, setTarget] = useState(0), [preview, setPreview] = useState(false), [bypass, setBypass] = useState(false);
  const [status, setStatus] = useState("Reading LED calibration…"), [applying, setApplying] = useState(false);
  const [power, setPower] = useState("");
  const failure = useRef(false), previewActive = useRef(false); previewActive.current = preview;
  const mounted = useRef(false), running = useRef(false), pending = useRef<null | { profile: ColorProfile; target: number; preview: boolean; bypass: boolean }>(null);
  const executeRef = useRef(execute); executeRef.current = execute;
  const worker = useRef<() => Promise<void>>(async () => {});
  worker.current = async () => {
    if (running.current || !mounted.current) return;
    running.current = true; setApplying(true);
    try {
      while (pending.current && mounted.current) {
        const next = pending.current; pending.current = null;
        await executeRef.current(colorSetCommand(next.profile));
        if (!mounted.current) break;
        const rgb = colorTargets[next.target].rgb;
        const lines = await executeRef.current(next.preview ? `led color preview ${rgb.join(" ")} ${Number(next.bypass)}` : "led color stop");
        if (!mounted.current) break;
        const state = record(lines, "led,color,");
        setPower(next.preview ? state.rail === "0" ? "LED rail is off. Check source power and charging; allow a moment for it to settle." : Number(state.scale) < 65535 ? "Power limiting is active. Use a stronger source or turn charging off before matching." : "Seven central keys · fixed brightness 32/255" : "Normal board colors restored.");
      }
      if (mounted.current) { failure.current = false; setFailed(false); setStatus("Applied to board RAM. Save when the colors look right."); }
    } catch (cause) { failure.current = true; pending.current = null; if (mounted.current) { setFailed(true); setStatus(cause instanceof Error ? cause.message : "Could not update colors."); } }
    finally { running.current = false; if (mounted.current) setApplying(false); }
  };
  useEffect(() => {
    mounted.current = true;
    void executeRef.current("led color status").then(lines => {
      if (!mounted.current) return;
      const p = colorProfile(record(lines, "led,color,")); setProfile(p); setInitial(p); setLoaded(true); setStatus("Choose Start matching to light the seven central keys.");
    }).catch(() => { if (mounted.current) { setFailed(true); setStatus("Update Advanced main firmware to use color calibration, then reconnect Calibration."); } });
    const timer = setInterval(() => {
      if (!previewActive.current || running.current || pending.current) return;
      void executeRef.current("led color status").then(lines => {
        if (!mounted.current) return;
        const state = record(lines, "led,color,");
        setPower(state.rail === "0" ? "LED rail is off. Check source power and charging." : Number(state.scale) < 65535 ? "Power limiting is active. Use a stronger source or turn charging off before matching." : "Seven central keys · fixed brightness 32/255");
      }).catch(() => {});
    }, 1000);
    return () => { clearInterval(timer); mounted.current = false; pending.current = null; void executeRef.current("led color stop").catch(() => {}); };
  }, []);
  useEffect(() => {
    if (!loaded || !available) return;
    pending.current = { profile, target, preview, bypass }; setApplying(true);
    const timer = setTimeout(() => { void worker.current(); }, 60);
    return () => clearTimeout(timer);
  }, [profile, target, preview, bypass, loaded, available]);
  async function save() {
    pending.current = { profile, target, preview, bypass };
    await worker.current();
    if (failure.current || running.current || !mounted.current) return;
    setApplying(true);
    try { await executeRef.current("led color save"); if (mounted.current) { setInitial(profile); setStatus("Color calibration saved on this board. It loads after restart."); } }
    catch (cause) { if (mounted.current) { setFailed(true); setStatus(cause instanceof Error ? cause.message : "Save failed."); } }
    finally { if (mounted.current) setApplying(false); }
  }
  function change(group: keyof ColorProfile, index: number, value: number) {
    setProfile(old => ({ ...old, [group]: old[group].map((v, i) => i === index ? value : v) }));
  }
  const disabled = !available || !loaded;
  return <section className="calCard colorCalibration"><h3>Match your LEDs to your screen</h3>
    <p>Start with a neutral white, then check colors and dim grays. Turn off Night Shift, True Tone, HDR and automatic screen brightness. Use your normal room lighting and match color rather than brightness. Your screen is a visual reference; this does not measure LED color accuracy.</p>
    <div className="calActions"><button type="button" disabled={disabled} aria-pressed={preview} onClick={() => setPreview(!preview)}>{preview ? "Stop matching" : "Start matching"}</button>
      <button type="button" disabled={disabled || !preview} aria-pressed={bypass} onClick={() => setBypass(!bypass)}>{bypass ? "Show calibrated" : "Compare uncorrected"}</button></div>
    <div className="colorReference" style={{ backgroundColor: `rgb(${colorTargets[target].rgb.join(" ")})` }} role="img" aria-label={`Screen reference: ${colorTargets[target].name}`} />
    <div className="colorTargets" aria-label="Reference colors">{colorTargets.map((item, i) => <button type="button" key={item.name} disabled={disabled} aria-pressed={target === i} onClick={() => setTarget(i)}><span style={{ backgroundColor: `rgb(${item.rgb.join(" ")})` }} />{item.name}</button>)}</div>
    <p className="calHint">{power} {bypass && preview ? "Comparison: correction bypassed. Choose Show calibrated to see slider edits." : ""}</p>
    <fieldset disabled={disabled}><legend>1. Neutral white</legend><p>Look at White. Reduce the channel that looks too strong until the keycaps look neutral.</p>
      {['Red', 'Green', 'Blue'].map((name, i) => <label className="colorSlider" key={name}>{name}<input type="range" min="0" max="1000" step="5" value={profile.gain[i]} onChange={e => change('gain', i, Number(e.target.value))} /><output>{(profile.gain[i] / 10).toFixed(1)}%</output></label>)}</fieldset>
    <details><summary>2. Fine-tune individual colors</summary><fieldset disabled={disabled}><p>Select a matching reference above, then move its hue until the keycaps resemble the screen. Neighboring colors blend smoothly.</p>
      {['Red', 'Yellow', 'Green', 'Cyan', 'Blue', 'Magenta'].map((name, i) => <label className="colorSlider" key={name}>{name}<input type="range" min="-25" max="25" value={profile.hue[i]} onChange={e => change('hue', i, Number(e.target.value))} /><output>{profile.hue[i]}°</output></label>)}</fieldset></details>
    <details><summary>3. Check dim grays</summary><fieldset disabled={disabled}><p>Choose Mid gray and Dim gray. If their color shifts, adjust the channel curves. Higher values make that channel darker at intermediate levels. White stays fixed.</p>
      {['Red', 'Green', 'Blue'].map((name, i) => <label className="colorSlider" key={name}>{name} curve<input type="range" min="100" max="400" value={profile.gamma[i]} onChange={e => change('gamma', i, Number(e.target.value))} /><output>{(profile.gamma[i] / 100).toFixed(2)}</output></label>)}</fieldset></details>
    <div className="calActions"><button type="button" disabled={disabled || applying} onClick={() => { void save(); }}>Save color calibration</button>
      <button type="button" disabled={disabled} onClick={() => { setBypass(false); setProfile(initial); }}>Undo edits</button>
      <button type="button" disabled={disabled} onClick={() => { setBypass(false); setProfile(colorDefaults()); }}>Default correction</button></div>
    <p className="calHint">Save briefly pauses scanning. Release keys and stop the synth and arpeggiator first. Defaults and Undo apply immediately in RAM; Save retains them.</p>
    <p role="status" className="calStatus" data-error={failed}>{applying ? "Updating LEDs…" : status}</p>
  </section>;
}

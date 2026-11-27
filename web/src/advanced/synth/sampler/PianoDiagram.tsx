import type {CSSProperties} from "react";
import type {PianoMixKey} from "./pianoMix.mjs";

export type PianoPart = PianoMixKey | "room";
type Props = {
  /** 0 is silent; 1 is unity for the mechanical trims, +36 dB for resonance. */
  levels: Partial<Record<PianoPart, number>>;
  boosted?: boolean;
  solo?: boolean;
  active?: PianoPart;
  onPick?: (part: PianoPart) => void;
  onHover?: (part?: PianoPart) => void;
};

// A grand piano in side section. Each mixer channel lights the part of the
// instrument that makes that sound. The sympathetic strings bow with the
// resonance trim; they show the setting, not a live meter.
const strings = [
  {y: 69, mode: 2, period: 1.1},
  {y: 75, mode: 3, period: .8},
  {y: 89, mode: 1, period: 1.4},
  {y: 95, mode: 4, period: .65},
];
const stringStart = 262, stringEnd = 548;

function standingWave(y: number, mode: number, amplitude: number) {
  const points: string[] = [];
  for (let i = 0; i <= 48; ++i) {
    const x = stringStart + (stringEnd - stringStart) * i / 48;
    points.push(`${x.toFixed(1)},${(y + amplitude * Math.sin(Math.PI * mode * i / 48)).toFixed(2)}`);
  }
  return `M${points.join("L")}`;
}

export function PianoDiagram({levels, boosted, solo, active, onPick, onHover}: Props) {
  const level = (part: PianoPart) => Math.max(0, Math.min(1, levels[part] ?? 0));
  const part = (name: PianoPart, label: string) => ({
    className: `piano-part${active === name ? " is-active" : ""}${level(name) ? "" : " is-off"}`,
    "data-part": name,
    style: {"--glow": level(name)} as CSSProperties,
    role: onPick ? "button" : undefined,
    "aria-label": onPick ? `${label} level` : undefined,
    onClick: onPick && (() => onPick(name)),
    onPointerEnter: onHover && (() => onHover(name)),
    onPointerLeave: onHover && (() => onHover()),
  });
  const resonance = level("pianoResonance");
  const amplitude = resonance ? 1 + 9 * resonance : 0;
  const room = level("room");
  return <svg className={`piano-diagram${solo ? " is-solo" : ""}${boosted ? " is-boosted" : ""}`} viewBox="0 0 720 230"
    role="img" aria-label="Piano sound sources">
    <defs>
      <filter id="piano-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
    </defs>

    <g className="piano-case" aria-hidden="true">
      <rect x="40" y="46" width="560" height="104" rx="14"/>
      <path className="piano-soundboard" d="M196 116 Q400 104 596 116"/>
      <path className="piano-keybed" d="M8 158H210"/>
      <path className="piano-legs" d="M86 150V214M560 150V214"/>
    </g>

    <g {...part("pianoResonance", "Sympathetic resonance")}>
      <ellipse className="piano-glow" cx="410" cy="84" rx="170" ry="30"/>
      <path className="piano-bridge" d="M536 84H556L560 112H532Z"/>
      {strings.map(s => <path key={s.y} className="piano-string is-sympathetic" d={standingWave(s.y, s.mode, amplitude)}
        style={{"--period": `${s.period}s`} as CSSProperties}/>)}
      <rect className="piano-hit" x="250" y="56" width="320" height="64"/>
      <text x="410" y="34" textAnchor="middle">Sympathetic strings</text>
    </g>

    <g className="piano-struck" aria-hidden="true">
      <path className="piano-string" d="M190 82H588"/>
      <circle className="piano-pin" cx="188" cy="82" r="3.5"/>
      <circle className="piano-pin" cx="590" cy="82" r="3.5"/>
      <path className="piano-hammer-shank" d="M142 132L206 100"/>
      <rect className="piano-hammer" x="198" y="86" width="20" height="18" rx="6"/>
    </g>

    <g {...part("pianoStringRelease", "String release")}>
      <ellipse className="piano-glow" cx="238" cy="78" rx="34" ry="22"/>
      <path className="piano-damper-wire" d="M238 50V64"/>
      <rect className="piano-damper" x="227" y="63" width="22" height="16" rx="3"/>
      <rect className="piano-hit" x="210" y="40" width="56" height="48"/>
      <text x="238" y="34" textAnchor="middle">String release</text>
    </g>

    <g {...part("pianoKeyNoise", "Key return")}>
      <ellipse className="piano-glow" cx="52" cy="146" rx="48" ry="20"/>
      <path className="piano-key" d="M14 134H178V143H14Z"/>
      <path className="piano-balance" d="M112 143L120 155H104Z"/>
      <rect className="piano-hit" x="6" y="124" width="180" height="36"/>
      <text x="14" y="182">Key return</text>
    </g>

    <g {...part("pianoPedalNoise", "Pedal noise")}>
      <ellipse className="piano-glow" cx="330" cy="200" rx="52" ry="22"/>
      <path className="piano-lyre" d="M322 150V196M338 150V196"/>
      <path className="piano-trap" d="M330 150V112"/>
      <rect className="piano-pedal" x="300" y="196" width="66" height="8" rx="4"/>
      <rect className="piano-hit" x="290" y="150" width="86" height="64"/>
      <text x="380" y="204">Pedal noise</text>
    </g>

    <g {...part("room", "Room")}>
      <ellipse className="piano-glow" cx="650" cy="98" rx="56" ry="56"/>
      {[22, 40, 58].map((r, i) => <path key={r} className="piano-wave"
        style={{opacity: room ? .25 + .75 * Math.max(0, Math.min(1, room * 3 - i)) : .12}}
        d={`M${608 + r * .55} ${98 - r}A${r} ${r} 0 0 1 ${608 + r * .55} ${98 + r}`}/>)}
      <rect className="piano-hit" x="606" y="34" width="110" height="128"/>
      <text x="662" y="182" textAnchor="middle">Room</text>
    </g>

    {solo && <text className="piano-solo-tag" x="410" y="140" textAnchor="middle">Solo · dampers lifted</text>}
  </svg>;
}

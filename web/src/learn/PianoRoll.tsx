import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { CourseLesson } from "./beginnerCourse.ts";
import { addRollNote, editRollNote, lessonRollNotes, measureLength, removeRollNote, type RollNote } from "./courseTimeline.ts";

export interface NoteSelection { step: number; voice: number }
export function PianoRoll({ lesson, pitches, color, selection, disabled = false, playhead, onChange, onSelect }: {
  lesson: CourseLesson; pitches: [number, string][]; color: (pitch: number) => string;
  selection?: NoteSelection; disabled?: boolean; playhead?: number;
  onChange: (lesson: CourseLesson, selection?: NoteSelection) => void;
  onSelect: (selection: NoteSelection) => void;
}) {
  const [snap, setSnap] = useState(0.25), [error, setError] = useState("");
  const [extraBars, setExtraBars] = useState(2);
  const [ghost, setGhost] = useState<RollNote>();
  const scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<{ note: RollNote; x: number; y: number; resize: boolean; row: number; scale: number; ghost: RollNote } | null>(null);
  const notes = lessonRollNotes(lesson);
  const current = notes.find(note => note.step === selection?.step && note.voice === selection.voice);
  const rows = [...new Map([...pitches, ...notes.filter(note => !pitches.some(([pitch]) => pitch === note.pitch)).map(note => [note.pitch, `Pitch ${note.pitch}`] as [number,string])]).entries()].sort((a,b) => b[0]-a[0]);
  const barLength = measureLength(lesson);
  const contentEnd = Math.max(lesson.timing!.beats.reduce((a, b) => a + b, 0), ...notes.map(note => note.onset + note.hold));
  const total = Math.min(2048, Math.max(barLength * 4, (Math.ceil(contentEnd / barLength) + extraBars) * barLength));
  const px = 64, rowHeight = 24, left = 76;
  useEffect(() => {
    const center = rows.findIndex(([pitch]) => pitch === (notes[0]?.pitch ?? pitches.find(([pitch]) => pitch >= 60)?.[0]));
    if (scroll.current) scroll.current.scrollTop = Math.max(0, center * rowHeight - 110);
  }, [lesson.id]);
  useEffect(() => {
    const remove = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (disabled || !current || !["Backspace", "Delete"].includes(event.key) || target.closest("input,textarea,select,[contenteditable=true],dialog")) return;
      event.preventDefault();
      onChange(removeRollNote(lesson, current.step, current.voice));
    };
    window.addEventListener("keydown", remove);
    return () => window.removeEventListener("keydown", remove);
  }, [lesson, selection, disabled, onChange]);
  function commit(next: CourseLesson, pitch: number, onset: number) {
    const note = lessonRollNotes(next).find(note => note.pitch === pitch && note.onset === onset);
    onChange(next, note ? { step: note.step, voice: note.voice } : undefined);
    setError("");
  }
  function insert(event: MouseEvent<SVGSVGElement>) {
    if (disabled || (event.target as Element).closest('[data-roll-note]')) return;
    const svg = event.currentTarget, bounds = svg.getBoundingClientRect();
    const scale = bounds.width / svg.width.baseVal.value;
    const x = (event.clientX - bounds.left) / scale - left, y = (event.clientY - bounds.top) / scale;
    const row = rows[Math.floor(y / rowHeight)];
    if (x < 0 || !row) return;
    const onset = Math.floor(x / px / snap) * snap;
    try { commit(addRollNote(lesson, row[0], onset, snap), row[0], onset); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  return <section className="pianoRoll" aria-label="Lesson piano roll">
    <div className="learnPracticeHeader"><h3>1. Place a note</h3><label>Snap <select aria-label="Piano roll snap" value={snap} disabled={disabled} onChange={event => setSnap(Number(event.target.value))}>
      <option value={1}>Quarter note</option><option value={0.5}>Eighth note</option><option value={0.25}>Sixteenth note</option>
    </select></label></div>
    <p className="learnMuted">Double-click or ⌘/Ctrl-click to add. Drag to move; drag the right edge to resize. Delete removes the selected note.</p>
    <div ref={scroll} className="pianoRollScroll" onScroll={event => { const element = event.currentTarget; if (element.scrollWidth > element.clientWidth && element.scrollLeft + element.clientWidth >= element.scrollWidth - 50 && total < 2048) setExtraBars(value => value + 2); }}>
      <div className="pianoRollRuler" style={{ width: left + total * px + 24 }}><span>Bar</span>{Array.from({ length: Math.ceil(total / barLength) }, (_, bar) => <span key={bar} style={{ position: "absolute", left: left + bar * barLength * px + 3 }}>{bar + 1}</span>)}</div>
      <svg width={left + total * px + 24} height={rows.length * rowHeight} aria-label="Notes by pitch and measure" onDoubleClick={insert} onClick={event => { if (event.metaKey || event.ctrlKey) insert(event); }}
        onPointerMove={event => {
          const d = drag.current; if (!d) return;
          const delta = Math.round((event.clientX - d.x) / d.scale / px / snap) * snap;
          d.ghost = { ...d.note, ...(d.resize ? { hold: Math.max(0.25, Math.min(32, d.note.hold + delta)) } : { onset: Math.max(0, Math.min(2047.75, d.note.onset + delta)), pitch: rows[Math.max(0, Math.min(rows.length - 1, d.row + Math.round((event.clientY - d.y) / d.scale / rowHeight)))][0] }) };
          setGhost(d.ghost);
        }}
        onPointerUp={event => {
          const d = drag.current; if (!d) return;
          drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
          if (d.ghost.onset !== d.note.onset || d.ghost.hold !== d.note.hold || d.ghost.pitch !== d.note.pitch) {
            try { commit(editRollNote(lesson, d.note.step, d.note.voice, d.ghost), d.ghost.pitch, d.ghost.onset); }
            catch (error) { setError(error instanceof Error ? error.message : String(error)); }
          }
          setGhost(undefined);
        }} onPointerCancel={() => { drag.current = null; setGhost(undefined); }}>
        {rows.map(([pitch, label], row) => <g key={pitch}><rect x={left} y={row * rowHeight} width={total * px} height={rowHeight} fill={row % 2 ? "var(--surface)" : "var(--surface-muted)"} /><text x={left - 8} y={row * rowHeight + 17} textAnchor="end">{label}</text></g>)}
        {Array.from({ length: Math.floor(total / snap) + 1 }, (_, i) => { const at = i * snap; return <line key={i} x1={left + at * px} x2={left + at * px} y1={0} y2={rows.length * rowHeight} stroke="currentColor" opacity={Number.isInteger(at) ? 0.16 : 0.07} pointerEvents="none" />; })}
        {Array.from({length:Math.ceil(total/barLength)},(_,bar)=><line key={`bar-${bar}`} x1={left+bar*barLength*px} x2={left+bar*barLength*px} y1={0} y2={rows.length*rowHeight} stroke="currentColor" opacity={0.4} pointerEvents="none"/>)}
        {notes.map(note => {
          const shown = ghost && drag.current?.note.step === note.step && drag.current.note.voice === note.voice ? ghost : note;
          const row = rows.findIndex(([pitch]) => pitch === shown.pitch); if (row < 0) return null;
          return <g data-roll-note key={`${note.step}:${note.voice}`} role="button" tabIndex={disabled ? -1 : 0} aria-pressed={current?.step === note.step && current.voice === note.voice} aria-label={`Note ${note.step + 1}.${note.voice + 1}: ${rows[row][1]}, onset ${note.onset}, hold ${note.hold}`}
            onKeyDown={event => { if (!disabled && ["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect({ step: note.step, voice: note.voice }); } }}
            onPointerDown={event => {
              if (disabled) return; event.preventDefault(); event.currentTarget.focus(); onSelect({ step: note.step, voice: note.voice });
              const svg = event.currentTarget.ownerSVGElement!; svg.setPointerCapture(event.pointerId);
              drag.current = { note, x: event.clientX, y: event.clientY, resize: (event.target as Element).getAttribute("data-resize") === "true", row, scale: svg.getBoundingClientRect().width / svg.width.baseVal.value, ghost: note }; setGhost(note);
            }}>
            <rect x={left + shown.onset * px + 1} y={row * rowHeight + 3} width={Math.max(8, shown.hold * px - 2)} height={rowHeight - 6} rx={3} fill={color(shown.pitch)} stroke={current?.step === note.step && current.voice === note.voice ? "var(--text)" : "#333"} strokeWidth={current?.step === note.step && current.voice === note.voice ? 3 : 1} />
            <rect data-resize="true" x={left + (shown.onset + shown.hold) * px - 7} y={row * rowHeight + 3} width={6} height={rowHeight - 6} fill="#fff" opacity={0.65} style={{ cursor: "ew-resize" }} />
          </g>;
        })}
        {playhead !== undefined && <line x1={left + playhead * px} x2={left + playhead * px} y1={0} y2={rows.length * rowHeight} stroke="var(--brand)" strokeWidth={3} pointerEvents="none" />}
      </svg>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}

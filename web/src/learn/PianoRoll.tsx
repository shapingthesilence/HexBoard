import type {TuningBundle} from "../catalogs/layoutsCatalog.ts";
import {translateCopiedFingerings} from "./courseFingering.ts";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { CourseLesson } from "./beginnerCourse.ts";
import { addRollNote, rebuild, copyRollNotes, pasteRollNotes, lessonRollNotes, measureLength, type RollNote } from "./courseTimeline.ts";

import {snapBeat,roundBeat,beatTick} from "./beatGrid.ts";
let copiedNotes:RollNote[]=[];
let copiedBundle:TuningBundle|undefined;
export interface NoteSelection { step: number; voice: number }
export function PianoRoll({ lesson, pitches, bundle, color, selection, disabled = false, playhead, snap: timedSnap, onChange, onSelect, onAudition }: {
  lesson: CourseLesson; bundle:TuningBundle; pitches: [number, string][]; color: (pitch: number) => string;
  selection?: NoteSelection; disabled?: boolean; playhead?: number; snap: number;
  onChange: (lesson: CourseLesson, selection?: NoteSelection) => void;
  onAudition:(pitch:number)=>void;
  onSelect: (selection: NoteSelection) => void;
}) {
  const [error, setError] = useState("");
  const snap = lesson.timing ? timedSnap : 1;
  const [extraBars, setExtraBars] = useState(2);
  const [ghosts,setGhosts]=useState<RollNote[]>([]);
  const [selectedKeys,setSelectedKeys]=useState<string[]>([]);
  const [pasting,setPasting]=useState(false);
  const [box,setBox]=useState<{x:number;y:number;endX:number;endY:number}>();
  const boxRef=useRef<typeof box>(undefined);
  const cursor=useRef({onset:0,row:0});
  const keyOf=(note:{step:number;voice:number})=>`${note.step}:${note.voice}`;
  const scroll = useRef<HTMLDivElement>(null);
  const drag = useRef<{ note: RollNote; x: number; y: number; resize: boolean; row: number; scale: number; ghost: RollNote; group:RollNote[]; moved:RollNote[] } | null>(null);
  const notes = lessonRollNotes(lesson);
  const selected=notes.filter(note=>selectedKeys.includes(keyOf(note)));
  const current = notes.find(note => note.step === selection?.step && note.voice === selection.voice);
  const rows = [...new Map([...pitches, ...notes.filter(note => !pitches.some(([pitch]) => pitch === note.pitch)).map(note => [note.pitch, `Pitch ${note.pitch}`] as [number,string])]).entries()].sort((a,b) => b[0]-a[0]);
  const barLength = measureLength(lesson);
  const contentEnd = Math.max(lesson.timing?.beats.reduce((a, b) => a + b, 0) ?? lesson.targets.length, ...notes.map(note => note.onset + note.hold));
  const total = Math.min(2048, Math.max(barLength * 4, (Math.ceil(contentEnd / barLength) + extraBars) * barLength));
  const px = 64, rowHeight = 24, left = 76;
  useEffect(() => {
    const center = rows.findIndex(([pitch]) => pitch === (notes[0]?.pitch ?? pitches.find(([pitch]) => pitch >= 60)?.[0]));
    if (scroll.current) scroll.current.scrollTop = Math.max(0, center * rowHeight - 110);
  }, [lesson.id]);
  const viewport=useRef<{pitch:number;offset:number}|undefined>(undefined);
  const rowSignature=rows.map(([pitch])=>pitch).join(",");
  useLayoutEffect(()=>{
    const element=scroll.current,anchor=viewport.current;if(!element)return;
    if(anchor){let index=rows.findIndex(([pitch])=>pitch===anchor.pitch);if(index<0)index=rows.reduce((best,[pitch],i)=>Math.abs(pitch-anchor.pitch)<Math.abs(rows[best][0]-anchor.pitch)?i:best,0);element.scrollTop=index*rowHeight+anchor.offset;}
  },[rowSignature]);
  useEffect(()=>{if(selection&&!selectedKeys.includes(keyOf(selection)))setSelectedKeys([keyOf(selection)]);},[selection?.step,selection?.voice]);
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (disabled || target.closest("input,textarea,select,[contenteditable=true],dialog")) return;
      const chosen=selected.length?selected:current?[current]:[];
      if(event.key==="Escape"){setPasting(false);setGhosts([]);return;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="c"&&chosen.length){event.preventDefault();copiedNotes=copyRollNotes(lesson,chosen);copiedBundle=structuredClone(bundle);return;}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="v"&&copiedNotes.length){event.preventDefault();setPasting(true);setGhosts(positionPaste(cursor.current.onset,cursor.current.row));return;}
      if(!["Backspace","Delete"].includes(event.key)||!chosen.length)return;
      event.preventDefault();onChange(rebuild(lesson,notes.filter(note=>!chosen.some(selected=>keyOf(selected)===keyOf(note))),chosen.map(note=>note.onset)));setSelectedKeys([]);
    };
    window.addEventListener("keydown",keyboard);return()=>window.removeEventListener("keydown",keyboard);
  },[lesson,selection,selectedKeys,disabled,pasting]);
  function positionPaste(onset:number,row:number){
    const first=Math.min(...copiedNotes.map(note=>note.onset));
    const sourceRows=copiedNotes.map(note=>rows.findIndex(([pitch])=>pitch===note.pitch));
    if(sourceRows.some(index=>index<0))return [];
    const delta=Math.max(-Math.min(...sourceRows),Math.min(rows.length-1-Math.max(...sourceRows),row-Math.min(...sourceRows)));
    const placed=copiedNotes.map((note,i)=>({...note,onset:roundBeat(onset+note.onset-first),pitch:rows[sourceRows[i]+delta][0]}));
    return copiedBundle?translateCopiedFingerings(copiedNotes,placed,copiedBundle,bundle):placed;
  }
  function point(event:{clientX:number;clientY:number;currentTarget:SVGSVGElement}){const bounds=event.currentTarget.getBoundingClientRect(),scale=bounds.width/event.currentTarget.width.baseVal.value;return {x:(event.clientX-bounds.left)/scale,y:(event.clientY-bounds.top)/scale};}
  function commit(next: CourseLesson, pitch: number, onset: number) {
    const note = lessonRollNotes(next).find(note => note.pitch === pitch && note.onset === onset);
    setSelectedKeys(note?[keyOf(note)]:[]);
    onChange(next, note ? { step: note.step, voice: note.voice } : undefined);
    setError("");onAudition(pitch);
  }
  function insert(event: MouseEvent<SVGSVGElement>) {
    if (disabled || pasting || (event.target as Element).closest('[data-roll-note]')) return;
    const svg = event.currentTarget, bounds = svg.getBoundingClientRect();
    const scale = bounds.width / svg.width.baseVal.value;
    const x = (event.clientX - bounds.left) / scale - left, y = (event.clientY - bounds.top) / scale;
    const row = rows[Math.floor(y / rowHeight)];
    if (x < 0 || !row) return;
    const onset = roundBeat(Math.floor(x / px / snap) * snap);
    try { commit(addRollNote(lesson, row[0], onset, snap), row[0], onset); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  }
  return <section className="pianoRoll" aria-label="Lesson piano roll">
    <div className="learnPracticeHeader"><h3>1. Place a note</h3></div>
    <p className="learnMuted">Double-click or ⌘/Ctrl-click to add. Drag to move{lesson.timing?"; drag the right edge to resize":" · quarter-note steps"}. Drag empty space to select notes. ⌘/Ctrl+C copies; ⌘/Ctrl+V follows the cursor until clicked. Escape cancels.</p>
    <div ref={scroll} className="pianoRollScroll" onScroll={event => { const element = event.currentTarget; const index=Math.min(rows.length-1,Math.max(0,Math.floor(element.scrollTop/rowHeight)));viewport.current={pitch:rows[index][0],offset:element.scrollTop-index*rowHeight}; if (element.scrollWidth > element.clientWidth && element.scrollLeft + element.clientWidth >= element.scrollWidth - 50 && total < 2048) setExtraBars(value => value + 2); }}>
      <div className="pianoRollRuler" style={{ width: left + total * px + 24 }}><span>Bar</span>{Array.from({ length: Math.ceil(total / barLength) }, (_, bar) => <span key={bar} style={{ position: "absolute", left: left + bar * barLength * px + 3 }}>{bar + 1}</span>)}</div>
      <svg width={left + total * px + 24} height={rows.length * rowHeight} aria-label="Notes by pitch and measure" onDoubleClick={insert} onClick={event=>{
        if(disabled)return;
        if(pasting){try{const placed=positionPaste(cursor.current.onset,cursor.current.row);if(!placed.length)throw new Error("Copied notes are outside this tuning’s piano roll.");const next=pasteRollNotes(lesson,placed);const chosen=lessonRollNotes(next).filter(note=>placed.some(p=>p.pitch===note.pitch&&Math.abs(p.onset-note.onset)<1e-7));onChange(next,chosen[0]);if(placed[0])onAudition(placed[0].pitch);setSelectedKeys(chosen.map(keyOf));setPasting(false);setGhosts([]);setError("");}catch(error){setError(String(error));}return;}
        if(event.metaKey||event.ctrlKey)insert(event);
      }}
      onPointerDown={event=>{if(disabled||pasting||event.metaKey||event.ctrlKey||(event.target as Element).closest('[data-roll-note]'))return;const p=point(event);if(p.x<left)return;boxRef.current={x:p.x,y:p.y,endX:p.x,endY:p.y};setBox(boxRef.current);event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={event=>{
        const p=point(event);cursor.current={onset:Math.max(0,snapBeat((p.x-left)/px,snap)),row:Math.max(0,Math.min(rows.length-1,Math.floor(p.y/rowHeight)))};
        if(pasting){setGhosts(positionPaste(cursor.current.onset,cursor.current.row));return;}
        if(boxRef.current){boxRef.current={...boxRef.current,endX:p.x,endY:p.y};setBox(boxRef.current);return;}
        const d=drag.current;if(!d)return;
        const raw=(event.clientX-d.x)/d.scale/px;
        const onset=snapBeat(d.note.onset+raw,snap);
        const delta=Math.max(-Math.min(...d.group.map(note=>note.onset)),onset-d.note.onset);
        const requested=Math.round((event.clientY-d.y)/d.scale/rowHeight);
        const sourceRows=d.group.map(note=>rows.findIndex(([pitch])=>pitch===note.pitch));
        const rowDelta=Math.max(-Math.min(...sourceRows),Math.min(rows.length-1-Math.max(...sourceRows),requested));
        const previousPitch=d.moved.find(note=>keyOf(note)===keyOf(d.note))?.pitch;
        d.moved=d.group.map(note=>({...note,...(d.resize?{hold:Math.max(beatTick,Math.min(32,snapBeat(note.hold+raw,snap)))}:{onset:roundBeat(note.onset+delta),pitch:rows[rows.findIndex(([pitch])=>pitch===note.pitch)+rowDelta][0]})}));setGhosts(d.moved);const pitch=d.moved.find(note=>keyOf(note)===keyOf(d.note))?.pitch;if(pitch!==undefined&&pitch!==previousPitch)onAudition(pitch);
      }}
      onPointerUp={event=>{
        if(boxRef.current){const b=boxRef.current;const chosen=notes.filter(note=>{const x=left+note.onset*px,y=rows.findIndex(([pitch])=>pitch===note.pitch)*rowHeight;return x+note.hold*px>=Math.min(b.x,b.endX)&&x<=Math.max(b.x,b.endX)&&y+rowHeight>=Math.min(b.y,b.endY)&&y<=Math.max(b.y,b.endY);});setSelectedKeys(chosen.map(keyOf));if(chosen[0])onSelect(chosen[0]);boxRef.current=undefined;setBox(undefined);event.currentTarget.releasePointerCapture(event.pointerId);return;}
        const d=drag.current;if(!d)return;drag.current=null;event.currentTarget.releasePointerCapture(event.pointerId);
        if(d.moved.some((note,i)=>note.onset!==d.group[i].onset||note.pitch!==d.group[i].pitch||note.hold!==d.group[i].hold))try{
          const moved=translateCopiedFingerings(copyRollNotes(lesson,d.group),d.moved.map((note,i)=>({...note,cues:copyRollNotes(lesson,[d.group[i]])[0].cues})),bundle,bundle);
          const next=rebuild(lesson,notes.map(note=>moved.find(moved=>keyOf(moved)===keyOf(note))??note));
          const chosen=lessonRollNotes(next).filter(note=>d.moved.some(moved=>moved.pitch===note.pitch&&Math.abs(moved.onset-note.onset)<1e-7));setSelectedKeys(chosen.map(keyOf));onChange(next,chosen[0]);setError("");
        }catch(error){setError(String(error));}setGhosts([]);
      }} onPointerCancel={()=>{drag.current=null;boxRef.current=undefined;setBox(undefined);setGhosts([]);}}>

        {rows.map(([pitch, label], row) => <g key={pitch}><rect x={left} y={row * rowHeight} width={total * px} height={rowHeight} fill={row % 2 ? "var(--surface)" : "var(--surface-muted)"} /><text x={left - 8} y={row * rowHeight + 17} textAnchor="end">{label}</text></g>)}
        {Array.from({ length: Math.floor(total / snap) + 1 }, (_, i) => { const at = i * snap; return <line key={i} x1={left + at * px} x2={left + at * px} y1={0} y2={rows.length * rowHeight} stroke="currentColor" opacity={Number.isInteger(at) ? 0.16 : 0.07} pointerEvents="none" />; })}
        {Array.from({length:Math.ceil(total/barLength)},(_,bar)=><line key={`bar-${bar}`} x1={left+bar*barLength*px} x2={left+bar*barLength*px} y1={0} y2={rows.length*rowHeight} stroke="currentColor" opacity={0.4} pointerEvents="none"/>)}
        {notes.map(note => {
          const shown = !pasting ? ghosts.find(ghost=>keyOf(ghost)===keyOf(note))??note : note;
          const row = rows.findIndex(([pitch]) => pitch === shown.pitch); if (row < 0) return null;
          return <g data-roll-note key={`${note.step}:${note.voice}`} role="button" tabIndex={disabled ? -1 : 0} aria-pressed={selectedKeys.includes(keyOf(note))} aria-label={`Note ${note.step + 1}.${note.voice + 1}: ${rows[row][1]}, onset ${note.onset}, hold ${note.hold}`}
            onKeyDown={event => { if (!disabled && ["Enter", " "].includes(event.key)) { event.preventDefault(); onSelect({ step: note.step, voice: note.voice });onAudition(note.pitch); } }}
            onPointerDown={event => {
              if (disabled||pasting) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.focus(); onSelect({ step: note.step, voice: note.voice });onAudition(note.pitch);
              const svg = event.currentTarget.ownerSVGElement!; svg.setPointerCapture(event.pointerId);
              const group=selectedKeys.includes(keyOf(note))&&selected.length?selected:[note];setSelectedKeys(group.map(keyOf));
              drag.current = { group,moved:group,note, x: event.clientX, y: event.clientY, resize: !!lesson.timing && (event.target as Element).getAttribute("data-resize") === "true", row, scale: svg.getBoundingClientRect().width / svg.width.baseVal.value, ghost: note }; setGhosts(group);
            }}>
            <rect x={left + shown.onset * px + 1} y={row * rowHeight + 3} width={Math.max(8, shown.hold * px - 2)} height={rowHeight - 6} rx={3} fill={color(shown.pitch)} stroke={selectedKeys.includes(keyOf(note)) ? "var(--text)" : "#333"} strokeWidth={selectedKeys.includes(keyOf(note)) ? 3 : 1} />
            {lesson.timing && <rect data-resize="true" x={left + (shown.onset + shown.hold) * px - 7} y={row * rowHeight + 3} width={6} height={rowHeight - 6} fill="#fff" opacity={0.65} style={{ cursor: "ew-resize" }} />}
          </g>;
        })}
        {box&&<rect pointerEvents="none" x={Math.min(box.x,box.endX)} y={Math.min(box.y,box.endY)} width={Math.abs(box.endX-box.x)} height={Math.abs(box.endY-box.y)} fill="var(--brand)" fillOpacity={0.15} stroke="var(--brand)"/>}
        {pasting&&ghosts.map((note,i)=><rect key={i} pointerEvents="none" x={left+note.onset*px} y={rows.findIndex(([pitch])=>pitch===note.pitch)*rowHeight+3} width={note.hold*px} height={18} fill={color(note.pitch)} opacity={0.65} stroke="var(--text)" strokeDasharray="4 2"/>)}
        {playhead !== undefined && <line x1={left + playhead * px} x2={left + playhead * px} y1={0} y2={rows.length * rowHeight} stroke="var(--brand)" strokeWidth={3} pointerEvents="none" />}
      </svg>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}

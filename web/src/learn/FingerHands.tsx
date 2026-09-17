import type { KeyCue } from "./beginnerCourse.ts";

const fingers = [
  { number: 1, name: "thumb", x: 117, y: 120, height: 52, angle: 40 },
  { number: 2, name: "index finger", x: 93, y: 59, height: 70, angle: 0 },
  { number: 3, name: "middle finger", x: 69, y: 46, height: 84, angle: 0 },
  { number: 4, name: "ring finger", x: 45, y: 60, height: 71, angle: 0 },
  { number: 5, name: "little finger", x: 21, y: 84, height: 51, angle: -8 },
];
export function FingerHands({cue,cues=cue?[cue]:[],color,disabled=false,onChoose}:{cue?:KeyCue;cues?:readonly KeyCue[];color?:(note:number)=>{fill:string;text:string};disabled?:boolean;onChoose?:(hand:"left"|"right",finger:number)=>void}) {
  return <svg className="courseHands" viewBox="0 0 340 240" aria-label="Recommended finger selection">
    {(["left","right"] as const).map((hand,index)=><g key={hand} transform={`translate(${index*175} 0)`}>
      <path d="M 20 117 Q 16 97 40 100 L 92 100 Q 110 99 111 118 L 119 143 Q 130 150 114 175 L 98 203 L 42 203 L 27 171 Q 17 150 20 117 Z" transform={hand==="right"?"translate(140 0) scale(-1 1)":undefined} className="handPalm"/>
      {fingers.map(finger=>{const x=hand==="left"?finger.x:140-finger.x,angle=hand==="left"?finger.angle:-finger.angle;const assigned=cues.filter(cue=>cue.hand===hand&&cue.finger===finger.number);const selected=assigned.length>0;const pitches=[...new Set(assigned.map(cue=>cue.note))];const shade=pitches.length===1?color?.(pitches[0]):undefined;
        const choose=()=>{if(!disabled)onChoose?.(hand,finger.number);};
        return <g key={finger.number} role={onChoose?"button":"img"} aria-label={`${hand==='left'?'Left':'Right'} ${finger.name} (${finger.number})`} aria-pressed={onChoose?selected:undefined} aria-disabled={onChoose?disabled:undefined} tabIndex={onChoose&&!disabled?0:undefined} className={`handFinger ${selected?'selected':''}`} onClick={choose} onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();choose();}}}>
          <rect style={shade?{fill:shade.fill}:undefined} x={x-10} y={finger.y} width={20} height={finger.height} rx={10} transform={`rotate(${angle} ${x} ${finger.y+finger.height})`}/>
          <text style={shade?{fill:shade.text}:undefined} x={x} y={finger.y+18} textAnchor="middle" transform={`rotate(${angle} ${x} ${finger.y+finger.height})`}>{finger.number}</text>
        </g>;
      })}
      <text x={70} y={228} textAnchor="middle" className="handCaption">{hand==='left'?'Left hand':'Right hand'}</text>
    </g>)}
  </svg>;
}

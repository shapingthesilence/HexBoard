import {beginnerLessons,type CourseLesson} from "./beginnerCourse.ts";
import {compactCourseKeys} from "./compactCourseKeys.ts";
import {starterLayouts} from "./majorScale.ts";
import {courseFormat,type UserCourse} from "./courseFiles.ts";
const melody=(notes:number[])=>notes.map(note=>[note]);
const timed=(id:string,title:string,instruction:string,targets:number[][],beats:number[],goalBpm=72,meter=4):CourseLesson=>({id,title,section:"Rhythm",instruction,targets,timing:{goalBpm,beats},timeSignature:{numerator:meter,denominator:4}});
const guided:CourseLesson[]=[
  timed("steady-pulse","Find the pulse","The beat is a steady reference underneath the music. After four count-in clicks, play one C on each click. Release and press again for each repeated note. Keep your hand relaxed and aim for an even pulse.",melody([60,60,60,60,60,60,60,60]),Array(8).fill(1),60),
  timed("moving-pulse","Move with the beat","Keep the same pulse while changing pitch. Play C–D–E–F and back. The bright buttons stay in one compact area so you can focus on listening to the click instead of searching for notes.",melody([60,62,64,65,65,64,62,60]),Array(8).fill(1)),
  timed("eighth-notes","Two notes per beat","Eighth notes divide a quarter-note beat into two equal parts. Count “1 and 2 and” and place the second note halfway between clicks. An even subdivision helps faster melodies feel controlled.",melody([60,62,64,65,67,65,64,62]),Array(8).fill(0.5),60),
  timed("mixed-lengths","Long and short","Melodies combine motion with breathing space. Alternate quarter and eighth notes, then let G ring for two beats. Watch the approaching cue for the next attack; note release length is guidance, not part of your timing score.",melody([60,62,64,65,67,65,64,60]),[1,0.5,0.5,2,1,0.5,0.5,2]),
  timed("rests","Leave room for silence","Rests are part of the rhythm. Play C–E–G, wait through the empty beat, then answer G–E–C. Do not start a new note during a rest; an already held note may continue ringing.",[[60],[64],[67],[],[67],[64],[60],[]],Array(8).fill(1),68),
  timed("three-four","Feel three beats","In 3/4, each bar contains three quarter-note beats. Count “1 2 3” as you outline C major, then F major. The click stays on quarter notes and the count-in is still four clicks; group the notes in threes yourself.",melody([60,64,67,65,69,72,67,64,60,60,64,67]),Array(12).fill(1),72,3),
  timed("offbeats","Between the clicks","Syncopation puts an attack between strong beats and lets it carry over a click. Hold the first note for a beat and a half, place the next attack on “and”, then land the following note on the next click. Count the “ands” even when you do not play them.",melody([60,64,67,64,62,60]),[1.5,0.5,2,1.5,0.5,2],60),
  timed("chord-rhythm","Change chords in time","Harmony has rhythm too. Change from C major to C minor every two beats. Keep C and G held and move only E or E♭ on the cue. Shared notes stay highlighted; the old third dims so the next change is clear.",[[60,64,67],[60,63,67],[60,64,67],[60,63,67]],[2,2,2,2],60),
];
export const intermediateLessons:readonly CourseLesson[]=[
  ...compactCourseKeys([...beginnerLessons,...guided]).slice(beginnerLessons.length),
  {id:"duplicate-buttons",title:"One pitch, several buttons",section:"Board fluency",instruction:"Different buttons can produce exactly the same pitch—not just the same note in another octave. Until now, one compact route was recommended. Here all matching buttons are equally bright: play C♯, release it, and try another highlighted C♯ before doing the same with E♭ and F. Alternate positions can make a chord or melody easier to reach. Any matching button counts.",targets:melody([61,61,63,63,65,65,61,61])},
  timed("short-phrase","Choose your own route","Put your rhythm and board knowledge together in this short original phrase. Quarter notes establish the pulse, pairs of eighth notes add movement, and a final long C brings it home. Choose whichever duplicate buttons give you a comfortable route; practice slowly, then reach the goal tempo.",melody([60,62,64,67,65,64,62,60,64,67,72,67,64,62,60]),[1,0.5,0.5,2,1,0.5,0.5,2,1,0.5,0.5,1,1,1,3],80),
];
const layouts=starterLayouts();
export const intermediateCourse:UserCourse={format:courseFormat,id:"hexboard-intermediate",revision:1,title:"Intermediate course · Rhythm",author:"HexBoard",bundle:{...layouts[0].bundle,layouts:layouts.map(item=>item.layout)},lessons:[...intermediateLessons]};

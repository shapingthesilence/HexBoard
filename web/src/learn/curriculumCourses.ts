import type {CourseLesson} from "./beginnerCourse.ts";
import {courseFormat, type UserCourse} from "./courseFiles.ts";
import {starterLayouts} from "./majorScale.ts";
import {recommendCourseRoute as route} from "./curriculumKeys.ts";

const melody = (notes: number[]) => notes.map(note => [note]);
const page = (id:string, title:string, section:string, markdown:string):CourseLesson => ({id,title,section,kind:"content",markdown,instruction:"",targets:[]});
const play = (id:string, title:string, section:string, instruction:string, notes:number[]):CourseLesson => ({id,title,section,instruction,targets:melody(notes)});
const timed = (lesson:CourseLesson, beats:number[], goalBpm=60):CourseLesson => ({...lesson,timing:{goalBpm,beats}});
const layouts = starterLayouts();
const course = (id:string,title:string,description:string,lessons:CourseLesson[]):UserCourse => ({
  format:courseFormat,id,revision:1,title,author:"HexBoard",description,
  bundle:{...layouts[0].bundle,layouts:layouts.map(item=>item.layout)},lessons,
});
const firstTune = [60,62,64,65,67,65,64,62,60];
const homeTune = [60,62,64,67,64,62,60,60,65,64,62,60];

export const firstStepsCourse = course("hexboard-first-steps","1 · First Steps on HexBoard",
  "Make your first music in about 20–30 minutes. No music reading is needed. Choose one layout and stay with it for now; the same sounds have different physical routes on other layouts.",[
  page("welcome","Welcome: listen, then play","Meet the board","Use **Hear example** to listen before playing. With hints on, the brightest keys suggest a route. Play one note at a time; take as long as you need.\n\nRepeat a familiar phrase, then choose **Try without hints**. Labels and colors remain visible. An Independent star records a clean run without hints or demonstration.\n\nKeep your hand loose and release a key before pressing it again. On screen, click keys to play. On a connected HexBoard, press the physical keys."),
  route(play("first-note","Your first note","Meet the board","Play the bright C. Listen until its sound feels familiar. You have started: there is no clock to beat.",[60])),
  route(play("home","Find home","Meet the board","Play C, then G, then C. Listen to how the last note feels like coming home. Hear the example, then answer it yourself.",[60,67,60])),
  route(play("higher-lower","Higher and lower","Meet the board","Play C–D–E, then come down to C. Follow the sound going up and down; higher pitch does not always mean a button directly above the last one.",[60,62,64,62,60])),
  route(play("octaves","Two versions of C","Meet the board","Alternate the lower and higher C. They share a name but sound at different heights. This distance is called an octave.",[60,72,60,72,60])),
  play("same-pitch","Same pitch, different button","Choose a route","All matching buttons light equally here. Play the highlighted C♯ (C-sharp), release it, then find another button with exactly the same sound. Repeat with E♭ and F. A higher version of a note is an octave, not a duplicate. These pitches have duplicates on all three layouts. Any matching button counts; changing buttons is your own listening experiment.",[61,61,63,63,65,65]),
  route(play("follow-lights","Follow a short trail","Your first tune","A compact route is highlighted again. Play C–D–E and back, then C–G–C. A duplicate button with the same pitch still counts. Use whichever feels comfortable.",[60,62,64,62,60,67,60])),
  route(play("five-note-tune","Five notes make a tune","Your first tune","Listen first, then play this little hill: C–D–E–F–G–F–E–D–C. Repeat until the return to C feels familiar.",firstTune)),
  route(play("remember-tune","Remember the tune","Your first tune","Turn off Hints before starting. Play the same little hill from memory. If you get lost, return to the previous lesson with hints, then try again. Aim for an Independent star.",firstTune)),
  route(timed(play("first-beat","Your first tune in time","Your first tune","You already know the notes. After four count-in clicks, play one note per click. Use Step to rehearse, or slow the Practice tempo; reach 50 BPM when ready. The example uses the goal tempo.",firstTune),[1,1,1,1,1,1,1,1,4],50)),
  route(play("homecoming-rehearsal","Homecoming: learn the ending","Make music","This original mini piece uses your familiar notes. Play C–D–E–G–E–D–C, repeat C, then answer F–E–D–C. Release before the repeated C. Take your time learning that answer.",homeTune)),
  {...route(timed(play("homecoming","Homecoming: your first performance","Make music","Play the piece with the click at 50 BPM. Give the long notes room to ring. After a comfortable guided run, choose Try without hints and aim for two clean runs. A guided completion is still a useful first win.",homeTune),[1,1,1,1,1,1,2,1,1,1,1,4],50)),repetitions:2},
]);

const pair = (id:string,title:string,instruction:string,notes:number[]) => route(play(id,title,"Hear and find intervals",instruction,notes),[{steps:notes.length,root:60,shape:"interval"}]);
const motif = [60,62,64,62,60];
export const movementCourse = course("hexboard-isomorphic-movement","2 · Moving Around an Isomorphic Keyboard",
  "Learn a relationship, recognize its shape, then move it. Start after First Steps. These exercises are untimed so you can watch, listen, and choose a comfortable route.",[
  page("same-shape","What is isomorphic?","Shapes that move","An **interval** is the distance between two pitches. On an isomorphic layout, translating a complete shape preserves its intervals. The shape changes between Wicki-Hayden, Harmonic Table, and Gerhard, so practice on one layout at a time.\n\nA duplicate lets the same pitch live in more than one place. Moving a shape onto a duplicate root keeps the pitches; moving it to a different pitch transposes it. The whole shape must fit on playable buttons."),
  pair("half-steps","Half-step neighbors","Play C–C♯ and back. A half step is the smallest pitch step in this course's 12-EDO tuning. Listen first; its physical route depends on your layout.",[60,61,60,61,60]),
  pair("whole-steps","Whole-step neighbors","Play C–D and back. This larger pitch step spans two half steps. Notice the direction and distance between the suggested buttons.",[60,62,60,62,60]),
  pair("major-third","A major third","Play C–E and back. This interval spans four half steps. Hum the sound and trace the movement before repeating it.",[60,64,60,64,60]),
  pair("minor-third","A minor third","Play C–E♭ and back. A minor third spans three half steps. Compare its sound with the previous lesson; change only the upper note.",[60,63,60,63,60]),
  route(play("thirds-answer","A small question and answer","Hear and find intervals","Let the major third ask C–E–C; let the minor third answer C–E♭–C. Repeat the two little phrases. Hear how one changed note changes the answer.",[60,64,60,60,63,60])),
  pair("fifth","A perfect fifth","Play C–G and back. This seven-half-step interval gives a clear, open sound. Notice its button shape before moving it in a later lesson.",[60,67,60,67,60]),
  pair("octave","The octave shape","Play the two Cs. An octave spans twelve half steps. Trace this route on your layout; do not confuse the upper C with a duplicate of the lower C.",[60,72,60,72,60]),
  route(play("interval-locations","Same interval, another position","Translate a shape","Play C♯–F–C♯ in one position, then follow the same major-third shape in a second position. The pitches are unchanged. Matching duplicates are accepted; following the recommendations lets you see the translation.",[61,65,61,61,65,61]),[{steps:3,root:61,position:0},{steps:3,root:61,position:1}]),
  route(play("move-fifth","Move a fifth to a new root","Translate a shape","Play C–G–C, then D–A–D. The second phrase starts higher, but the suggested buttons preserve the same shape. This is transposition.",[60,67,60,62,69,62]),[{steps:3,root:60},{steps:3,root:62}]),
  route(play("three-note-shape","Three notes become a shape","Translate a shape","Play C–D–E–D–C. Think of two equal whole steps followed by the return. On some layouts this scale route uses a different duplicate than the earlier interval exercise.",motif)),
  route(play("duplicate-route","A second route for the same phrase","Translate a shape","Start the little whole-step phrase on C♯: C♯–E♭–F–E♭–C♯. Then move to the second highlighted position and repeat it. The sound stays the same. Look ahead so your hand can reposition without a hurried stretch.",[...motif,...motif].map(n=>n+1)),[{steps:5,root:61,position:0},{steps:5,root:61,position:1}]),
  route(play("transpose-motif","A traveling melody","Make the shape musical","Play the little phrase from C, then D, then F. Listen for the same tune at three heights. Follow the recommended buttons to see the same physical shape travel.",[...motif,...motif.map(n=>n+2),...motif.map(n=>n+5)]),[{steps:5,root:60},{steps:5,root:62},{steps:5,root:65}]),
  play("choose-route","Choose your return home","Make the shape musical","All matching buttons are equally bright. Play C–E–G–E–C, then D–F♯–A–F♯–D. Choose duplicates that keep the phrase comfortable. The second phrase has the same intervals as the first.",[60,64,67,64,60,62,66,69,66,62]),
  {...route(play("shape-checkpoint","Travel without hints","Make the shape musical","Turn off Hints before starting. Play the C phrase, then the same shape from D. Take your time and aim for two clean runs and an Independent star. Return to A traveling melody if you need to see the route again.",[...motif,...motif.map(n=>n+2)]),[{steps:5,root:60},{steps:5,root:62}]),repetitions:2},
]);

const rhythm = (id:string,title:string,instruction:string,notes:number[],beats:number[],goalBpm=60,section="Keep a pulse") => route(timed(play(id,title,section,instruction,notes),beats,goalBpm));
const rhythmPhrase = [60,62,64,67,64,62,60];
export const rhythmCourse = course("hexboard-rhythm-fundamentals","3 · Rhythm Fundamentals",
  "Keep a pulse while familiar notes become music. Start after Isomorphic Movement. Rehearse any exercise in Step mode, slow the Practice tempo when needed, and work toward its goal BPM. BPM always counts quarter notes.",[
  page("pulse","Find the pulse before playing","Keep a pulse","Listen to an example and tap along away from the keys. A beat is the steady pulse; a rhythm places notes and spaces around it.\n\nEvery timed exercise has four count-in clicks. **Step** waits for notes without a clock. Slower runs give practice feedback; completion needs the goal tempo and a passing score. Note lengths guide your phrasing here; releases are not graded.\n\nUse familiar pitches while you learn each new rhythm. Return to hints whenever they help, then repeat familiar phrases with **Try without hints**."),
  rhythm("steady-pulse","One note on the pulse","After four clicks, play C once per click. Release before pressing again. Count 1–2–3–4 twice; let your movement feel small and even.",Array(8).fill(60),Array(8).fill(1),50),
  rhythm("moving-pulse","Move with the beat","Keep the same pulse while playing C–D–E–D–C. The notes are familiar; focus on arriving with each click.",[60,62,64,62,60],[1,1,1,1,4],50),
  rhythm("quarter-notes","Quarter notes at 60","A note on every click is a quarter-note rhythm here. Repeat C four times, then D four times. Keep the spacing even across the change.",[60,60,60,60,62,62,62,62],Array(8).fill(1)),
  rhythm("eighth-notes","Two notes per beat","Count 1-and-2-and. Play the first C on a click and the next halfway to the following click. Keep the pitch fixed while learning this subdivision.",Array(8).fill(60),Array(8).fill(0.5),50),
  rhythm("pulse-tune","A tune with moving eighths","Play this original answer using quarters and a pair of eighths. Keep counting through the long final C. You have made a rhythm from your familiar notes.",rhythmPhrase,[1,1,0.5,0.5,1,1,3],50),
  rhythm("mixed-lengths","Long and short","Alternate quarters and eighths, with room to breathe on G and C. Let the long notes ring; release length is guidance, while the next attack must stay in time.",[60,62,64,67,64,62,60],[1,0.5,0.5,2,1,1,2],60,"Space and accents"),
  route({...timed(play("rests","Make room for silence","Space and accents","Play C–E–G, leave a beat of silence, then answer G–E–C. Release for the written rests. The grader checks that you do not start a new note in a rest; it does not grade the release.",[]),Array(8).fill(1),60),targets:[[60],[64],[67],[],[67],[64],[60],[]]}),
  rhythm("repeated-notes","Clean repeated notes","Repeat C in quarters, then eighths, and finish on a long C. Release between attacks. Listen for separate, evenly spaced sounds without making larger movements.",Array(9).fill(60),[1,1,1,1,0.5,0.5,0.5,0.5,2],60,"Space and accents"),
  {...rhythm("three-four","A three-beat dance","Count 1–2–3 in each bar. Play C–E–G, then G–E–C, twice. The count-in is still four clicks; begin grouping in threes at the first note.",[60,64,67,67,64,60,60,64,67,67,64,60],Array(12).fill(1),60,"Space and accents"),timeSignature:{numerator:3,denominator:4}},
  route({...timed(play("offbeats","The spaces between clicks","Space and accents","Count 1-and-2-and. Wait on each numbered click, then play C on and. Keep counting during the rests; they make the offbeat audible.",[]),Array(8).fill(0.5),50),targets:[[],[60],[],[60],[],[60],[],[60]]}),
  rhythm("syncopation","Carry across the click","Count the ands. Play C on 1, E on the and of 2, and G on 3. Repeat, then return home. The long first note carries over a click; avoid adding an attack there.",[60,64,67,60,64,60],[1.5,0.5,2,1.5,0.5,2],50,"Space and accents"),
  page("together","Two notes can share a beat","Sound together","For this rhythm exercise, use only C and G, a familiar fifth. First hold them together without a clock. On screen, click to hold and click again to release. The next timed lesson repeats that same pair; full triad construction comes in Chords and Arpeggios."),
  route({id:"together-rehearsal",title:"Hold C and G together",section:"Sound together",instruction:"Hold both bright notes together, then release. Listen to them blend. Take as much time as you need before adding the click.",targets:[[60,67]]}),
  route({id:"chords-on-beat",title:"Together on the beat",section:"Sound together",instruction:"After the count-in, press C and G together every two beats. Release both before the next pair. These are the same two notes you just rehearsed, now arriving together with the pulse.",targets:Array.from({length:4},()=>[60,67]),timing:{goalBpm:50,beats:[2,2,2,2]}}),
  rhythm("short-phrase","A short rhythmic phrase","Return to the little answer from earlier at 60 BPM. Count through its long ending. When comfortable, repeat without hints before learning a new subdivision.",rhythmPhrase,[1,1,0.5,0.5,1,1,3],60,"Sound together"),
  rhythm("triplets","Three notes per beat","Count 1-trip-let, 2-trip-let. Fit three equal C attacks between successive quarter-note clicks. Keep the pitch fixed while learning the new spacing.",Array(12).fill(60),Array(12).fill(1/3),50,"Divide the beat"),
  rhythm("subdivision-mix","One, two, then three","Play two quarters, four eighths, then six triplet notes. Each group lasts two beats. Finish on a C held for two beats. Keep the click steady while only the subdivision changes.",Array(13).fill(60),[1,1,0.5,0.5,0.5,0.5,1/3,1/3,1/3,1/3,1/3,1/3,2],50,"Divide the beat"),
  {...rhythm("six-eight","Two groups of three in 6/8","Count ONE-two-three FOUR-five-six. Each note is an eighth; feel two larger pulses per bar. BPM and the click still use quarter notes, so the larger pulses do not all fall on clicks. Listen before playing; 6/8 grouping is different from triplets within quarter beats.",[60,64,67,67,64,60,60,64,67,67,64,60],Array(12).fill(0.5),60,"Divide the beat"),timeSignature:{numerator:6,denominator:8}},
  rhythm("etude-rehearsal","Pulse and Play: rehearsal","Revisit quarters, eighths, a long note, and a triplet answer in this original four-bar piece. Start in Step mode to learn the order, then use 50 BPM before the final checkpoint.",[60,62,64,64,60,60,62,64,67,64,62,60,60,62,60],[1,1,0.5,0.5,1,2,1,1,1,0.5,0.5,2,1/3,1/3,10/3],50,"Make music"),
  {...rhythm("rhythm-checkpoint","Pulse and Play: performance","Play the same piece at 60 BPM for two clean runs. Once comfortable, use Try without hints and aim for an Independent star. Your goal is an even pulse through changing note lengths.",[60,62,64,64,60,60,62,64,67,64,62,60,60,62,60],[1,1,0.5,0.5,1,2,1,1,1,0.5,0.5,2,1/3,1/3,10/3],60,"Make music"),repetitions:2},
]);

/** Learner order; built-ins use the same portable format as authored courses. */
export const builtinCourses = [firstStepsCourse,movementCourse,rhythmCourse] as const;
export const defaultCourse = firstStepsCourse;

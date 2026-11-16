// Public-domain melodies, entered as single-line teaching excerpts in C.
// Sources, phrase boundaries, and rhythmic adaptations: docs/course-repertoire.md.
export const odeOpening = [64,64,65,67,67,65,64,62];
export const odeClosing = [...odeOpening,60,60,62,64,62,60,60];
export const odeEvenBeats = [...Array(14).fill(1),2];
export const odeClosingBeats = [...Array(12).fill(1),1.5,0.5,2];
export const twinkleOpening = [60,60,67,67,69,69,67];
export const twinklePhrase = [...twinkleOpening,65,65,64,64,62,62,60];
export const twinkleBeats = [1,1,1,1,1,1,2,1,1,1,1,1,1,2];
// First four bars of the traditional air; the final rest becomes a held C.
export const auClairOpening = [60,60,60,62,64,62,60,64,62,62,60];
export const auClairBeats = [1,1,1,1,2,2,1,1,1,1,4];
// The first phrase of ANTIOCH, also known as Joy to the World. Untimed here.
export const joyDescending = [72,71,69,67,65,64,62,60];
// NEW BRITAIN (Amazing Grace), first two lines transposed to F so it stays
// within C4–C5. Timed lessons add a two-beat leading rest so the C pickup
// falls on beat 3 of a 3/4 bar.
export const graceLine = [60,65,69,65,69,67,65,62,60,60,65,69,65,69,67,72];
export const graceBeats = [1,2,0.5,0.5,2,1,2,1,2,1,2,0.5,0.5,2,1,3];
// Row, Row, Row Your Boat in 6/8, one statement of the round, in quarter-note beats.
export const rowOpening = [60,60,60,62,64,64,62,64,65,67];
export const rowRun = [72,72,72,67,67,67,64,64,64,60,60,60];
export const rowSong = [...rowOpening,...rowRun,67,65,64,62,60];
export const rowBeats = [1.5,1.5,1,0.5,1.5,1,0.5,1,0.5,3,...Array(12).fill(0.5),1,0.5,1,0.5,3];

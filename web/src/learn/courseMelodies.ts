// Public-domain melodies, entered as single-line teaching excerpts in C.
// Sources, phrase boundaries, and rhythmic adaptations: docs/course-repertoire.md.
export const odeOpening = [64,64,65,67,67,65,64,62];
export const odeClosing = [...odeOpening,60,60,62,64,62,60,60];
export const odeEvenBeats = [...Array(14).fill(1),2];
export const odeClosingBeats = [...Array(12).fill(1),1.5,0.5,2];
export const twinkleOpening = [60,60,67,67,69,69,67];
export const twinklePhrase = [...twinkleOpening,65,65,64,64,62,62,60];
export const twinkleBeats = [1,1,1,1,1,1,2,1,1,1,1,1,1,2];

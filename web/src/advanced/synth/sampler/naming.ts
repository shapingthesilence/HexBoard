/**
 * MIDI note written in a sample file name, using C4 = 60 (for example
 * "glock_medium_G4", "pizz-e2", "Flute Eb5"). Uses the last note-like token.
 * Libraries number octaves differently, so treat the result as a hint.
 */
export function noteFromName(name:string):number|undefined{
 const matches=[...name.matchAll(/(?:^|[^A-Za-z])([A-Ga-g])(#|♯|s|b|♭)?(-?\d)(?!\d)/g)];
 const m=matches.at(-1);
 if(!m)return;
 const pc={c:0,d:2,e:4,f:5,g:7,a:9,b:11}[m[1].toLowerCase() as 'c'],accidental=m[2]?/[#♯s]/.test(m[2])?1:-1:0,midi=12*(+m[3]+1)+pc+accidental;
 return midi>=0&&midi<=127?midi:undefined;
}

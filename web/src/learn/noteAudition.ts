interface AuditionAudio {
  start(): Promise<void>;
  noteOn(note:number): Promise<void>;
  allNotesOff(): void;
  close(): Promise<void>;
}
/** One short voice, reusing the audio engine while editing. Late starts cannot
 * sound after a newer gesture or after the editor is stopped. */
export class NoteAudition {
  private audio?:AuditionAudio;
  private ready?:Promise<void>;
  private generation=0;
  private timer?:ReturnType<typeof setTimeout>;
  constructor(private create:()=>AuditionAudio){}
  async play(pitch:number){
    const generation=++this.generation;
    clearTimeout(this.timer);
    this.audio?.allNotesOff();
    if(!this.audio){this.audio=this.create();this.ready=this.audio.start();}
    const audio=this.audio;
    try{
      await this.ready;
      if(generation!==this.generation)return;
      await audio.noteOn(pitch);
      if(generation!==this.generation)return;
      this.timer=setTimeout(()=>audio.allNotesOff(),220);
    }catch(error){if(generation===this.generation)this.stop();throw error;}
  }
  stop(){
    this.generation++;clearTimeout(this.timer);
    const audio=this.audio;this.audio=undefined;this.ready=undefined;
    audio?.allNotesOff();void audio?.close().catch(()=>{});
  }
}

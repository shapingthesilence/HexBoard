import type { Settings } from './prepare.mjs';

// Audition uses the same two tap times, rates and mix as the device.
export class PreviewEffects {
  readonly roomInput: GainNode;
  readonly roomOutput: GainNode;
  private ensembleDry: GainNode;
  private driveDry: GainNode;
  private taps?: GainNode[];
  private shaper?: WaveShaperNode;
  private driveWet?: GainNode;
  private drive = 0;

  constructor(private ctx: AudioContext, private input: GainNode, private output: AudioNode) {
    this.roomInput = ctx.createGain();
    this.roomOutput = ctx.createGain();
    this.ensembleDry = ctx.createGain();
    this.driveDry = ctx.createGain();
    input.connect(this.ensembleDry).connect(this.roomInput);
    this.roomOutput.connect(this.driveDry).connect(output);
  }

  apply(settings?: Settings) {
    const {ctx,input,output}=this, now=ctx.currentTime;
    const ensemble=settings?.ensemble??0,drive=settings?.drive??0;
    if(ensemble&&!this.taps){
      const mono=ctx.createGain();
      mono.channelCount=1;
      mono.channelCountMode='explicit';
      input.connect(mono);
      this.taps=[0,1].map(i=>{
        const delay=ctx.createDelay(.032),lfo=ctx.createOscillator(),depth=ctx.createGain();
        const gain=ctx.createGain(),pan=ctx.createStereoPanner();
        delay.delayTime.value=(8+3.1*i)/1000;
        lfo.frequency.value=.31+.23*i;
        depth.gain.value=(1.5+.5*i)/1000;
        pan.pan.value=i?1:-1;
        gain.gain.value=0;
        lfo.connect(depth).connect(delay.delayTime);
        mono.connect(delay).connect(gain).connect(pan).connect(this.roomInput);
        lfo.start();
        return gain;
      });
    }
    this.ensembleDry.gain.setTargetAtTime(1-.36*ensemble,now,.01);
    for(const tap of this.taps??[])tap.gain.setTargetAtTime(1.2*ensemble,now,.01);
    if(drive&&!this.shaper){
      this.shaper=ctx.createWaveShaper();
      this.driveWet=ctx.createGain();
      this.driveWet.gain.value=0;
      this.roomOutput.connect(this.shaper).connect(this.driveWet).connect(output);
    }
    if(drive&&drive!==this.drive&&this.shaper){
      const gain=1+15*drive,compensation=(1+gain)/gain;
      this.shaper.curve=Float32Array.from({length:2049},(_,i)=>{
        const x=(i/1024-1)*gain;
        return x/(1+Math.abs(x))*compensation;
      });
    }
    this.drive=drive;
    this.driveDry.gain.setTargetAtTime(1-drive,now,.01);
    this.driveWet?.gain.setTargetAtTime(drive,now,.01);
  }
}

// Clicks run on Web Audio's clock, independently of React rendering. The same
// clock is mapped to performance timestamps for Web MIDI and pointer attacks.
export class PracticeMetronome {
  private context = new AudioContext();
  private timer?: ReturnType<typeof setInterval>;
  private nodes = new Set<OscillatorNode>();
  private nextBeat = 0;
  private firstClick = 0;
  private closed = false;
  async start(bpm: number, noteCount: number): Promise<number> {
    await this.context.resume();
    if (this.closed) throw new Error("Practice stopped.");
    const period = 60 / bpm;
    this.firstClick = this.context.currentTime + 0.15;
    const output = this.context.getOutputTimestamp?.();
    const anchor = output && output.performanceTime !== undefined && output.contextTime !== undefined && output.performanceTime > 0
      ? output.performanceTime + (this.firstClick - output.contextTime) * 1000
      : performance.now() + (this.firstClick - this.context.currentTime + (this.context.outputLatency || this.context.baseLatency || 0)) * 1000;
    const schedule = () => {
      if (this.closed) return;
      // If scheduling falls behind, skip expired clicks instead of bursting.
      this.nextBeat = Math.max(this.nextBeat, Math.ceil((this.context.currentTime - this.firstClick) / period));
      while (this.firstClick + this.nextBeat * period < this.context.currentTime + 0.12) {
        const at = this.firstClick + this.nextBeat * period;
        const position = this.nextBeat % (noteCount + 4);
        const oscillator = this.context.createOscillator(), gain = this.context.createGain();
        oscillator.frequency.value = position < 4 ? 1100 : position === 4 ? 1500 : 800;
        gain.gain.setValueAtTime(0.22, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
        oscillator.connect(gain); gain.connect(this.context.destination);
        oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
        this.nodes.add(oscillator);
        oscillator.start(at); oscillator.stop(at + 0.05);
        this.nextBeat++;
      }
    };
    schedule();
    this.timer = setInterval(schedule, 25);
    return anchor + 4 * period * 1000;
  }
  stop() {
    this.closed = true;
    clearInterval(this.timer);
    this.nodes.forEach((node) => { try { node.stop(); } catch { /* Already ended. */ } });
    this.nodes.clear();
    void this.context.close().catch(() => {});
  }
}

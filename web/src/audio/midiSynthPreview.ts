export interface MidiPreviewSink {
  noteOn(note: number, velocity: number, id: string, pitchOffset: number): void;
  noteOff(id: string, immediate?: boolean): void;
  setPitch(id: string, pitchOffset: number): void;
  setMod(value: number): void;
}

interface Channel {
  bend: number;
  range: number;
  cents: number;
  rpnMsb: number;
  rpnLsb: number;
  sustain: boolean;
  notes: Map<number, boolean>; // true while physically held, false while sustained
  sounding: Set<number>; // Includes release tails; bounded by 128 MIDI notes.
}

// Channel/note identity stays separate from sounding pitch: MPE unisons and
// pitch changes must never release another channel's voice or a typing key.
export class MidiSynthPreview {
  private channels: Channel[];
  constructor(private sink: MidiPreviewSink, range = 2) {
    this.channels = Array.from({ length: 16 }, () => ({
      bend: 0, range, cents: 0, rpnMsb: 127, rpnLsb: 127,
      sustain: false, notes: new Map(), sounding: new Set()
    }));
  }

  setBendRange(range: number): void {
    for (let index = 0; index < 16; index++) {
      this.channels[index].range = range;
      this.channels[index].cents = 0;
      this.updatePitch(index);
    }
  }

  receive(bytes: Uint8Array): void {
    const status = bytes[0];
    if (status < 0x80 || status >= 0xf0 || bytes.length !== 3 || bytes[1] > 127 || bytes[2] > 127) return;
    const index = status & 15;
    const channel = this.channels[index];
    const command = status & 0xf0;
    const [ , key, value ] = bytes;
    if (command === 0x90 && value > 0) {
      if (channel.notes.has(key)) this.sink.noteOff(this.id(index, key), true);
      channel.notes.set(key, true);
      channel.sounding.add(key);
      this.sink.noteOn(key, value / 127, this.id(index, key), this.pitchOffset(channel));
    } else if (command === 0x80 || command === 0x90) {
      this.release(index, key);
    } else if (command === 0xe0) {
      channel.bend = (key | (value << 7)) - 8192;
      this.updatePitch(index);
    } else if (command === 0xb0) {
      switch (key) {
        case 1: this.sink.setMod(value); break;
        case 64:
          channel.sustain = value >= 64;
          if (!channel.sustain) this.releaseSustained(index);
          break;
        case 101: channel.rpnMsb = value; break;
        case 100: channel.rpnLsb = value; break;
        case 99: case 98: // NRPN selection cancels RPN data entry.
          channel.rpnMsb = channel.rpnLsb = 127;
          break;
        case 6: case 38:
          if (channel.rpnMsb === 0 && channel.rpnLsb === 0) {
            if (key === 6) channel.range = value;
            else channel.cents = Math.min(value, 99);
            this.updatePitch(index);
          }
          break;
        case 120:
          for (const note of channel.sounding) this.sink.noteOff(this.id(index, note), true);
          channel.notes.clear();
          channel.sounding.clear();
          break;
        case 123:
          for (const note of channel.notes.keys()) this.release(index, note);
          break;
        case 121:
          channel.bend = 0;
          channel.sustain = false;
          channel.rpnMsb = channel.rpnLsb = 127;
          this.releaseSustained(index);
          this.updatePitch(index);
          this.sink.setMod(0);
          break;
      }
    }
  }

  stop(): void {
    this.channels.forEach((channel, index) => {
      for (const note of channel.sounding) this.sink.noteOff(this.id(index, note), true);
      channel.notes.clear();
      channel.sounding.clear();
      channel.sustain = false;
    });
  }

  private id(channel: number, note: number): string { return `midi:${channel}:${note}`; }
  private pitchOffset(channel: Channel): number { return channel.bend / 8192 * (channel.range + channel.cents / 100); }
  private updatePitch(index: number): void {
    const channel = this.channels[index];
    for (const note of channel.notes.keys()) this.sink.setPitch(this.id(index, note), this.pitchOffset(channel));
  }
  private release(index: number, note: number): void {
    const channel = this.channels[index];
    if (!channel.notes.has(note)) return;
    if (channel.sustain) channel.notes.set(note, false);
    else {
      channel.notes.delete(note);
      this.sink.noteOff(this.id(index, note));
    }
  }
  private releaseSustained(index: number): void {
    for (const [note, held] of this.channels[index].notes) if (!held) this.release(index, note);
  }
}

import type { MidiMessageListener, WebMidiInput, WebMidiMessageEvent } from "./types.ts";

// Listen without replacing preset sync's handler or closing its shared port.
export function subscribeControllerInput(input: WebMidiInput, receive: MidiMessageListener, onError: (error: unknown) => void): () => void {
  if (!input.addEventListener || !input.removeEventListener) {
    onError(new Error("This MIDI input does not support browser event listeners"));
    return () => {};
  }
  let disposed = false;
  const listener = (event: WebMidiMessageEvent) => {
    if (!disposed) receive(event.data, event.timeStamp);
  };
  input.addEventListener("midimessage", listener);
  try {
    void input.open?.().catch(error => { if (!disposed) onError(error); });
  } catch (error) {
    onError(error);
  }
  return () => {
    disposed = true;
    input.removeEventListener?.("midimessage", listener);
  };
}

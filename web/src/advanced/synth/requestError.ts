// Closing an editor cancels its requests; it says nothing about USB or audio.
export class SynthRequestCancelledError extends Error {
  constructor() {
    super("Synth request canceled.");
    this.name = "SynthRequestCancelledError";
  }
}

export function synthErrorMessage(error: unknown): string | undefined {
  if (error instanceof SynthRequestCancelledError) return undefined;
  return error instanceof Error ? error.message : String(error);
}

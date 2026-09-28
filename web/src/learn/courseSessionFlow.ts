export function afterExample(wasComplete: boolean, boardSession: boolean): "complete" | "restart" | "ready" {
  if (wasComplete) return "complete";
  return boardSession ? "restart" : "ready";
}

export function repeatTempo(current: number, goal: number | undefined, stepTempo: number): number {
  return goal !== undefined && (current === stepTempo || current < goal) ? goal : current;
}

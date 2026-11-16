import type { Strike } from "./model.ts";
export function parseVelocity(line: string): Strike | null;
export class LiveVelocity {
  constructor(kind?: "on" | "off"); events: Strike[]; paused: boolean; key: number | null;
  clear(): void; accept(line: string): boolean; get latest(): Strike | null;
}

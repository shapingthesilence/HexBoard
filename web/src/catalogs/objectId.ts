export function objectIdFromHex(hex: string): Uint8Array {
  const normalized = hex.replace(/[^0-9a-f]/gi, "");
  if (normalized.length !== 32) {
    throw new Error("object id hex must contain exactly 16 bytes");
  }
  const output = new Uint8Array(16);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return output;
}

export function objectIdToHex(objectId: Uint8Array): string {
  if (objectId.length !== 16) {
    throw new Error("object id must be 16 bytes");
  }
  return Array.from(objectId, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function deterministicObjectId(seed: string): Uint8Array {
  const output = new Uint8Array(16);
  for (let index = 0; index < seed.length; index += 1) {
    const char = seed.charCodeAt(index);
    output[index % output.length] = (output[index % output.length] + char + index * 17) & 0xff;
  }
  return output;
}


export function formatHex(bytes: ArrayLike<number>, maxBytes = 96): string {
  const values = Array.from(bytes).slice(0, maxBytes);
  const suffix = bytes.length > maxBytes ? ` ... +${bytes.length - maxBytes} bytes` : "";
  return values.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ") + suffix;
}

export function formatByteLength(bytes: Uint8Array): string {
  return `${bytes.length.toLocaleString()} bytes`;
}


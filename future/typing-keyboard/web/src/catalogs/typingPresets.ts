import qwerty from "../../../factory-library/typing/00-qwerty.json";
import colemak from "../../../factory-library/typing/01-colemak.json";
import dvorak from "../../../factory-library/typing/02-dvorak.json";
import qwertyPortrait from "../../../factory-library/typing/03-qwerty-portrait.json";
import colemakPortrait from "../../../factory-library/typing/04-colemak-portrait.json";
import dvorakPortrait from "../../../factory-library/typing/05-dvorak-portrait.json";
import { ObjectType, decodeObjectBody, encodeObjectBody, tlv, tlvText, tlvU8, textFromBytes } from "../protocol/index.ts";
import { objectIdFromHex, objectIdToHex } from "./objectId.ts";

export interface TypingKey { usage: number; modifiers: number; color: string }
export interface TypingPreset {
  format: "hexboard.typingPreset.v1";
  name: string;
  objectId: string;
  folderPath: string;
  animation: number;
  rotation: number;
  keys: TypingKey[];
}
export const typingAnimations = [
  { value: 10, label: "None" }, { value: 0, label: "Button" }, { value: 1, label: "Star" },
  { value: 2, label: "Splash" }, { value: 3, label: "Orbit" }, { value: 6, label: "Beams" },
  { value: 7, label: "Reverse splash" }, { value: 8, label: "Reverse star" }
];
export const modifierNames = ["Ctrl", "Shift", "Alt", "GUI / Cmd", "Right Ctrl", "Right Shift", "Right Alt", "Right GUI"];
export function validTypingUsage(usage: number): boolean {
  return Number.isInteger(usage) && (usage === 0 || (usage >= 4 && usage <= 0x73) || (usage >= 0xe0 && usage <= 0xe7));
}
export function validateTypingPreset(value: unknown): TypingPreset {
  const p = value as TypingPreset | null;
  if (!p || p.format !== "hexboard.typingPreset.v1" || typeof p.name !== "string"
      || !/^[\x20-\x7e]{1,31}$/.test(p.name)
      || typeof p.objectId !== "string" || !/^[\da-f]{32}$/i.test(p.objectId) || /^0+$/.test(p.objectId)
      || !typingAnimations.some((a) => a.value === p.animation)
      || (p.rotation !== undefined && (!Number.isInteger(p.rotation) || p.rotation < 0 || p.rotation > 3))
      || !Array.isArray(p.keys) || p.keys.length !== 140) {
    throw new Error("Expected a typing preset with a 1–31 character ASCII name, nonzero 16-byte ID, supported animation, and 140 keys.");
  }
  for (const [index, key] of p.keys.entries()) {
    if (!key || !validTypingUsage(key.usage) || !Number.isInteger(key.modifiers) || key.modifiers < 0 || key.modifiers > 255
        || typeof key.color !== "string" || !/^#[\da-f]{6}$/i.test(key.color)) {
      throw new Error(`Key ${index}: invalid HID usage, modifiers, or RGB color.`);
    }
  }
  const folderPath = typeof p.folderPath === "string" && p.folderPath.trim()
    ? `/${p.folderPath.trim().replace(/^\/+|\/+$/g, "")}`
    : "/";
  return { format: p.format, name: p.name, objectId: p.objectId.toLowerCase(), folderPath, animation: p.animation, rotation: p.rotation ?? 0,
    keys: p.keys.map((k) => ({ usage: k.usage, modifiers: k.modifiers, color: k.color.toLowerCase() })) };
}
export const factoryTypingPresets = [qwerty, colemak, dvorak, qwertyPortrait, colemakPortrait, dvorakPortrait].map(validateTypingPreset);
export function encodeTypingPreset(preset: TypingPreset): Uint8Array {
  const p = validateTypingPreset(preset);
  return encodeObjectBody({ objectType: ObjectType.TypingPreset, schemaMajor: 1, schemaMinor: 0, objectFlags: 0, records: [
    tlvText(1, p.name), tlv(2, objectIdFromHex(p.objectId)),
    tlv(0x20, new Uint8Array(p.keys.flatMap((k) => [k.usage, k.modifiers]))),
    tlv(0x21, new Uint8Array(p.keys.flatMap((k) => [1, 3, 5].map((i) => parseInt(k.color.slice(i, i + 2), 16))))),
    tlvU8(0x22, p.animation), tlvU8(0x23, p.rotation)
  ] });
}
export function decodeTypingPreset(bytes: Uint8Array): TypingPreset {
  const body = decodeObjectBody(bytes);
  if (bytes.length > 1024 || body.objectType !== ObjectType.TypingPreset || body.schemaMajor !== 1 || body.schemaMinor !== 0 || body.objectFlags !== 0
      || ![5, 6].includes(body.records.length)
      || body.records.some((r) => ![1, 2, 0x20, 0x21, 0x22, 0x23].includes(r.tag))
      || new Set(body.records.map((r) => r.tag)).size !== body.records.length) throw new Error("Unsupported typing schema");
  const get = (tag: number, length?: number) => {
    const value = body.records.find((r) => r.tag === tag)?.value;
    if (!value || (length !== undefined && value.length !== length)) throw new Error(`Missing or invalid typing field ${tag}`);
    return value;
  };
  const keys = get(0x20, 280), colors = get(0x21, 420);
  return validateTypingPreset({ format: "hexboard.typingPreset.v1", name: textFromBytes(get(1)),
    objectId: objectIdToHex(get(2, 16)), folderPath: "/", animation: get(0x22, 1)[0],
    rotation: body.records.some((r) => r.tag === 0x23) ? get(0x23, 1)[0] : 0,
    keys: Array.from({ length: 140 }, (_, i) => ({ usage: keys[2 * i], modifiers: keys[2 * i + 1],
      color: "#" + Array.from(colors.slice(3 * i, 3 * i + 3), (c) => c.toString(16).padStart(2, "0")).join("") })) });
}

const keyNames: Record<number, string> = {
  0: "Unassigned", 40: "Enter", 41: "Esc", 42: "Backspace", 43: "Tab", 44: "Space",
  45: "-", 46: "=", 47: "[", 48: "]", 49: "\\", 50: "Non-US #", 51: ";", 52: "'", 53: "`",
  54: ",", 55: ".", 56: "/", 57: "Caps Lock", 70: "Print Screen", 71: "Scroll Lock", 72: "Pause",
  73: "Insert", 74: "Home", 75: "Page Up", 76: "Delete", 77: "End", 78: "Page Down",
  79: "Right", 80: "Left", 81: "Down", 82: "Up", 83: "Num Lock", 84: "KP /", 85: "KP *", 86: "KP -",
  87: "KP +", 88: "KP Enter", 98: "KP 0", 99: "KP .", 100: "Non-US \\", 101: "Menu", 102: "Power", 103: "KP ="
};
export function typingKeyLabel(usage: number): string {
  if (usage >= 4 && usage <= 29) return String.fromCharCode(usage + 61);
  if (usage >= 30 && usage <= 39) return String((usage - 29) % 10);
  if (usage >= 58 && usage <= 69) return `F${usage - 57}`;
  if (usage >= 104 && usage <= 115) return `F${usage - 91}`;
  if (usage >= 89 && usage <= 97) return `KP ${usage - 88}`;
  if (usage >= 224 && usage <= 231) return modifierNames[usage - 224];
  return keyNames[usage] ?? `Usage ${usage}`;
}
export const typingKeyChoices = [0, ...Array.from({ length: 112 }, (_, i) => i + 4), ...Array.from({ length: 8 }, (_, i) => i + 224)];

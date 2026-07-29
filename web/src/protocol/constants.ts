export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
export const HEXBOARD_MANUFACTURER_ID = 0x7d;
export const PRESET_SYNC_FAMILY = 0x10;
export const PROTOCOL_MAJOR = 1;
export const PROTOCOL_MINOR = 0;
export const NEW_OBJECT_HANDLE = 0x3fff;

export const DelegatedCommand = {
  Enter: 0x01,
  Exit: 0x02,
  Led: 0x03,
  NoteMap: 0x04,
  NoteMapReset: 0x05,
  EncoderEvent: 0x06
} as const;

export type DelegatedCommandValue = (typeof DelegatedCommand)[keyof typeof DelegatedCommand];

export const DelegatedEncoderEvent = {
  Up: 0x01,
  Down: 0x02,
  ButtonPress: 0x03,
  ButtonRelease: 0x04
} as const;

export type DelegatedEncoderEventValue = (typeof DelegatedEncoderEvent)[keyof typeof DelegatedEncoderEvent];

export const MessageType = {
  HelloRequest: 0x01,
  HelloResponse: 0x02,
  Ack: 0x06,
  Nack: 0x07,
  ObjectListRequest: 0x20,
  ObjectListResponse: 0x21,
  ReadRequest: 0x22,
  ReadBegin: 0x23,
  WriteBegin: 0x24,
  DataChunk: 0x25,
  TransferEnd: 0x26,
  WriteCommit: 0x27,
  TransferAbort: 0x28,
  DeleteRequest: 0x29,
  SynthParamSet: 0x2a,
  SynthWavetableSelect: 0x2b
} as const;

export type MessageTypeValue = (typeof MessageType)[keyof typeof MessageType];

export const SynthWavetableSelector = {
  Catalog: 0x00,
  BuiltIn: 0x01
} as const;

export const ErrorCode = {
  UnsupportedProtocol: 0x01,
  UnknownMessage: 0x02,
  BadLength: 0x03,
  BadObjectType: 0x04,
  BadChecksum: 0x05,
  BadCrc: 0x06,
  UnexpectedChunk: 0x07,
  Busy: 0x08,
  StorageFull: 0x09,
  WriteProtected: 0x0a,
  ObjectMissing: 0x0b,
  SchemaMismatch: 0x0c,
  ValidationFailed: 0x0d,
  Timeout: 0x0e
} as const;

export const ObjectType = {
  DeviceProfile: 0x01,
  ActiveSnapshot: 0x02,
  UserTuning: 0x03,
  UserLayout: 0x04,
  ScaleColorMap: 0x05,
  ExplicitButtonMap: 0x06,
  SynthPreset: 0x07,
  Bundle: 0x08,
  Folder: 0x09,
  UserScale: 0x0a,
  SynthWavetable: 0x0b,
  GeometryBundle: 0x0c,
  GeometryOrder: 0x0d
} as const;

export type ObjectTypeValue = (typeof ObjectType)[keyof typeof ObjectType];

export const WriteFlag = {
  ApplyToRuntime: 0x01,
  SaveToFlash: 0x02,
  OverwriteExisting: 0x04,
  DryRun: 0x08
} as const;

export type WriteFlagValue = (typeof WriteFlag)[keyof typeof WriteFlag];

export const ObjectListFlag = {
  Valid: 0x01,
  ReadOnly: 0x02,
  Active: 0x04,
  ReferencesOtherObject: 0x08,
  Folder: 0x10
} as const;

export type ObjectListFlagValue = (typeof ObjectListFlag)[keyof typeof ObjectListFlag];

export const CapabilityFlag = {
  Profile: 1 << 0,
  SynthPreset: 1 << 1,
  UserTuning: 1 << 2,
  UserLayout: 1 << 3,
  UserScale: 1 << 4,
  ScaleColorMap: 1 << 5,
  ExplicitButtonMap: 1 << 6,
  ActiveSnapshot: 1 << 7,
  DryRun: 1 << 8,
  DeleteUserObject: 1 << 9,
  FactoryGeometry: 1 << 10,
  SynthWavetable: 1 << 11,
  LiveSynthParam: 1 << 12,
  CentsTableRuntimeTuning: 1 << 13,
  GeometryBundleFiles: 1 << 14,
  LiveSynthWavetableSelect: 1 << 15
} as const;

export type CapabilityFlagValue = (typeof CapabilityFlag)[keyof typeof CapabilityFlag];

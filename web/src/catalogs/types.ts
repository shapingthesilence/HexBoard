import { type ObjectTypeValue } from "../protocol/constants.ts";
import { type TlvRecord } from "../protocol/tlv.ts";

export interface EncodedCatalogObject {
  objectType: ObjectTypeValue;
  schemaMajor: number;
  schemaMinor: number;
  objectId: Uint8Array;
  name: string;
  folderPath?: string;
  records: TlvRecord[];
  body: Uint8Array;
}

export interface LayoutsDatCatalog {
  tunings: EncodedCatalogObject[];
  layouts: EncodedCatalogObject[];
  scaleColorMaps: EncodedCatalogObject[];
  explicitButtonMaps: EncodedCatalogObject[];
}

export interface SynthPresetCatalog {
  presets: EncodedCatalogObject[];
  folders: string[];
}

export interface ObjectReferenceInput {
  objectType: ObjectTypeValue;
  handle: number;
  objectId: Uint8Array;
}


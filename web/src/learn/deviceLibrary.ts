import { objectIdToHex } from "../catalogs/objectId.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import type { MidiTransport } from "../midi/types.ts";
import { ObjectType, type ObjectListRecord } from "../protocol/index.ts";
import { CommonTlv, decodeObjectBody } from "../protocol/tlv.ts";
import { decodeDeviceTuning, decodeDeviceLayout, decodeDeviceScale, decodeDeviceColorMap, decodeDeviceDefaultColorMode, type DeviceGeometryObject } from "../catalogs/deviceGeometry.ts";
import { type TuningBundle } from "../catalogs/layoutsCatalog.ts";

// One connection-scoped reader, shared across Learn visits. Transfers are
// serialized; fulfilled objects are cached, failed reads can be retried.
export class LessonDeviceLibrary {
  private client: PresetSyncClient;
  private cache = new Map<string, Promise<unknown>>();
  private tail: Promise<unknown> = Promise.resolve();
  constructor(transport: MidiTransport) { this.client = new PresetSyncClient(transport); }
  private once<T>(key: string, action: () => Promise<T>): Promise<T> {
    const old = this.cache.get(key);
    if (old) return old as Promise<T>;
    const pending = this.tail.catch(() => {}).then(action);
    this.tail = pending;
    this.cache.set(key, pending);
    void pending.catch(() => { if (this.cache.get(key) === pending) this.cache.delete(key); });
    return pending;
  }
  tuningNames() { return this.once("tunings", () => this.client.listGeometryObjects(ObjectType.UserTuning, 4)); }
  names(type: number, tuningHandle: number, layoutHandle?: number) {
    return this.once(`list:${type}:${tuningHandle}:${layoutHandle}`, () => this.client.listGeometryObjects(type, 4, { tuningHandle, layoutHandle }));
  }
  private object(record: ObjectListRecord): Promise<DeviceGeometryObject> {
    return this.once(`object:${record.objectType}:${record.handle}`, async () => {
      const body = await this.client.readGeometryObject(record.objectType, record.handle);
      const decoded = decodeObjectBody(body);
      const id = decoded.records.find(item => item.tag === CommonTlv.ObjectId)?.value;
      if (decoded.objectType !== record.objectType || !id || objectIdToHex(id) !== objectIdToHex(record.objectId)) throw new Error("The device library changed. Refresh its tuning names and try again.");
      return { record, body, records: decoded.records };
    });
  }
  async tuning(record: ObjectListRecord): Promise<TuningBundle> {
    const object = await this.object(record);
    const tuning = decodeDeviceTuning({ deviceHandle: record.handle, name: record.name, folderPath: record.folderPath, catalogOrder: 0 }, object);
    return { objectIdHex: objectIdToHex(record.objectId), tuningObjectIdHex: objectIdToHex(record.objectId), folderPath: record.folderPath,
      tuning, palette: { defaultColorMode: 0, degreeColors: [] }, layouts: [], scales: [], activeLayoutIdHex: "", activeScaleIdHex: "" };
  }
  async layout(tuningHandle: number, record: ObjectListRecord) {
    const object = await this.object(record);
    const maps = await this.names(ObjectType.ExplicitButtonMap, tuningHandle, record.handle);
    const map = maps[0] ? await this.object(maps[0]) : undefined;
    return decodeDeviceLayout(object, 0, map);
  }
  async scale(record: ObjectListRecord, cycleLength: number) { return decodeDeviceScale(await this.object(record), 0, cycleLength); }
  async palette(tuningHandle: number, cycleLength: number) {
    const names = await this.names(ObjectType.ScaleColorMap, tuningHandle);
    const object = names[0] ? await this.object(names[0]) : undefined;
    return { defaultColorMode: decodeDeviceDefaultColorMode(object), degreeColors: decodeDeviceColorMap(object, cycleLength) };
  }
}
const libraries = new WeakMap<MidiTransport, LessonDeviceLibrary>();
export function lessonDeviceLibrary(transport: MidiTransport, refresh = false) {
  let library = libraries.get(transport);
  if (!library || refresh) { library = new LessonDeviceLibrary(transport); libraries.set(transport, library); }
  return library;
}

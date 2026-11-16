import { objectIdToHex } from "../catalogs/objectId.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LessonDeviceLibrary, lessonDeviceLibrary } from "./deviceLibrary.ts";
import { PresetSyncClient } from "../midi/presetSyncClient.ts";
import { MockMidiTransport } from "../midi/mockTransport.ts";
import { createDefaultTuningBundle, encodeTuningBundle } from "../catalogs/layoutsCatalog.ts";
import { decodeDeviceGeometryBundle } from "../catalogs/deviceGeometry.ts";
import { ObjectType, ObjectListFlag, encodeObjectListRequestPayload } from "../protocol/index.ts";

function fixture() {
  const bundle = createDefaultTuningBundle();
  bundle.layouts[0].buttonOverrides = [{buttonIndex:1, role:"note", stepsFromC:7, action:{kind:"direct-midi", midiNote:61, midiChannel:2}}];
  const encoded = encodeTuningBundle(bundle);
  const objects = encoded.objects;
  const records = objects.map((object, handle) => ({objectType:object.objectType, handle, flags:ObjectListFlag.Valid,
    schemaMajor:object.schemaMajor, schemaMinor:object.schemaMinor, objectId:object.objectId, folderPath:object.folderPath ?? "/", name:object.name}));
  const list = vi.spyOn(PresetSyncClient.prototype, "listGeometryObjects").mockImplementation(async type => records.filter(record => record.objectType === type));
  const read = vi.spyOn(PresetSyncClient.prototype, "readGeometryObject").mockImplementation(async (_type, handle) => objects[handle].body);
  const full = vi.spyOn(PresetSyncClient.prototype, "readGeometryBundle").mockRejectedValue(new Error("Full downloads are forbidden in Learn"));
  return {bundle, encoded, records, list, read, full};
}
afterEach(() => vi.restoreAllMocks());
describe("lazy device learning library", () => {
  it("reads only names initially, then only selected definitions and their dependencies", async () => {
    const {records, list, read, full} = fixture();
    const library = new LessonDeviceLibrary(new MockMidiTransport());
    const names = await library.tuningNames();
    expect(list).toHaveBeenCalledExactlyOnceWith(ObjectType.UserTuning, 4);
    expect(read).not.toHaveBeenCalled();
    const tuning = await library.tuning(names[0]);
    const layouts = await library.names(ObjectType.UserLayout, names[0].handle);
    const scales = await library.names(ObjectType.UserScale, names[0].handle);
    expect(read).toHaveBeenCalledExactlyOnceWith(ObjectType.UserTuning, names[0].handle);
    expect(list).toHaveBeenCalledWith(ObjectType.UserLayout, 4, {tuningHandle:names[0].handle, layoutHandle:undefined});
    const layout = await library.layout(names[0].handle, layouts[0]);
    expect(layout.buttonOverrides[0].action).toMatchObject({kind:"direct-midi", midiNote:61});
    expect(list).toHaveBeenCalledWith(ObjectType.ExplicitButtonMap, 4, {tuningHandle:names[0].handle, layoutHandle:layouts[0].handle});
    expect(read.mock.calls.some(([type]) => type === ObjectType.UserScale)).toBe(false);
    const scale = await library.scale(scales[0], tuning.tuning.cycleLength);
    expect(scale.name).toBe(scales[0].name);
    const count = read.mock.calls.length;
    await library.layout(names[0].handle, layouts[0]); await library.scale(scales[0], tuning.tuning.cycleLength);
    expect(read).toHaveBeenCalledTimes(count);
    expect(full).not.toHaveBeenCalled();
    expect(records.length).toBeGreaterThan(count);
  });
  it("shares a cache only for the current connection, supports refresh, and retries failed reads", async () => {
    const {list} = fixture(), transport = new MockMidiTransport();
    const library = lessonDeviceLibrary(transport);
    list.mockRejectedValueOnce(new Error("USB disconnected"));
    await expect(library.tuningNames()).rejects.toThrow("USB disconnected");
    await library.tuningNames();
    await lessonDeviceLibrary(transport).tuningNames();
    expect(list).toHaveBeenCalledTimes(2);
    await lessonDeviceLibrary(transport, true).tuningNames();
    expect(list).toHaveBeenCalledTimes(3);
    expect(lessonDeviceLibrary(new MockMidiTransport())).not.toBe(library);
  });
  it("rejects a stale handle whose body now belongs to a different object", async () => {
    const {records, read, encoded} = fixture();
    read.mockResolvedValueOnce(encoded.scaleColorMap.body);
    const library = new LessonDeviceLibrary(new MockMidiTransport());
    await expect(library.tuning(records[0])).rejects.toThrow("library changed");
  });
  it("keeps editor bundle decoding and individual layout decoding consistent", async () => {
    const {encoded, records} = fixture();
    const decoded = decodeDeviceGeometryBundle({deviceHandle:0, name:records[0].name, folderPath:"/", catalogOrder:0}, encoded.bundleFile);
    const layoutRecord = records.find(record => record.objectType === ObjectType.UserLayout)!;
    const layout = await new LessonDeviceLibrary(new MockMidiTransport()).layout(0, layoutRecord);
    expect(decoded.bundle.layouts[0]).toEqual(layout);
    expect(decoded.bundle.tuningObjectIdHex).toBe(objectIdToHex(records[0].objectId));
  });
  it("encodes optional tuning and layout scope without changing legacy list requests", () => {
    expect(encodeObjectListRequestPayload(ObjectType.UserLayout, 0, 4)).toEqual([ObjectType.UserLayout,0,0,4,0]);
    expect(encodeObjectListRequestPayload(ObjectType.UserLayout, 0, 4, "", {tuningHandle:130})).toEqual([ObjectType.UserLayout,0,0,4,0,1,2]);
    expect(encodeObjectListRequestPayload(ObjectType.ExplicitButtonMap, 0, 4, "", {tuningHandle:0,layoutHandle:3})).toEqual([ObjectType.ExplicitButtonMap,0,0,4,0,0,0,0,3]);
  });
});

/**
 * Instruments of sampler sounds in the Browser Library, by sound object id.
 * They are too large for local storage, so they live in IndexedDB; without
 * IndexedDB (tests, private windows that refuse it) they last for the page.
 */
const databaseName = "hexboard-sampler-instruments";
const storeName = "instruments";
const memory = new Map<string, Uint8Array>();
let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return database().then((db) => db && new Promise<T | undefined>((resolve) => {
    try {
      const request = action(db.transaction(storeName, mode).objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }) || undefined);
}

export async function readBrowserInstrument(objectIdHex: string): Promise<Uint8Array | undefined> {
  const cached = memory.get(objectIdHex);
  if (cached) return cached;
  const stored = await run<Uint8Array>("readonly", (store) => store.get(objectIdHex));
  if (stored) memory.set(objectIdHex, stored);
  return stored;
}

export async function writeBrowserInstrument(objectIdHex: string, instrument: Uint8Array): Promise<void> {
  memory.set(objectIdHex, instrument);
  await run("readwrite", (store) => store.put(instrument, objectIdHex));
}

export async function deleteBrowserInstrument(objectIdHex: string): Promise<void> {
  memory.delete(objectIdHex);
  await run("readwrite", (store) => store.delete(objectIdHex));
}

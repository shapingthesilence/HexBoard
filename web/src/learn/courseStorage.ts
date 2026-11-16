import type { UserCourse } from "./courseFiles.ts";

export interface CourseDraft { id: string; course: UserCourse; updatedAt: string }
let database: Promise<IDBDatabase> | undefined;
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("hexboard-learning-v2", 1);
    request.onupgradeneeded = () => { for (const name of ["courses", "drafts"]) request.result.createObjectStore(name, { keyPath: "id" }); };
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); database = undefined; }; resolve(request.result); };
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onblocked = () => { database = undefined; reject(new Error("Close other HexBoard tabs to open course storage.")); };
  });
  return database;
}
async function operation<T>(store: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("Course storage failed. Export your draft before closing."));
  });
}
export const courseStorage = {
  courses: () => operation<UserCourse[]>("courses", "readonly", store => store.getAll()),
  save: (course: UserCourse) => operation("courses", "readwrite", store => store.put(course)),
  remove: (id: string) => operation("courses", "readwrite", store => store.delete(id)),
  drafts: () => operation<CourseDraft[]>("drafts", "readonly", store => store.getAll()),
  saveDraft: (course: UserCourse) => operation("drafts", "readwrite", store => store.put({ id: course.id, course, updatedAt: new Date().toISOString() } satisfies CourseDraft)),
  removeDraft: (id: string) => operation("drafts", "readwrite", store => store.delete(id)),
};

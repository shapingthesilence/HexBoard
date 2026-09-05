import { useEffect, useState } from "react";

export interface EditorDraft<T> { value: T; base: T }
export interface DraftState<T> { active: string; entries: Record<string, EditorDraft<T>> }
export function sameContent(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
export function readDraftState<T>(raw: string | null, validate: (value: unknown) => value is T): DraftState<T> {
  const empty = { active: "", entries: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.active !== "string" || !parsed.entries || typeof parsed.entries !== "object") return empty;
    const entries: Record<string, EditorDraft<T>> = {};
    for (const [key, entry] of Object.entries(parsed.entries)) {
      const draft = entry as EditorDraft<unknown>;
      if (draft && validate(draft.value) && validate(draft.base)) entries[key] = { value: draft.value, base: draft.base };
    }
    return { active: parsed.active, entries };
  } catch { return empty; }
}
export function useEditorDrafts<T>(storageKey: string, validate: (value: unknown) => value is T) {
  const [state, setState] = useState<DraftState<T>>(() => {
    try { return readDraftState(window.localStorage.getItem(storageKey), validate); }
    catch { return { active: "", entries: {} }; }
  });
  const [error, setError] = useState("");
  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
      setError("");
    } catch { setError("Draft could not be saved in this browser. Export a file to keep your work."); }
  }, [state, storageKey]);
  function remember(key: string, value: T, base: T) {
    setState(current => {
      const entry = { value, base };
      if (current.active === key && sameContent(current.entries[key], entry)) return current;
      return { active: key, entries: { ...current.entries, [key]: entry } };
    });
  }
  function forget(key: string) {
    setState(current => {
      const entries = { ...current.entries };
      delete entries[key];
      return { active: current.active === key ? "" : current.active, entries };
    });
  }
  return { ...state, remember, forget, error };
}

import type { ReactNode, Ref } from "react";
import { LibraryIcon, OverflowMenu } from "./Library.tsx";

interface SaveAction {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

interface EditorBarProps {
  /** What is being edited, for labels: "Tuning" or "Sound". */
  itemLabel: string;
  library: { open?: boolean; disabled?: boolean; onOpen: () => void; buttonRef?: Ref<HTMLButtonElement> };
  /** Name, folder and favorite fields. */
  identity: ReactNode;
  /** Where the current edit is saved. */
  status?: ReactNode;
  /** Editor-specific controls placed before the save buttons: preview, undo. */
  tools?: ReactNode;
  saveBrowser: SaveAction;
  saveHexBoard: SaveAction;
  /** Less common actions for the ••• menu. */
  menu?: ReactNode;
}

/** The header every editor shares: Library, identity, save state, and save actions in one row. */
export function EditorBar({ itemLabel, library, identity, status, tools, saveBrowser, saveHexBoard, menu }: EditorBarProps) {
  return (
    <div className="editorBar">
      <button ref={library.buttonRef} className="editorBarLibrary" type="button" aria-haspopup="dialog" aria-expanded={library.open} disabled={library.disabled} onClick={library.onOpen}>
        <LibraryIcon />
        Library
      </button>
      <div className="editorBarIdentity">{identity}</div>
      {status ? <div className="editorBarStatus">{status}</div> : null}
      <div className="editorBarActions">
        {tools}
        <button type="button" disabled={saveBrowser.disabled} title={saveBrowser.title} onClick={saveBrowser.onClick}>Save to Browser</button>
        <button className="primary" type="button" disabled={saveHexBoard.disabled} title={saveHexBoard.title} onClick={saveHexBoard.onClick}>Save to HexBoard</button>
        {menu ? <OverflowMenu label={`${itemLabel} actions`}>{menu}</OverflowMenu> : null}
      </div>
    </div>
  );
}

/** A labelled field sized for the editor bar. The label sits inside the field's frame. */
export function EditorBarField({ label, grow = false, children }: { label: string; grow?: boolean; children: ReactNode }) {
  return (
    <label className={`editorBarField${grow ? " grow" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/** Star toggle for the item being edited. */
export function EditorBarFavorite({ on, disabled, onToggle }: { on: boolean; disabled?: boolean; onToggle: () => void }) {
  return (
    <button className="editorBarFavorite" type="button" aria-pressed={on} aria-label={on ? "Remove from favorites" : "Add to favorites"} title={on ? "Remove from favorites" : "Add to favorites"} disabled={disabled} onClick={onToggle}>
      {on ? "★" : "☆"}
    </button>
  );
}

/** Two-part save state: this browser, then the HexBoard. */
export function SaveState({ browser, device, error }: { browser: "saved" | "draft"; device: "saved" | "unsaved" | "offline"; error?: string }) {
  if (error) return <span className="saveState error">{error}</span>;
  return (
    <span className="saveState">
      <span data-state={browser === "saved" ? "ok" : "pending"}>{browser === "saved" ? "Saved in browser" : "Draft kept in browser"}</span>
      <span data-state={device === "saved" ? "ok" : device === "unsaved" ? "pending" : "off"}>{device === "saved" ? "Saved on HexBoard" : device === "unsaved" ? "Changes not saved to HexBoard" : "Offline"}</span>
    </span>
  );
}

/** Inline form shown under the bar after choosing "New folder…" in the folder field. */
export function NewFolderForm({ maxLength, onCreate, onCancel }: { maxLength?: number; onCreate: (name: string) => boolean; onCancel: () => void }) {
  return (
    <form
      className="editorBarExtra"
      onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("folder");
        if (input instanceof HTMLInputElement && onCreate(input.value)) onCancel();
      }}
    >
      <label className="field">
        <span>New folder name</span>
        <input autoFocus name="folder" maxLength={maxLength} placeholder="e.g. Pads/Warm" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } }} />
      </label>
      <button type="submit">Create folder</button>
      <button type="button" onClick={onCancel}>Cancel</button>
    </form>
  );
}

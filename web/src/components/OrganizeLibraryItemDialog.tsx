import { useEffect, useId, useState } from "react";

export interface LibraryOrganizationConflict {
  name: string;
  folderPath: string;
}

interface OrganizeLibraryItemDialogProps {
  itemLabel: string;
  libraryLabel: string;
  name: string;
  folderPath: string;
  initialName?: string;
  initialFolderPath?: string;
  folders: string[];
  maxNameLength: number;
  maxFolderLength: number;
  normalizeName: (value: string) => string;
  normalizeFolderPath: (value: string) => string;
  folderLabel: (value: string) => string;
  findConflict: (name: string, folderPath: string) => LibraryOrganizationConflict | null;
  onCancel: () => void;
  onSave: (name: string, folderPath: string) => boolean | Promise<boolean>;
}

export function organizationActionLabel(nameChanged: boolean, folderChanged: boolean, hasConflict: boolean): string {
  if (hasConflict) return "Overwrite and continue";
  if (nameChanged && folderChanged) return "Rename and move";
  if (nameChanged) return "Rename";
  if (folderChanged) return "Move";
  return "Done";
}

export function OrganizeLibraryItemDialog({
  itemLabel,
  libraryLabel,
  name,
  folderPath,
  initialName = name,
  initialFolderPath = folderPath,
  folders,
  maxNameLength,
  maxFolderLength,
  normalizeName,
  normalizeFolderPath,
  folderLabel,
  findConflict,
  onCancel,
  onSave
}: OrganizeLibraryItemDialogProps) {
  const [draftName, setDraftName] = useState(initialName);
  const [draftFolderPath, setDraftFolderPath] = useState(initialFolderPath);
  const [saving, setSaving] = useState(false);
  const folderListId = useId();

  useEffect(() => {
    setDraftName(initialName);
    setDraftFolderPath(initialFolderPath);
    setSaving(false);
  }, [initialFolderPath, initialName]);

  const normalizedName = normalizeName(draftName);
  const normalizedFolderPath = normalizeFolderPath(draftFolderPath);
  const nameChanged = normalizedName !== normalizeName(name);
  const folderChanged = normalizedFolderPath !== normalizeFolderPath(folderPath);
  const conflict = findConflict(normalizedName, normalizedFolderPath);
  const actionLabel = organizationActionLabel(nameChanged, folderChanged, conflict !== null);

  async function submit() {
    if (!nameChanged && !folderChanged) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      if (await onSave(normalizedName, normalizedFolderPath)) {
        onCancel();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalOverlay" role="presentation" onMouseDown={() => !saving && onCancel()}>
      <div
        aria-labelledby="organizeLibraryItemTitle"
        aria-modal="true"
        className="modalPanel stack organizeLibraryItemDialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div>
          <span className="eyebrow">{libraryLabel}</span>
          <h3 id="organizeLibraryItemTitle">Rename or move {itemLabel}</h3>
          <p className="muted">Update this {itemLabel} in place without making a duplicate.</p>
        </div>
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            maxLength={maxNameLength}
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
          />
        </label>
        <label className="field">
          <span>Folder</span>
          <input
            list={folderListId}
            maxLength={maxFolderLength}
            value={draftFolderPath}
            onChange={(event) => setDraftFolderPath(event.target.value)}
          />
          <datalist id={folderListId}>
            {folders.map((folder) => <option key={folder} value={folder}>{folderLabel(folder)}</option>)}
          </datalist>
          <small className="muted">Choose an existing folder or type a new one. Use / for Root.</small>
        </label>
        <div className="organizationPreview">
          <span className="muted">Destination</span>
          <strong>{folderLabel(normalizedFolderPath)} / {normalizedName}</strong>
        </div>
        {conflict ? (
          <div className="organizationConflict" role="alert">
            <strong>Overwrite warning</strong>
            <span>
              “{conflict.name}” already exists in {folderLabel(conflict.folderPath)}. Continuing replaces that
              {` ${itemLabel}`} and permanently deletes the existing copy after this one is saved.
            </span>
          </div>
        ) : null}
        <div className="row organizeLibraryItemActions">
          <button disabled={saving} type="button" onClick={onCancel}>Cancel</button>
          <button
            className={conflict ? "warning" : "primary"}
            disabled={saving || (!nameChanged && !folderChanged)}
            type="button"
            onClick={() => void submit()}
          >
            {saving ? "Saving…" : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

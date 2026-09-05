import { useEffect, useState } from "react";

interface FolderControlsProps {
  folderLabel: (folderPath: string) => string;
  folders: string[];
  itemLabel: string;
  maxLength?: number;
  newFolder: string;
  onCreate: () => void;
  onDelete: (folderPath: string) => void;
  onNewFolderChange: (value: string) => void;
  itemCount: (folderPath: string) => number;
}

export function FolderControls({
  folderLabel,
  folders,
  itemLabel,
  maxLength,
  newFolder,
  onCreate,
  onDelete,
  onNewFolderChange,
  itemCount
}: FolderControlsProps) {
  const [folderToDelete, setFolderToDelete] = useState("");
  const selectedCount = folderToDelete ? itemCount(folderToDelete) : 0;

  useEffect(() => {
    if (folderToDelete && !folders.includes(folderToDelete)) {
      setFolderToDelete("");
    }
  }, [folderToDelete, folders]);

  return (
    <details className="folderMenu">
      <summary>Folders</summary>
      <div className="folderControls" aria-label={`${itemLabel} folder controls`}>
      <form
        className="fieldControlRow folderCreateControl"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <input
          aria-label={`New ${itemLabel} folder`}
          maxLength={maxLength}
          placeholder="New folder name"
          value={newFolder}
          onChange={(event) => onNewFolderChange(event.target.value)}
        />
        <button disabled={!newFolder.trim()} type="submit">Create</button>
      </form>

      <div className="fieldControlRow folderDeleteControl">
        <select
          aria-label={`Delete ${itemLabel} folder`}
          value={folderToDelete}
          onChange={(event) => setFolderToDelete(event.target.value)}
        >
          <option value="">Delete folder…</option>
          {folders.map((folder) => {
            const count = itemCount(folder);
            return (
              <option key={folder} value={folder}>
                {folderLabel(folder)}{count > 0 ? ` (${count})` : ""}
              </option>
            );
          })}
        </select>
        <button
          className="warning"
          disabled={!folderToDelete || selectedCount > 0}
          title={selectedCount > 0 ? `Move or erase the ${selectedCount} ${itemLabel}${selectedCount === 1 ? "" : "s"} first` : undefined}
          type="button"
          onClick={() => {
            onDelete(folderToDelete);
            setFolderToDelete("");
          }}
        >
          Delete
        </button>
      </div>
      </div>
    </details>
  );
}

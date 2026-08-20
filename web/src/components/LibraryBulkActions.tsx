interface LibraryBulkActionsProps {
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  transferLabel: string;
  busy?: boolean;
  onSelectVisible: (selected: boolean) => void;
  onClear: () => void;
  onTransfer: () => void;
  onExport: () => void;
}

export function LibraryBulkActions({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  transferLabel,
  busy = false,
  onSelectVisible,
  onClear,
  onTransfer,
  onExport
}: LibraryBulkActionsProps) {
  return (
    <div className="libraryBulkActions">
      <label className="checkField">
        <input
          checked={visibleCount > 0 && allVisibleSelected}
          disabled={busy || visibleCount === 0}
          type="checkbox"
          onChange={(event) => onSelectVisible(event.target.checked)}
        />
        <span>Select shown</span>
      </label>
      <span className="muted">{selectedCount} selected</span>
      <div className="row">
        <button disabled={busy || selectedCount === 0} type="button" onClick={onTransfer}>{transferLabel}</button>
        <button disabled={busy || selectedCount === 0} type="button" onClick={onExport}>Export selected</button>
        <button disabled={busy || selectedCount === 0} type="button" onClick={onClear}>Clear</button>
      </div>
    </div>
  );
}

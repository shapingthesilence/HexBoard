interface LibraryBulkActionsProps {
  selectedCount: number;
  visibleCount: number;
  allVisibleSelected: boolean;
  transferLabel: string;
  busy?: boolean;
  transferDisabled?: boolean;
  showSelectVisible?: boolean;
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
  transferDisabled = false,
  showSelectVisible = true,
  onSelectVisible,
  onClear,
  onTransfer,
  onExport
}: LibraryBulkActionsProps) {
  return (
    <div className="libraryBulkActions">
      {showSelectVisible ? (
        <label className="checkField">
          <input
            checked={visibleCount > 0 && allVisibleSelected}
            disabled={busy || visibleCount === 0}
            type="checkbox"
            onChange={(event) => onSelectVisible(event.target.checked)}
          />
          <span>Select shown</span>
        </label>
      ) : null}
      <span className="muted">{selectedCount > 0 ? `${selectedCount} selected` : `${visibleCount} shown`}</span>
      {selectedCount > 0 ? (
      <div className="row">
        <button disabled={busy || transferDisabled || selectedCount === 0} type="button" onClick={onTransfer}>{transferLabel}</button>
        <button disabled={busy || selectedCount === 0} type="button" onClick={onExport}>Export selected</button>
        <button disabled={busy || selectedCount === 0} type="button" onClick={onClear}>Clear</button>
      </div>
      ) : null}
    </div>
  );
}

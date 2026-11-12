import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type LiHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./library.css";

/** Close any open overflow menu when the pointer lands outside it or Escape is pressed. */
if (typeof document !== "undefined") {
  const closeOthers = (target: EventTarget | null) => {
    document.querySelectorAll<HTMLDetailsElement>("details.overflowMenu[open]").forEach((menu) => {
      if (!(target instanceof Node && menu.contains(target))) menu.open = false;
    });
  };
  document.addEventListener("pointerdown", (event) => closeOthers(event.target), true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = document.querySelector<HTMLDetailsElement>("details.overflowMenu[open]");
    if (!open) return;
    event.preventDefault();
    open.open = false;
    open.querySelector("summary")?.focus();
  }, true);
}

/** The ••• menu for less common actions. It closes after an action is chosen. */
export function OverflowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="overflowMenu">
      <summary aria-label={label} title="More actions">•••</summary>
      <div
        className="overflowMenuItems"
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("button")) event.currentTarget.closest("details")?.removeAttribute("open");
        }}
      >
        {children}
      </div>
    </details>
  );
}

export function LibraryIcon() {
  return <svg aria-hidden="true" className="libraryIcon" viewBox="0 0 24 24"><path d="M4 5h5v14H4zM10 5h4v14h-4zM15.5 6.2l3.8-1 3.2 12.6-3.8 1z" /></svg>;
}

interface LibraryDialogProps {
  title: string;
  /** Names the instrument or engine the library belongs to. */
  eyebrow?: string;
  /** Section switcher shown beside the title. */
  tabs?: ReactNode;
  /** Library-wide actions: new, import, folders. */
  actions?: ReactNode;
  hint?: ReactNode;
  status?: ReactNode;
  columns?: 2 | 3;
  /** Blocks closing while a transfer is running. */
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Nested dialogs that must stay above the library. */
  overlays?: ReactNode;
}

/** The one library window every editor opens from its Library button. */
export function LibraryDialog({ title, eyebrow, tabs, actions, hint, status, columns = 2, busy = false, onClose, children, overlays }: LibraryDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const requestClose = () => { if (!busy) onClose(); };
  return createPortal(
    <dialog
      ref={ref}
      className="libraryDialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        // Escape belongs to a nested dialog while one is open.
        if (!ref.current?.querySelector(".modalOverlay")) requestClose();
      }}
      onClick={(event) => { if (event.target === ref.current) requestClose(); }}
    >
      <header className="libraryDialogHeader">
        <div className="libraryDialogTitle">
          {eyebrow ? <span className="libraryDialogEyebrow">{eyebrow}</span> : null}
          <h2 id={titleId}>{title}</h2>
        </div>
        {tabs}
        <div className="libraryDialogActions">
          {actions}
          <button className="libraryDialogClose" type="button" aria-label="Close library" title="Close library" disabled={busy} onClick={requestClose}>×</button>
        </div>
      </header>
      {hint || status ? (
        <div className="libraryDialogInfo">
          {hint ? <span className="libraryDialogHint">{hint}</span> : null}
          {status ? <span className="libraryDialogStatus" role="status">{status}</span> : null}
        </div>
      ) : null}
      <div className="libraryColumns" data-columns={columns} aria-busy={busy}>{children}</div>
      {overlays}
    </dialog>,
    document.body
  );
}

/** Presets | Wavetables style switcher for the dialog header. */
export function LibraryTabs<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <nav className="libraryTabs" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-current={option.value === value ? "page" : undefined} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </nav>
  );
}

interface LibraryColumnProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: string;
  subtitle?: ReactNode;
  count?: number;
  /** Controls that belong to this place only, such as Refresh. */
  actions?: ReactNode;
  dropReady?: boolean;
}

/** One place sounds or tunings live: this browser, the HexBoard, or the factory set. */
export function LibraryColumn({ title, subtitle, count, actions, dropReady = false, children, ...sectionProps }: LibraryColumnProps) {
  return (
    <section className={`libraryColumn${dropReady ? " dropReady" : ""}`} {...sectionProps}>
      <div className="libraryColumnHeader">
        <div>
          <h3>{title}</h3>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
        {actions}
        {count !== undefined ? <span className="libraryCount">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function LibrarySearch({ label, placeholder, value, onChange, children }: { label: string; placeholder: string; value: string; onChange: (value: string) => void; children?: ReactNode }) {
  return (
    <div className="librarySearch">
      <input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      {children}
    </div>
  );
}

export function LibraryChips({ label, children }: { label: string; children: ReactNode }) {
  return <div className="libraryChips" role="group" aria-label={label}>{children}</div>;
}

interface LibraryChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  label: string;
  count: ReactNode;
  active: boolean;
}

export function LibraryChip({ label, count, active, ...buttonProps }: LibraryChipProps) {
  return (
    <button className="libraryChip" type="button" aria-pressed={active} {...buttonProps}>
      <span>{label}</span>
      <span>{count}</span>
    </button>
  );
}

export function LibraryList({ busy, children }: { busy?: boolean; children: ReactNode }) {
  return <ul className="libraryList" aria-busy={busy}>{children}</ul>;
}

export function LibraryEmpty({ children }: { children: ReactNode }) {
  return <li className="libraryEmpty">{children}</li>;
}

interface LibraryRowProps extends LiHTMLAttributes<HTMLLIElement> {
  name: string;
  meta?: ReactNode;
  /** Marks the item open in the editor. */
  active?: boolean;
  dropTarget?: boolean;
  disabled?: boolean;
  /** "Open" for documents that close the library, "Load" for sounds that audition. */
  openVerb?: string;
  onOpen: () => void;
  selection?: { checked: boolean; onChange: (checked: boolean) => void };
  icon?: ReactNode;
  favorite?: { on: boolean; disabled?: boolean; onToggle: () => void };
  /** The one-click copy to the other place. */
  transfer?: { label: string; title: string; disabled?: boolean; onClick: () => void };
  menu?: ReactNode;
}

export function LibraryRow({ name, meta, active = false, dropTarget = false, disabled = false, openVerb = "Open", onOpen, selection, icon, favorite, transfer, menu, ...liProps }: LibraryRowProps) {
  return (
    <li className={`libraryRow${active ? " active" : ""}${dropTarget ? " dropTarget" : ""}`} aria-current={active ? "true" : undefined} {...liProps}>
      {selection ? (
        <label className="libraryRowSelect" title={`Select ${name}`}>
          <input aria-label={`Select ${name}`} checked={selection.checked} type="checkbox" onChange={(event) => selection.onChange(event.target.checked)} />
        </label>
      ) : null}
      {icon}
      <button className="libraryRowName" type="button" disabled={disabled} title={`${openVerb} ${name}`} onClick={onOpen}>
        <strong>{name}</strong>
        {meta ? <span>{meta}</span> : null}
      </button>
      {favorite ? (
        <button
          className="libraryRowStar"
          type="button"
          aria-pressed={favorite.on}
          aria-label={`${favorite.on ? "Unfavorite" : "Favorite"} ${name}`}
          title={favorite.on ? "Remove from favorites" : "Add to favorites"}
          disabled={disabled || favorite.disabled}
          onClick={favorite.onToggle}
        >
          {favorite.on ? "★" : "☆"}
        </button>
      ) : null}
      {transfer ? (
        <button className="libraryRowTransfer" type="button" aria-label={`${transfer.title}: ${name}`} title={transfer.title} disabled={disabled || transfer.disabled} onClick={transfer.onClick}>
          {transfer.label}
        </button>
      ) : null}
      {menu ? <OverflowMenu label={`More actions for ${name}`}>{menu}</OverflowMenu> : null}
    </li>
  );
}

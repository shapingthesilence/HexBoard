#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import queue
import sys
import threading
from pathlib import Path, PurePosixPath
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from hexboard_backup_lib import (
    REMOTE_ROOT,
    RemoteEntry,
    available_ports,
    connect,
    collect_local_tree,
    delete_remote_file,
    delete_remote_folder,
    get_remote_entry,
    list_tree,
    pull_backup,
    pull_remote_file,
    pull_remote_folder,
    push_backup,
    push_local_file,
    push_local_folder,
    rename_remote_file,
    rename_remote_folder,
    validate_remote_leaf_name,
)


class HexBoardBackupApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("HexBoard Backup")
        self.root.geometry("980x680")

        self.port_var = tk.StringVar(value="Auto")
        self.status_var = tk.StringVar(value="Ready")
        self.log_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        self.busy = False
        self.entry_by_item_id: dict[str, RemoteEntry] = {}
        self.remote_root_entry = RemoteEntry(path=REMOTE_ROOT, is_dir=True, size=0)
        self.state_path = self._state_file_path()
        self.state = self._load_state()
        self.selection_anchor_id: str | None = None

        self._build_ui()
        self._refresh_ports()
        self._poll_log_queue()
        self.refresh_remote_tree()

    def _build_ui(self) -> None:
        self.root.columnconfigure(0, weight=1)
        self.root.rowconfigure(2, weight=1)
        self.root.rowconfigure(3, weight=1)

        connection_frame = ttk.Frame(self.root, padding=12)
        connection_frame.grid(row=0, column=0, sticky="ew")
        connection_frame.columnconfigure(4, weight=1)

        ttk.Label(connection_frame, text="Serial Port").grid(row=0, column=0, sticky="w")
        self.port_combo = ttk.Combobox(connection_frame, textvariable=self.port_var, state="readonly", width=28)
        self.port_combo.grid(row=0, column=1, padx=(8, 8), sticky="w")

        self.refresh_ports_button = ttk.Button(connection_frame, text="Refresh Ports", command=self._refresh_ports)
        self.refresh_ports_button.grid(row=0, column=2, padx=(0, 8), sticky="ew")

        self.refresh_button = ttk.Button(connection_frame, text="Refresh Remote", command=self.refresh_remote_tree)
        self.refresh_button.grid(row=0, column=3, padx=(0, 8), sticky="ew")

        ttk.Label(connection_frame, textvariable=self.status_var).grid(row=0, column=4, sticky="w")

        actions_frame = ttk.Frame(self.root, padding=(12, 0, 12, 12))
        actions_frame.grid(row=1, column=0, sticky="ew")
        for column in range(3):
            actions_frame.columnconfigure(column, weight=1)

        self.backup_all_button = ttk.Button(actions_frame, text="Backup All", command=self.backup_all)
        self.backup_all_button.grid(row=0, column=0, padx=(0, 8), pady=(0, 8), sticky="ew")

        self.restore_all_button = ttk.Button(actions_frame, text="Restore Backup", command=self.restore_backup)
        self.restore_all_button.grid(row=0, column=1, padx=(0, 8), pady=(0, 8), sticky="ew")

        self.download_selected_button = ttk.Button(actions_frame, text="Download Selected", command=self.download_selected)
        self.download_selected_button.grid(row=1, column=0, padx=(0, 8), pady=(0, 8), sticky="ew")

        self.upload_file_button = ttk.Button(actions_frame, text="Upload File", command=self.upload_file)
        self.upload_file_button.grid(row=1, column=1, padx=(0, 8), pady=(0, 8), sticky="ew")

        self.upload_folder_button = ttk.Button(actions_frame, text="Upload Folder", command=self.upload_folder)
        self.upload_folder_button.grid(row=1, column=2, padx=(0, 8), pady=(0, 8), sticky="ew")

        self.rename_file_button = ttk.Button(actions_frame, text="Rename File", command=self.rename_file)
        self.rename_file_button.grid(row=2, column=0, padx=(0, 8), sticky="ew")

        self.rename_folder_button = ttk.Button(actions_frame, text="Rename Folder", command=self.rename_folder)
        self.rename_folder_button.grid(row=2, column=1, padx=(0, 8), sticky="ew")

        self.delete_selected_button = ttk.Button(actions_frame, text="Delete Selected", command=self.delete_selected)
        self.delete_selected_button.grid(row=2, column=2, sticky="ew")

        tree_frame = ttk.LabelFrame(self.root, text="Remote /Sequences", padding=12)
        tree_frame.grid(row=2, column=0, padx=12, pady=(0, 12), sticky="nsew")
        tree_frame.columnconfigure(0, weight=1)
        tree_frame.rowconfigure(0, weight=1)

        self.tree = ttk.Treeview(tree_frame, columns=("type", "size"), show="tree headings", selectmode="extended")
        self.tree.heading("#0", text="Name")
        self.tree.heading("type", text="Type")
        self.tree.heading("size", text="Size Bytes")
        self.tree.column("#0", width=420, stretch=True)
        self.tree.column("type", width=90, stretch=False, anchor="center")
        self.tree.column("size", width=120, stretch=False, anchor="e")
        self.tree.grid(row=0, column=0, sticky="nsew")
        self.tree.bind("<<TreeviewSelect>>", self._on_tree_selection_changed)
        self.tree.bind("<Button-1>", self._on_tree_click, add="+")

        tree_scroll = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        tree_scroll.grid(row=0, column=1, sticky="ns")
        self.tree.configure(yscrollcommand=tree_scroll.set)

        log_frame = ttk.LabelFrame(self.root, text="Log", padding=12)
        log_frame.grid(row=3, column=0, padx=12, pady=(0, 12), sticky="nsew")
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)

        self.log_text = tk.Text(log_frame, wrap="word", height=10, state="disabled")
        self.log_text.grid(row=0, column=0, sticky="nsew")
        log_scroll = ttk.Scrollbar(log_frame, orient="vertical", command=self.log_text.yview)
        log_scroll.grid(row=0, column=1, sticky="ns")
        self.log_text.configure(yscrollcommand=log_scroll.set)

    def _selected_port(self) -> str | None:
        port = self.port_var.get().strip()
        return None if not port or port == "Auto" else port

    def _state_file_path(self) -> Path:
        if sys.platform == "darwin":
            base_dir = Path.home() / "Library" / "Application Support" / "HexBoard Backup"
        elif sys.platform.startswith("win"):
            appdata = os.environ.get("APPDATA")
            base_dir = Path(appdata) / "HexBoard Backup" if appdata else Path.home() / "AppData" / "Roaming" / "HexBoard Backup"
        else:
            xdg_config_home = os.environ.get("XDG_CONFIG_HOME")
            base_dir = Path(xdg_config_home) / "HexBoard Backup" if xdg_config_home else Path.home() / ".config" / "HexBoard Backup"
        return base_dir / "gui_state.json"

    def _load_state(self) -> dict[str, str]:
        try:
            if self.state_path.exists():
                raw = json.loads(self.state_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    return {str(key): str(value) for key, value in raw.items()}
        except Exception:
            pass
        return {}

    def _save_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(json.dumps(self.state, indent=2, sort_keys=True), encoding="utf-8")

    def _remember_directory(self, key: str, directory: Path) -> None:
        if not directory.exists() or not directory.is_dir():
            return
        self.state[key] = str(directory)
        try:
            self._save_state()
        except Exception:
            pass

    def _initial_directory(self, key: str) -> str | None:
        stored = self.state.get(key)
        if not stored:
            return None
        path = Path(stored)
        if path.exists() and path.is_dir():
            return str(path)
        return None

    def _normalize_save_file(self, path_text: str) -> Path:
        path = Path(path_text)
        if path.suffix.lower() != ".hbseq":
            path = path.with_suffix(".hbseq")
        return path

    def _refresh_ports(self) -> None:
        try:
            ports = available_ports()
        except Exception as exc:
            messagebox.showerror("Ports", str(exc))
            return
        values = ["Auto"] + ports
        self.port_combo["values"] = values
        if self.port_var.get() not in values:
            self.port_var.set("Auto")

    def _set_busy(self, busy: bool, status: str) -> None:
        self.busy = busy
        self.status_var.set(status)
        self._update_action_states()

    def _set_button_state(self, button: ttk.Button, enabled: bool) -> None:
        button.configure(state="normal" if enabled and not self.busy else "disabled")

    def _selected_entries(self) -> list[RemoteEntry]:
        selection = self.tree.selection()
        if not selection:
            return []
        return [self.entry_by_item_id.get(item_id, self.remote_root_entry) for item_id in selection]

    def _primary_entry(self) -> RemoteEntry:
        entries = self._selected_entries()
        if not entries:
            return self.remote_root_entry
        return entries[0]

    def _dedupe_delete_entries(self, entries: list[RemoteEntry]) -> list[RemoteEntry]:
        filtered: list[RemoteEntry] = []
        for entry in sorted(entries, key=lambda item: (len(item.path.parts), item.path.as_posix().lower())):
            covered_by_parent = False
            for accepted in filtered:
                if accepted.is_dir and accepted.path != entry.path:
                    try:
                        entry.path.relative_to(accepted.path)
                        covered_by_parent = True
                        break
                    except ValueError:
                        continue
            if not covered_by_parent:
                filtered.append(entry)
        return sorted(filtered, key=lambda item: (len(item.path.parts), item.path.as_posix().lower()), reverse=True)

    def _can_delete_entries(self, entries: list[RemoteEntry]) -> bool:
        return bool(entries) and all(entry.path != REMOTE_ROOT for entry in entries)

    def _update_action_states(self) -> None:
        selected_entries = self._selected_entries()
        selection_count = len(selected_entries)
        single_entry = selected_entries[0] if selection_count == 1 else None
        can_target_single = selection_count <= 1
        can_rename_file = single_entry is not None and not single_entry.is_dir and single_entry.path != REMOTE_ROOT
        can_rename_folder = single_entry is not None and single_entry.is_dir and single_entry.path != REMOTE_ROOT
        can_delete = self._can_delete_entries(selected_entries)
        can_download = can_target_single
        can_upload = can_target_single

        self._set_button_state(self.refresh_ports_button, True)
        self._set_button_state(self.refresh_button, True)
        self._set_button_state(self.backup_all_button, True)
        self._set_button_state(self.restore_all_button, True)
        self._set_button_state(self.download_selected_button, can_download)
        self._set_button_state(self.upload_file_button, can_upload)
        self._set_button_state(self.upload_folder_button, can_upload)
        self._set_button_state(self.rename_file_button, can_rename_file)
        self._set_button_state(self.rename_folder_button, can_rename_folder)
        self._set_button_state(self.delete_selected_button, can_delete)

    def _append_log(self, message: str) -> None:
        self.log_text.configure(state="normal")
        self.log_text.insert("end", message + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _on_tree_selection_changed(self, _event=None) -> None:
        selection = self.tree.selection()
        self.selection_anchor_id = selection[0] if selection else None
        self._update_action_states()

    def _on_tree_click(self, event) -> None:
        row_id = self.tree.identify_row(event.y)
        if row_id:
            self.selection_anchor_id = row_id

    def _poll_log_queue(self) -> None:
        try:
            while True:
                event_type, message = self.log_queue.get_nowait()
                if event_type == "log":
                    self._append_log(message)
                elif event_type == "status":
                    self.status_var.set(message)
                elif event_type == "error":
                    self._set_busy(False, "Error")
                    messagebox.showerror("HexBoard Backup", message)
                elif event_type == "refresh":
                    self._populate_tree(message)  # type: ignore[arg-type]
                elif event_type == "done":
                    self._set_busy(False, message)
        except queue.Empty:
            pass
        self.root.after(100, self._poll_log_queue)

    def _run_task(self, title: str, target, *, refresh_after: bool = False, initial_log_message: str | None = None) -> None:
        if self.busy:
            return

        self._set_busy(True, title)
        if initial_log_message:
            self._append_log(initial_log_message)

        def worker() -> None:
            try:
                result = target()
                if refresh_after:
                    self.log_queue.put(("log", "Refreshing Remote..."))
                    self.log_queue.put(("status", "Refreshing Remote..."))
                    entries, port = self._fetch_remote_entries()
                    self.log_queue.put(("refresh", (entries, port)))
                done_message = result if isinstance(result, str) else "Done"
                self.log_queue.put(("done", done_message))
            except Exception as exc:
                if refresh_after:
                    try:
                        self.log_queue.put(("log", "Refreshing Remote..."))
                        self.log_queue.put(("status", "Refreshing Remote..."))
                        entries, port = self._fetch_remote_entries()
                        self.log_queue.put(("refresh", (entries, port)))
                    except Exception:
                        pass
                self.log_queue.put(("error", str(exc)))

        threading.Thread(target=worker, daemon=True).start()

    def _log_from_worker(self, message: str) -> None:
        self.log_queue.put(("log", message))

    def _log_from_worker_skip_attempts(self, message: str) -> None:
        if message.startswith("Attempting to "):
            return
        self.log_queue.put(("log", message))

    def _fetch_remote_entries(self) -> tuple[list[RemoteEntry], str]:
        with connect(self._selected_port()) as protocol:
            entries = list_tree(protocol, REMOTE_ROOT)
            return entries, protocol.port

    def _populate_tree(self, payload: tuple[list[RemoteEntry], str]) -> None:
        entries, connected_port = payload
        self.tree.delete(*self.tree.get_children())
        self.entry_by_item_id.clear()

        root_id = REMOTE_ROOT.as_posix()
        self.tree.insert("", "end", iid=root_id, text=REMOTE_ROOT.name, values=("folder", ""))
        self.entry_by_item_id[root_id] = self.remote_root_entry

        for entry in sorted(entries, key=lambda item: item.path.as_posix().lower()):
            parent_path = entry.path.parent.as_posix()
            parent_id = parent_path if parent_path in self.entry_by_item_id else root_id
            item_id = entry.path.as_posix()
            self.tree.insert(
                parent_id,
                "end",
                iid=item_id,
                text=entry.path.name,
                values=("folder" if entry.is_dir else "file", "" if entry.is_dir else entry.size),
            )
            self.entry_by_item_id[item_id] = entry

        self.tree.item(root_id, open=True)
        self.selection_anchor_id = None
        self._update_action_states()
        if not self.busy:
            self.status_var.set(f"Connected on {connected_port}")
        self._append_log(f"Refreshed remote tree from {connected_port}")

    def _selected_entry(self) -> RemoteEntry:
        return self._primary_entry()

    def refresh_remote_tree(self) -> None:
        def task() -> str:
            entries, port = self._fetch_remote_entries()
            self.log_queue.put(("refresh", (entries, port)))
            return f"Remote refreshed on {port}"

        self._run_task("Refreshing Remote...", task, initial_log_message="Refreshing Remote...")

    def backup_all(self) -> None:
        output_dir = filedialog.askdirectory(title="Choose backup destination")
        if not output_dir:
            return

        def task() -> str:
            with connect(self._selected_port()) as protocol:
                pull_backup(protocol, Path(output_dir), log=self._log_from_worker_skip_attempts)
                return f"Backup complete from {protocol.port}"

        self._run_task(
            "Backing up all sequences...",
            task,
            initial_log_message=f"Attempting to back up remote {REMOTE_ROOT} into {output_dir}",
        )

    def restore_backup(self) -> None:
        source_dir = filedialog.askdirectory(
            title="Choose backup folder",
            initialdir=self._initial_directory("restore_backup_dir"),
        )
        if not source_dir:
            return
        self._remember_directory("restore_backup_dir", Path(source_dir))
        answer = messagebox.askyesnocancel(
            "Restore Backup",
            "Replace the board contents first?\n\nYes = wipe remote /Sequences first\nNo = merge without deleting old files",
        )
        if answer is None:
            return

        def task() -> str:
            with connect(self._selected_port()) as protocol:
                push_backup(protocol, Path(source_dir), wipe=answer, log=self._log_from_worker_skip_attempts)
                return f"Restore complete on {protocol.port}"

        self._run_task(
            "Restoring backup...",
            task,
            refresh_after=True,
            initial_log_message=f"Attempting to restore backup from {Path(source_dir)} into {REMOTE_ROOT}",
        )

    def download_selected(self) -> None:
        entry = self._selected_entry()
        if entry.is_dir:
            if entry.path == REMOTE_ROOT:
                output_dir = filedialog.askdirectory(title="Choose destination for full backup")
                if not output_dir:
                    return

                def task() -> str:
                    with connect(self._selected_port()) as protocol:
                        pull_backup(protocol, Path(output_dir), log=self._log_from_worker_skip_attempts)
                        return f"Backup complete from {protocol.port}"

                self._run_task(
                    "Downloading all sequences...",
                    task,
                    initial_log_message=f"Attempting to back up remote {REMOTE_ROOT} into {output_dir}",
                )
                return

            parent_dir = filedialog.askdirectory(title="Choose destination for folder download")
            if not parent_dir:
                return
            output_dir = Path(parent_dir) / entry.path.name

            def task() -> str:
                with connect(self._selected_port()) as protocol:
                    pull_remote_folder(protocol, entry.path, output_dir, log=self._log_from_worker_skip_attempts)
                    return f"Downloaded folder {entry.path}"

            self._run_task(
                f"Downloading {entry.path.name}...",
                task,
                initial_log_message=f"Attempting to pull remote folder {entry.path} into {output_dir}",
            )
            return

        output_file = filedialog.asksaveasfilename(
            title="Save remote file as",
            initialfile=entry.path.stem,
            defaultextension="",
            filetypes=[("HexBoard Sequence", "*.hbseq"), ("All files", "*.*")],
        )
        if not output_file:
            return
        output_path = self._normalize_save_file(output_file)

        def task() -> str:
            with connect(self._selected_port()) as protocol:
                pull_remote_file(protocol, entry.path, output_path, log=self._log_from_worker_skip_attempts)
                return f"Downloaded file {entry.path.name}"

        self._run_task(
            f"Downloading {entry.path.name}...",
            task,
            initial_log_message=f"Attempting to pull {entry.path} -> {output_path}",
        )

    def upload_file(self) -> None:
        local_file = filedialog.askopenfilename(
            title="Choose local .hbseq file",
            initialdir=self._initial_directory("upload_file_dir"),
            filetypes=[("HexBoard Sequence", "*.hbseq"), ("All files", "*.*")],
        )
        if not local_file:
            return
        self._remember_directory("upload_file_dir", Path(local_file).parent)
        selected = self._selected_entry()
        local_path = Path(local_file)
        if selected.is_dir:
            remote_path = selected.path / local_path.name
        else:
            remote_path = selected.path

        try:
            with connect(self._selected_port()) as protocol:
                remote_entry = get_remote_entry(protocol, remote_path)
        except Exception as exc:
            messagebox.showerror("Upload File", str(exc))
            return

        if remote_entry is not None:
            if remote_entry.is_dir:
                messagebox.showerror("Upload File", f"Remote destination is a folder, not a file: {remote_path}")
                return
            if not messagebox.askokcancel(
                "Replace Remote File",
                f"Upload {local_path.name} into {remote_path} ?\n\n"
                f"This will replace the existing remote file {remote_path.name}.\n\n"
                "If you want to copy the file into a folder instead, select that folder in the main window first.",
            ):
                return

        def task() -> str:
            with connect(self._selected_port()) as protocol:
                push_local_file(protocol, local_path, remote_path, log=self._log_from_worker_skip_attempts)
                return f"Uploaded file to {remote_path}"

        self._run_task(
            f"Uploading {local_path.name}...",
            task,
            refresh_after=True,
            initial_log_message=f"Attempting to push {local_path} -> {remote_path}",
        )

    def upload_folder(self) -> None:
        local_dir = filedialog.askdirectory(
            title="Choose local folder",
            initialdir=self._initial_directory("upload_folder_dir"),
        )
        if not local_dir:
            return
        self._remember_directory("upload_folder_dir", Path(local_dir))
        selected = self._selected_entry()
        destination_parent = selected.path if selected.is_dir else selected.path.parent
        local_path = Path(local_dir)
        remote_path = destination_parent / local_path.name
        skip_remote_files: set[PurePosixPath] = set()

        try:
            with connect(self._selected_port()) as protocol:
                remote_entry = get_remote_entry(protocol, remote_path)
                if remote_entry is not None and not remote_entry.is_dir:
                    messagebox.showerror("Upload Folder", f"Remote destination is a file, not a folder: {remote_path}")
                    return
                existing_remote_files: set[PurePosixPath] = set()
                if remote_entry is not None:
                    existing_remote_files = {
                        child.path for child in list_tree(protocol, remote_path) if not child.is_dir
                    }
        except Exception as exc:
            messagebox.showerror("Upload Folder", str(exc))
            return

        _, local_files = collect_local_tree(local_path)
        for file_path in local_files:
            relative = file_path.relative_to(local_path)
            target_file = remote_path / PurePosixPath(relative.as_posix())
            if target_file not in existing_remote_files:
                continue
            answer = messagebox.askyesnocancel(
                "Overwrite Remote File",
                f"Overwrite existing remote file?\n\n"
                f"Local:\n{file_path}\n\n"
                f"Remote:\n{target_file}\n\n"
                "Yes = overwrite this remote file\n"
                "No = keep the remote file and skip this upload\n"
                "Cancel = stop folder upload",
            )
            if answer is None:
                return
            if not answer:
                skip_remote_files.add(target_file)

        def task() -> str:
            with connect(self._selected_port()) as protocol:
                push_local_folder(
                    protocol,
                    local_path,
                    remote_path,
                    wipe=False,
                    skip_remote_files=skip_remote_files,
                    log=self._log_from_worker_skip_attempts,
                )
                return f"Uploaded folder to {remote_path}"

        self._run_task(
            f"Uploading folder {local_path.name}...",
            task,
            refresh_after=True,
            initial_log_message=f"Attempting to push local folder {local_path} into {remote_path}",
        )

    def delete_selected(self) -> None:
        entries = self._selected_entries()
        if not entries:
            messagebox.showinfo("Delete Selected", "Select a file or folder inside /Sequences first.")
            return
        if any(entry.path == REMOTE_ROOT for entry in entries):
            messagebox.showinfo("Delete Selected", "Delete individual items inside /Sequences, not the /Sequences root.")
            return

        filtered_entries = self._dedupe_delete_entries(entries)
        item_count = len(filtered_entries)
        if item_count == 1:
            entry = filtered_entries[0]
            kind = "folder" if entry.is_dir else "file"
            prompt = f"Delete remote {kind} {entry.path}?"
        else:
            prompt = f"Delete {item_count} selected items from the board?"
        if not messagebox.askyesno("Delete Selected", prompt):
            return

        def task() -> str:
            with connect(self._selected_port()) as protocol:
                for entry in filtered_entries:
                    if entry.is_dir:
                        delete_remote_folder(protocol, entry.path, log=self._log_from_worker_skip_attempts)
                    else:
                        delete_remote_file(protocol, entry.path, log=self._log_from_worker_skip_attempts)
                if item_count == 1:
                    return f"Deleted {filtered_entries[0].path}"
                return f"Deleted {item_count} items"

        task_label = f"Deleting {item_count} item{'s' if item_count != 1 else ''}..."
        if item_count == 1:
            entry = filtered_entries[0]
            kind = "folder" if entry.is_dir else "file"
            initial_log_message = f"Attempting to delete remote {kind} {entry.path}"
        else:
            initial_log_message = f"Attempting to delete {item_count} selected items"
        self._run_task(task_label, task, refresh_after=True, initial_log_message=initial_log_message)

    def _rename_entry(self, *, expect_dir: bool) -> None:
        entry = self._selected_entry()
        if entry.path == REMOTE_ROOT:
            messagebox.showinfo("Rename", "Select a file or folder inside /Sequences first.")
            return
        if entry.is_dir != expect_dir:
            messagebox.showinfo(
                "Rename",
                "Select a folder first." if expect_dir else "Select a file first.",
            )
            return

        initial_name = entry.path.name if entry.is_dir else entry.path.stem
        prompt = "Enter a new folder name:" if entry.is_dir else "Enter a new file name:"
        title = "Rename Folder" if entry.is_dir else "Rename File"
        attempted_name = initial_name
        while True:
            new_name = simpledialog.askstring(title, prompt, initialvalue=attempted_name, parent=self.root)
            if new_name is None:
                return
            attempted_name = new_name
            try:
                new_name = validate_remote_leaf_name(new_name, is_dir=entry.is_dir)
                break
            except ValueError as exc:
                messagebox.showinfo(title, str(exc))

        def task() -> str:
            with connect(self._selected_port()) as protocol:
                if entry.is_dir:
                    target_path = rename_remote_folder(protocol, entry.path, new_name, log=self._log_from_worker_skip_attempts)
                else:
                    target_path = rename_remote_file(protocol, entry.path, new_name, log=self._log_from_worker_skip_attempts)
                return f"Renamed to {target_path.name}"

        target_name = new_name if entry.is_dir else (new_name if new_name.lower().endswith(".hbseq") else f"{new_name}.hbseq")
        target_path = entry.path.parent / target_name
        self._run_task(
            f"Renaming {entry.path.name}...",
            task,
            refresh_after=True,
            initial_log_message=f"Attempting to rename {entry.path} -> {target_path}",
        )

    def rename_file(self) -> None:
        self._rename_entry(expect_dir=False)

    def rename_folder(self) -> None:
        self._rename_entry(expect_dir=True)


def main() -> int:
    root = tk.Tk()
    style = ttk.Style(root)
    if "clam" in style.theme_names():
        style.theme_use("clam")
    HexBoardBackupApp(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

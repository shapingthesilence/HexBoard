from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable, Iterable
from urllib.parse import quote, unquote


PROTOCOL = "HBK1"
REMOTE_ROOT = PurePosixPath("/Sequences")
MANIFEST_NAME = "manifest.json"
LONG_OPERATION_TIMEOUT_SECONDS = 60.0
SAFE_REMOTE_NAME_MAX_LENGTH = 20
SAFE_REMOTE_NAME_PATTERN = re.compile(r"[A-Za-z0-9 \-]+")
SAFE_REMOTE_NAME_ALLOWED_TEXT = "letters, numbers, spaces, and -"
LogFn = Callable[[str], None]


def require_pyserial():
    try:
        import serial  # type: ignore
        from serial.tools import list_ports  # type: ignore
    except ModuleNotFoundError as exc:  # pragma: no cover - import-time environment dependent
        raise SystemExit(
            "pyserial is required for this tool.\n"
            "Install it with: python3 -m pip install --user pyserial\n"
            "If Homebrew-managed Python blocks that, use:\n"
            "python3 -m pip install --user --break-system-packages pyserial"
        ) from exc
    return serial, list_ports


def available_ports() -> list[str]:
    _, list_ports = require_pyserial()
    return [port.device for port in list_ports.comports()]


def encode_remote_path(path: PurePosixPath) -> str:
    return quote(path.as_posix(), safe="/-_.")


def decode_remote_path(token: str) -> PurePosixPath:
    return PurePosixPath(unquote(token))


def normalize_remote_path(path: str | PurePosixPath) -> PurePosixPath:
    raw_path = PurePosixPath(str(path).strip()) if not isinstance(path, PurePosixPath) else path
    if raw_path.as_posix() in {"", "."}:
        return REMOTE_ROOT
    if not raw_path.is_absolute():
        raw_path = REMOTE_ROOT / raw_path
    return PurePosixPath(raw_path.as_posix())


def normalize_remote_dir_path(path: str | PurePosixPath) -> PurePosixPath:
    remote_path = normalize_remote_path(path)
    if remote_path == PurePosixPath("/"):
        remote_path = REMOTE_ROOT
    if remote_path != REMOTE_ROOT and remote_path.suffix.lower() == ".hbseq":
        raise ValueError(f"Expected a folder path, got file path: {remote_path}")
    return remote_path


def normalize_remote_file_path(path: str | PurePosixPath) -> PurePosixPath:
    remote_path = normalize_remote_path(path)
    if remote_path.suffix.lower() != ".hbseq":
        raise ValueError(f"Expected a .hbseq file path under /Sequences, got: {remote_path}")
    return remote_path


def emit(log: LogFn | None, message: str) -> None:
    if log is not None:
        log(message)


def _unsupported_remote_name_characters(cleaned_name: str) -> list[str]:
    allowed_punctuation = {" ", "-"}
    unsupported = {
        char for char in cleaned_name
        if not char.isalnum() and char not in allowed_punctuation and char != "."
    }
    return sorted(unsupported)


def get_remote_leaf_name_validation_details(new_name: str, *, is_dir: bool) -> tuple[str, list[str]]:
    cleaned_name = new_name.strip()
    kind = "folder" if is_dir else "file"
    problems: list[str] = []
    if not cleaned_name:
        problems.append(f"The {kind} name is empty after trimming spaces.")
    if len(cleaned_name) > SAFE_REMOTE_NAME_MAX_LENGTH:
        excess_count = len(cleaned_name) - SAFE_REMOTE_NAME_MAX_LENGTH
        problems.append(
            f"The {kind} name is longer than {SAFE_REMOTE_NAME_MAX_LENGTH} characters "
            f"by {excess_count}."
        )
    if "." in cleaned_name:
        problems.append(f"The {kind} name contains a period.")
    unsupported = _unsupported_remote_name_characters(cleaned_name)
    if unsupported:
        problems.append(
            f"The {kind} name contains unsupported characters: {' '.join(unsupported)}"
        )
    if cleaned_name and not SAFE_REMOTE_NAME_PATTERN.fullmatch(cleaned_name):
        if not unsupported and "." not in cleaned_name:
            problems.append(f"The {kind} name contains unsupported characters.")
    return cleaned_name, problems


def format_remote_leaf_name_validation_message(new_name: str, *, is_dir: bool) -> str:
    cleaned_name, problems = get_remote_leaf_name_validation_details(new_name, is_dir=is_dir)
    kind = "folder" if is_dir else "file"
    if not problems:
        return f"The {kind} name is valid."

    rules = [
        "Name cannot be empty",
        f"Maximum length: {SAFE_REMOTE_NAME_MAX_LENGTH} characters",
        "Periods are not allowed",
        f"Allowed characters: {SAFE_REMOTE_NAME_ALLOWED_TEXT}",
    ]
    lines = [
        "Broken rules:",
        *[f"- {problem}" for problem in problems],
    ]
    if cleaned_name:
        lines.extend(["", "Entered Name:", cleaned_name])
    lines.extend([
        "",
        f"{kind.title()} name rules:",
        *[f"- {rule}" for rule in rules],
    ])
    return "\n".join(lines)


def validate_remote_leaf_name(new_name: str, *, is_dir: bool) -> str:
    cleaned_name, problems = get_remote_leaf_name_validation_details(new_name, is_dir=is_dir)
    if problems:
        raise ValueError(format_remote_leaf_name_validation_message(new_name, is_dir=is_dir))
    return cleaned_name


@dataclass
class RemoteEntry:
    path: PurePosixPath
    is_dir: bool
    size: int


class HexBoardProtocol:
    def __init__(self, port: str, baud: int = 115200, timeout: float = 1.0):
        serial_mod, _ = require_pyserial()
        self._serial = serial_mod.Serial(port=port, baudrate=baud, timeout=timeout, write_timeout=timeout)
        self.port = port

    def close(self) -> None:
        self._serial.close()

    def __enter__(self) -> "HexBoardProtocol":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    def _send_line(self, line: str) -> None:
        self._serial.write((line + "\n").encode("utf-8"))
        self._serial.flush()

    def _readline(self, timeout: float | None = None) -> str:
        previous_timeout = self._serial.timeout
        if timeout is not None:
            self._serial.timeout = timeout
        try:
            raw = self._serial.readline()
        finally:
            if timeout is not None:
                self._serial.timeout = previous_timeout
        if not raw:
            raise TimeoutError("Timed out waiting for device response")
        return raw.decode("utf-8", errors="replace").strip()

    def hello(self) -> str:
        self._serial.reset_input_buffer()
        self._send_line("HELLO")
        deadline = time.time() + 3.0
        while time.time() < deadline:
            line = self._readline()
            if line.startswith("OK HELLO"):
                parts = line.split()
                if len(parts) >= 4 and parts[2] == PROTOCOL:
                    return line
                raise RuntimeError(f"Unexpected protocol response: {line}")
            if line.startswith("ERR"):
                raise RuntimeError(f"Device error: {line}")
        raise TimeoutError("No HELLO response from device")

    def ping(self) -> None:
        self._send_line("PING")
        line = self._readline()
        if line != "OK PONG":
            raise RuntimeError(f"Unexpected PING response: {line}")

    def list_dir(self, remote_path: PurePosixPath) -> list[RemoteEntry]:
        self._send_line(f"LIST {encode_remote_path(remote_path)}")
        entries: list[RemoteEntry] = []
        while True:
            line = self._readline()
            if line == "DONE LIST":
                return entries
            if line.startswith("ERR "):
                raise RuntimeError(line)
            if not line.startswith("ENTRY "):
                raise RuntimeError(f"Unexpected LIST response: {line}")
            _, type_token, encoded_path, size_token = line.split(maxsplit=3)
            entries.append(
                RemoteEntry(
                    path=decode_remote_path(encoded_path),
                    is_dir=(type_token == "D"),
                    size=int(size_token),
                )
            )

    def get_file(self, remote_path: PurePosixPath) -> bytes:
        self._send_line(f"GET {encode_remote_path(remote_path)}")
        line = self._readline()
        if line.startswith("ERR "):
            raise RuntimeError(line)
        prefix = "OK SIZE "
        if not line.startswith(prefix):
            raise RuntimeError(f"Unexpected GET response: {line}")
        size = int(line[len(prefix):])
        data = bytearray()
        deadline = time.time() + max(3.0, size / 2048.0)
        while len(data) < size and time.time() < deadline:
            chunk = self._serial.read(size - len(data))
            if chunk:
                data.extend(chunk)
                deadline = time.time() + max(3.0, size / 2048.0)
        if len(data) != size:
            raise RuntimeError(f"Expected {size} bytes, received {len(data)}")
        done = self._readline()
        if done != "DONE GET":
            raise RuntimeError(f"Unexpected GET trailer: {done}")
        return bytes(data)

    def mkdir(self, remote_path: PurePosixPath) -> None:
        self._send_line(f"MKDIR {encode_remote_path(remote_path)}")
        line = self._readline()
        if line != "OK MKDIR":
            raise RuntimeError(f"MKDIR failed: {line}")

    def put_file(self, remote_path: PurePosixPath, data: bytes) -> None:
        self._send_line(f"PUT {encode_remote_path(remote_path)} {len(data)}")
        line = self._readline()
        if line != "READY":
            raise RuntimeError(f"PUT not ready: {line}")
        self._serial.write(data)
        self._serial.flush()
        done = self._readline()
        if done != "OK PUT":
            raise RuntimeError(f"PUT failed: {done}")

    def delete_file(self, remote_path: PurePosixPath) -> None:
        self._send_line(f"DELETE {encode_remote_path(remote_path)}")
        line = self._readline()
        if line != "OK DELETE":
            raise RuntimeError(f"DELETE failed: {line}")

    def remove_dir(self, remote_path: PurePosixPath) -> None:
        self._send_line(f"RMDIR {encode_remote_path(remote_path)}")
        line = self._readline(timeout=LONG_OPERATION_TIMEOUT_SECONDS)
        if line != "OK RMDIR":
            try:
                remaining = get_remote_entry(self, remote_path)
            except Exception:
                remaining = object()
            if remaining is None:
                return
            raise RuntimeError(f"RMDIR failed: {line}")

    def rename_path(self, source_path: PurePosixPath, target_path: PurePosixPath) -> None:
        self._send_line(f"RENAME {encode_remote_path(source_path)} {encode_remote_path(target_path)}")
        line = self._readline()
        if line != "OK RENAME":
            raise RuntimeError(f"RENAME failed: {line}")


def autodetect_port() -> str:
    ports = available_ports()
    if not ports:
        raise RuntimeError("No serial ports found. Start USB Backup mode on the board first.")

    last_error = None
    for port in ports:
        try:
            with HexBoardProtocol(port) as protocol:
                protocol.hello()
                return port
        except Exception as exc:  # pragma: no cover - hardware dependent
            last_error = exc
            continue

    raise RuntimeError(
        "Could not find a HexBoard backup session on any serial port.\n"
        "Start the USB Backup session on the board and try again.\n"
        f"Last error: {last_error}"
    )


def connect(port: str | None) -> HexBoardProtocol:
    resolved_port = port or autodetect_port()
    protocol = HexBoardProtocol(resolved_port)
    protocol.hello()
    return protocol


def relative_remote_path(remote_path: PurePosixPath, root: PurePosixPath = REMOTE_ROOT) -> PurePosixPath:
    return PurePosixPath(remote_path.relative_to(root))


def list_tree(protocol: HexBoardProtocol, root: PurePosixPath) -> list[RemoteEntry]:
    results: list[RemoteEntry] = []
    stack = [root]
    while stack:
        current = stack.pop()
        entries = protocol.list_dir(current)
        entries.sort(key=lambda entry: (not entry.is_dir, entry.path.as_posix().lower()))
        for entry in entries:
            results.append(entry)
            if entry.is_dir:
                stack.append(entry.path)
    return results


def get_remote_entry(protocol: HexBoardProtocol, remote_path: PurePosixPath) -> RemoteEntry | None:
    normalized = normalize_remote_path(remote_path)
    if normalized == REMOTE_ROOT:
        return RemoteEntry(path=normalized, is_dir=True, size=0)
    parent = normalized.parent
    try:
        entries = protocol.list_dir(parent)
    except RuntimeError as exc:
        if str(exc).strip() == "ERR BAD_PATH":
            return None
        raise
    for entry in entries:
        if entry.path == normalized:
            return entry
    return None


def write_manifest(target_dir: Path, port: str, entries: Iterable[RemoteEntry]) -> None:
    manifest_path = target_dir / MANIFEST_NAME
    payload = {
        "tool": "hexboard_backup.py",
        "protocol": PROTOCOL,
        "remote_root": REMOTE_ROOT.as_posix(),
        "port": port,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "entries": [
            {
                "path": entry.path.as_posix(),
                "type": "dir" if entry.is_dir else "file",
                "size": entry.size,
            }
            for entry in entries
        ],
    }
    manifest_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def choose_local_sequences_root(source_dir: Path) -> Path:
    sequences_dir = source_dir / REMOTE_ROOT.name
    return sequences_dir if sequences_dir.is_dir() else source_dir


def collect_local_tree(source_dir: Path) -> tuple[list[Path], list[Path]]:
    directories: list[Path] = []
    files: list[Path] = []
    for path in sorted(source_dir.rglob("*")):
        if path.name.startswith(".") or path.name == MANIFEST_NAME:
            continue
        if path.is_dir():
            directories.append(path)
        elif path.is_file() and path.suffix.lower() == ".hbseq":
            files.append(path)
    directories.sort(key=lambda path: len(path.relative_to(source_dir).parts))
    files.sort()
    return directories, files


def ensure_remote_dir(protocol: HexBoardProtocol, remote_dir: PurePosixPath) -> None:
    normalized = normalize_remote_dir_path(remote_dir)
    if normalized == REMOTE_ROOT:
        return
    current = REMOTE_ROOT
    for part in relative_remote_path(normalized).parts:
        current = current / part
        protocol.mkdir(current)


def pull_backup(protocol: HexBoardProtocol, output_dir: Path, log: LogFn | None = print) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    sequences_dir = output_dir / REMOTE_ROOT.name
    sequences_dir.mkdir(parents=True, exist_ok=True)
    emit(log, f"Attempting to back up remote {REMOTE_ROOT} into {output_dir}")
    entries = list_tree(protocol, REMOTE_ROOT)
    for entry in entries:
        relative_path = relative_remote_path(entry.path)
        local_path = sequences_dir / Path(relative_path.as_posix())
        if entry.is_dir:
            local_path.mkdir(parents=True, exist_ok=True)
            continue
        local_path.parent.mkdir(parents=True, exist_ok=True)
        emit(log, f"Attempting to pull {entry.path} -> {local_path}")
        data = protocol.get_file(entry.path)
        local_path.write_bytes(data)
        emit(log, f"Pulled {entry.path} -> {local_path}")
    write_manifest(output_dir, protocol.port, entries)
    emit(log, f"Backup complete at {output_dir}")


def pull_remote_file(protocol: HexBoardProtocol, remote_file: str | PurePosixPath, output_file: Path,
                     log: LogFn | None = print) -> None:
    remote_path = normalize_remote_file_path(remote_file)
    entry = get_remote_entry(protocol, remote_path)
    if entry is None or entry.is_dir:
        raise RuntimeError(f"Remote file not found: {remote_path}")
    output_file.parent.mkdir(parents=True, exist_ok=True)
    emit(log, f"Attempting to pull {remote_path} -> {output_file}")
    output_file.write_bytes(protocol.get_file(remote_path))
    emit(log, f"Pulled {remote_path} -> {output_file}")


def pull_remote_folder(protocol: HexBoardProtocol, remote_folder: str | PurePosixPath, output_dir: Path,
                       log: LogFn | None = print) -> None:
    remote_path = normalize_remote_dir_path(remote_folder)
    entry = get_remote_entry(protocol, remote_path)
    if entry is None or not entry.is_dir:
        raise RuntimeError(f"Remote folder not found: {remote_path}")
    output_dir.mkdir(parents=True, exist_ok=True)
    emit(log, f"Attempting to pull remote folder {remote_path} into {output_dir}")
    for child in list_tree(protocol, remote_path):
        relative_path = relative_remote_path(child.path, root=remote_path)
        local_path = output_dir / Path(relative_path.as_posix())
        if child.is_dir:
            local_path.mkdir(parents=True, exist_ok=True)
        else:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            emit(log, f"Attempting to pull {child.path} -> {local_path}")
            local_path.write_bytes(protocol.get_file(child.path))
            emit(log, f"Pulled {child.path} -> {local_path}")
    emit(log, f"Folder pull complete at {output_dir}")


def wipe_remote_tree(protocol: HexBoardProtocol, root: PurePosixPath = REMOTE_ROOT, log: LogFn | None = print) -> None:
    entries = list_tree(protocol, normalize_remote_dir_path(root))
    files = [entry for entry in entries if not entry.is_dir]
    directories = [entry for entry in entries if entry.is_dir]
    for entry in files:
        emit(log, f"Attempting to delete remote file {entry.path}")
        protocol.delete_file(entry.path)
        emit(log, f"Deleted remote file {entry.path}")
    for entry in sorted(directories, key=lambda item: len(item.path.parts), reverse=True):
        emit(log, f"Attempting to delete remote folder {entry.path}")
        protocol.remove_dir(entry.path)
        emit(log, f"Deleted remote folder {entry.path}")


def push_backup(protocol: HexBoardProtocol, source_dir: Path, wipe: bool, log: LogFn | None = print) -> None:
    sequences_root = choose_local_sequences_root(source_dir)
    if not sequences_root.exists():
        raise FileNotFoundError(f"No local sequences directory found in {source_dir}")

    emit(log, f"Attempting to restore backup from {sequences_root} into {REMOTE_ROOT}")
    if wipe:
        wipe_remote_tree(protocol, REMOTE_ROOT, log=log)

    directories, files = collect_local_tree(sequences_root)
    for directory in directories:
        relative = directory.relative_to(sequences_root)
        remote_path = REMOTE_ROOT / PurePosixPath(relative.as_posix())
        emit(log, f"Attempting to create remote folder {remote_path}")
        protocol.mkdir(remote_path)
        emit(log, f"Created remote folder {remote_path}")

    for local_file in files:
        relative = local_file.relative_to(sequences_root)
        remote_path = REMOTE_ROOT / PurePosixPath(relative.as_posix())
        emit(log, f"Attempting to push {local_file} -> {remote_path}")
        protocol.put_file(remote_path, local_file.read_bytes())
        emit(log, f"Pushed {local_file} -> {remote_path}")

    emit(log, "Restore complete")


def push_local_file(protocol: HexBoardProtocol, local_file: Path, remote_file: str | PurePosixPath,
                    log: LogFn | None = print) -> None:
    if not local_file.is_file():
        raise FileNotFoundError(f"Local file not found: {local_file}")
    remote_path = normalize_remote_file_path(remote_file)
    ensure_remote_dir(protocol, remote_path.parent)
    emit(log, f"Attempting to push {local_file} -> {remote_path}")
    protocol.put_file(remote_path, local_file.read_bytes())
    emit(log, f"Pushed {local_file} -> {remote_path}")


def push_local_folder(protocol: HexBoardProtocol, local_dir: Path, remote_folder: str | PurePosixPath,
                      wipe: bool = False, skip_remote_files: set[PurePosixPath] | None = None,
                      log: LogFn | None = print) -> None:
    if not local_dir.is_dir():
        raise FileNotFoundError(f"Local folder not found: {local_dir}")

    remote_path = normalize_remote_dir_path(remote_folder)
    entry = get_remote_entry(protocol, remote_path)
    if entry is not None and not entry.is_dir:
        raise RuntimeError(f"Remote destination is a file, not a folder: {remote_path}")

    emit(log, f"Attempting to push local folder {local_dir} into {remote_path}")
    if wipe:
        if remote_path == REMOTE_ROOT:
            wipe_remote_tree(protocol, REMOTE_ROOT, log=log)
        elif entry is not None:
            emit(log, f"Attempting to delete remote folder {remote_path}")
            protocol.remove_dir(remote_path)
            emit(log, f"Deleted remote folder {remote_path}")

    ensure_remote_dir(protocol, remote_path)
    directories, files = collect_local_tree(local_dir)
    for directory in directories:
        relative = directory.relative_to(local_dir)
        target_dir = remote_path / PurePosixPath(relative.as_posix())
        emit(log, f"Attempting to create remote folder {target_dir}")
        protocol.mkdir(target_dir)
        emit(log, f"Created remote folder {target_dir}")
    for local_file in files:
        relative = local_file.relative_to(local_dir)
        target_file = remote_path / PurePosixPath(relative.as_posix())
        if skip_remote_files and target_file in skip_remote_files:
            emit(log, f"Skipped existing remote file {target_file}")
            continue
        emit(log, f"Attempting to push {local_file} -> {target_file}")
        protocol.put_file(target_file, local_file.read_bytes())
        emit(log, f"Pushed {local_file} -> {target_file}")
    emit(log, f"Folder restore complete into {remote_path}")


def delete_remote_file(protocol: HexBoardProtocol, remote_file: str | PurePosixPath, log: LogFn | None = print) -> None:
    remote_path = normalize_remote_file_path(remote_file)
    emit(log, f"Attempting to delete remote file {remote_path}")
    protocol.delete_file(remote_path)
    emit(log, f"Deleted remote file {remote_path}")


def delete_remote_folder(protocol: HexBoardProtocol, remote_folder: str | PurePosixPath,
                         log: LogFn | None = print) -> None:
    remote_path = normalize_remote_dir_path(remote_folder)
    if remote_path == REMOTE_ROOT:
        raise RuntimeError("Refusing to delete the /Sequences root folder")
    emit(log, f"Attempting to delete remote folder {remote_path}")
    protocol.remove_dir(remote_path)
    emit(log, f"Deleted remote folder {remote_path}")


def rename_remote_file(protocol: HexBoardProtocol, remote_file: str | PurePosixPath, new_name: str,
                       log: LogFn | None = print) -> PurePosixPath:
    source_path = normalize_remote_file_path(remote_file)
    cleaned_name = validate_remote_leaf_name(new_name, is_dir=False)
    target_leaf = cleaned_name if cleaned_name.lower().endswith(".hbseq") else f"{cleaned_name}.hbseq"
    target_path = source_path.parent / target_leaf
    emit(log, f"Attempting to rename {source_path} -> {target_path}")
    protocol.rename_path(source_path, target_path)
    emit(log, f"Renamed {source_path} -> {target_path}")
    return target_path


def rename_remote_folder(protocol: HexBoardProtocol, remote_folder: str | PurePosixPath, new_name: str,
                         log: LogFn | None = print) -> PurePosixPath:
    source_path = normalize_remote_dir_path(remote_folder)
    if source_path == REMOTE_ROOT:
        raise RuntimeError("Refusing to rename the /Sequences root folder")
    cleaned_name = validate_remote_leaf_name(new_name, is_dir=True)
    target_path = source_path.parent / cleaned_name
    emit(log, f"Attempting to rename {source_path} -> {target_path}")
    protocol.rename_path(source_path, target_path)
    emit(log, f"Renamed {source_path} -> {target_path}")
    return target_path


def print_tree(protocol: HexBoardProtocol) -> None:
    entries = list_tree(protocol, REMOTE_ROOT)
    print(REMOTE_ROOT.as_posix())
    for entry in sorted(entries, key=lambda item: item.path.as_posix().lower()):
        relative = relative_remote_path(entry.path)
        indent = "  " * (len(relative.parts) - 1)
        suffix = "/" if entry.is_dir else f" ({entry.size} bytes)"
        print(f"{indent}- {relative.name}{suffix}")


def print_ports() -> None:
    ports = available_ports()
    if not ports:
        print("No serial ports found.")
        return
    for port in ports:
        print(port)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Back up and restore HexBoard sequences over USB serial.")
    parser.add_argument("--port", help="Serial port, for example COM4 or /dev/cu.usbmodem123")

    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("ports", help="List available serial ports")
    subparsers.add_parser("list", help="List remote sequences and folders")

    pull_parser = subparsers.add_parser("pull", help="Back up all remote sequences to a local folder")
    pull_parser.add_argument("output_dir", type=Path, help="Local output directory")

    push_parser = subparsers.add_parser("push", help="Restore all local sequences to the board")
    push_parser.add_argument("source_dir", type=Path, help="Local backup directory or Sequences folder")
    push_parser.add_argument("--wipe", action="store_true", help="Delete remote sequences before restoring")

    pull_file_parser = subparsers.add_parser("pull-file", help="Download one remote .hbseq file")
    pull_file_parser.add_argument("remote_file", help="Remote file path, absolute or relative to /Sequences")
    pull_file_parser.add_argument("output_file", type=Path, help="Local destination file path")

    pull_folder_parser = subparsers.add_parser("pull-folder", help="Download one remote folder")
    pull_folder_parser.add_argument("remote_folder", help="Remote folder path, absolute or relative to /Sequences")
    pull_folder_parser.add_argument("output_dir", type=Path, help="Local destination folder path")

    push_file_parser = subparsers.add_parser("push-file", help="Upload one local .hbseq file")
    push_file_parser.add_argument("local_file", type=Path, help="Local .hbseq file")
    push_file_parser.add_argument("remote_file", help="Remote file path, absolute or relative to /Sequences")

    push_folder_parser = subparsers.add_parser("push-folder", help="Upload one local folder into a remote folder path")
    push_folder_parser.add_argument("local_dir", type=Path, help="Local folder containing .hbseq files")
    push_folder_parser.add_argument("remote_folder", help="Remote folder path, absolute or relative to /Sequences")
    push_folder_parser.add_argument("--wipe", action="store_true", help="Delete the target remote folder contents first")

    delete_file_parser = subparsers.add_parser("delete-file", help="Delete one remote .hbseq file")
    delete_file_parser.add_argument("remote_file", help="Remote file path, absolute or relative to /Sequences")

    delete_folder_parser = subparsers.add_parser("delete-folder", help="Delete one remote folder recursively")
    delete_folder_parser.add_argument("remote_folder", help="Remote folder path, absolute or relative to /Sequences")

    rename_file_parser = subparsers.add_parser("rename-file", help="Rename one remote .hbseq file")
    rename_file_parser.add_argument("remote_file", help="Remote file path, absolute or relative to /Sequences")
    rename_file_parser.add_argument("new_name", help="New file name, with or without .hbseq")

    rename_folder_parser = subparsers.add_parser("rename-folder", help="Rename one remote folder")
    rename_folder_parser.add_argument("remote_folder", help="Remote folder path, absolute or relative to /Sequences")
    rename_folder_parser.add_argument("new_name", help="New folder name")

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "ports":
            print_ports()
            return 0

        with connect(args.port) as protocol:
            if args.command == "list":
                print_tree(protocol)
            elif args.command == "pull":
                pull_backup(protocol, args.output_dir)
            elif args.command == "push":
                push_backup(protocol, args.source_dir, args.wipe)
            elif args.command == "pull-file":
                pull_remote_file(protocol, args.remote_file, args.output_file)
            elif args.command == "pull-folder":
                pull_remote_folder(protocol, args.remote_folder, args.output_dir)
            elif args.command == "push-file":
                push_local_file(protocol, args.local_file, args.remote_file)
            elif args.command == "push-folder":
                push_local_folder(protocol, args.local_dir, args.remote_folder, wipe=args.wipe)
            elif args.command == "delete-file":
                delete_remote_file(protocol, args.remote_file)
            elif args.command == "delete-folder":
                delete_remote_folder(protocol, args.remote_folder)
            elif args.command == "rename-file":
                rename_remote_file(protocol, args.remote_file, args.new_name)
            elif args.command == "rename-folder":
                rename_remote_folder(protocol, args.remote_folder, args.new_name)
            else:  # pragma: no cover - argparse prevents this
                parser.error(f"Unknown command: {args.command}")
        return 0
    except Exception as exc:
        parser.exit(1, f"{exc}\n")

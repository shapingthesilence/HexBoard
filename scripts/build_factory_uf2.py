#!/usr/bin/env python3
"""Build and validate firmware-only update and destructive factory UF2 files."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import struct
import subprocess
import tempfile

UF2_BLOCK_SIZE = 512
UF2_PAYLOAD_SIZE = 256
UF2_MAGIC_START0 = 0x0A324655
UF2_MAGIC_START1 = 0x9E5D5157
UF2_MAGIC_END = 0x0AB16F30
UF2_FLAG_FAMILY_ID_PRESENT = 0x00002000
FLASH_SECTOR_SIZE = 4096
LITTLEFS_START = 0x107FF000
LITTLEFS_SIZE = 8 * 1024 * 1024
LITTLEFS_END = LITTLEFS_START + LITTLEFS_SIZE


class BuildError(RuntimeError):
    pass


def locate_mklittlefs(explicit: str | None) -> Path:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    if os.environ.get("MKLITTLEFS"):
        candidates.append(Path(os.environ["MKLITTLEFS"]).expanduser())
    for root in (Path.home() / "Library/Arduino15", Path.home() / ".arduino15"):
        candidates.extend(sorted(root.glob("packages/rp2040/tools/pqt-mklittlefs/*/mklittlefs"), reverse=True))
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return candidate
    raise BuildError("mklittlefs was not found; set MKLITTLEFS to its executable path")


def filesystem_files(root: Path) -> dict[str, bytes]:
    if not root.is_dir():
        raise BuildError(f"filesystem seed directory does not exist: {root}")
    files = {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }
    return files


def filesystem_directories(root: Path) -> set[str]:
    return {
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if path.is_dir()
    }


def build_littlefs(mklittlefs: Path, seed_dir: Path, image_path: Path) -> None:
    expected_files = filesystem_files(seed_dir)
    expected_directories = filesystem_directories(seed_dir)
    if not expected_files:
        raise BuildError(f"factory filesystem is empty: {seed_dir}")
    image_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [str(mklittlefs), "-c", str(seed_dir), "-b", "4096", "-p", "256",
         "-s", str(LITTLEFS_SIZE), str(image_path)],
        check=True,
    )
    if image_path.stat().st_size != LITTLEFS_SIZE:
        raise BuildError("mklittlefs produced an image with the wrong size")
    with tempfile.TemporaryDirectory(prefix="hexboard-littlefs-") as temporary:
        unpacked = Path(temporary)
        subprocess.run(
            [str(mklittlefs), "-u", str(unpacked), "-b", "4096", "-p", "256",
             "-s", str(LITTLEFS_SIZE), str(image_path)],
            check=True,
        )
        actual_files = filesystem_files(unpacked)
        actual_directories = filesystem_directories(unpacked)
        if actual_files != expected_files:
            missing = sorted(set(expected_files) - set(actual_files))
            extra = sorted(set(actual_files) - set(expected_files))
            changed = sorted(path for path in set(expected_files) & set(actual_files)
                             if expected_files[path] != actual_files[path])
            raise BuildError(
                f"extracted LittleFS mismatch; missing={missing}, extra={extra}, changed={changed}"
            )
        if not expected_directories.issubset(actual_directories):
            missing = sorted(expected_directories - actual_directories)
            raise BuildError(f"extracted LittleFS is missing directories: {missing}")


def parse_uf2(data: bytes) -> list[bytearray]:
    if not data or len(data) % UF2_BLOCK_SIZE:
        raise BuildError("firmware UF2 has an invalid size")
    blocks: list[bytearray] = []
    for offset in range(0, len(data), UF2_BLOCK_SIZE):
        block = bytearray(data[offset:offset + UF2_BLOCK_SIZE])
        header = struct.unpack_from("<8I", block, 0)
        if header[0] != UF2_MAGIC_START0 or header[1] != UF2_MAGIC_START1:
            raise BuildError(f"invalid UF2 header at block {offset // UF2_BLOCK_SIZE}")
        if struct.unpack_from("<I", block, UF2_BLOCK_SIZE - 4)[0] != UF2_MAGIC_END:
            raise BuildError(f"invalid UF2 footer at block {offset // UF2_BLOCK_SIZE}")
        if header[4] <= 0 or header[4] > 476:
            raise BuildError("UF2 block has an invalid payload size")
        blocks.append(block)
    return blocks


def uf2_header(block: bytes) -> tuple[int, ...]:
    return struct.unpack_from("<8I", block, 0)


def family_id_for(blocks: list[bytearray]) -> int:
    family_ids = {
        uf2_header(block)[7]
        for block in blocks
        if uf2_header(block)[2] & UF2_FLAG_FAMILY_ID_PRESENT
    }
    if len(family_ids) != 1:
        raise BuildError("firmware UF2 must contain one family ID")
    return family_ids.pop()


def validate_firmware_ranges(blocks: list[bytearray]) -> None:
    for block in blocks:
        header = uf2_header(block)
        target, payload_size = header[3], header[4]
        if target < 0x10000000 or target + payload_size > LITTLEFS_START:
            raise BuildError(
                f"firmware block 0x{target:08x}-0x{target + payload_size:08x} overlaps reserved flash"
            )


def validate_firmware_binary(blocks: list[bytearray], binary_path: Path) -> None:
    binary = binary_path.read_bytes()
    if not binary:
        raise BuildError("compiled firmware binary is empty")
    flash_base = 0x10000000
    reconstructed = bytearray(b"\xff" * len(binary))
    covered = bytearray(len(binary))
    for block in blocks:
        header = uf2_header(block)
        start = header[3] - flash_base
        end = start + header[4]
        if end <= 0 or start >= len(binary):
            continue
        destination_start = max(0, start)
        destination_end = min(len(binary), end)
        source_start = 32 + destination_start - start
        copy_length = destination_end - destination_start
        reconstructed[destination_start:destination_end] = block[source_start:source_start + copy_length]
        covered[destination_start:destination_end] = b"\x01" * copy_length
    if not all(covered) or reconstructed != binary:
        raise BuildError("firmware UF2 payload does not match the compiled binary")


def make_uf2_block(payload: bytes, target: int, family_id: int) -> bytearray:
    if len(payload) != UF2_PAYLOAD_SIZE:
        raise BuildError("filesystem UF2 payload must be exactly 256 bytes")
    block = bytearray(UF2_BLOCK_SIZE)
    struct.pack_into(
        "<8I", block, 0, UF2_MAGIC_START0, UF2_MAGIC_START1,
        UF2_FLAG_FAMILY_ID_PRESENT, target, UF2_PAYLOAD_SIZE, 0, 0, family_id,
    )
    block[32:32 + UF2_PAYLOAD_SIZE] = payload
    struct.pack_into("<I", block, UF2_BLOCK_SIZE - 4, UF2_MAGIC_END)
    return block


def pad_firmware_sectors(blocks: list[bytearray], family_id: int) -> list[bytearray]:
    """Fully represent every firmware sector before appending another flash range."""
    pages: dict[int, bytearray] = {}
    for block in blocks:
        header = uf2_header(block)
        target, payload_size = header[3], header[4]
        if payload_size != UF2_PAYLOAD_SIZE or target % UF2_PAYLOAD_SIZE:
            raise BuildError("firmware UF2 pages must be 256-byte aligned and complete")
        if target in pages:
            raise BuildError(f"firmware UF2 contains duplicate page 0x{target:08x}")
        pages[target] = block

    padded: list[bytearray] = []
    sectors = sorted({target - target % FLASH_SECTOR_SIZE for target in pages})
    for sector in sectors:
        for target in range(sector, sector + FLASH_SECTOR_SIZE, UF2_PAYLOAD_SIZE):
            block = pages.get(target)
            if block is None:
                block = make_uf2_block(bytes(UF2_PAYLOAD_SIZE), target, family_id)
            padded.append(block)
    return padded


def merge_uf2(firmware_path: Path, firmware_binary_path: Path,
              filesystem_path: Path, output_path: Path) -> None:
    firmware_blocks = parse_uf2(firmware_path.read_bytes())
    validate_firmware_ranges(firmware_blocks)
    validate_firmware_binary(firmware_blocks, firmware_binary_path)
    family_id = family_id_for(firmware_blocks)
    filesystem = filesystem_path.read_bytes()
    if len(filesystem) != LITTLEFS_SIZE:
        raise BuildError("LittleFS image has the wrong size")
    filesystem_blocks = [
        make_uf2_block(filesystem[offset:offset + UF2_PAYLOAD_SIZE], LITTLEFS_START + offset, family_id)
        for offset in range(0, len(filesystem), UF2_PAYLOAD_SIZE)
    ]
    # The standalone firmware may end in a partial sector because that sector is
    # final in its UF2. Once LittleFS follows it, RP2040-E14 requires every page
    # of each earlier touched sector to be present in the combined transfer.
    combined = pad_firmware_sectors(firmware_blocks, family_id) + filesystem_blocks
    total_blocks = len(combined)
    for block_number, block in enumerate(combined):
        struct.pack_into("<II", block, 20, block_number, total_blocks)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(b"".join(combined))
    validate_combined_uf2(output_path, firmware_blocks)


def write_update_uf2(firmware_path: Path, firmware_binary_path: Path, output_path: Path) -> None:
    blocks = parse_uf2(firmware_path.read_bytes())
    validate_firmware_ranges(blocks)
    validate_firmware_binary(blocks, firmware_binary_path)
    if any(LITTLEFS_START <= uf2_header(block)[3] < LITTLEFS_END for block in blocks):
        raise BuildError("firmware-only UF2 unexpectedly contains LittleFS blocks")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(firmware_path.read_bytes())
    copied = parse_uf2(output_path.read_bytes())
    if len(copied) != len(blocks):
        raise BuildError("firmware-only UF2 changed while copying")


def validate_combined_uf2(output_path: Path, firmware_blocks: list[bytearray]) -> None:
    combined = parse_uf2(output_path.read_bytes())
    total = len(combined)
    blocks_by_address: dict[int, bytearray] = {}
    for expected_number, block in enumerate(combined):
        header = uf2_header(block)
        if header[5] != expected_number or header[6] != total:
            raise BuildError("combined UF2 block numbering is invalid")
        target, payload_size = header[3], header[4]
        if payload_size != UF2_PAYLOAD_SIZE or target % UF2_PAYLOAD_SIZE:
            raise BuildError("combined UF2 pages must be 256-byte aligned and complete")
        if target in blocks_by_address:
            raise BuildError(f"combined UF2 contains duplicate page 0x{target:08x}")
        blocks_by_address[target] = block

    written_sectors = {
        target - target % FLASH_SECTOR_SIZE for target in blocks_by_address
    }
    for sector in written_sectors:
        missing = [
            target
            for target in range(sector, sector + FLASH_SECTOR_SIZE, UF2_PAYLOAD_SIZE)
            if target not in blocks_by_address
        ]
        if missing:
            raise BuildError(
                f"combined UF2 partially represents flash sector 0x{sector:08x}"
            )
    expected_fs_addresses = set(range(LITTLEFS_START, LITTLEFS_END, UF2_PAYLOAD_SIZE))
    actual_fs_addresses = {
        uf2_header(block)[3]
        for block in combined
        if LITTLEFS_START <= uf2_header(block)[3] < LITTLEFS_END
    }
    if actual_fs_addresses != expected_fs_addresses:
        raise BuildError("combined UF2 does not cover the complete LittleFS range")
    if any(uf2_header(block)[3] >= LITTLEFS_END for block in combined):
        raise BuildError("combined UF2 writes into the EEPROM reservation or beyond flash")
    original_addresses = {uf2_header(block)[3] for block in firmware_blocks}
    for original in firmware_blocks:
        original_header = uf2_header(original)
        merged = blocks_by_address.get(original_header[3])
        if merged is None:
            raise BuildError("combined UF2 is missing a firmware page")
        merged_header = uf2_header(merged)
        payload_size = original_header[4]
        if (original_header[2:5] != merged_header[2:5]
                or original_header[7] != merged_header[7]
                or original[32:32 + payload_size] != merged[32:32 + payload_size]):
            raise BuildError("firmware contents changed while merging the UF2")
    zero_page = bytes(UF2_PAYLOAD_SIZE)
    for target, block in blocks_by_address.items():
        if target < LITTLEFS_START and target not in original_addresses:
            if block[32:32 + UF2_PAYLOAD_SIZE] != zero_page:
                raise BuildError("firmware sector padding is not zero-filled")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--firmware", type=Path, required=True)
    parser.add_argument("--firmware-binary", type=Path, required=True)
    parser.add_argument("--filesystem-dir", type=Path, required=True)
    parser.add_argument("--filesystem-image", type=Path, required=True)
    parser.add_argument("--factory-output", type=Path, required=True)
    parser.add_argument("--update-output", type=Path, required=True)
    parser.add_argument("--mklittlefs")
    args = parser.parse_args()
    mklittlefs = locate_mklittlefs(args.mklittlefs)
    build_littlefs(mklittlefs, args.filesystem_dir, args.filesystem_image)
    write_update_uf2(args.firmware, args.firmware_binary, args.update_output)
    merge_uf2(args.firmware, args.firmware_binary, args.filesystem_image, args.factory_output)
    print(
        f"Built update UF2 {args.update_output} (firmware only; LittleFS preserved)"
    )
    print(
        f"Built factory UF2 {args.factory_output} with firmware plus "
        f"0x{LITTLEFS_START:08x}-0x{LITTLEFS_END:08x} LittleFS"
    )


if __name__ == "__main__":
    try:
        main()
    except (BuildError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"factory UF2 build failed: {error}") from error

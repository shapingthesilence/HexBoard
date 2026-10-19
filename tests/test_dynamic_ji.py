#!/usr/bin/env python3
"""Compile the actual JI/dispatch sources against host-only hardware boundaries."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ["tuning/DynamicJustIntonation.cpp", "midi/NoteDispatch.cpp"]
HEADERS = ["tuning/DynamicJustIntonation.h", "midi/NoteDispatch.h"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT)
    parser.add_argument("--case")
    parser.add_argument("--benchmark", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="hexboard-ji-tests-") as directory:
        mirror = Path(directory)
        for relative in SOURCES + HEADERS:
            target = mirror / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(args.source_root / "src/firmware" / relative, target)
        # Keep production includes intact. Replace only headers outside the
        # tested units, never the implementation or their public declarations.
        boundary = ROOT / "tests/support/dynamic_ji_runtime.h"
        for relative in SOURCES + HEADERS:
            target = mirror / relative
            for include in re.findall(r'^#include "([^"]+)"', target.read_text(), re.M):
                stub = (target.parent / include).resolve()
                if stub.exists():
                    continue
                stub.parent.mkdir(parents=True, exist_ok=True)
                stub.write_text(f'#pragma once\n#include "{boundary}"\n')
        flags = ["-std=c++17", "-O2", "-Wall", "-Wextra", "-Werror"]
        if not args.benchmark:
            flags += ["-g", "-fno-omit-frame-pointer", "-fsanitize=address,undefined,float-cast-overflow",
                      "-fno-sanitize-recover=all"]
        if sys.platform == "darwin":
            sdk = subprocess.check_output(["xcrun", "--show-sdk-path"], text=True).strip()
            flags += ["-isystem", str(Path(sdk) / "usr/include/c++/v1")]
        executable = str(mirror / "dynamic_ji_test")
        command = [os.environ.get("CXX", "c++"), *flags, "-I", str(mirror),
                   str(ROOT / "tests/support/dynamic_ji_runtime.cpp"),
                   *(str(mirror / source) for source in SOURCES), "-o", executable]
        subprocess.run(command, check=True)
        subprocess.run([executable, *(["benchmark"] if args.benchmark else [args.case] if args.case else [])],
                       check=True)


if __name__ == "__main__":
    main()

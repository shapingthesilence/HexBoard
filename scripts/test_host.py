#!/usr/bin/env python3
"""Run portable firmware checks with address and undefined-behavior sanitizers."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    flags = ["-std=c++17", "-O1", "-g", "-fno-omit-frame-pointer",
             "-fsanitize=address,undefined", "-fno-sanitize-recover=all"]
    if sys.platform == "darwin":
        sdk = subprocess.check_output(["xcrun", "--show-sdk-path"], text=True).strip()
        flags += ["-isystem", str(Path(sdk) / "usr/include/c++/v1")]
    with tempfile.TemporaryDirectory(prefix="hexboard-host-tests-") as directory:
        for test in sorted((ROOT / "tests").glob("*_test.cpp")):
            sources = [str(test)]
            if test.name == "preset_sync_packing_test.cpp":
                sources.append(str(ROOT / "src/firmware/storage/PresetSyncPacking.cpp"))
            executable = str(Path(directory) / test.stem)
            subprocess.run([os.environ.get("CXX", "c++"), *flags, *sources, "-o", executable], check=True)
            subprocess.run([executable], check=True)
            print(f"PASS {test.name}", flush=True)
        for test in sorted((ROOT / "tests").glob("test_*.py")):
            subprocess.run([sys.executable, str(test)], cwd=ROOT, check=True)
            print(f"PASS {test.name}", flush=True)


if __name__ == "__main__":
    main()

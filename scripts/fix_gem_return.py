#!/usr/bin/env python3
"""Apply the missing-return correction required by GEM 1.8.1 on GCC 16."""
import argparse
from pathlib import Path

BUGGY = "GEMSelect& GEMSelect::setOptions(void* options_) {\n  _options = options_;\n}"
FIXED = "GEMSelect& GEMSelect::setOptions(void* options_) {\n  _options = options_;\n  return *this;\n}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library", type=Path, help="Installed GEM library directory")
    args = parser.parse_args()
    path = args.library / "src/GEMSelect.cpp"
    source = path.read_text()
    if FIXED in source:
        print(f"Already corrected: {path}")
    elif source.count(BUGGY) == 1:
        path.write_text(source.replace(BUGGY, FIXED))
        print(f"Corrected missing return: {path}")
    else:
        parser.error("Known GEM 1.8.1 defect not found; leave this library unchanged")


if __name__ == "__main__":
    main()

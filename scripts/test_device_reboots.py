#!/usr/bin/env python3
"""Check repeated firmware boots without writing or erasing flash."""
import argparse
import json
from pathlib import Path
import subprocess
import time

from test_device_stability import Device


def snapshot(midi, port):
    device = Device(midi, port)
    try:
        device.hello()
        return bytes(device.read({"type": 7, "handle": 0x3fff}))
    finally:
        device.close()


def main():
    import serial
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", default="/dev/cu.usbmodem101")
    parser.add_argument("--midi", default="HexBoard virtual-cable")
    parser.add_argument("--count", type=int, default=5)
    parser.add_argument("--output", type=Path, default=Path("build/stability/reboots.json"))
    args = parser.parse_args()
    if args.count <= 0:
        parser.error("--count must be positive")
    report = {"passed": False, "boots_checked": 0}
    try:
        before = snapshot(args.midi, args.serial)
        for iteration in range(args.count):
            with serial.Serial(args.serial, 1200, write_timeout=3) as connection:
                connection.dtr = False
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                result = subprocess.run(["picotool", "reboot"], capture_output=True, text=True, timeout=3)
                if result.returncode == 0:
                    break
                time.sleep(0.2)
            else:
                raise TimeoutError("Software BOOTSEL reset did not complete")
            time.sleep(5)
            assert snapshot(args.midi, args.serial) == before, "Active preset changed across boot"
            report["boots_checked"] = iteration + 1
            print(f"PASS boot {iteration + 1}/{args.count}; current preset CRC and contents preserved", flush=True)
        report["passed"] = True
    except BaseException as error:
        report["error"] = repr(error)
        raise
    finally:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()

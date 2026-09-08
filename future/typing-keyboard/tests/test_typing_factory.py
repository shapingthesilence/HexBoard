"""Typing JSON, filesystem CRC, and factory settings contract checks."""
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("factory", ROOT / "scripts/build_factory_library.py")
factory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(factory)


class TypingFactoryTests(unittest.TestCase):
    def test_factory_records_match_every_source_key(self):
        config = json.loads((ROOT / "factory-library/config.json").read_text())
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            factory.build_typing(ROOT / "factory-library/typing", output, config)
            for slot, path in enumerate(sorted((ROOT / "factory-library/typing").glob("*.json"))):
                preset = json.loads(path.read_text())
                raw = (output / "typing" / f"{slot:02d}.hkb").read_bytes()
                body = raw[:-4]
                self.assertEqual(zlib.crc32(body), struct.unpack("<I", raw[-4:])[0])
                self.assertEqual(body[:8], b"HBS1\x0e\x01\0\0")
                fields, pos = {}, 8
                while pos < len(body):
                    tag, size = struct.unpack_from("<BH", body, pos)
                    fields[tag] = body[pos + 3:pos + 3 + size]
                    pos += 3 + size
                self.assertEqual(fields[1].decode(), preset["name"])
                self.assertEqual(fields[2].hex(), preset["objectId"])
                self.assertEqual(fields[0x20], bytes(v for key in preset["keys"] for v in (key["usage"], key["modifiers"])))
                self.assertEqual(fields[0x21], b"".join(bytes.fromhex(key["color"][1:]) for key in preset["keys"]))
                self.assertEqual(fields[0x22], bytes([preset["animation"]]))
                self.assertEqual(fields[0x23], bytes([preset["rotation"]]))

    def test_invalid_usage_and_missing_selected_slot_are_rejected(self):
        preset = json.loads((ROOT / "factory-library/typing/00-qwerty.json").read_text())
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, output = root / "source", root / "output"
            source.mkdir()
            output.mkdir()
            preset["keys"][139]["usage"] = 116
            (source / "00.json").write_text(json.dumps(preset))
            config = {"settings": {"TypingLayout": 0, "TypingColors": 0, "TypingAnimation": 0}}
            with self.assertRaisesRegex(factory.LibraryError, "key 139: unsupported HID usage"):
                factory.build_typing(source, output, config)
        with tempfile.TemporaryDirectory() as temporary:
            config = {"settings": {"TypingLayout": 15, "TypingColors": 0, "TypingAnimation": 0}}
            with self.assertRaisesRegex(factory.LibraryError, "TypingLayout does not select"):
                factory.build_typing(ROOT / "factory-library/typing", Path(temporary), config)

    def test_settings_keys_and_version_match_firmware(self):
        config = json.loads((ROOT / "factory-library/config.json").read_text())
        self.assertEqual(config["settingsVersion"], factory.CURRENT_SETTINGS_VERSION)
        self.assertEqual(set(config["settings"]), set(factory.SETTING_KEYS))


if __name__ == "__main__":
    unittest.main()

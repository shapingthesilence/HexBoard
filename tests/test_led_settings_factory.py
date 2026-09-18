import copy
import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('factory', ROOT / 'scripts/build_factory_library.py')
factory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(factory)


class LedSettingsFactoryTest(unittest.TestCase):
    def setUp(self):
        self.path = ROOT / 'factory-library/config.json'
        self.config = json.loads(self.path.read_text())

    def build(self, config):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            factory.build_settings(self.path, output, config, bytes(range(16)),
                                   (bytes([1]) * 16, bytes([2]) * 16, bytes([3]) * 16))
            return (output / 'settings.dat').read_bytes()

    def test_defaults_and_custom_period(self):
        keys = [k for k in factory.SETTING_KEYS if k not in factory.SYNTH_PRESET_KEYS]
        for enabled, period in [(0, 4328), (1, 6000)]:
            config = copy.deepcopy(self.config)
            config['settings'].update(ColorDithering=enabled,
                                      LedFramePeriodLow=period & 255,
                                      LedFramePeriodHigh=period >> 8)
            data = self.build(config)
            magic, version, profile, crc = struct.unpack('<3sBB3xI', data[:12])
            self.assertEqual((magic, version, profile), (b'STG', 33, 0))
            self.assertEqual(zlib.crc32(data[12:]), crc)
            self.assertEqual(len(data), 12 + 1134)
            for profile in range(9):
                start = 12 + profile * len(keys)
                self.assertEqual(data[start + keys.index('ColorDithering')], enabled)
                low = data[start + keys.index('LedFramePeriodLow')]
                high = data[start + keys.index('LedFramePeriodHigh')]
                self.assertEqual(low | high << 8, period)
            self.assertEqual(data[12 + 9 * len(keys):][:49],
                             b'\x07' + bytes([1]) * 16 + bytes([2]) * 16 + bytes([3]) * 16)

    def test_reject_invalid_led_settings(self):
        for enabled, period in [(2, 4328), (0, 4324), (1, 6004), (1, 4329)]:
            config = copy.deepcopy(self.config)
            config['settings'].update(ColorDithering=enabled,
                                      LedFramePeriodLow=period & 255,
                                      LedFramePeriodHigh=period >> 8)
            with self.assertRaises(factory.LibraryError):
                self.build(config)


if __name__ == '__main__':
    unittest.main()

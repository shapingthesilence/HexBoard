import contextlib
import importlib.util
import io
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('factory', ROOT / 'scripts/build_factory_library.py')
factory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(factory)


class SynthPresetsFactoryTest(unittest.TestCase):
    def test_factory_records_match_firmware_reader_and_profile_references(self):
        # Use the firmware's compatibility table, rather than duplicating its
        # accepted version/size pairs in Python.
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            source = work / 'reader.cpp'
            source.write_text('''
#include "src/firmware/storage/SettingsMigration.h"
#include <stdio.h>
int main(int argc, char** argv) {
  for (int i = 1; i < argc; ++i) {
    FILE* file = fopen(argv[i], "rb");
    if (!file) return 1;
    uint8_t data[222] = {};
    const size_t size = fread(data, 1, sizeof(data), file);
    fclose(file);
    if (size < 8) return 1;
    const size_t width = persistedSynthPresetWidth(data[3]);
    if (!width || size != 8 + width) return 2;
    uint8_t preset[213] = {};
    if (!expandPersistedSynthPreset(preset, sizeof(preset),
                                   data + 8, width, 100)) return 3;
  }
}
''')
            reader = work / 'reader'
            subprocess.run(['c++', '-std=c++17', '-I', str(ROOT), str(source),
                            '-o', str(reader)], check=True)
            output = work / 'filesystem'
            with contextlib.redirect_stdout(io.StringIO()):
                factory.build_library(ROOT / 'factory-library', output)
            records = sorted((output / 'presets').glob('*.hsp'))
            sources = sorted((ROOT / 'factory-library/presets').rglob('*.json'))
            self.assertEqual(len(records), len(sources))
            self.assertGreater(len(records), 0)
            subprocess.run([str(reader), *map(str, records)], check=True)
            firmware = factory.PERSISTENT_MODELS_HEADER.read_text()
            keys = re.findall(r'SettingKey::(\w+)',
                              firmware.split('synthPresetKeys = {', 1)[1].split('};', 1)[0])
            self.assertEqual(tuple(keys), factory.SYNTH_PRESET_KEYS)
            ids = set()
            for path in records:
                data = path.read_bytes()
                magic, version, crc = struct.unpack('<3sBI', data[:8])
                self.assertEqual(magic, b'HSP')
                self.assertEqual(version, factory.source_integer_constant('SYNTH_PRESET_FILE_VERSION'))
                self.assertEqual(crc, zlib.crc32(data[8:]))
                object_id = data[10:26]
                self.assertEqual(path.stem, object_id.hex().upper())
                ids.add(object_id)
            settings = (output / 'settings.dat').read_bytes()[12:]
            reference_offset = factory.PROFILE_COUNT * (
                len(factory.SETTING_KEYS) - len(factory.SYNTH_PRESET_KEYS) + 49)
            for profile in range(factory.PROFILE_COUNT):
                start = reference_offset + profile * 17
                self.assertEqual(settings[start], 2)
                self.assertIn(settings[start + 1:start + 17], ids)
            # Reproduce the broken build: v12 payload mislabeled as v11.
            malformed = work / 'mislabeled.hsp'
            data = bytearray(records[0].read_bytes())
            data[3] = 11
            malformed.write_bytes(data)
            self.assertNotEqual(subprocess.run([str(reader), str(malformed)]).returncode, 0)


if __name__ == '__main__':
    unittest.main()

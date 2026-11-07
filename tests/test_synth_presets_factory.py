import contextlib
import importlib.util
import io
import shutil
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('factory', ROOT / 'scripts/build_factory_library.py')
factory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(factory)


def cxx_flags():
    flags = ['-std=c++17']
    if sys.platform == 'darwin':
        sdk = subprocess.check_output(['xcrun', '--show-sdk-path'], text=True).strip()
        flags += ['-isystem', str(Path(sdk) / 'usr/include/c++/v1')]
    return flags


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
    uint8_t data[254] = {};
    const size_t size = fread(data, 1, sizeof(data), file);
    fclose(file);
    if (size < 8) return 1;
    const size_t width = persistedSynthPresetWidth(data[3]);
    if (!width || size != 8 + width) return 2;
    uint8_t preset[246] = {};
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
            records = sorted((output / 'presets').rglob('*.hsp'))
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
            # A current payload mislabeled as v11 must be rejected.
            malformed = work / 'mislabeled.hsp'
            data = bytearray(records[0].read_bytes())
            data[3] = 11
            malformed.write_bytes(data)
            self.assertNotEqual(subprocess.run([str(reader), str(malformed)]).returncode, 0)

    def test_factory_index_matches_firmware_decoder_and_preset_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            checker = work / 'index_checker'
            subprocess.run(['c++', *cxx_flags(), str(ROOT / 'tests/synth_preset_index_test.cpp'),
                            '-o', str(checker)], check=True)
            output = work / 'filesystem'
            with contextlib.redirect_stdout(io.StringIO()):
                factory.build_library(ROOT / 'factory-library', output)
            records = sorted((output / 'presets').rglob('*.hsp'))
            result = subprocess.run([str(checker), str(output / 'preset_index'),
                                     *(path.relative_to(output / 'presets').as_posix() for path in records)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            listed = {tuple(line.split('\t')) for line in result.stdout.splitlines()}
            expected = {(path.parent.relative_to(ROOT / 'factory-library/presets').as_posix(), path.stem)
                        for path in (ROOT / 'factory-library/presets').rglob('*.json')}
            self.assertEqual(listed, expected)

    def test_factory_rejects_overfull_preset_folder(self):
        entries = [(bytes([1, index]) + bytes(14), f'Preset {index}', 'Pads', False, Path('Pads'))
                   for index in range(factory.SYNTH_PRESET_FOLDER_MAX_PRESETS + 1)]
        with self.assertRaises(factory.LibraryError):
            factory.build_preset_index(Path('presets'), entries)
        factory.build_preset_index(Path('presets'), entries[:-1])


    def test_factory_sampler_presets_reference_installed_instruments(self):
        def instrument(name):
            frames = 5
            asset = struct.pack('<IIIIff', 0, frames, 1, 4, 22050.0, 440.0) + bytes([1]) + bytes(7)
            zone = struct.pack('<HBBffHHHHHHHH', 0, 1, 127, 10.0, 30000.0, 32768, 256, 0, 0, 65535, 100, 0, 0) + bytes(20)
            pcm = struct.pack('<5h', 0, 1000, 2000, 3000, 4000)
            header = bytearray(64)
            header[:8] = b'HBC1' + struct.pack('<HH', 1, 64)
            struct.pack_into('<IIIIHHI', header, 8, 64 + 32 + 48 + len(pcm), frames, zlib.crc32(pcm), 0, 1, 1, 0)
            header[32:32 + len(name)] = name.encode()
            metadata = bytes(header) + asset + zone
            struct.pack_into('<I', header, 20, zlib.crc32(metadata[:20] + bytes(4) + metadata[24:]))
            return bytes(header) + asset + zone + pcm

        with tempfile.TemporaryDirectory() as temporary:
            work = Path(temporary)
            library = work / 'library'
            shutil.copytree(ROOT / 'factory-library', library)
            (library / 'sampler').mkdir()
            (library / 'sampler' / 'Felt.hbc').write_bytes(instrument('Felt Piano'))
            # The firmware's own decoder accepts the generated test instrument.
            checker = work / 'hbc_checker.cpp'
            checker.write_text(
                '#include "src/firmware/synth/CompactSamplerCodec.h"\n'
                '#include <stdio.h>\n'
                'int main(int argc, char** argv) {\n'
                '  static uint8_t data[60000]; FILE* f = fopen(argv[1], "rb");\n'
                '  size_t n = fread(data, 1, sizeof(data), f); fclose(f);\n'
                '  size_t metadata = 64 + CompactSampler::u16(data + 24) * 32 + CompactSampler::u16(data + 26) * 48;\n'
                '  CompactSampler::Directory d;\n'
                '  return metadata <= n && d.decode(data, metadata) && d.total == n ? 0 : 1;\n'
                '}\n')
            subprocess.run(['c++', *cxx_flags(), '-I', str(ROOT), str(checker), '-o', str(work / 'hbc_checker')], check=True)
            subprocess.run([str(work / 'hbc_checker'), str(library / 'sampler' / 'Felt.hbc')], check=True)

            document = json.loads((library / 'presets/Pads/Glassy Bow.json').read_text())
            preset = document.get('preset', document)
            preset.update(name='Felt Keys', sampler={'name': 'Felt Piano', 'envelopeOverride': 0b10001})
            preset.pop('objectId', None)
            preset.pop('wavetable', None)
            felt = library / 'presets/Pads/Felt Keys.json'
            felt.write_text(json.dumps(document))
            output = work / 'filesystem'
            with contextlib.redirect_stdout(io.StringIO()):
                factory.build_library(library, output)
            self.assertEqual((output / 'sampler/00.hbc').read_bytes(), instrument('Felt Piano'))
            records = [path.read_bytes()[8:] for path in (output / 'presets').rglob('*.hsp')]
            sampler_records = [record for record in records if record[213:245].rstrip(bytes(1)) == b'Felt Piano']
            self.assertEqual(len(sampler_records), 1)
            self.assertEqual(sampler_records[0][245], 0b10001)
            self.assertTrue(all(record[213:246] == bytes(33) for record in records if record not in sampler_records))

            preset['sampler'] = {'name': 'Missing Instrument'}
            felt.write_text(json.dumps(document))
            with self.assertRaises(factory.LibraryError):
                factory.build_library(library, work / 'missing')
            preset['sampler'] = {'name': 'Felt Piano'}
            felt.write_text(json.dumps(document))
            (library / 'sampler' / 'Copy.hbc').write_bytes(instrument('Felt Piano'))
            with self.assertRaises(factory.LibraryError):
                factory.build_library(library, work / 'duplicate')

if __name__ == '__main__':
    unittest.main()

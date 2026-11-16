"""Run the production compact format/reader with host memory sanitizers."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CompactSamplerTest(unittest.TestCase):
    def test_codec_and_readers(self):
        flags = ['-std=c++17', '-O2', '-fsanitize=address,undefined', '-fno-sanitize-recover=all']
        if sys.platform == 'darwin':
            sdk = subprocess.check_output(['xcrun', '--show-sdk-path'], text=True).strip()
            flags += ['-isystem', str(Path(sdk) / 'usr/include/c++/v1')]
        with tempfile.TemporaryDirectory() as temporary:
            executable = str(Path(temporary) / 'compact-test')
            subprocess.run(['c++', *flags, str(ROOT / 'tests/compact_sampler_test.cpp'), '-o', executable], check=True)
            subprocess.run([executable], check=True)

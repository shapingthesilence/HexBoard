"""Ensure missing DSP coverage or missed deadlines cannot pass the hardware runner."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('perf', Path(__file__).resolve().parents[1] / 'scripts/test_synth_performance.py')
perf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(perf)


class PerformanceReportTest(unittest.TestCase):
    def setUp(self):
        self.metadata = {'version': '1', 'phases': '17', 'frames': '16'}
        self.phases = [dict(phase=name, blocks='2500', avg_us='900', max_us='1250', budget_us='1572',
                            underruns='0', overruns='0', voices_at_peak='8', release_starts='40',
                            note_failures='0', wheel_span='127', fx_active='3',
                            lfo_wave=str(index - 6)) for index, name in enumerate(perf.PHASES)]

    def check(self, **kwargs):
        return perf.assess(self.metadata, self.phases, kwargs.get('completed', True), kwargs.get('limit', 100))

    def test_sampler_expression_requires_actual_retunes(self):
        self.metadata.update(sampler='1', sampler_expression='1', frames='1')
        self.assertTrue(any('retunes' in error for error in self.check()))
        for phase in self.phases:
            phase['retunes'] = '2300'
        self.assertFalse(self.check())

    def test_complete_measurements_pass(self):
        self.assertEqual(self.check(), [])
        self.assertEqual(perf.fields('HBAUDIO phase=eight blocks=2500'), {'phase': 'eight', 'blocks': '2500'})
        self.assertIsNone(perf.fields('Audio cpu avg/max/worst: 17%'))

    def test_incomplete_coverage_fails(self):
        self.assertTrue(self.check(completed=False))
        self.metadata['frames'] = '1'
        self.assertTrue(self.check())
        self.metadata['frames'] = '16'
        self.phases.pop()
        self.assertTrue(self.check())

    def test_faults_and_silent_workloads_fail(self):
        for key, value in [('underruns', '1'), ('overruns', '1'), ('note_failures', '1'),
                           ('voices_at_peak', '0'), ('blocks', '0'), ('budget_us', '0'),
                           ('release_starts', '0'), ('max_us', '1572'),
                           ('wheel_span', '0'), ('fx_active', '1'), ('lfo_wave', '5')]:
            with self.subTest(key=key):
                phase = self.phases[6]
                saved = phase[key]
                phase[key] = value
                self.assertTrue(self.check())
                phase[key] = saved
        self.assertTrue(self.check(limit=75))


if __name__ == '__main__':
    unittest.main()

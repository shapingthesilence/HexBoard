#!/usr/bin/env python3
"""Run the on-device, 68-second synth DSP/voice/modulation workload (audible).

Requires pyserial and firmware supporting HBAUD. Uses the loaded wavetable and
output routing; leave Poly selected, release keys, and close other serial/MIDI
clients. No flash writes or patch transfers. Firmware restores runtime controls
and auto-save on completion/cancel, including after a host disconnect.
"""
import argparse
import json
from pathlib import Path
import time

PHASES = ('idle', 'single', 'eight', 'release', 'retrigger', 'steal',
          'mod_sine', 'mod_triangle', 'mod_saw', 'mod_square', 'mod_noise', 'mod_smooth_noise',
          'amp_attack', 'amp_hold', 'amp_decay', 'amp_sustain', 'amp_release')


def fields(line):
    if not line.startswith('HBAUDIO '):
        return None
    return dict(item.split('=', 1) for item in line.split()[1:] if '=' in item)


def assess(metadata, phases, completed, max_cpu_percent):
    errors = []
    if not completed:
        errors.append('Firmware did not complete the suite')
    if metadata.get('version') != '1' or metadata.get('phases') != str(len(PHASES)):
        errors.append('Missing or unsupported suite metadata')
    sampler = metadata.get('sampler') == '1'
    if not sampler and int(metadata.get('frames', '0')) < 2:
        errors.append('Multiframe wavetable required for full wavetable modulation coverage')
    if [p.get('phase') for p in phases] != list(PHASES):
        errors.append('Missing, duplicate, or out-of-order phases')
    for phase in phases:
        name = phase['phase']
        try:
            numbers = {key: int(phase[key]) for key in
                       ('blocks', 'avg_us', 'max_us', 'budget_us', 'underruns', 'overruns',
                        'voices_at_peak', 'release_starts', 'note_failures')}
        except (ValueError, KeyError):
            errors.append(f'{name}: malformed measurement')
            continue
        if numbers['blocks'] < 100 or numbers['budget_us'] <= 0:
            errors.append(f'{name}: insufficient profiling samples')
            continue
        if numbers['underruns'] or numbers['overruns'] or numbers['note_failures']:
            errors.append(f'{name}: underrun, overrun, or note allocation failure')
        cpu = 100 * numbers['max_us'] / numbers['budget_us']
        if cpu >= max_cpu_percent:
            errors.append(f'{name}: peak {cpu:.1f}% exceeds limit {max_cpu_percent:g}%')
        if name == 'single' and numbers['voices_at_peak'] < 1:
            errors.append(f'{name}: no rendered voice at peak')
        if name in ('eight', 'steal') or name.startswith(('mod_', 'amp_')):
            if numbers['voices_at_peak'] < 8:
                errors.append(f'{name}: eight rendered voices not demonstrated at peak')
        if name.startswith('mod_') and not numbers['release_starts']:
            errors.append(f'{name}: release transitions not demonstrated')
        if sampler and metadata.get('sampler_expression') == '1' and name.startswith(('mod_', 'amp_')) and int(phase.get('retunes', '0')) < 1000:
            errors.append(f'{name}: sampler continuous retunes not demonstrated')
        if not sampler and name.startswith(('mod_', 'amp_')):
            if int(phase.get('wheel_span', '0')) < 120 or phase.get('fx_active') != '3':
                errors.append(f'{name}: wheel sweep or both effect envelopes not demonstrated')
        if not sampler and name.startswith('mod_'):
            if phase.get('lfo_wave') != str(PHASES.index(name) - 6):
                errors.append(f'{name}: expected LFO waveform not exercised')
    return errors


def main():
    import serial
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', default='/dev/cu.usbmodem101')
    parser.add_argument('--piezo', action='store_true', help='Temporarily exercise piezo output; restores routing after the suite')
    parser.add_argument('--max-cpu-percent', type=float, default=100,
                        help='Fail at this peak load; use 90 to require 10%% render headroom')
    parser.add_argument('--output', type=Path, default=Path('build/performance/automated.json'))
    args = parser.parse_args()
    if not 0 < args.max_cpu_percent <= 100:
        parser.error('--max-cpu-percent must be in (0, 100]')
    report = {'passed': False, 'metadata': {}, 'phases': [], 'log': []}
    connection = None
    try:
        connection = serial.Serial(args.serial, 115200, timeout=.25, write_timeout=3)
        # An interrupted previous run must clean up before a fresh test starts.
        connection.write(b'HBAUD 0\n')
        time.sleep(.2)
        connection.reset_input_buffer()
        connection.write(b'HBAUD 2\n' if args.piezo else b'HBAUD 1\n')
        deadline = time.monotonic() + 85
        completed = False
        started = time.monotonic()
        while time.monotonic() < deadline:
            line = connection.readline().decode(errors='replace').strip()
            if not line:
                if not report['metadata'] and time.monotonic() - started > 5:
                    raise RuntimeError('No HBAUD response; update firmware or close other serial clients')
                continue
            report['log'].append(line)
            data = fields(line)
            if data is None:
                continue
            print(line, flush=True)
            if 'error' in data:
                raise RuntimeError(data['error'])
            if 'version' in data:
                report['metadata'] = data
            if 'phase' in data:
                report['phases'].append(data)
            if 'result' in data:
                completed = data['result'] == 'complete'
                break
        report['errors'] = assess(report['metadata'], report['phases'], completed, args.max_cpu_percent)
        report['passed'] = not report['errors']
    except Exception as error:
        report['errors'] = [str(error)]
    finally:
        if connection is not None:
            try:
                connection.write(b'HBAUD 0\n')
            finally:
                connection.close()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'passed': report['passed'], 'errors': report.get('errors', []),
                      'output': str(args.output)}), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())

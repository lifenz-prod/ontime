import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { TimecodeFrame, TimecodeReaderStatus, TimecodeSettings } from 'ontime-types';
import { LtcEncoder } from 'ontime-utils';

import { NativeTimecodeReader } from '../NativeTimecodeReader.js';

vi.mock('../../../classes/Logger.js', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const sampleRate = 48000;

/**
 * Stands in for ltc-capture: same arguments, same reports on stderr, and LTC on stdout read from
 * a file the test writes, paced in 10 ms blocks. "Missing" is an input that is not there.
 */
const fakeHelper = `
const fs = require('node:fs');
const [mode, device, channel] = process.argv.slice(2);
const report = (o) => process.stderr.write(JSON.stringify(o) + '\\n');
if (mode === 'list') {
  process.stdout.write(JSON.stringify([{ name: 'Dante Virtual Soundcard', channels: 16 }, { name: 'Mic', channels: 1 }]));
  process.exit(0);
}
fs.appendFileSync(process.env.FAKE_LOG, device + '|' + channel + '\\n');
if (device === 'Missing') {
  report({ event: 'error', message: 'Input "Missing" was not found on this machine' });
  process.exit(3);
}
report({ event: 'started', device, channels: 16, channel: Number(channel), sampleRate: ${sampleRate} });
const audio = fs.readFileSync(process.env.FAKE_AUDIO);
const block = ${sampleRate / 100} * 4 + 2; // an odd size, so samples straddle chunks
let offset = 0;
const timer = setInterval(() => {
  if (offset >= audio.length) return clearInterval(timer);
  process.stdout.write(audio.subarray(offset, offset + block));
  offset += block;
}, 10);
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
`;

const settings = (overrides: Partial<TimecodeSettings> = {}): TimecodeSettings => ({
  enabled: true,
  deviceLabel: 'Dante Virtual Soundcard',
  channel: 9,
  warningThreshold: 30000,
  dangerThreshold: 10000,
  timeout: 500,
  timers: [],
  ...overrides,
});

const start: TimecodeFrame = { hours: 1, minutes: 0, seconds: 0, frames: 0, dropFrame: false, fps: 25 };

describe('NativeTimecodeReader', () => {
  let dir: string;
  let log: string;
  let reader: NativeTimecodeReader | null = null;
  let frames: TimecodeFrame[];
  let statuses: TimecodeReaderStatus[];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ltc-capture-'));
    log = join(dir, 'log.txt');
    writeFileSync(join(dir, 'helper.cjs'), fakeHelper);
    writeFileSync(log, '');

    // a second of LTC from 01:00:00:00
    const samples = new Float32Array(sampleRate);
    new LtcEncoder(sampleRate, start).fill(samples);
    writeFileSync(join(dir, 'audio.raw'), Buffer.from(samples.buffer));

    process.env.FAKE_LOG = log;
    process.env.FAKE_AUDIO = join(dir, 'audio.raw');
    frames = [];
    statuses = [];
  });

  afterEach(() => {
    reader?.stop();
    reader = null;
    rmSync(dir, { recursive: true, force: true });
  });

  const makeReader = () =>
    new NativeTimecodeReader(
      { command: process.execPath, args: [join(dir, 'helper.cjs')] },
      { frame: (frame) => frames.push(frame), status: (status) => statuses.push(status) },
    );

  const launches = async () => (await import('node:fs')).readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);

  it('reads the chosen channel and decodes the timecode on it', async () => {
    reader = makeReader();
    reader.start(settings());

    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(15), { timeout: 4000 });
    expect(await launches()).toEqual(['Dante Virtual Soundcard|9']);
    // consecutive frames from where the signal starts
    const first = frames[0];
    expect(first).toMatchObject({ hours: 1, minutes: 0, seconds: 0, fps: 25 });
    frames.slice(1, 10).forEach((frame, i) => expect(frame.frames).toBe(first.frames + i + 1));

    await vi.waitFor(() =>
      expect(statuses.at(-1)).toMatchObject({
        devices: ['Dante Virtual Soundcard', 'Mic'],
        deviceChannels: [16, 1],
        deviceLabel: 'Dante Virtual Soundcard',
        channel: 9,
        error: '',
      }),
    );
  });

  it('moves to another channel when the settings change', async () => {
    reader = makeReader();
    reader.start(settings());
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 4000 });

    reader.apply(settings({ channel: 12 }));
    await vi.waitFor(async () =>
      expect(await launches()).toEqual(['Dante Virtual Soundcard|9', 'Dante Virtual Soundcard|12']),
    );

    // the same settings again do not restart it
    reader.apply(settings({ channel: 12 }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await launches()).toHaveLength(2);
  });

  it('says why when the input is not there, and keeps trying', async () => {
    reader = makeReader();
    reader.start(settings({ deviceLabel: 'Missing' }));

    await vi.waitFor(() => expect(statuses.at(-1)?.error).toBe('Input "Missing" was not found on this machine'));
    expect(frames).toHaveLength(0);
  });

  it('runs nothing while timecode is off', async () => {
    reader = makeReader();
    reader.start(settings({ enabled: false }));

    expect(statuses).toEqual([expect.objectContaining({ devices: [], error: 'Timecode is turned off in settings' })]);
    // no capture, no polling for inputs, no status ticking
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await launches()).toEqual([]);
    expect(statuses).toHaveLength(1);
  });

  it('stops the helper when timecode is turned off', async () => {
    reader = makeReader();
    reader.start(settings());
    await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 4000 });

    reader.apply(settings({ enabled: false }));
    expect(statuses.at(-1)).toMatchObject({ devices: [], error: 'Timecode is turned off in settings' });
    const count = frames.length;
    const reports = statuses.length;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(frames.length).toBe(count);
    expect(statuses.length).toBe(reports);
  });
});

import * as dgram from 'node:dgram';
import { fromBuffer, toBuffer } from 'osc-min';
import type { AbletonState } from 'ontime-types';

vi.mock('../../../classes/Logger.js', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../stores/EventStore.js', () => ({
  eventStore: { set: vi.fn(), get: vi.fn(), poll: vi.fn(), init: vi.fn(), broadcast: vi.fn() },
}));
vi.mock('../../countdown-service/CountdownService.js', () => ({
  countdownService: { update: vi.fn(), setSource: vi.fn(), getSource: vi.fn(), getState: vi.fn() },
}));

/** ports of our own, so the test does not fight whatever else is on the machine */
const abletonPort = 55930;
const listenPort = 55931;

type FakeArg = { type: 'integer' | 'float' | 'string' | 'true' | 'false'; value?: number | string | boolean };

/**
 * Stands in for Ableton Live running AbletonOSC: answers the queries Ontime sends,
 * replying to the sender's address on the reply port, the way AbletonOSC does.
 */
function createFakeAbleton() {
  const live = {
    tempo: 120,
    isPlaying: true,
    playingSlot: new Map<number, number>([[0, 1]]), // track 1 plays its second clip
    position: 30, // beats: 15 seconds at 120 bpm
    received: [] as string[],
  };

  const socket = dgram.createSocket('udp4');
  socket.on('message', (buf, rinfo) => {
    const message = fromBuffer(buf);
    if (message.oscType !== 'message') return;
    live.received.push(message.address);
    const args = message.args.map((arg) => (arg as { value: unknown }).value as number);

    const reply = (address: string, replyArgs: FakeArg[]) => {
      const out = toBuffer({ address, args: replyArgs as never });
      socket.send(out, 0, out.byteLength, listenPort, rinfo.address);
    };
    const int = (value: number): FakeArg => ({ type: 'integer', value });

    switch (message.address) {
      case '/live/test':
        reply('/live/test', [{ type: 'string', value: 'ok' }]);
        break;
      case '/live/song/get/tempo':
        reply('/live/song/get/tempo', [{ type: 'float', value: live.tempo }]);
        break;
      case '/live/song/get/is_playing':
        reply('/live/song/get/is_playing', [{ type: live.isPlaying ? 'true' : 'false' }]);
        break;
      case '/live/track/get/playing_slot_index':
        reply('/live/track/get/playing_slot_index', [int(args[0]), int(live.playingSlot.get(args[0]) ?? -1)]);
        break;
      case '/live/clip/get/playing_position':
        reply('/live/clip/get/playing_position', [int(args[0]), int(args[1]), { type: 'float', value: live.position }]);
        break;
      case '/live/clip/get/warping':
        reply('/live/clip/get/warping', [int(args[0]), int(args[1]), { type: 'true' }]);
        break;
      case '/live/track/get/name':
        reply('/live/track/get/name', [int(args[0]), { type: 'string', value: 'Click' }]);
        break;
      case '/live/clip/get/name':
        reply('/live/clip/get/name', [int(args[0]), int(args[1]), { type: 'string', value: 'Way Maker' }]);
        break;
      default:
        break;
    }
  });

  return {
    live,
    ready: new Promise<void>((resolve) => socket.bind(abletonPort, () => resolve())),
    close: () => socket.close(),
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lastAbletonState(): Promise<AbletonState> {
  const { countdownService } = await import('../../countdown-service/CountdownService.js');
  const calls = vi.mocked(countdownService.update).mock.calls.filter(([provider]) => provider === 'ableton');
  return calls.at(-1)?.[1] as AbletonState;
}

describe('AbletonService', () => {
  it('counts down to a point in the playing clip, follows a scrub, and lets go past it', async () => {
    const ableton = createFakeAbleton();
    await ableton.ready;

    const { abletonService } = await import('../AbletonService.js');
    abletonService.init({
      enabled: true,
      host: '127.0.0.1',
      port: abletonPort,
      listenPort,
      warningThreshold: 30000,
      dangerThreshold: 10000,
      timeout: 5000,
      timers: [{ id: 't1', name: 'Way Maker end', track: 1, clip: 2, target: 60000 }],
    });
    await wait(700);

    // we asked Live to keep us posted on what each watched track plays
    expect(ableton.live.received).toContain('/live/track/start_listen/playing_slot_index');

    let state = await lastAbletonState();
    expect(state).toMatchObject({ enabled: true, connected: true, cueName: 'Way Maker end', duration: 60000 });
    // 15s in, 45s to go, give or take our own clock carrying it forward between polls
    expect(state.remaining).toBeGreaterThan(43500);
    expect(state.remaining).toBeLessThanOrEqual(45000);

    // scrub forward to 50s
    ableton.live.position = 100;
    await wait(500);
    state = await lastAbletonState();
    expect(state.remaining).toBeGreaterThan(8500);
    expect(state.remaining).toBeLessThanOrEqual(10000);

    // past the target: Ableton lets go of the countdown
    ableton.live.position = 130;
    await wait(500);
    state = await lastAbletonState();
    expect(state).toMatchObject({ connected: true, duration: 0, remaining: 0 });

    abletonService.shutdown();
    ableton.close();
  }, 15000);

  it('reads the playhead for "Set to current position"', async () => {
    const ableton = createFakeAbleton();
    await ableton.ready;
    ableton.live.position = 64; // 32 seconds at 120 bpm

    const { abletonService } = await import('../AbletonService.js');
    abletonService.init({
      enabled: true,
      host: '127.0.0.1',
      port: abletonPort,
      listenPort,
      warningThreshold: 30000,
      dangerThreshold: 10000,
      timeout: 5000,
      timers: [],
    });
    await wait(300);

    const position = await abletonService.readClipPosition(1, 2);
    expect(position).toEqual({ position: 32000, isPlaying: true, trackName: 'Click', clipName: 'Way Maker' });

    abletonService.shutdown();
    ableton.close();
  }, 15000);
});

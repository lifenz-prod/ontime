import * as dgram from 'node:dgram';
import { fromBuffer, toBuffer } from 'osc-min';

vi.mock('../../../classes/Logger.js', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock('../../../stores/EventStore.js', () => ({
  eventStore: { set: vi.fn(), get: vi.fn(), poll: vi.fn(), init: vi.fn(), broadcast: vi.fn() },
}));
vi.mock('../../countdown-service/CountdownService.js', () => ({
  countdownService: { update: vi.fn(), setSource: vi.fn(), getSource: vi.fn(), getState: vi.fn() },
}));

/** QLab's default, which a client can move for itself with /udpReplyPort */
const defaultReplyPort = 53001;

/**
 * Stands in for QLab 5, following its OSC dictionary: replies go to a reply port rather than back
 * to the sender, carry a /reply prefix and a JSON envelope, and report times in seconds. The reply
 * port is kept per client, which is what lets Ontime read a QLab that Companion is also driving.
 * Note what /runningOrPausedCues does NOT carry: no duration, elapsed or paused state.
 */
function startFakeQlab(options: { port: number; status?: string }) {
  const socket = dgram.createSocket('udp4');
  const asked: string[] = [];
  const replyPorts = new Map<string, number>();

  socket.on('message', (buf, rinfo) => {
    const packet = fromBuffer(buf);
    if (packet.oscType !== 'message') return;

    const { address, args } = packet;
    const client = `${rinfo.address}:${rinfo.port}`;
    asked.push(address);

    if (address.endsWith('/udpReplyPort')) {
      const port = args[0]?.value;
      if (typeof port === 'number') {
        replyPorts.set(client, port);
      }
      return; // writing a value generates no reply
    }

    let data: unknown;
    if (address.endsWith('/runningOrPausedCues')) {
      data = [
        {
          uniqueID: 'ABC-123',
          number: '12',
          name: 'Sermon Bumper',
          listName: 'Sermon Bumper',
          type: 'Video',
          colorName: 'none',
          flagged: 0,
          armed: 1,
        },
      ];
    } else if (address.endsWith('/actionElapsed')) {
      data = 48.5;
    } else if (address.endsWith('/currentDuration')) {
      data = 300;
    } else if (address.endsWith('/isPaused')) {
      data = false;
    } else {
      // QLab stays silent for messages that generate no reply
      return;
    }

    const envelope = JSON.stringify({
      workspace_id: 'WS-1',
      address,
      status: options.status ?? 'ok',
      data: options.status === 'denied' ? 'denied' : data,
    });
    const reply = toBuffer({ address: `/reply${address}`, args: [{ type: 'string', value: envelope } as const] });
    socket.send(reply, 0, reply.byteLength, replyPorts.get(client) ?? defaultReplyPort, rinfo.address);
  });

  socket.bind(options.port);
  return { socket, asked };
}

function settings(port: number, listenPort: number) {
  return {
    enabled: true,
    host: '127.0.0.1',
    port,
    listenPort,
    filterByColor: null,
    filterByType: null,
    filterByCueNumber: null,
    warningThreshold: 30000,
    dangerThreshold: 10000,
    timeout: 3000,
  };
}

describe('QlabService', () => {
  it('builds a countdown out of the replies QLab sends', async () => {
    const fake = startFakeQlab({ port: 53900 });
    const { qlabService } = await import('../QlabService.js');

    qlabService.init(settings(53900, 53901));
    await new Promise((r) => setTimeout(r, 1200));

    // the cue list carries no timing data, so each value has to be asked for separately
    expect(new Set(fake.asked)).toEqual(
      new Set([
        '/udpReplyPort',
        '/runningOrPausedCues',
        '/cue_id/ABC-123/actionElapsed',
        '/cue_id/ABC-123/currentDuration',
        '/cue_id/ABC-123/isPaused',
      ]),
    );
    expect(qlabService.getState()).toMatchObject({
      enabled: true,
      connected: true,
      cueName: 'Sermon Bumper',
      cueNumber: '12',
      duration: 300000, // QLab counts in seconds, we count in milliseconds
      elapsed: 48500,
      remaining: 251500,
      isPaused: false,
    });

    qlabService.shutdown();
    fake.socket.close();
  }, 20000);

  it('says so when QLab refuses the request over a workspace passcode', async () => {
    const fake = startFakeQlab({ port: 53902, status: 'denied' });
    const { qlabService } = await import('../QlabService.js');
    const { logger } = await import('../../../classes/Logger.js');
    vi.mocked(logger.error).mockClear();

    qlabService.init(settings(53902, 53903));
    await new Promise((r) => setTimeout(r, 1200));

    expect(qlabService.getState()).toMatchObject({ connected: false, remaining: 0 });
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('passcode'));
    // the complaint is made once, not on every poll
    expect(vi.mocked(logger.error).mock.calls.filter(([, message]) => message.includes('passcode'))).toHaveLength(1);

    qlabService.shutdown();
    fake.socket.close();
  }, 20000);

  it('claims a reply port of its own, so it can read a QLab that Companion also drives', async () => {
    const fake = startFakeQlab({ port: 53904 });
    const { qlabService } = await import('../QlabService.js');

    // 53905 is not where QLab would reply on its own, so this only works if Ontime asks for it
    qlabService.init(settings(53904, 53905));
    await new Promise((r) => setTimeout(r, 1200));

    expect(fake.asked).toContain('/udpReplyPort');
    expect(qlabService.getState()).toMatchObject({ connected: true, remaining: 251500 });

    qlabService.shutdown();
    fake.socket.close();
  }, 20000);
});

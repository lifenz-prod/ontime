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

/** a port of our own, so the test does not fight whatever else is on the machine */
const listenPort = 55917;

/** stands in for Mitti pushing a feedback message at us */
function sendFeedback(address: string, value?: string | number, toPort: number = listenPort): Promise<void> {
  const socket = dgram.createSocket('udp4');
  const args =
    value === undefined
      ? []
      : [typeof value === 'string' ? ({ type: 'string', value } as const) : ({ type: 'integer', value } as const)];
  const buffer = toBuffer({ address, args });

  return new Promise((resolve) => {
    socket.send(buffer, 0, buffer.byteLength, toPort, '127.0.0.1', () => {
      socket.close();
      resolve();
    });
  });
}

/** the feedback is handled on the socket callback, so give the event loop a turn */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 200));
}

describe('MittiService', () => {
  it('builds a countdown out of the feedback Mitti pushes', async () => {
    const { mittiService } = await import('../MittiService.js');
    const { countdownService } = await import('../../countdown-service/CountdownService.js');

    mittiService.init({
      enabled: true,
      host: '127.0.0.1',
      port: 55918, // nothing is listening there: we never need Mitti to answer
      listenPort,
      warningThreshold: 300000,
      dangerThreshold: 60000,
      timeout: 5000,
      relayHost: null,
      relayPort: null,
    });
    await settle();

    await sendFeedback('/mitti/currentCueName', 'Sermon Bumper');
    await sendFeedback('/mitti/currentCueID', 'A1');
    await sendFeedback('/mitti/currentCueTRT', '00:05:00:00');
    await sendFeedback('/mitti/cueTimeElapsed', '00:00:48:12');
    await sendFeedback('/mitti/cueTimeLeft', '-00:04:12:13');
    await sendFeedback('/mitti/togglePlay', 1);
    await sendFeedback('/mitti/playhead', 42);
    await settle();

    expect(mittiService.getState()).toMatchObject({
      enabled: true,
      connected: true,
      cueName: 'Sermon Bumper',
      cueNumber: 'A1',
      duration: 300000,
      elapsed: 48000,
      remaining: 252000,
      isPaused: false,
    });
    expect(countdownService.update).toHaveBeenCalledWith('mitti', expect.objectContaining({ remaining: 252000 }));

    // Mitti sends a pause on its own, without resending the cue
    await sendFeedback('/mitti/togglePlay', 0);
    await settle();
    expect(mittiService.getState().isPaused).toBe(true);

    // and when the cue goes away, its times go with it
    await sendFeedback('/mitti/currentCueName', '-');
    await settle();
    expect(mittiService.getState()).toMatchObject({ cueName: '', duration: 0, remaining: 0 });

    mittiService.shutdown();
  }, 15000);

  it('stays at zero for a cue that is only cued up', async () => {
    const cuedListenPort = 55921;
    const { mittiService } = await import('../MittiService.js');

    mittiService.init({
      enabled: true,
      host: '127.0.0.1',
      port: 55918,
      listenPort: cuedListenPort,
      warningThreshold: 300000,
      dangerThreshold: 60000,
      timeout: 5000,
      relayHost: null,
      relayPort: null,
    });
    await settle();

    // selecting a cue in Mitti loads it and reports its whole duration as time remaining
    await sendFeedback('/mitti/currentCueName', 'Sermon Bumper', cuedListenPort);
    await sendFeedback('/mitti/currentCueTRT', '00:05:00:00', cuedListenPort);
    await sendFeedback('/mitti/cueTimeElapsed', '00:00:00:00', cuedListenPort);
    await sendFeedback('/mitti/cueTimeLeft', '-00:05:00:00', cuedListenPort);
    await settle();

    expect(mittiService.getState()).toMatchObject({
      connected: true,
      cueName: '',
      duration: 0,
      remaining: 0,
      isPaused: false,
    });

    // and it counts as soon as it is actually played
    await sendFeedback('/mitti/togglePlay', 1, cuedListenPort);
    await sendFeedback('/mitti/cueTimeLeft', '-00:04:12:13', cuedListenPort);
    await settle();

    expect(mittiService.getState()).toMatchObject({ cueName: 'Sermon Bumper', remaining: 252000 });

    mittiService.shutdown();
  }, 15000);

  it('hands every packet on to the relay, so Companion keeps its feedback', async () => {
    const relayListenPort = 55919;
    const relayTargetPort = 55920;

    // stands in for Companion's Mitti module, which still needs the feedback to drive its buttons
    const relayed: Buffer[] = [];
    const companion = dgram.createSocket('udp4');
    companion.on('message', (buf) => relayed.push(buf));
    await new Promise<void>((resolve) => companion.bind(relayTargetPort, () => resolve()));

    const { mittiService } = await import('../MittiService.js');
    mittiService.init({
      enabled: true,
      host: '127.0.0.1',
      port: 55918,
      listenPort: relayListenPort,
      warningThreshold: 300000,
      dangerThreshold: 60000,
      timeout: 5000,
      relayHost: '127.0.0.1',
      relayPort: relayTargetPort,
    });
    await settle();

    await sendFeedback('/mitti/currentCueName', 'Sermon Bumper', relayListenPort);
    await sendFeedback('/mitti/currentCueTRT', '00:05:00:00', relayListenPort);
    await sendFeedback('/mitti/cueTimeLeft', '-00:04:12:13', relayListenPort);
    await sendFeedback('/mitti/togglePlay', 1, relayListenPort);
    await settle();

    // Ontime reads it as usual
    expect(mittiService.getState()).toMatchObject({ cueName: 'Sermon Bumper', remaining: 252000 });

    // and Companion gets the bytes Mitti sent, not our reading of them
    expect(relayed).toHaveLength(4);
    const relayedAddresses = relayed.map((buf) => (fromBuffer(buf) as { address: string }).address);
    expect(relayedAddresses).toEqual([
      '/mitti/currentCueName',
      '/mitti/currentCueTRT',
      '/mitti/cueTimeLeft',
      '/mitti/togglePlay',
    ]);

    mittiService.shutdown();
    companion.close();
  }, 15000);
});

import * as dgram from 'node:dgram';

vi.mock('../../classes/Logger.js', () => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { logger } from '../../classes/Logger.js';
import { ListenSocket } from '../listenSocket.js';

const port = 53910;

function hold(port: number): Promise<dgram.Socket> {
  const socket = dgram.createSocket('udp4');
  return new Promise((resolve) => socket.bind(port, () => resolve(socket)));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ListenSocket', () => {
  it('takes the port over once whatever was holding it lets go', async () => {
    // stands in for Companion, which listens on the same ports for the same devices
    const squatter = await hold(port);
    const received: string[] = [];

    const listener = new ListenSocket({
      label: 'Test',
      port,
      onMessage: (buf) => received.push(buf.toString()),
      retryDelay: 100,
    });

    await wait(300);
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('already in use'));
    // it says it once, however many times it retries
    expect(vi.mocked(logger.error).mock.calls.filter(([, m]) => m.includes('already in use'))).toHaveLength(1);
    expect(received).toHaveLength(0);

    await new Promise<void>((resolve) => squatter.close(() => resolve()));
    await wait(400);

    const sender = dgram.createSocket('udp4');
    await new Promise<void>((resolve) => sender.send('hello', port, '127.0.0.1', () => resolve()));
    await wait(200);
    sender.close();

    expect(received).toEqual(['hello']);

    listener.close();
  }, 20000);
});

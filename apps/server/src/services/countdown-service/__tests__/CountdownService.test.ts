import { CountdownSourceState, TimerPhase } from 'ontime-types';

vi.mock('../../../stores/EventStore.js', () => ({
  eventStore: { set: vi.fn() },
}));

const idle: CountdownSourceState = {
  enabled: true,
  connected: true,
  cueName: '',
  cueNumber: '',
  duration: 0,
  elapsed: 0,
  remaining: 0,
  isPaused: false,
  phase: TimerPhase.None,
};

const running = (cueName: string, remaining: number): CountdownSourceState => ({
  ...idle,
  cueName,
  duration: 300000,
  elapsed: 300000 - remaining,
  remaining,
  phase: TimerPhase.Default,
});

describe('CountdownService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('shows the selected source while Ableton has nothing running', async () => {
    const { countdownService } = await import('../CountdownService.js');
    countdownService.setSource('mitti');
    countdownService.update('mitti', running('Bumper', 60000));
    countdownService.update('ableton', idle);

    expect(countdownService.getState()).toMatchObject({ source: 'mitti', cueName: 'Bumper' });
  });

  it('lets an Ableton timer take over, and hands back when it is done', async () => {
    const { countdownService } = await import('../CountdownService.js');
    const { eventStore } = await import('../../../stores/EventStore.js');
    countdownService.setSource('mitti');
    countdownService.update('mitti', running('Bumper', 60000));

    countdownService.update('ableton', running('Way Maker', 45000));
    expect(countdownService.getState()).toMatchObject({ source: 'ableton', cueName: 'Way Maker', remaining: 45000 });
    expect(eventStore.set).toHaveBeenLastCalledWith('countdown', expect.objectContaining({ source: 'ableton' }));

    // while Ableton is on screen, Mitti's updates are not broadcast over it
    vi.mocked(eventStore.set).mockClear();
    countdownService.update('mitti', running('Bumper', 59000));
    expect(eventStore.set).not.toHaveBeenCalled();

    countdownService.update('ableton', idle);
    expect(countdownService.getState()).toMatchObject({ source: 'mitti', cueName: 'Bumper', remaining: 59000 });
    expect(eventStore.set).toHaveBeenLastCalledWith('countdown', expect.objectContaining({ source: 'mitti' }));
  });

  it('does not let a disconnected Ableton hold the countdown', async () => {
    const { countdownService } = await import('../CountdownService.js');
    countdownService.setSource('qlab');
    countdownService.update('ableton', { ...running('Way Maker', 45000), connected: false });
    expect(countdownService.getState().source).toBe('qlab');
  });
});

import type { CountdownProvider } from 'ontime-types';

/** How we name each playback system in the UI */
export const countdownSourceLabels: Record<CountdownProvider, string> = {
  qlab: 'QLab',
  mitti: 'Mitti',
  ableton: 'Ableton',
  timecode: 'Timecode',
};

import type { CountdownSource } from './Countdown.type.js';

export type ViewSettings = {
  countdownSource: CountdownSource;
  dangerColor: string;
  endMessage: string;
  freezeEnd: boolean;
  normalColor: string;
  overrideStyles: boolean;
  warningColor: string;
};

import type { CountdownState } from '../core/Countdown.type.js';
import type { MittiState } from '../core/Mitti.type.js';
import type { OntimeEvent } from '../core/OntimeEvent.type.js';
import type { QlabState } from '../core/Qlab.type.js';
import type { SimpleTimerState } from './AuxTimer.type.js';
import type { CurrentBlockState } from './CurrentBlockState.type.js';
import type { MessageState } from './MessageControl.type.js';
import type { RundownSourcesState } from './RundownSources.type.js';
import type { Runtime } from './Runtime.type.js';
import type { TimerState } from './TimerState.type.js';

export type RuntimeStore = {
  // timer data
  clock: number;
  timer: TimerState;
  onAir: boolean;

  // messages service
  message: MessageState;

  // rundown data
  runtime: Runtime;
  currentBlock: CurrentBlockState;
  eventNow: OntimeEvent | null;
  publicEventNow: OntimeEvent | null;
  eventNext: OntimeEvent | null;
  publicEventNext: OntimeEvent | null;

  // extra timers
  auxtimer1: SimpleTimerState;

  // external integrations
  qlab: QlabState;
  mitti: MittiState;

  // the countdown views read this: whichever integration is the selected source
  countdown: CountdownState;

  // recallable rundown sources
  rundownSources: RundownSourcesState;

  // utils
  ping: number;
};

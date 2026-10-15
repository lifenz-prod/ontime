import { TimerPhase } from 'ontime-types';
import { millisToString, removeLeadingZero } from 'ontime-utils';

import { useWindowTitle } from '../../common/hooks/useWindowTitle';
import { useRuntimeStore } from '../../common/stores/runtime';
import { countdownSourceLabels } from '../../common/utils/countdownSource';

import './QlabTimer.scss';

function getPhaseClass(phase: TimerPhase): string {
  switch (phase) {
    case TimerPhase.Warning:
      return 'countdown--warning';
    case TimerPhase.Danger:
      return 'countdown--danger';
    case TimerPhase.Overtime:
      return 'countdown--overtime';
    default:
      return 'countdown--default';
  }
}

function getProgressPhaseClass(phase: TimerPhase): string {
  switch (phase) {
    case TimerPhase.Warning:
      return 'progress-fill--warning';
    case TimerPhase.Danger:
      return 'progress-fill--danger';
    case TimerPhase.Overtime:
      return 'progress-fill--overtime';
    default:
      return 'progress-fill--default';
  }
}

export default function QlabTimer() {
  const countdown = useRuntimeStore((state) => state.countdown);
  const sourceLabel = countdownSourceLabels[countdown.source];

  useWindowTitle(`${sourceLabel} Timer`);

  if (!countdown.enabled) {
    return (
      <div className='qlab-timer'>
        <div className='idle'>{sourceLabel} integration disabled</div>
      </div>
    );
  }

  if (!countdown.connected) {
    return (
      <div className='qlab-timer'>
        <div className='status status--disconnected'>Disconnected</div>
        <div className='idle'>Waiting for {sourceLabel} connection...</div>
      </div>
    );
  }

  if (!countdown.cueName && !countdown.cueNumber) {
    return (
      <div className='qlab-timer'>
        <div className='status status--connected'>Connected</div>
        <div className='idle'>No running cues</div>
      </div>
    );
  }

  const display = removeLeadingZero(millisToString(countdown.remaining));
  const progress = countdown.duration > 0 ? ((countdown.duration - countdown.remaining) / countdown.duration) * 100 : 0;
  const phaseClass = getPhaseClass(countdown.phase);
  const progressPhaseClass = getProgressPhaseClass(countdown.phase);

  return (
    <div className='qlab-timer'>
      <div className='status status--connected'>{sourceLabel} Connected</div>

      <div className='cue-info'>
        {countdown.cueNumber && <div className='cue-number'>Cue {countdown.cueNumber}</div>}
        {countdown.cueName && <div className='cue-name'>{countdown.cueName}</div>}
      </div>

      <div className={`countdown ${phaseClass} ${countdown.isPaused ? 'countdown--paused' : ''}`}>
        {display}
      </div>

      <div className='progress-bar'>
        <div
          className={`progress-fill ${progressPhaseClass}`}
          style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
        />
      </div>

      {countdown.isPaused && <div className='pause-indicator'>Paused</div>}
    </div>
  );
}

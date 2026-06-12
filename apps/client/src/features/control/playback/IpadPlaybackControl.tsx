import { Playback, TimerPhase } from 'ontime-types';

import { usePlaybackControl, useTimer } from '../../../common/hooks/useSocket';

import AddTime from './add-time/AddTime';
import { AuxTimer } from './aux-timer/AuxTimer';
import GlobalOffset from './global-offset/GlobalOffset';
import IpadPlaybackButtons from './playback-buttons/IpadPlaybackButtons';
import IpadTimerDisplay from './timer-display/IpadTimerDisplay';

import style from './PlaybackControl.module.scss';
import ipadStyle from './IpadPlaybackControl.module.scss';
import timerStyle from './playback-timer/PlaybackTimer.module.scss';

function IpadPlaybackTimer({ playback }: { playback: Playback }) {
  const timer = useTimer();
  const isOvertime = timer.phase === TimerPhase.Overtime;
  const isWaiting = timer.phase === TimerPhase.Pending;

  return (
    <div className={timerStyle.timeContainer}>
      <div className={timerStyle.indicators}>
        <div className={timerStyle.indicatorNegative} data-active={isOvertime} />
      </div>
      <IpadTimerDisplay time={isWaiting ? timer.secondaryTimer : timer.current} />
      <AddTime playback={playback} bigger />
    </div>
  );
}

export default function IpadPlaybackControl() {
  const data = usePlaybackControl();

  return (
    <div className={style.mainContainer}>
      <IpadPlaybackTimer playback={data.playback as Playback} />
      <IpadPlaybackButtons
        playback={data.playback as Playback}
        numEvents={data.numEvents}
        selectedEventIndex={data.selectedEventIndex}
        timerPhase={data.timerPhase}
      />
      <AuxTimer controlsClassName={ipadStyle.tallAuxControls} mmSs />
      <GlobalOffset />
    </div>
  );
}

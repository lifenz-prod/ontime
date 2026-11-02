import { useMemo } from 'react';
import { IoStop } from 'react-icons/io5';
import { Playback, TimerPhase } from 'ontime-types';
import { validatePlayback } from 'ontime-utils';

import { setPlayback } from '../../../../common/hooks/useSocket';
import TapButton from '../tap-button/TapButton';

import style from './IpadPlaybackButtons.module.scss';

interface IpadPlaybackButtonsProps {
  playback: Playback;
  numEvents: number;
  selectedEventIndex: number | null;
  timerPhase: TimerPhase;
}

export default function IpadPlaybackButtons(props: IpadPlaybackButtonsProps) {
  const { playback, numEvents, selectedEventIndex, timerPhase } = props;

  const isArmed = playback === Playback.Armed;
  const isRolling = playback === Playback.Roll;
  const isFirst = selectedEventIndex === 0;
  const isLast = selectedEventIndex === numEvents - 1;
  const noEvents = numEvents === 0;

  const disableGo = isRolling || noEvents;
  const disablePrev = isRolling || noEvents || isFirst || selectedEventIndex === null;

  const playbackCan = validatePlayback(playback, timerPhase);
  const disableStop = !playbackCan.stop;

  const [goModeAction, goModeText] = useMemo(() => {
    if (isArmed) {
      return [setPlayback.start, 'Start'];
    } else if (isLast) {
      return [setPlayback.stop, 'Finish'];
    } else if (selectedEventIndex === null) {
      return [setPlayback.startNext, 'Start'];
    }
    return [setPlayback.startNext, 'Next'];
  }, [isArmed, isLast, selectedEventIndex]);

  return (
    <div className={style.buttonContainer}>
      <TapButton disabled={disableGo} onClick={goModeAction} aspect='fill' className={style.go}>
        {goModeText}
      </TapButton>
      <div className={style.controls}>
        <TapButton onClick={setPlayback.startPrevious} disabled={disablePrev} className={style.prev}>
          PREV
        </TapButton>
        <TapButton onClick={setPlayback.stop} disabled={disableStop} theme={Playback.Stop}>
          <IoStop />
        </TapButton>
      </div>
    </div>
  );
}

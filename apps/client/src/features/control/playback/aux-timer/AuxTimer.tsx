import { IoArrowDown, IoArrowUp, IoPause, IoPlay, IoStop } from 'react-icons/io5';
import { Playback, SimpleDirection, SimplePlayback } from 'ontime-types';
import { MILLIS_PER_SECOND, parseUserTime } from 'ontime-utils';

import TimeInput from '../../../../common/components/input/time-input/TimeInput';
import { setAuxTimer, useAuxTimerControl, useAuxTimerTime } from '../../../../common/hooks/useSocket';
import { cx } from '../../../../common/utils/styleUtils';
import TapButton from '../tap-button/TapButton';

import style from './AuxTimer.module.scss';

// Display milliseconds as mm:ss without the hours field
function formatMmSs(millis: number): string {
  const totalSeconds = Math.floor(Math.abs(millis) / MILLIS_PER_SECOND);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function AuxTimer({ controlsClassName, mmSs }: { controlsClassName?: string; mmSs?: boolean }) {
  const { playback, direction } = useAuxTimerControl();

  const { start, pause, stop, setDirection } = setAuxTimer;

  const toggleDirection = () => {
    const newDirection = direction === SimpleDirection.CountDown ? SimpleDirection.CountUp : SimpleDirection.CountDown;
    setDirection(newDirection);
  };

  const userCan = {
    start: playback !== SimplePlayback.Start,
    pause: playback === SimplePlayback.Start,
    stop: playback !== SimplePlayback.Stop,
  };

  return (
    <label className={style.label}>
      Auxiliary Timer
      <div className={cx([style.controls, controlsClassName])}>
        <AuxTimerInput mmSs={mmSs} />
        <TapButton onClick={toggleDirection} aspect='tight'>
          {direction === SimpleDirection.CountDown && <IoArrowDown data-testid='aux-timer-direction' />}
          {direction === SimpleDirection.CountUp && <IoArrowUp data-testid='aux-timer-direction' />}
        </TapButton>

        <TapButton
          onClick={start}
          theme={Playback.Play}
          active={playback === SimplePlayback.Start}
          disabled={!userCan.start}
        >
          <IoPlay data-testid='aux-timer-start' />
        </TapButton>
        <TapButton
          onClick={pause}
          theme={Playback.Pause}
          active={playback === SimplePlayback.Pause}
          disabled={!userCan.pause}
        >
          <IoPause data-testid='aux-timer-pause' />
        </TapButton>
        <TapButton onClick={stop} theme={Playback.Stop} disabled={!userCan.stop}>
          <IoStop data-testid='aux-timer-stop' />
        </TapButton>
      </div>
    </label>
  );
}

function AuxTimerInput({ mmSs }: { mmSs?: boolean }) {
  const time = useAuxTimerTime();
  const { setDuration } = setAuxTimer;

  const handleTimeUpdate = (_field: string, value: string) => {
    let newTime: number;
    // In mm:ss mode, a two-section entry (e.g. "1:30") is minutes:seconds;
    // otherwise fall back to the shared parser (handles "5m", "30s", plain values).
    const sections = value.split(/[\s,:.]+/);
    if (mmSs && sections.length >= 2) {
      const mins = Number(sections[0]) || 0;
      const secs = Number(sections[1]) || 0;
      newTime = (Math.abs(mins) * 60 + Math.abs(secs)) * MILLIS_PER_SECOND;
    } else {
      newTime = parseUserTime(value);
    }
    setDuration(newTime / 1000); // frontend api is seconds based
  };

  return (
    <TimeInput<'auxTimer'>
      submitHandler={handleTimeUpdate}
      name='auxTimer'
      time={time}
      placeholder='Aux Timer 1'
      formatValue={mmSs ? formatMmSs : undefined}
    />
  );
}

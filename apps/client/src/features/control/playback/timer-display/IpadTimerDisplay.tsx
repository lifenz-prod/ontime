import { MaybeNumber } from 'ontime-types';

import { cx, timerPlaceholder } from '../../../../common/utils/styleUtils';

import style from './TimerDisplay.module.scss';

function millisToMmSs(ms: MaybeNumber): string {
  if (ms == null) return timerPlaceholder;
  const isNegative = ms < 0;
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60);
  const sign = isNegative ? '-' : '';
  return `${sign}${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

interface IpadTimerDisplayProps {
  time: MaybeNumber;
}

export default function IpadTimerDisplay({ time }: IpadTimerDisplayProps) {
  const isNegative = (time ?? 0) < 0;
  const display = millisToMmSs(time);
  const classes = cx([style.timer, isNegative ? style.finished : null, time === null && style.muted]);

  return <div className={classes}>{display}</div>;
}

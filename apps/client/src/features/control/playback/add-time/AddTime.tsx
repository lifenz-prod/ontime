import { IoAdd, IoRemove } from 'react-icons/io5';
import { Tooltip } from '@chakra-ui/react';
import { useLocalStorage } from '@mantine/hooks';
import { Playback } from 'ontime-types';
import { MILLIS_PER_HOUR, MILLIS_PER_SECOND, parseUserTime } from 'ontime-utils';

import TimeInput from '../../../../common/components/input/time-input/TimeInput';
import { setPlayback } from '../../../../common/hooks/useSocket';
import { cx } from '../../../../common/utils/styleUtils';
import { tooltipDelayMid } from '../../../../ontimeConfig';
import TapButton from '../tap-button/TapButton';

import style from './AddTime.module.scss';

interface AddTimeProps {
  playback: Playback;
  bigger?: boolean;
  label?: string;
}

export default function AddTime(props: AddTimeProps) {
  const { playback, bigger, label } = props;
  const [time, setTime] = useLocalStorage({ key: 'add-time-v2', defaultValue: 60_000 }); // 1 minute

  const handleTimeChange = (_field: string, value: string) => {
    // Add time is displayed and entered as mm:ss. A two-section entry (e.g. "1:30")
    // is treated as minutes:seconds, otherwise we fall back to the shared parser
    // (handles "5m", "30s", plain minutes).
    const sections = value.split(/[\s,:.]+/);
    let newTime: number;
    if (sections.length >= 2) {
      const mins = Number(sections[0]) || 0;
      const secs = Number(sections[1]) || 0;
      newTime = (Math.abs(mins) * 60 + Math.abs(secs)) * MILLIS_PER_SECOND;
    } else {
      newTime = parseUserTime(value);
    }
    // cap add time to 1 hour
    setTime(Math.min(newTime, MILLIS_PER_HOUR));
  };

  const handleAddTime = (direction: 'add' | 'remove') => {
    // API expects input in seconds
    if (direction === 'add') {
      setPlayback.addTime(time / MILLIS_PER_SECOND);
    } else {
      setPlayback.addTime((-1 * time) / MILLIS_PER_SECOND);
    }
  };

  const canAddTime = playback === Playback.Play || playback === Playback.Pause;
  const doDisableButtons = !canAddTime || time === 0;

  // Add time is capped at 1 hour, so display as mm:ss without the hours field
  const formatMmSs = (millis: number) => {
    const totalSeconds = Math.floor(Math.abs(millis) / MILLIS_PER_SECOND);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className={style.addTime}>
      {label && <span className={style.label}>{label}</span>}
      <TimeInput
        name='addtime'
        submitHandler={handleTimeChange}
        time={time}
        placeholder='Add time'
        className={bigger ? style.biggerInput : undefined}
        formatValue={formatMmSs}
      />
      <div className={style.addButtons}>
        <Tooltip label='Remove time' openDelay={tooltipDelayMid} shouldWrapChildren>
          <TapButton
            onClick={() => handleAddTime('remove')}
            disabled={doDisableButtons}
            className={cx([style.tallButtons, bigger && style.biggerButton])}
          >
            <IoRemove />
          </TapButton>
        </Tooltip>
        <Tooltip label='Add time' openDelay={tooltipDelayMid} shouldWrapChildren>
          <TapButton
            onClick={() => handleAddTime('add')}
            disabled={doDisableButtons}
            className={cx([style.tallButtons, bigger && style.biggerButton])}
          >
            <IoAdd />
          </TapButton>
        </Tooltip>
      </div>
    </div>
  );
}

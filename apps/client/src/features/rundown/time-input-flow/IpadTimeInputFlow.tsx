import { memo } from 'react';
import { IoAlertCircleOutline, IoLink, IoLockClosed, IoLockOpenOutline, IoUnlink } from 'react-icons/io5';
import { InputRightElement, Tooltip } from '@chakra-ui/react';
import { MaybeString, TimeField, TimeStrategy } from 'ontime-types';
import { dayInMs } from 'ontime-utils';

import TimeInputWithButton from '../../../common/components/input/time-input/TimeInputWithButton';
import { useEventAction } from '../../../common/hooks/useEventAction';
import { cx } from '../../../common/utils/styleUtils';
import { tooltipDelayFast, tooltipDelayMid } from '../../../ontimeConfig';
import * as Editor from '../../editors/editor-utils/EditorUtils';

import style from './TimeInputFlow.module.scss';

interface IpadTimeInputFlowProps {
  eventId: string;
  countToEnd: boolean;
  timeStart: number;
  timeEnd: number;
  duration: number;
  timeStrategy: TimeStrategy;
  linkStart: MaybeString;
  delay: number;
  showLabels?: boolean;
}

function IpadTimeInputFlow(props: IpadTimeInputFlowProps) {
  const { eventId, countToEnd, timeStart, duration, timeStrategy, linkStart, delay, showLabels } = props;
  const { updateEvent, updateTimer } = useEventAction();
  const displayStart = timeStart + delay;

  const handleSubmit = (field: TimeField, value: string) => {
    updateTimer(eventId, field, value);
  };

  const handleChangeStrategy = (newStrategy: TimeStrategy) => {
    updateEvent({ id: eventId, timeStrategy: newStrategy });
  };

  const handleLink = (doLink: boolean) => {
    updateEvent({ id: eventId, linkStart: doLink ? 'true' : null });
  };

  const warnings = [];
  if (timeStart + duration > dayInMs) {
    warnings.push('Over midnight');
  }

  const hasDelay = delay !== 0;
  const isLockedDuration = timeStrategy === TimeStrategy.LockDuration;
  const activeStart = cx([style.timeAction, linkStart ? style.active : null]);
  const activeDuration = cx([style.timeAction, isLockedDuration ? style.active : null]);

  return (
    <>
      <div>
        {showLabels && <Editor.Label className={style.sectionTitle}>Start time</Editor.Label>}
        <TimeInputWithButton<TimeField>
          name='timeStart'
          submitHandler={handleSubmit}
          time={timeStart}
          displayTime={displayStart}
          hasDelay={hasDelay}
          placeholder='Start'
        >
          <Tooltip label='Link start to previous end' openDelay={tooltipDelayMid}>
            <InputRightElement className={activeStart} onClick={() => handleLink(!linkStart)}>
              <span className={style.timeLabel}>S</span>
              <span className={style.fourtyfive}>{linkStart ? <IoLink /> : <IoUnlink />}</span>
            </InputRightElement>
          </Tooltip>
        </TimeInputWithButton>
      </div>

      <div>
        {showLabels && <Editor.Label>Duration</Editor.Label>}
        <TimeInputWithButton<TimeField>
          name='duration'
          submitHandler={handleSubmit}
          time={duration}
          placeholder='Duration'
        >
          <Tooltip label='Lock duration' openDelay={tooltipDelayMid}>
            <InputRightElement
              className={activeDuration}
              onClick={() => handleChangeStrategy(TimeStrategy.LockDuration)}
              data-testid='lock__duration'
            >
              <span className={style.timeLabel}>D</span>
              {isLockedDuration ? <IoLockClosed /> : <IoLockOpenOutline />}
            </InputRightElement>
          </Tooltip>
        </TimeInputWithButton>
      </div>

      {warnings.length > 0 && (
        <div className={style.timerNote} data-testid='event-warning'>
          <Tooltip label={warnings.join(' - ')} openDelay={tooltipDelayFast} variant='ontime-ondark' shouldWrapChildren>
            <IoAlertCircleOutline />
          </Tooltip>
        </div>
      )}
    </>
  );
}

export default memo(IpadTimeInputFlow);

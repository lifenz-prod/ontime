import { memo } from 'react';
import { Select, Switch } from '@chakra-ui/react';
import { EndAction, MaybeString, TimeStrategy } from 'ontime-types';
import { millisToString } from 'ontime-utils';

import { useEventAction } from '../../../../common/hooks/useEventAction';
import { millisToDelayString } from '../../../../common/utils/dateConfig';
import * as Editor from '../../../editors/editor-utils/EditorUtils';
import IpadTimeInputFlow from '../../time-input-flow/IpadTimeInputFlow';

import style from '../EventEditor.module.scss';

interface IpadEventEditorTimesProps {
  eventId: string;
  timeStart: number;
  timeEnd: number;
  duration: number;
  timeStrategy: TimeStrategy;
  linkStart: MaybeString;
  countToEnd: boolean;
  showAsAuxTimer: boolean;
  hideTimer: boolean;
  delay: number;
  endAction: EndAction;
}

type HandledActions = 'countToEnd' | 'showAsAuxTimer' | 'hideTimer' | 'endAction';

function IpadEventEditorTimes(props: IpadEventEditorTimesProps) {
  const { eventId, timeStart, timeEnd, duration, timeStrategy, linkStart, countToEnd, showAsAuxTimer, hideTimer, delay, endAction } = props;
  const { updateEvent } = useEventAction();

  const handleSubmit = (field: HandledActions, value: string | boolean) => {
    if (field === 'countToEnd') {
      updateEvent({ id: eventId, countToEnd: !(value as boolean) });
      return;
    }
    if (field === 'showAsAuxTimer') {
      const newValue = !(value as boolean);
      updateEvent({ id: eventId, showAsAuxTimer: newValue, ...(newValue && { hideTimer: false }) });
      return;
    }
    if (field === 'hideTimer') {
      const newValue = !(value as boolean);
      updateEvent({ id: eventId, hideTimer: newValue, ...(newValue && { showAsAuxTimer: false }) });
      return;
    }
    if (field === 'endAction') {
      updateEvent({ id: eventId, endAction: value as EndAction });
      return;
    }
  };

  const hasDelay = delay !== 0;
  const delayLabel = hasDelay
    ? `Event is ${millisToDelayString(delay, 'expanded')}. New schedule ${millisToString(timeStart + delay)}`
    : '';

  return (
    <>
      <div className={style.column}>
        <Editor.Title>Event schedule</Editor.Title>
        <div>
          <div className={style.inline}>
            <IpadTimeInputFlow
              eventId={eventId}
              timeStart={timeStart}
              timeEnd={timeEnd}
              duration={duration}
              timeStrategy={timeStrategy}
              linkStart={linkStart}
              delay={delay}
              countToEnd={countToEnd}
              showLabels
            />
          </div>
          <div className={style.delayLabel}>{delayLabel}</div>
        </div>
      </div>

      <div className={style.column}>
        <Editor.Title>Event Behaviour</Editor.Title>
        <div className={style.splitTwo}>
          <div>
            <Editor.Label htmlFor='endAction'>End Action</Editor.Label>
            <Select
              id='endAction'
              size='md'
              name='endAction'
              value={endAction}
              onChange={(event) => handleSubmit('endAction', event.target.value)}
              variant='ontime'
            >
              <option value={EndAction.None}>None</option>
              <option value={EndAction.Stop}>Stop rundown</option>
              <option value={EndAction.LoadNext}>Load next event</option>
              <option value={EndAction.PlayNext}>Play next event</option>
            </Select>
          </div>
          <div>
            <Editor.Label htmlFor='countToEnd'>Countdown to Time</Editor.Label>
            <Editor.Label className={style.switchLabel}>
              <Switch
                id='countToEnd'
                size='lg'
                isChecked={countToEnd}
                onChange={() => handleSubmit('countToEnd', countToEnd)}
                variant='ontime'
              />
              {countToEnd ? 'On' : 'Off'}
            </Editor.Label>
          </div>
          <div>
            <Editor.Label htmlFor='showAsAuxTimer'>Show as Aux Timer</Editor.Label>
            <Editor.Label className={style.switchLabel}>
              <Switch
                id='showAsAuxTimer'
                size='lg'
                isChecked={showAsAuxTimer}
                onChange={() => handleSubmit('showAsAuxTimer', showAsAuxTimer)}
                variant='ontime'
              />
              {showAsAuxTimer ? 'On' : 'Off'}
            </Editor.Label>
          </div>
          <div>
            <Editor.Label htmlFor='hideTimer'>Hide Timer</Editor.Label>
            <Editor.Label className={style.switchLabel}>
              <Switch
                id='hideTimer'
                size='lg'
                isChecked={hideTimer}
                onChange={() => handleSubmit('hideTimer', hideTimer)}
                variant='ontime'
              />
              {hideTimer ? 'Hide' : 'Show'}
            </Editor.Label>
          </div>
        </div>
      </div>
    </>
  );
}

export default memo(IpadEventEditorTimes);

import { memo, useEffect, useState } from 'react';
import { isOntimeEvent, OntimeEvent } from 'ontime-types';

import useRundown from '../../../common/hooks-query/useRundown';
import { useEventSelection } from '../useEventSelection';

import EventEditorEmpty from './EventEditorEmpty';
import IpadEventEditor from './IpadEventEditor';

import style from './EventEditor.module.scss';

function IpadRundownEventEditor() {
  const selectedEvents = useEventSelection((state) => state.selectedEvents);
  const { data } = useRundown();
  const { order, rundown } = data;

  const [event, setEvent] = useState<OntimeEvent | null>(null);

  useEffect(() => {
    if (order.length === 0) {
      setEvent(null);
      return;
    }

    const selectedEventId = order.find((eventId) => selectedEvents.has(eventId));
    if (!selectedEventId) {
      setEvent(null);
      return;
    }
    const entry = rundown[selectedEventId];

    if (entry && isOntimeEvent(entry)) {
      setEvent(entry);
    } else {
      setEvent(null);
    }
  }, [order, rundown, selectedEvents]);

  if (!event) {
    return <EventEditorEmpty />;
  }

  return (
    <div className={style.eventEditor} data-testid='editor-container'>
      <IpadEventEditor event={event} />
    </div>
  );
}

export default memo(IpadRundownEventEditor);

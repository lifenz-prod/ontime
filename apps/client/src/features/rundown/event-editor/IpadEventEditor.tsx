import { OntimeEvent } from 'ontime-types';

import EventEditorEmpty from './EventEditorEmpty';

import style from './EventEditor.module.scss';
import IpadEventEditorTimes from './composite/IpadEventEditorTimes';

interface IpadEventEditorProps {
  event: OntimeEvent;
}

export default function IpadEventEditor({ event }: IpadEventEditorProps) {
  if (!event) {
    return <EventEditorEmpty />;
  }

  return (
    <div className={style.content}>
      <IpadEventEditorTimes
        key={`${event.id}-times`}
        eventId={event.id}
        timeStart={event.timeStart}
        timeEnd={event.timeEnd}
        duration={event.duration}
        timeStrategy={event.timeStrategy}
        linkStart={event.linkStart}
        countToEnd={event.countToEnd}
        showAsAuxTimer={event.showAsAuxTimer}
        hideTimer={event.hideTimer}
        delay={event.delay ?? 0}
        endAction={event.endAction}
      />
    </div>
  );
}

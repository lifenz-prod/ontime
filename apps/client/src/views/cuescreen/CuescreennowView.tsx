import { useEffect, useRef } from 'react';
import { OntimeEvent, SimpleTimerState } from 'ontime-types';

import { useWindowTitle } from '../../common/hooks/useWindowTitle';
import { ViewExtendedTimer } from '../../common/models/TimeManager.type';
import { useRuntimeStore } from '../../common/stores/runtime';
import { formatTime } from '../../common/utils/time';

import './CuescreennowView.scss';

interface CuescreennowViewProps {
  time: ViewExtendedTimer;
  auxTimer: SimpleTimerState;
  eventNow: OntimeEvent | null;
  eventNext: OntimeEvent | null;
}

/** Formats milliseconds as mm:ss with no hour component (e.g. 90 minutes → 90:00). */
function formatMs(ms: number | null): string {
  if (ms === null) return '0:00';
  const totalSeconds = ms < 0 ? Math.ceil(Math.abs(ms) / 1000) : Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const sign = ms < 0 ? '-' : '';
  return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function useAutoScaleTitle(
  containerRef: React.RefObject<HTMLDivElement | null>,
  titleRef: React.RefObject<HTMLSpanElement | null>,
  deps: unknown[],
) {
  useEffect(() => {
    function resize() {
      const titleEl = titleRef.current;
      const containerEl = containerRef.current;
      if (!titleEl || !containerEl) return;

      const maxFontSize = 90;
      const minFontSize = 24;
      let fontSize = maxFontSize;
      titleEl.style.fontSize = `${fontSize}px`;

      while (titleEl.scrollWidth > titleEl.clientWidth && fontSize > minFontSize) {
        fontSize -= 1;
        titleEl.style.fontSize = `${fontSize}px`;
      }
    }

    resize();
    const observer = new ResizeObserver(resize);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export default function CuescreennowView({ time, auxTimer, eventNow, eventNext }: CuescreennowViewProps) {
  useWindowTitle('Cuescreen NOW');

  const qlab = useRuntimeStore((state) => state.qlab);
  const externalMessage = useRuntimeStore((state) => state.message.external);
  const showExternal = useRuntimeStore((state) => state.message.timer.secondarySource === 'external');
  const overrideMessage = showExternal && externalMessage ? externalMessage : null;

  useEffect(() => {
    document.body.setAttribute('data-view', 'cuescreennow');
    return () => document.body.removeAttribute('data-view');
  }, []);

  const isAltarCall = eventNow?.showAsAuxTimer === true;
  const isHideTimer = eventNow?.hideTimer === true;
  const isOvertime = (time.current ?? 0) < 0;
  const timerColor = isOvertime ? 'red' : 'limegreen';

  const mainTimerDisplay = isAltarCall || isHideTimer ? '0:00' : formatMs(time.current);
  const auxTimerColor = isOvertime ? 'red' : 'orange';
  const regularAuxColor = (auxTimer.current ?? 0) < 0 ? 'red' : 'orange';

  const clock = formatTime(time.clock, { format12: 'h:mm a', format24: 'H:mm' });

  const eventContainerRef = useRef<HTMLDivElement>(null);
  const nowTitleRef = useRef<HTMLSpanElement>(null);
  const nextTitleRef = useRef<HTMLSpanElement>(null);

  useAutoScaleTitle(eventContainerRef, nowTitleRef, [eventNow?.title, overrideMessage]);
  useAutoScaleTitle(eventContainerRef, nextTitleRef, [eventNext?.title, overrideMessage]);

  return (
    <div className='cuescreennow'>
      <div className='cuescreennow__timer-container'>
        <div className='cuescreennow__timer-row'>
          <div className='cuescreennow__clock'>{clock}</div>
          <div className='cuescreennow__main-timer' style={{ color: timerColor }}>
            {mainTimerDisplay}
          </div>
          {isAltarCall ? (
            <div className='cuescreennow__aux-timer' style={{ color: auxTimerColor }}>
              {formatMs(time.current)}
            </div>
          ) : (
            <div className='cuescreennow__aux-timer' style={{ color: regularAuxColor }}>
              {formatMs(auxTimer.current)}
            </div>
          )}
        </div>
      </div>

      <div className='cuescreennow__event-container' ref={eventContainerRef}>
        <div className='cuescreennow__title-card'>
          {overrideMessage ? (
            <>
              <span className='cuescreennow__title-card__label'>MSG:&nbsp;</span>
              <span className='cuescreennow__title-card__title' style={{ color: timerColor }} ref={nowTitleRef}>
                {overrideMessage}
              </span>
            </>
          ) : (
            <>
              <span className='cuescreennow__title-card__label'>NOW:&nbsp;</span>
              <span className='cuescreennow__title-card__title' style={{ color: timerColor }} ref={nowTitleRef}>
                {eventNow?.title ?? ''}
              </span>
            </>
          )}
        </div>
        <div className='cuescreennow__title-card cuescreennow__title-card--next'>
          <span className='cuescreennow__title-card__label cuescreennow__title-card__label--next'>NEXT:&nbsp;</span>
          <span className='cuescreennow__title-card__title cuescreennow__title-card__title--next' ref={nextTitleRef}>
            {eventNext?.title ?? ''}
          </span>
        </div>
      </div>
      {qlab.enabled && <div className='cuescreennow__qlab-timer'>{formatMs(qlab.remaining)}</div>}
    </div>
  );
}

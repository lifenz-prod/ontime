import { useEffect, useRef } from 'react';

import { useWindowTitle } from '../../common/hooks/useWindowTitle';
import { useRuntimeStore } from '../../common/stores/runtime';

import './QlabCountdownView.scss';

/** Formats milliseconds as mm:ss with no hour component (e.g. 90 minutes → 90:00). */
function formatMs(ms: number | null): string {
  if (ms === null) return '0:00';
  const totalSeconds = ms < 0 ? Math.ceil(Math.abs(ms) / 1000) : Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const sign = ms < 0 ? '-' : '';
  return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export default function QlabCountdownView() {
  useWindowTitle('QLab Countdown');

  const qlab = useRuntimeStore((state) => state.qlab);
  const display = formatMs(qlab.remaining);

  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.body.setAttribute('data-view', 'qlabcountdown');
    return () => document.body.removeAttribute('data-view');
  }, []);

  useEffect(() => {
    function fitText() {
      const container = containerRef.current;
      const timer = timerRef.current;
      if (!container || !timer) return;

      // Binary search for the largest font size that fits both width and height
      let lo = 10;
      let hi = 3000;
      while (lo < hi - 1) {
        const mid = Math.floor((lo + hi) / 2);
        timer.style.fontSize = `${mid}px`;
        if (timer.scrollWidth <= container.clientWidth && timer.scrollHeight <= container.clientHeight) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      timer.style.fontSize = `${lo}px`;
    }

    fitText();
    const observer = new ResizeObserver(fitText);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [display]);

  return (
    <div className='qlabcountdown' ref={containerRef}>
      <div className='qlabcountdown__timer' ref={timerRef}>{display}</div>
    </div>
  );
}

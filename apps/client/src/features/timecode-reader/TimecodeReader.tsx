import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TimecodeFrame } from 'ontime-types';
import { formatTimecode, parseTimecode, timecodeToMs } from 'ontime-utils';

import { useWindowTitle } from '../../common/hooks/useWindowTitle';
import useTimecodeSettings from '../../common/hooks-query/useTimecodeSettings';

import { useTimecodeReader } from './useTimecodeReader';

import style from './TimecodeReader.module.scss';

/**
 * Reads incoming timecode and sends it to the server.
 *
 * The desktop app opens this in a hidden window, so on the machine running Ontime it just works.
 * It can also be opened in a browser on any machine that has the timecode on an input.
 * Add ?test-signal=01:00:00:00&fps=25 to feed it generated timecode instead of recording.
 */
export default function TimecodeReader() {
  useWindowTitle('Timecode Reader');
  const [searchParams] = useSearchParams();
  const { data: settings } = useTimecodeSettings(2000);

  const testSignal = useMemo((): TimecodeFrame | null => {
    const start = searchParams.get('test-signal');
    if (start === null) return null;
    const fps = [24, 25, 30].includes(Number(searchParams.get('fps'))) ? Number(searchParams.get('fps')) : 25;
    const ms = parseTimecode(start || '01:00:00:00', fps) ?? 3600000;
    const totalSeconds = Math.floor(ms / 1000);
    return {
      hours: Math.floor(totalSeconds / 3600),
      minutes: Math.floor(totalSeconds / 60) % 60,
      seconds: totalSeconds % 60,
      frames: Math.round(((ms % 1000) * fps) / 1000),
      dropFrame: false,
      fps,
    };
  }, [searchParams]);

  const { status, lastFrame, needsGesture, start } = useTimecodeReader({
    enabled: settings.enabled,
    deviceLabel: settings.deviceLabel,
    channel: settings.channel,
    testSignal,
  });

  const timecode = lastFrame ? formatTimecode(timecodeToMs(lastFrame), lastFrame.fps) : '--:--:--:--';

  return (
    <div className={style.reader}>
      <div className={style.title}>Ontime timecode reader</div>
      <div className={style.timecode} data-testid='reader-timecode'>
        {timecode}
      </div>
      <div className={style.meter}>
        <div className={style.meterFill} style={{ width: `${Math.round(status.level * 100)}%` }} />
      </div>
      <div className={style.detail}>
        {status.deviceLabel || 'No input'} · channel {status.channel}
        {lastFrame && ` · ${lastFrame.fps}${lastFrame.dropFrame ? ' drop frame' : ''} fps`}
      </div>
      {status.error && <div className={style.error}>{status.error}</div>}
      {needsGesture && (
        <button type='button' className={style.start} onClick={start}>
          Click to start reading
        </button>
      )}
    </div>
  );
}

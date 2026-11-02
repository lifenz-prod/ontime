import { ComponentProps, useLayoutEffect, useRef, useState } from 'react';

import { useWindowTitle } from '../../common/hooks/useWindowTitle';

import CuescreenView from './CuescreenView';

import './MobileCuescreenView.scss';

// The cue screen is laid out at a fixed 1920x1080
const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

/**
 * The real cue screen, scaled as a whole to fit a phone or iPad.
 * Everything is rendered at full size and shrunk together, so text lengths,
 * spacing and the timers alongside each other look exactly as they do on the screen.
 */
export default function MobileCuescreenView(props: ComponentProps<typeof CuescreenView>) {
  useWindowTitle('Mobile Cue Screen');
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  // fit the screen inside the space the view fills, whatever the device or orientation
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const fit = () => {
      const { width, height } = container.getBoundingClientRect();
      setScale(Math.min(width / SCREEN_WIDTH, height / SCREEN_HEIGHT));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, []);

  return (
    <div className='mobile-cuescreen' ref={containerRef}>
      <div className='mobile-cuescreen__frame' style={{ width: SCREEN_WIDTH * scale, height: SCREEN_HEIGHT * scale }}>
        <div className='mobile-cuescreen__screen' style={{ transform: `scale(${scale})` }}>
          <CuescreenView {...props} />
        </div>
      </div>
    </div>
  );
}

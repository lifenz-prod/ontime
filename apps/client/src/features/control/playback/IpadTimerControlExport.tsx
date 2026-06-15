import { memo } from 'react';

import ErrorBoundary from '../../../common/components/error-boundary/ErrorBoundary';

import IpadPlaybackControl from './IpadPlaybackControl';

import style from '../../editors/Editor.module.scss';

const IpadTimerControlExport = () => {
  return (
    <div className={style.playback} data-testid='panel-timer-control'>
      <div className={style.content}>
        <ErrorBoundary>
          <IpadPlaybackControl />
        </ErrorBoundary>
      </div>
    </div>
  );
};

export default memo(IpadTimerControlExport);

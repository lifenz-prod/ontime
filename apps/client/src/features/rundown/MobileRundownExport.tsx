import { memo } from 'react';

import { ContextMenu } from '../../common/components/context-menu/ContextMenu';
import ErrorBoundary from '../../common/components/error-boundary/ErrorBoundary';
import { cx } from '../../common/utils/styleUtils';

import MobileRundownWrapper from './MobileRundownWrapper';

import style from './RundownExport.module.scss';

const MobileRundownExport = () => {
  const classes = cx([style.rundownExport]);

  return (
    <div className={classes} data-testid='panel-rundown'>
      <div className={style.rundown}>
        <div className={style.list}>
          <ErrorBoundary>
            <ContextMenu>
              <MobileRundownWrapper />
            </ContextMenu>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default memo(MobileRundownExport);

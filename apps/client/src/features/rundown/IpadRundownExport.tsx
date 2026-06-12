import { memo } from 'react';

import { ContextMenu } from '../../common/components/context-menu/ContextMenu';
import ErrorBoundary from '../../common/components/error-boundary/ErrorBoundary';
import { cx } from '../../common/utils/styleUtils';

import IpadRundownWrapper from './IpadRundownWrapper';

import style from './RundownExport.module.scss';

const IpadRundownExport = () => {
  const classes = cx([style.rundownExport, style.ipad]);

  return (
    <div className={classes} data-testid='panel-rundown'>
      <div className={style.rundown}>
        <div className={style.list}>
          <ErrorBoundary>
            <ContextMenu>
              <IpadRundownWrapper />
            </ContextMenu>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
};

export default memo(IpadRundownExport);

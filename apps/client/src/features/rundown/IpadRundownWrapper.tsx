import Empty from '../../common/components/state/Empty';
import useServiceSwitcher from '../../common/hooks/useServiceSwitcher';
import useRundown from '../../common/hooks-query/useRundown';

import Rundown from './Rundown';
import RundownModeContext from './RundownModeContext';

import styles from './Rundown.module.scss';

const ipadMode = { hideRowActions: true, hideEndTime: true };

export default function IpadRundownWrapper() {
  const { data, status } = useRundown();
  const { visibleOrder } = useServiceSwitcher();

  return (
    <RundownModeContext.Provider value={ipadMode}>
      <div className={styles.rundownWrapper}>
        {status === 'success' && data ? (
          <Rundown data={{ ...data, order: visibleOrder }} />
        ) : (
          <Empty text='Connecting to server' />
        )}
      </div>
    </RundownModeContext.Provider>
  );
}

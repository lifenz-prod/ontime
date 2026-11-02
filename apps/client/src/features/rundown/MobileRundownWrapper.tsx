import Empty from '../../common/components/state/Empty';
import useServiceSwitcher from '../../common/hooks/useServiceSwitcher';
import useRundown from '../../common/hooks-query/useRundown';

import RundownHeader from './rundown-header/RundownHeader';
import Rundown from './Rundown';
import RundownModeContext from './RundownModeContext';

import styles from './Rundown.module.scss';

const editorMode = { hideRowActions: false, hideEndTime: false, playbackOnly: false, eventOnlyQuickAdd: true };

export default function MobileRundownWrapper() {
  const { data, status } = useRundown();
  const { visibleOrder } = useServiceSwitcher();

  return (
    <RundownModeContext.Provider value={editorMode}>
      <div className={styles.rundownWrapper}>
        <RundownHeader />
        {status === 'success' && data ? (
          <Rundown data={{ ...data, order: visibleOrder }} fullOrder={data.order} />
        ) : (
          <Empty text='Connecting to server' />
        )}
      </div>
    </RundownModeContext.Provider>
  );
}

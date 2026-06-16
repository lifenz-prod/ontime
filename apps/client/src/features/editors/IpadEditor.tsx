import { lazy } from 'react';
import { IoApps, IoCloudDownloadOutline } from 'react-icons/io5';
import { Button, ButtonGroup, IconButton, useDisclosure } from '@chakra-ui/react';
import { ErrorBoundary } from '@sentry/react';

import NavigationMenu from '../../common/components/navigation-menu/NavigationMenu';
import { useElectronListener } from '../../common/hooks/useElectronEvent';
import useServiceSwitcher from '../../common/hooks/useServiceSwitcher';
import { useWindowTitle } from '../../common/hooks/useWindowTitle';
import AppSettings from '../app-settings/AppSettings';
import useAppSettingsNavigation from '../app-settings/useAppSettingsNavigation';
import { ExternalInput } from '../control/message/MessageControl';
import { MobileEditorOverview } from '../overview/MobileOverview';

import rundownStyle from '../rundown/RundownExport.module.scss';
import styles from './Editor.module.scss';

const IpadTimerControl = lazy(() => import('../control/playback/IpadTimerControlExport'));
const IpadRundown = lazy(() => import('../rundown/IpadRundownExport'));
const IpadRundownEventEditor = lazy(() => import('../rundown/event-editor/IpadRundownEventEditor'));

export default function IpadEditor() {
  const { isOpen: isMenuOpen, onOpen, onClose } = useDisclosure();
  const { tabs, activeTabId, selectTab } = useServiceSwitcher();
  const { isOpen: isSettingsOpen, setLocation } = useAppSettingsNavigation();

  useWindowTitle('iPad Editor');
  useElectronListener();

  return (
    <div className={styles.mainContainer} data-testid='ipad-editor'>
      <NavigationMenu isOpen={isMenuOpen} onClose={onClose} />
      <MobileEditorOverview
        rightContent={
          tabs.length > 0 ? (
            <ButtonGroup size='lg' isAttached>
              {tabs.map((tab) => (
                <Button
                  key={tab.id}
                  onClick={() => selectTab(tab.id)}
                  variant={activeTabId === tab.id ? 'ontime-filled' : 'ontime-subtle-white'}
                >
                  {tab.name}
                </Button>
              ))}
            </ButtonGroup>
          ) : undefined
        }
      >
        <IconButton
          aria-label='Toggle navigation'
          variant='ontime-subtle-white'
          size='lg'
          icon={<IoApps />}
          onClick={onOpen}
        />
        <IconButton
          aria-label='Import Sheet'
          variant='ontime-subtle-white'
          size='lg'
          icon={<IoCloudDownloadOutline />}
          onClick={() => setLocation('sources__gsheet_import' as Parameters<typeof setLocation>[0])}
        />
      </MobileEditorOverview>

      {isSettingsOpen ? (
        <AppSettings />
      ) : (
        <>
          <div id='panels' className={styles.panelContainer}>
            <div className={`${styles.left} ${styles.ipadLeft}`}>
              <IpadTimerControl />
              <ExternalInput />
              <div className={rundownStyle.side}>
                <ErrorBoundary>
                  <IpadRundownEventEditor />
                </ErrorBoundary>
              </div>
            </div>
            <IpadRundown />
          </div>
        </>
      )}
    </div>
  );
}

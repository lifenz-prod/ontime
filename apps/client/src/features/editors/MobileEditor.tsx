import { lazy, useCallback, useEffect } from 'react';
import { IoApps, IoClose, IoSettingsOutline } from 'react-icons/io5';
import { Button, ButtonGroup, IconButton, useDisclosure } from '@chakra-ui/react';
import { useHotkeys } from '@mantine/hooks';
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

const MobileTimerControl = lazy(() => import('../control/playback/MobileTimerControlExport'));
const MobileRundown = lazy(() => import('../rundown/MobileRundownExport'));
const MobileRundownEventEditor = lazy(() => import('../rundown/event-editor/MobileRundownEventEditor'));
export default function MobileEditor() {
  const { isOpen: isSettingsOpen, setLocation, close } = useAppSettingsNavigation();
  const { isOpen: isMenuOpen, onOpen, onClose } = useDisclosure();
  const { onToggle: onFinderToggle, onClose: onFinderClose } = useDisclosure();
  const { tabs, activeTabId, selectTab } = useServiceSwitcher();

  useWindowTitle('Mobile Editor');

  // we need to register the listener to change the editor location
  useElectronListener();

  // listen to shutdown request from electron process
  useEffect(() => {
    if (window.process?.type === 'renderer') {
      window.ipcRenderer.on('user-request-shutdown', () => {
        setLocation('shutdown');
      });
    }
  }, [setLocation]);


  const toggleSettings = useCallback(() => {
    if (isSettingsOpen) {
      close();
    } else {
      setLocation('project');
    }
  }, [close, isSettingsOpen, setLocation]);

  useHotkeys([
    ['mod + ,', toggleSettings],
    ['mod + f', onFinderToggle],
    ['Escape', onFinderClose],
  ]);

  return (
    <div className={styles.mainContainer} data-testid='event-editor'>
      <NavigationMenu isOpen={isMenuOpen} onClose={onClose} />
      <MobileEditorOverview>
        <IconButton
          aria-label='Toggle navigation'
          variant='ontime-subtle-white'
          size='lg'
          icon={<IoApps />}
          onClick={onOpen}
        />
        <IconButton
          aria-label='Toggle settings'
          variant={isSettingsOpen ? 'ontime-subtle' : 'ontime-subtle-white'}
          size='lg'
          icon={isSettingsOpen ? <IoClose /> : <IoSettingsOutline />}
          onClick={toggleSettings}
        />
      </MobileEditorOverview>
      {!isSettingsOpen && tabs.length > 0 && (
        <ButtonGroup size='md' variant='ontime-subtle' isAttached mx={4} my={2}>
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              variant={activeTabId === tab.id ? 'ontime-filled' : 'ontime-subtle'}
            >
              {tab.name}
            </Button>
          ))}
        </ButtonGroup>
      )}
      {isSettingsOpen ? (
        <AppSettings />
      ) : (
        <div id='panels' className={styles.panelContainer}>
          <div className={styles.left}>
            <MobileTimerControl />
            <ExternalInput />
            <div className={rundownStyle.side}>
              <ErrorBoundary>
                <MobileRundownEventEditor />
              </ErrorBoundary>
            </div>
          </div>
          <MobileRundown />
        </div>
      )}
    </div>
  );
}

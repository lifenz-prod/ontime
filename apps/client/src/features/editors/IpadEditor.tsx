import { lazy, useEffect, useState } from 'react';
import { IoApps, IoCloudDownloadOutline } from 'react-icons/io5';
import { Button, ButtonGroup, IconButton, useDisclosure } from '@chakra-ui/react';
import { isOntimeEvent, TimeStrategy } from 'ontime-types';

import NavigationMenu from '../../common/components/navigation-menu/NavigationMenu';
import { useEventAction } from '../../common/hooks/useEventAction';
import { useElectronListener } from '../../common/hooks/useElectronEvent';
import { useWindowTitle } from '../../common/hooks/useWindowTitle';
import useRundown from '../../common/hooks-query/useRundown';
import useServiceProfiles from '../../common/hooks-query/useServiceProfiles';
import { ErrorBoundary } from '@sentry/react';
import AppSettings from '../app-settings/AppSettings';
import useAppSettingsNavigation from '../app-settings/useAppSettingsNavigation';
import { MobileEditorOverview } from '../overview/MobileOverview';
import { ExternalInput } from '../control/message/MessageControl';

import styles from './Editor.module.scss';
import rundownStyle from '../rundown/RundownExport.module.scss';

const IpadTimerControl = lazy(() => import('../control/playback/IpadTimerControlExport'));
const IpadRundown = lazy(() => import('../rundown/IpadRundownExport'));
const IpadRundownEventEditor = lazy(() => import('../rundown/event-editor/IpadRundownEventEditor'));

export default function IpadEditor() {
  const { isOpen: isMenuOpen, onOpen, onClose } = useDisclosure();
  const { data } = useRundown();
  const { batchUpdateEvents, updateEvent } = useEventAction();
  const { data: serviceProfiles } = useServiceProfiles();
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const { isOpen: isSettingsOpen, setLocation } = useAppSettingsNavigation();

  useWindowTitle('iPad Editor');
  useElectronListener();

  // When switching service profile, compute each event's start time from durations
  // (LockEnd strategy does not cascade, so we update all start times explicitly)
  const handleProfileSelect = (profileId: string, startTime: number) => {
    setActiveProfileId(profileId);
    const { order, rundown } = data;
    let currentTime = startTime;
    for (const id of order) {
      const event = rundown[id];
      if (!isOntimeEvent(event)) continue;
      updateEvent({ id, timeStart: currentTime });
      currentTime += event.duration;
    }
  };

  // On mount, ensure all events use LockEnd so editing start time updates duration
  useEffect(() => {
    const { order, rundown } = data;
    if (!order || order.length === 0) return;

    const eventIdsToUpdate = order.filter((id) => {
      const entry = rundown[id];
      return isOntimeEvent(entry) && entry.timeStrategy !== TimeStrategy.LockEnd;
    });

    if (eventIdsToUpdate.length > 0) {
      batchUpdateEvents({ timeStrategy: TimeStrategy.LockEnd }, eventIdsToUpdate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.mainContainer} data-testid='ipad-editor'>
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
          aria-label='Import Sheet'
          variant='ontime-subtle-white'
          size='lg'
          icon={<IoCloudDownloadOutline />}
          onClick={() => setLocation('sources__gsheet_import' as Parameters<typeof setLocation>[0])}
        />
      </MobileEditorOverview>

      {isSettingsOpen && <AppSettings />}

      {serviceProfiles.length > 0 && (
        <ButtonGroup size='md' variant='ontime-subtle' isAttached mx={4} my={2}>
          {serviceProfiles.map((profile) => (
            <Button
              key={profile.id}
              onClick={() => handleProfileSelect(profile.id, profile.startTime)}
              variant={activeProfileId === profile.id ? 'ontime-filled' : 'ontime-subtle'}
            >
              {profile.name}
            </Button>
          ))}
        </ButtonGroup>
      )}

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
    </div>
  );
}

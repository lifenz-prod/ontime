import { useCallback, useEffect, useState } from 'react';
import { IoCloudDownloadOutline, IoRefresh } from 'react-icons/io5';
import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Progress,
  Switch,
} from '@chakra-ui/react';
import { compareVersions } from 'ontime-utils';

import { AppRelease, getBetaOptIn, getLatestRelease, setBetaOptIn } from '../../../../common/api/appUpdates';
import ExternalLink from '../../../../common/components/link/external-link/ExternalLink';
import { ipcRenderer, isElectron } from '../../../../common/hooks/useElectronEvent';
import { appVersion } from '../../../../externals';
import * as Panel from '../../panel-utils/PanelUtils';

import ReleaseNotes from './ReleaseNotes';

import style from './AboutPanel.module.scss';

type Support = { supported: boolean; reason: string };

/** browsers on other devices can read about a release, but only the app can install it */
const browserReason = 'To update, use the Ontime app on the computer running it.';

/**
 * Checks GitHub for a newer release and, in the desktop app on the host machine, installs it in one click
 */
export default function AppUpdates() {
  const [optInBeta, setOptInBeta] = useState(getBetaOptIn);
  const [checking, setChecking] = useState(false);
  const [latest, setLatest] = useState<AppRelease | null>(null);
  const [error, setError] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [support, setSupport] = useState<Support>({ supported: false, reason: browserReason });
  const [progress, setProgress] = useState<number | null>(null);
  const [installError, setInstallError] = useState('');

  const isNewer = latest !== null && compareVersions(latest.version, appVersion) > 0;
  const isInstalling = progress !== null;

  const check = useCallback(async (includeBeta: boolean, openWhenAvailable: boolean) => {
    setChecking(true);
    setError('');
    try {
      const release = await getLatestRelease(includeBeta);
      setLatest(release);
      if (openWhenAvailable && release && compareVersions(release.version, appVersion) > 0) {
        setIsOpen(true);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setChecking(false);
    }
  }, []);

  // check quietly when the page opens, and whenever the channel changes
  useEffect(() => {
    check(optInBeta, false);
  }, [check, optInBeta]);

  useEffect(() => {
    if (!isElectron || !ipcRenderer) return;
    ipcRenderer.invoke('updater:support').then(setSupport);
    const onProgress = (_event: unknown, fraction: number) => setProgress(fraction);
    ipcRenderer.on('updater:progress', onProgress);
    return () => {
      ipcRenderer.removeListener('updater:progress', onProgress);
    };
  }, []);

  const toggleBeta = () => {
    const next = !optInBeta;
    setBetaOptIn(next);
    setOptInBeta(next);
  };

  const install = async () => {
    if (!latest || !ipcRenderer) return;
    setInstallError('');
    setProgress(0);
    const result: { ok: boolean; message?: string } = await ipcRenderer.invoke('updater:install', latest.tag);
    if (!result.ok) {
      setProgress(null);
      setInstallError(result.message ?? 'The update failed');
    }
    // on success the app quits and reopens on the new version
  };

  const closeModal = () => {
    if (isInstalling) return;
    setIsOpen(false);
    setInstallError('');
  };

  return (
    <>
      <Panel.ListGroup>
        <Panel.ListItem>
          <Panel.Field
            title='Opt in to beta releases'
            description='Get test builds before they are released to everyone. Betas may have rough edges.'
          />
          <Switch variant='ontime' size='lg' isChecked={optInBeta} onChange={toggleBeta} />
        </Panel.ListItem>
      </Panel.ListGroup>

      <div className={style.updateStatus}>
        <span data-testid='update-status'>
          {checking && 'Checking for updates…'}
          {!checking && error && <Panel.Error>{error}</Panel.Error>}
          {!checking && !error && latest && isNewer && `Ontime ${latest.version} is available`}
          {!checking && !error && latest && !isNewer && `You are up to date`}
          {!checking && !error && !latest && 'No releases found'}
        </span>
        <Panel.InlineElements>
          <Button
            variant='ontime-subtle'
            size='sm'
            leftIcon={<IoRefresh />}
            onClick={() => check(optInBeta, true)}
            isLoading={checking}
          >
            Check for updates
          </Button>
          {isNewer && (
            <Button
              variant='ontime-filled'
              size='sm'
              leftIcon={<IoCloudDownloadOutline />}
              onClick={() => setIsOpen(true)}
            >
              Update
            </Button>
          )}
        </Panel.InlineElements>
      </div>

      {latest && (
        <Modal isOpen={isOpen} onClose={closeModal} variant='ontime' isCentered size='xl' scrollBehavior='inside'>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>
              Update to Ontime {latest.version}
              {latest.isBeta && <span className={style.betaTag}>Beta</span>}
            </ModalHeader>
            {!isInstalling && <ModalCloseButton />}
            <ModalBody>
              <div className={style.versionLine}>
                You have {appVersion}. Released {new Date(latest.publishedAt).toLocaleDateString()}.
              </div>
              <ReleaseNotes notes={latest.notes} />
              {isInstalling && (
                <div className={style.installProgress}>
                  <Progress value={(progress ?? 0) * 100} size='sm' colorScheme='blue' borderRadius='2px' />
                  <span>
                    {progress !== null && progress < 1
                      ? `Downloading ${Math.round(progress * 100)}%`
                      : 'Installing, Ontime will restart…'}
                  </span>
                </div>
              )}
              {installError && <Panel.Error>{installError}</Panel.Error>}
              {!support.supported && <div className={style.updateHint}>{support.reason}</div>}
            </ModalBody>
            <ModalFooter>
              <Panel.InlineElements>
                <Button variant='ontime-subtle' onClick={closeModal} isDisabled={isInstalling}>
                  Cancel
                </Button>
                {support.supported ? (
                  <Button variant='ontime-filled' onClick={install} isLoading={isInstalling}>
                    Update and restart
                  </Button>
                ) : (
                  <ExternalLink href={latest.url}>View on GitHub</ExternalLink>
                )}
              </Panel.InlineElements>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </>
  );
}

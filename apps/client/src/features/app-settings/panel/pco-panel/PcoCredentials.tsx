import { useState } from 'react';
import { Button, Input } from '@chakra-ui/react';
import type { PcoStatus } from 'ontime-types';

import { maybeAxiosError } from '../../../../common/api/utils';
import { usePcoCredentialsMutation } from '../../../../common/hooks-query/usePco';
import * as Panel from '../../panel-utils/PanelUtils';

import style from './PcoPanel.module.scss';

interface PcoCredentialsProps {
  status: PcoStatus | undefined;
}

/**
 * Entering the Planning Center token pair.
 *
 * The pair is a Personal Access Token for the whole Services product, so a few
 * things here are deliberate rather than incidental:
 *
 * - The secret is write-only. Nothing that could authenticate is ever sent back, so
 *   the fields start empty even when credentials are saved, and what is shown
 *   instead is a masked application id.
 * - The pair is checked against Planning Center before it is stored. A typo in a
 *   token leaves nothing to look at afterwards, so saving an unusable pair would
 *   just move the failure somewhere less obvious.
 * - Saved credentials live in the Ontime data directory, not in the project file: a
 *   project gets exported and passed around, and a token must not travel with it.
 */
export default function PcoCredentials({ status }: PcoCredentialsProps) {
  const { save, remove, isPending } = usePcoCredentialsMutation();

  const [applicationId, setApplicationId] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const canSubmit = applicationId.trim() !== '' && secret.trim() !== '' && !isPending;

  const onSave = async () => {
    setError('');
    setSaved(false);
    try {
      await save({ applicationId, secret });
      // held only as long as it takes to send
      setApplicationId('');
      setSecret('');
      setSaved(true);
    } catch (maybeError) {
      setError(maybeAxiosError(maybeError));
    }
  };

  const onRemove = async () => {
    setError('');
    setSaved(false);
    try {
      await remove();
    } catch (maybeError) {
      setError(maybeAxiosError(maybeError));
    }
  };

  const sourceLabel =
    status?.credentialSource === 'stored'
      ? 'Saved in Ontime'
      : status?.credentialSource === 'environment'
        ? 'From the environment'
        : 'None';

  return (
    <>
      <Panel.Title>Credentials</Panel.Title>
      {error && <Panel.Error>{error}</Panel.Error>}
      {saved && <Panel.BlockQuote>Credentials checked against Planning Center and saved.</Panel.BlockQuote>}

      <Panel.ListGroup>
        <Panel.ListItem>
          <Panel.Field
            title='Token in use'
            description={
              status?.credentialSource === 'environment'
                ? 'PCO_APP_ID and PCO_SECRET, or a .env file. Saving below takes over from it.'
                : 'A Personal Access Token pair from api.planningcenteronline.com/oauth/applications, with access to Services'
            }
          />
          <div className={style.statusRow}>
            {status?.applicationIdHint && <span className={style.muted}>{status.applicationIdHint}</span>}
            <span>{sourceLabel}</span>
          </div>
        </Panel.ListItem>

        <Panel.ListItem>
          <Panel.Field
            title='Application ID'
            description={status?.hasCredentials ? 'Enter a new pair to replace the one in use' : 'From the token pair'}
          />
          <Input
            size='sm'
            width='18rem'
            variant='ontime-filled'
            autoComplete='off'
            spellCheck={false}
            placeholder={status?.hasCredentials ? 'Replace the current pair' : 'Application ID'}
            value={applicationId}
            isDisabled={isPending}
            onChange={(event) => setApplicationId(event.target.value)}
          />
        </Panel.ListItem>

        <Panel.ListItem>
          <Panel.Field title='Secret' description='Never shown again once saved, and never sent back to this page' />
          <Input
            type='password'
            size='sm'
            width='18rem'
            variant='ontime-filled'
            autoComplete='new-password'
            spellCheck={false}
            placeholder='Secret'
            value={secret}
            isDisabled={isPending}
            onChange={(event) => setSecret(event.target.value)}
          />
        </Panel.ListItem>

        <Panel.ListItem>
          <Panel.Field
            title='Save'
            description='The pair is tested against Planning Center first, and only stored if it works'
          />
          <Panel.InlineElements>
            {status?.credentialSource === 'stored' && (
              <Button variant='ontime-ghosted' size='sm' onClick={onRemove} isDisabled={isPending}>
                Remove saved
              </Button>
            )}
            <Button variant='ontime-filled' size='sm' onClick={onSave} isDisabled={!canSubmit} isLoading={isPending}>
              Save and test
            </Button>
          </Panel.InlineElements>
        </Panel.ListItem>
      </Panel.ListGroup>

      <Panel.Description>
        Ontime serves this page over the local network without encryption, so enter a token from a machine you trust on
        a network you trust. The token is stored on the Ontime machine, readable only by its user account.
      </Panel.Description>
    </>
  );
}

import { useMemo, useState } from 'react';
import { IoAdd, IoRefresh, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input, Switch } from '@chakra-ui/react';
import type { PcoPinnedServiceType, PcoRules } from 'ontime-types';

import { maybeAxiosError } from '../../../../common/api/utils';
import { usePcoServiceTypes, usePcoStatus } from '../../../../common/hooks-query/usePco';
import * as Panel from '../../panel-utils/PanelUtils';

import style from './PcoPanel.module.scss';

interface PcoConnectionProps {
  rules: PcoRules;
  patchRules: (patch: Partial<PcoRules>) => Promise<void>;
  isSaving: boolean;
}

/**
 * Connection state and the service types kept for import.
 *
 * The organisation this was built for has over three hundred service types, so the
 * picker is a search rather than a list, and what gets used is pinned.
 */
export default function PcoConnection({ rules, patchRules, isSaving }: PcoConnectionProps) {
  const { data: status, isFetching, refetch } = usePcoStatus();
  const [isPicking, setIsPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');

  // the full list is the slowest call PCO serves, so it is only fetched while picking
  const { data: serviceTypes, isFetching: isLoadingServiceTypes } = usePcoServiceTypes(isPicking);

  const pinnedIds = useMemo(() => new Set(rules.pinnedServiceTypes.map((pinned) => pinned.id)), [rules]);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    const available = serviceTypes.filter((serviceType) => !pinnedIds.has(serviceType.id));
    if (!query) {
      return available.slice(0, 25);
    }
    return available.filter((serviceType) => serviceType.name.toLowerCase().includes(query)).slice(0, 25);
  }, [search, serviceTypes, pinnedIds]);

  const save = async (pinnedServiceTypes: PcoPinnedServiceType[]) => {
    setError('');
    try {
      await patchRules({ pinnedServiceTypes });
    } catch (maybeError) {
      setError(maybeAxiosError(maybeError));
    }
  };

  const pin = (serviceType: { id: string; name: string }) => {
    // a new pin inherits the group of the last one, which is usually the same campus
    const group = rules.pinnedServiceTypes.at(-1)?.group ?? null;
    save([...rules.pinnedServiceTypes, { ...serviceType, group }]);
    setSearch('');
  };

  const unpin = (id: string) => save(rules.pinnedServiceTypes.filter((pinned) => pinned.id !== id));

  const setGroup = (id: string, group: string) => {
    const trimmed = group.trim();
    const current = rules.pinnedServiceTypes.find((pinned) => pinned.id === id);
    if ((current?.group ?? '') === trimmed) {
      return;
    }
    save(rules.pinnedServiceTypes.map((pinned) => (pinned.id === id ? { ...pinned, group: trimmed || null } : pinned)));
  };

  const connectionLabel = !status
    ? 'Checking...'
    : !status.hasCredentials
      ? 'No credentials'
      : status.error
        ? 'Cannot reach Planning Center'
        : status.serviceType
          ? `Connected · recall uses ${status.serviceType.name}`
          : 'Connected · no service type chosen';

  const connectionDescription =
    !status || !status.hasCredentials
      ? 'Credentials are read from the environment'
      : (status.error ??
        (status.serviceTypeCount === null
          ? 'Credentials are read from the environment'
          : `${status.serviceTypeCount} service types in this organisation`));

  // nothing is asserted until the status is known
  const dotState = !status ? '' : !status.hasCredentials || status.error ? style.bad : style.ok;

  return (
    <Panel.Card>
      <Panel.SubHeader>
        Planning Center
        <Panel.InlineElements>
          <Button
            variant='ontime-subtle'
            size='sm'
            rightIcon={<IoRefresh />}
            onClick={() => refetch()}
            isLoading={isFetching}
          >
            Check connection
          </Button>
        </Panel.InlineElements>
      </Panel.SubHeader>
      <Panel.Divider />

      <Panel.Section>
        {error && <Panel.Error>{error}</Panel.Error>}

        <Panel.Title>Connection</Panel.Title>
        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field title='Status' description={connectionDescription} />
            <div className={style.statusRow}>
              <span className={`${style.dot} ${dotState}`} />
              {connectionLabel}
            </div>
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Recall plans instead of Google Sheet tabs'
              description='Makes Planning Center the source for loadsource over OSC, websocket and HTTP. Off leaves sheet recall untouched.'
            />
            <Switch
              variant='ontime'
              size='lg'
              isChecked={rules.enabled}
              isDisabled={isSaving || !status?.hasCredentials}
              onChange={(event) => patchRules({ enabled: event.target.checked })}
            />
          </Panel.ListItem>
        </Panel.ListGroup>

        {status && !status.hasCredentials && (
          <Panel.BlockQuote>
            Set PCO_APP_ID and PCO_SECRET in the environment, from a Personal Access Token created at
            api.planningcenteronline.com/oauth/applications, then restart Ontime.
          </Panel.BlockQuote>
        )}

        <Panel.Title>
          Service types
          <Panel.InlineElements>
            <Button
              variant='ontime-subtle'
              size='sm'
              rightIcon={<IoAdd />}
              onClick={() => setIsPicking((previous) => !previous)}
              isDisabled={!status?.hasCredentials}
            >
              {isPicking ? 'Done' : 'Add service type'}
            </Button>
          </Panel.InlineElements>
        </Panel.Title>

        {isPicking && (
          <Panel.ListGroup>
            <Panel.ListItem>
              <Panel.Field
                title='Search'
                description={
                  isLoadingServiceTypes
                    ? 'Reading every service type from Planning Center...'
                    : `${serviceTypes.length} service types in this organisation`
                }
              />
              <Input
                size='sm'
                width='14rem'
                variant='ontime-filled'
                placeholder='eg. central am'
                autoComplete='off'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </Panel.ListItem>
            <Panel.ListItem>
              <div className={style.searchResults}>
                {!isLoadingServiceTypes && matches.length === 0 && (
                  <span className={style.muted}>No service type matches that</span>
                )}
                {matches.map((serviceType) => (
                  <div key={serviceType.id} className={style.searchResult}>
                    <span className={style.pinName}>{serviceType.name}</span>
                    <Button variant='ontime-ghosted' size='xs' onClick={() => pin(serviceType)} isDisabled={isSaving}>
                      Pin
                    </Button>
                  </div>
                ))}
              </div>
            </Panel.ListItem>
          </Panel.ListGroup>
        )}

        <Panel.ListGroup>
          {rules.pinnedServiceTypes.length === 0 && (
            <Panel.ListItem>
              <Panel.Field
                title='Nothing pinned yet'
                description='Pin the service types this machine imports, and they appear below with their upcoming plans.'
              />
            </Panel.ListItem>
          )}
          {rules.pinnedServiceTypes.map((pinned) => (
            <Panel.ListItem key={pinned.id}>
              <Panel.Field title={pinned.name} description={`Service type ${pinned.id}`} />
              <div className={style.pinRow}>
                <Input
                  size='sm'
                  width='9rem'
                  variant='ontime-filled'
                  placeholder='Campus'
                  autoComplete='off'
                  defaultValue={pinned.group ?? ''}
                  onBlur={(event) => setGroup(pinned.id, event.target.value)}
                />
                <IconButton
                  size='sm'
                  variant='ontime-ghosted'
                  aria-label={`Remove ${pinned.name}`}
                  icon={<IoTrash />}
                  isDisabled={isSaving}
                  onClick={() => unpin(pinned.id)}
                />
              </div>
            </Panel.ListItem>
          ))}
        </Panel.ListGroup>
      </Panel.Section>
    </Panel.Card>
  );
}

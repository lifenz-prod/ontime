import { useMemo, useRef, useState } from 'react';
import { IoDownloadOutline, IoRefresh } from 'react-icons/io5';
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  Button,
  useDisclosure,
} from '@chakra-ui/react';
import type { PcoImportResult, PcoPlanSummary, PcoRules } from 'ontime-types';

import { importPcoPlan } from '../../../../common/api/pco';
import { invalidateAllCaches, maybeAxiosError } from '../../../../common/api/utils';
import { usePcoPlans } from '../../../../common/hooks-query/usePco';
import * as Panel from '../../panel-utils/PanelUtils';

import style from './PcoPanel.module.scss';

interface PcoUpcomingProps {
  rules: PcoRules;
}

/** groups a campus heading over its service types, ungrouped ones last */
function groupLabel(rules: PcoRules, serviceTypeId: string): string {
  const pinned = rules.pinnedServiceTypes.find((candidate) => candidate.id === serviceTypeId);
  return pinned?.group?.trim() || 'Other';
}

export default function PcoUpcoming({ rules }: PcoUpcomingProps) {
  const pinnedIds = useMemo(() => rules.pinnedServiceTypes.map((pinned) => pinned.id), [rules]);
  const { data: plans, isFetching, isError, error, refetch } = usePcoPlans(pinnedIds, pinnedIds.length > 0);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const [selected, setSelected] = useState<PcoPlanSummary | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<PcoImportResult | null>(null);
  const [importError, setImportError] = useState('');

  /** plans keep their soonest-first order inside each campus heading */
  const grouped = useMemo(() => {
    const groups = new Map<string, PcoPlanSummary[]>();
    for (const plan of plans) {
      const label = groupLabel(rules, plan.serviceTypeId);
      groups.set(label, [...(groups.get(label) ?? []), plan]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
  }, [plans, rules]);

  const askToImport = (plan: PcoPlanSummary) => {
    setSelected(plan);
    setResult(null);
    setImportError('');
    onOpen();
  };

  const confirmImport = async () => {
    if (!selected) {
      return;
    }
    setIsImporting(true);
    setImportError('');
    try {
      const imported = await importPcoPlan({ serviceTypeId: selected.serviceTypeId, planId: selected.planId });
      setResult(imported);
      // the rundown, custom fields and service profiles have all been replaced
      await invalidateAllCaches();
      onClose();
    } catch (maybeError) {
      setImportError(maybeAxiosError(maybeError));
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Panel.Card>
      <Panel.SubHeader>
        Upcoming services
        <Panel.InlineElements>
          <Button
            variant='ontime-subtle'
            size='sm'
            rightIcon={<IoRefresh />}
            onClick={() => refetch()}
            isLoading={isFetching}
            isDisabled={pinnedIds.length === 0}
          >
            Refresh
          </Button>
        </Panel.InlineElements>
      </Panel.SubHeader>
      <Panel.Divider />

      <Panel.Section>
        {isError && <Panel.Error>{maybeAxiosError(error)}</Panel.Error>}
        {importError && <Panel.Error>{importError}</Panel.Error>}

        {result && (
          <Panel.BlockQuote>
            Imported {result.date} with {result.entries} entries.
            {result.warnings.length > 0 && (
              <div className={style.warnings}>
                {result.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
          </Panel.BlockQuote>
        )}

        <Panel.Loader isLoading={isFetching && plans.length === 0} />

        {pinnedIds.length === 0 ? (
          <Panel.Paragraph>Pin a service type above to see its upcoming services here.</Panel.Paragraph>
        ) : (
          grouped.map(([label, groupPlans]) => (
            <div key={label}>
              {/* a single ungrouped heading reading "Other" is noise, not information */}
              {!(grouped.length === 1 && label === 'Other') && <Panel.Title>{label}</Panel.Title>}
              <Panel.Table>
                <thead>
                  <tr>
                    <th className={style.fit}>Date</th>
                    <th className={style.fit}>Time</th>
                    <th className={style.fullWidth}>Service</th>
                    <th className={style.fit}>Items</th>
                    <th className={style.fit} />
                  </tr>
                </thead>
                <tbody>
                  {groupPlans.length === 0 && <Panel.TableEmpty label='No upcoming plans' />}
                  {groupPlans.map((plan) => (
                    <tr key={`${plan.serviceTypeId}-${plan.planId}`}>
                      <td className={style.date}>{plan.date}</td>
                      <td className={style.numeric}>{plan.firstServiceTime ?? '--:--'}</td>
                      <td>
                        {plan.serviceTypeName}
                        {plan.seriesTitle && <span className={style.muted}> · {plan.seriesTitle}</span>}
                      </td>
                      <td className={style.numeric}>{plan.itemsCount ?? '-'}</td>
                      <td className={style.fit}>
                        <Button
                          variant='ontime-subtle'
                          size='sm'
                          rightIcon={<IoDownloadOutline />}
                          onClick={() => askToImport(plan)}
                        >
                          Import
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Panel.Table>
            </div>
          ))
        )}
      </Panel.Section>

      <AlertDialog variant='ontime' isOpen={isOpen} leastDestructiveRef={cancelRef} onClose={onClose}>
        <AlertDialogOverlay>
          <AlertDialogContent>
            <AlertDialogHeader fontSize='lg' fontWeight='bold'>
              Import {selected?.serviceTypeName} {selected?.date}
            </AlertDialogHeader>
            <AlertDialogBody>
              This replaces the rundown, the service profiles and the generated second service in this project. It
              cannot be undone.
              <br />
              <br />
              Playback will be stopped.
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onClose} variant='ontime-ghosted-white' isDisabled={isImporting}>
                Cancel
              </Button>
              <Button colorScheme='red' onClick={confirmImport} isLoading={isImporting}>
                Replace rundown
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Panel.Card>
  );
}

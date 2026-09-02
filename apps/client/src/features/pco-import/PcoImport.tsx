import { useCallback, useMemo, useState } from 'react';
import { IoArrowBack, IoDownloadOutline, IoRefresh } from 'react-icons/io5';
import { Link } from 'react-router-dom';
import { Button, IconButton, Select } from '@chakra-ui/react';
import type { PcoImportResult, PcoPlanSummary, PcoRuleEffect, PcoRules } from 'ontime-types';

import { PCO_PLAN_SHEET } from '../../common/api/constants';
import { importPcoPlan } from '../../common/api/pco';
import { invalidateAllCaches, maybeAxiosError } from '../../common/api/utils';
import {
  usePcoPlans,
  usePcoPlanSheet,
  usePcoRules,
  usePcoRulesMutation,
  usePcoStatus,
} from '../../common/hooks-query/usePco';
import { ontimeQueryClient } from '../../common/queryClient';
import {
  hasServiceTypeEffect,
  serviceTypeEffectFor,
  withServiceTypeEffect,
} from '../app-settings/panel/pco-panel/pcoRuleUtils';

import PcoRunSheet from './PcoRunSheet';

import style from './PcoImport.module.scss';

/** groups a campus heading over its service types, ungrouped ones last */
function groupLabel(rules: PcoRules, serviceTypeId: string): string {
  const pinned = rules.pinnedServiceTypes.find((candidate) => candidate.id === serviceTypeId);
  return pinned?.group?.trim() || 'Other';
}

/**
 * Choosing a plan and saying what the import should do with each of its items.
 *
 * Its own page rather than a settings section: this is an operator's task done
 * against a run sheet, not a preference, and it wants the width. The settings panel
 * keeps the connection, the credentials and the pins.
 *
 * Every row change saves immediately, against the plan's **service type** -- so the
 * next Central AM plan opens with the same choices already made, and Central PM is
 * untouched by them.
 */
export default function PcoImport() {
  const { data: status } = usePcoStatus();
  const { data: rules } = usePcoRules();
  const { mutateAsync: saveRules, isPending: isSaving } = usePcoRulesMutation();

  const pinnedIds = useMemo(() => rules?.pinnedServiceTypes.map((pinned) => pinned.id) ?? [], [rules]);
  const { data: plans, isFetching: isLoadingPlans, refetch: refetchPlans } = usePcoPlans(pinnedIds, pinnedIds.length > 0);

  const [selected, setSelected] = useState<PcoPlanSummary | null>(null);
  const [targetDate, setTargetDate] = useState<string>('');
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<PcoImportResult | null>(null);
  const [error, setError] = useState('');

  const {
    data: sheet,
    isFetching: isLoadingSheet,
    error: sheetError,
  } = usePcoPlanSheet(selected?.serviceTypeId, selected?.planId);

  /** plans keep their soonest-first order inside each campus heading */
  const grouped = useMemo(() => {
    if (!rules) {
      return [];
    }
    const groups = new Map<string, PcoPlanSummary[]>();
    for (const plan of plans) {
      const label = groupLabel(rules, plan.serviceTypeId);
      groups.set(label, [...(groups.get(label) ?? []), plan]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)));
  }, [plans, rules]);

  const choosePlan = (plan: PcoPlanSummary) => {
    setSelected(plan);
    setTargetDate('');
    setResult(null);
    setError('');
  };

  /**
   * A row change writes a rule and re-reads the sheet, because the rules decide what
   * every other row says: turning one item into a block can change nothing else, but
   * a rename or a fold can, and a sheet showing one thing while the import does
   * another is the failure worth avoiding.
   */
  const changeItem = useCallback(
    async (title: string, effect: PcoRuleEffect) => {
      if (!rules || !selected) {
        return;
      }
      setError('');
      try {
        await saveRules(withServiceTypeEffect(rules, selected.serviceTypeId, title, effect));
        await ontimeQueryClient.invalidateQueries({ queryKey: PCO_PLAN_SHEET });
      } catch (maybeError) {
        setError(maybeAxiosError(maybeError));
      }
    },
    [rules, selected, saveRules],
  );

  const resetItem = useCallback((title: string) => changeItem(title, {}), [changeItem]);

  const isCustomised = useCallback(
    (title: string) => Boolean(rules && selected && hasServiceTypeEffect(rules, selected.serviceTypeId, title)),
    [rules, selected],
  );

  const ownEffect = useCallback(
    (title: string) => (rules && selected ? serviceTypeEffectFor(rules, selected.serviceTypeId, title) : {}),
    [rules, selected],
  );

  const runImport = async () => {
    if (!selected) {
      return;
    }
    setIsImporting(true);
    setError('');
    setResult(null);
    try {
      const imported = await importPcoPlan({
        serviceTypeId: selected.serviceTypeId,
        planId: selected.planId,
        ...(targetDate ? { targetDate } : {}),
      });
      setResult(imported);
      // the rundown, custom fields and service profiles have all been replaced
      await invalidateAllCaches();
    } catch (maybeError) {
      setError(maybeAxiosError(maybeError));
    } finally {
      setIsImporting(false);
    }
  };

  const importable = sheet?.items.filter(
    (item) => item.derivedAt !== null || item.disposition === 'event' || item.disposition === 'block',
  ).length;
  const days = sheet?.availableDays.filter((day) => day.hasServices) ?? [];

  return (
    <div className={style.page}>
      <div className={style.header}>
        <div className={style.title}>Import from Planning Center</div>
        <Button as={Link} to='/editor' size='sm' variant='ontime-subtle' leftIcon={<IoArrowBack />}>
          Back to the editor
        </Button>
      </div>
      <div className={style.subtitle}>
        Importing replaces the rundown and the service profiles, and is refused while a show is running.
      </div>

      {status && !status.hasCredentials && (
        <div className={style.error}>
          Planning Center has no credentials. Add a token pair on the Planning Center tab in app settings.
        </div>
      )}
      {status?.hasCredentials && status.error && <div className={style.error}>{status.error}</div>}

      <section className={style.section}>
        <div className={style.sectionTitle}>
          <span className={style.step}>1</span>
          Choose a plan
          <IconButton
            size='xs'
            variant='ontime-ghosted'
            aria-label='Refresh the plan list'
            icon={<IoRefresh />}
            isLoading={isLoadingPlans}
            onClick={() => refetchPlans()}
          />
        </div>
        <div className={style.sectionHint}>
          The upcoming plans of every pinned service type. Pin more on the Planning Center tab in app settings.
        </div>

        {pinnedIds.length === 0 && (
          <div className={style.empty}>No service types are pinned, so there is nothing to list.</div>
        )}
        {pinnedIds.length > 0 && plans.length === 0 && !isLoadingPlans && (
          <div className={style.empty}>No upcoming plans on the pinned service types.</div>
        )}

        {grouped.map(([label, groupPlans]) => (
          <div key={label}>
            <div className={style.groupLabel}>{label}</div>
            <div className={style.planGrid}>
              {groupPlans.map((plan) => (
                <button
                  key={`${plan.serviceTypeId}-${plan.planId}`}
                  type='button'
                  className={style.planCard}
                  data-selected={plan.planId === selected?.planId}
                  onClick={() => choosePlan(plan)}
                >
                  <div className={style.planDate}>{plan.dates || plan.date}</div>
                  <div className={style.planMeta}>
                    {plan.serviceTypeName}
                    {plan.firstServiceTime && ` · ${plan.firstServiceTime}`}
                    {plan.itemsCount ? ` · ${plan.itemsCount} items` : ''}
                  </div>
                  {(plan.title || plan.seriesTitle) && (
                    <div className={style.planMeta}>{plan.title || plan.seriesTitle}</div>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      {selected && (
        <section className={style.section}>
          <div className={style.sectionTitle}>
            <span className={style.step}>2</span>
            The run sheet
            {days.length > 1 && (
              <Select
                size='sm'
                width='16rem'
                variant='ontime'
                value={targetDate || days[0].dateKey}
                onChange={(event) => setTargetDate(event.target.value)}
              >
                {days.map((day) => (
                  <option key={day.dateKey} value={day.dateKey}>
                    {day.label}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <div className={style.sectionHint}>
            {sheet
              ? `Every item on the ${sheet.dates || selected.date} ${sheet.serviceTypeName} plan. A change here is remembered for ${sheet.serviceTypeName} and applied to its next plan too.`
              : 'Reading the run sheet from Planning Center...'}
          </div>

          {sheetError && <div className={style.error}>{maybeAxiosError(sheetError)}</div>}

          {sheet && (
            <PcoRunSheet
              items={sheet.items}
              isSaving={isSaving || isLoadingSheet}
              isCustomised={isCustomised}
              ownEffect={ownEffect}
              onChange={changeItem}
              onReset={resetItem}
            />
          )}

          <div className={style.footer}>
            <div className={style.summary}>
              {sheet
                ? `${importable} of ${sheet.items.length} items will be imported, plus the production run read from the plan's rehearsal times.`
                : ''}
            </div>
            <Button
              size='md'
              variant='ontime-filled'
              rightIcon={<IoDownloadOutline />}
              isLoading={isImporting}
              isDisabled={!sheet || isSaving}
              onClick={runImport}
            >
              Import and replace the rundown
            </Button>
          </div>

          {error && <div className={style.error}>{error}</div>}
          {result && (
            <>
              <div className={style.success}>
                Imported {result.entries} entries for {result.date}.
              </div>
              {result.warnings.length > 0 && (
                <ul className={style.warnings}>
                  {result.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

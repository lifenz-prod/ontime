import { useState } from 'react';
import { IoRefresh, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Select, Switch } from '@chakra-ui/react';
import type { PcoHeaderHandling, PcoItemDisposition, PcoKnownItem, PcoRuleEffect, PcoRules } from 'ontime-types';

import { maybeAxiosError } from '../../../../common/api/utils';
import { usePcoKnownItems } from '../../../../common/hooks-query/usePco';
import * as Panel from '../../panel-utils/PanelUtils';

import PcoPreServiceRun from './PcoPreServiceRun';
import {
  type TimingChoice,
  applyTiming,
  applyToggle,
  describeEffect,
  describeMatch,
  effectForTitle,
  handWrittenRules,
  removeRuleAt,
  timingLabels,
  timingOf,
  toggleKeys,
  toggleLabels,
  withEffectForTitle,
} from './pcoRuleUtils';

import style from './PcoPanel.module.scss';

interface PcoDefaultsProps {
  rules: PcoRules;
  patchRules: (patch: Partial<PcoRules>) => Promise<void>;
  isSaving: boolean;
}

function lengthLabel(seconds: number | null): string {
  if (!seconds) {
    return '-';
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Import defaults, and what each item on the run sheet should do.
 *
 * The list is the titles Planning Center actually carries, read from the next few
 * plans, so nobody has to know an item exists before they can configure it. Each
 * row writes a rule matching that title; the shipped regex rules are listed
 * separately because the panel cannot round-trip them.
 */
export default function PcoDefaults({ rules, patchRules, isSaving }: PcoDefaultsProps) {
  const serviceTypeId = rules.pinnedServiceTypes[0]?.id;
  const [chosenServiceType, setChosenServiceType] = useState<string | undefined>(serviceTypeId);
  const [error, setError] = useState('');

  const activeServiceType = chosenServiceType ?? serviceTypeId;
  const { data, isFetching, isError, error: fetchError, refetch } = usePcoKnownItems(activeServiceType, true);

  const save = async (patch: Partial<PcoRules>) => {
    setError('');
    try {
      await patchRules(patch);
    } catch (maybeError) {
      setError(maybeAxiosError(maybeError));
    }
  };

  const setItemEffect = (title: string, effect: PcoRuleEffect) =>
    save({ timerRules: withEffectForTitle(rules, title, effect).timerRules });

  const defaultTiming = timingOf(rules.defaultEffect);

  return (
    <Panel.Card>
      <Panel.SubHeader>
        Import defaults
        <Panel.InlineElements>
          <Button
            variant='ontime-subtle'
            size='sm'
            rightIcon={<IoRefresh />}
            onClick={() => refetch()}
            isLoading={isFetching}
            isDisabled={!activeServiceType}
          >
            Re-read run sheets
          </Button>
        </Panel.InlineElements>
      </Panel.SubHeader>
      <Panel.Divider />

      <Panel.Section>
        {error && <Panel.Error>{error}</Panel.Error>}
        {isError && <Panel.Error>{maybeAxiosError(fetchError)}</Panel.Error>}

        <Panel.Title>Every event</Panel.Title>
        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field
              title='Default timing'
              description='Applied to every imported event, then overridden by the rules below'
            />
            <Select
              size='sm'
              width='12rem'
              variant='ontime'
              value={defaultTiming === 'default' ? 'count-to-end' : defaultTiming}
              isDisabled={isSaving}
              onChange={(event) =>
                save({ defaultEffect: applyTiming(rules.defaultEffect, event.target.value as TimingChoice) })
              }
            >
              <option value='count-to-end'>{timingLabels['count-to-end']}</option>
              <option value='fixed-duration'>{timingLabels['fixed-duration']}</option>
            </Select>
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Hold durations after an overrun'
              description='Once an event keeps its own length, everything after it in the same section does too, so an overrunning message pushes the announcements instead of eating them'
            />
            <Switch
              variant='ontime'
              size='lg'
              isChecked={rules.fixedDurationCarriesForward}
              isDisabled={isSaving}
              onChange={(event) => save({ fixedDurationCarriesForward: event.target.checked })}
            />
          </Panel.ListItem>
          <Panel.ListItem>
            <Panel.Field
              title='Run sheet headings'
              description='What a Planning Center header becomes. A heading still marks where a section ends whichever this is'
            />
            <Select
              size='sm'
              width='12rem'
              variant='ontime'
              value={rules.headersBecome}
              isDisabled={isSaving}
              onChange={(event) => save({ headersBecome: event.target.value as PcoHeaderHandling })}
            >
              <option value='nothing'>Leave them out</option>
              <option value='block'>An Ontime block</option>
              <option value='event'>An event</option>
            </Select>
          </Panel.ListItem>
        </Panel.ListGroup>

        <PcoPreServiceRun rules={rules} save={save} isSaving={isSaving} />

        <Panel.Title>
          Run sheet items
          {rules.pinnedServiceTypes.length > 1 && (
            <Panel.InlineElements>
              <Select
                size='sm'
                width='12rem'
                variant='ontime'
                value={activeServiceType}
                onChange={(event) => setChosenServiceType(event.target.value)}
              >
                {rules.pinnedServiceTypes.map((pinned) => (
                  <option key={pinned.id} value={pinned.id}>
                    {pinned.name}
                  </option>
                ))}
              </Select>
            </Panel.InlineElements>
          )}
        </Panel.Title>

        {!activeServiceType ? (
          <Panel.Paragraph>Pin a service type on the Planning Center tab to read its run sheets.</Panel.Paragraph>
        ) : (
          <>
            <Panel.Description>
              {data
                ? `The items on the next ${data.plansSampled} ${data.serviceTypeName} run sheets. A choice here applies to every import.`
                : 'Reading the next few run sheets from Planning Center...'}
            </Panel.Description>
            <Panel.Loader isLoading={isFetching && !data} />

            {data && (
              <Panel.Table>
                <thead>
                  <tr>
                    <th className={style.fullWidth}>Item</th>
                    <th className={style.fit}>Weeks</th>
                    <th className={style.fit}>Usual</th>
                    <th className={style.fit}>Timing</th>
                    <th className={style.fit}>Hide timer</th>
                    <th className={style.fit}>Aux timer</th>
                    <th className={style.fit}>Skip</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.length === 0 && <Panel.TableEmpty label='No items found on these plans' />}
                  {data.items.map((item) => (
                    <KnownItemRow
                      key={item.title}
                      item={item}
                      plansSampled={data.plansSampled}
                      effect={effectForTitle(rules, item.title)}
                      isSaving={isSaving}
                      onChange={(effect) => setItemEffect(item.title, effect)}
                    />
                  ))}
                </tbody>
              </Panel.Table>
            )}
          </>
        )}

        <Panel.Title>Rules written by hand</Panel.Title>
        <Panel.Description>
          Rules from pco-rules.json which match on a pattern rather than a single title. They are applied after the
          choices above, and can be removed here.
        </Panel.Description>
        <Panel.Table>
          <thead>
            <tr>
              <th className={style.fullWidth}>Rule</th>
              <th className={style.fit}>Matches</th>
              <th className={style.fit}>Does</th>
              <th className={style.fit} />
            </tr>
          </thead>
          <tbody>
            {handWrittenRules(rules).length === 0 && <Panel.TableEmpty label='No pattern rules' />}
            {handWrittenRules(rules).map((rule) => (
              <tr key={`${rule.name}-${describeMatch(rule)}`}>
                <td>{rule.name}</td>
                <td className={style.muted}>{describeMatch(rule)}</td>
                <td className={style.muted}>{describeEffect(rule.effect)}</td>
                <td className={style.fit}>
                  <IconButton
                    size='sm'
                    variant='ontime-ghosted'
                    aria-label={`Remove ${rule.name}`}
                    icon={<IoTrash />}
                    isDisabled={isSaving}
                    onClick={() =>
                      save({
                        timerRules: removeRuleAt(rules, rules.timerRules.indexOf(rule)).timerRules,
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Panel.Table>
      </Panel.Section>
    </Panel.Card>
  );
}

interface KnownItemRowProps {
  item: PcoKnownItem;
  plansSampled: number;
  effect: PcoRuleEffect;
  isSaving: boolean;
  onChange: (effect: PcoRuleEffect) => void;
}

/** why a row cannot take these settings, and null when it can */
const dispositionReason: Record<PcoItemDisposition, string | null> = {
  event: null,
  block: 'imports as a block',
  collapsed: 'folded in with its section',
  merged: 'merged into the entry above',
  ignored: 'not imported',
};

function KnownItemRow({ item, plansSampled, effect, isSaving, onChange }: KnownItemRowProps) {
  // a pattern rule already covering this item is worth saying, since it wins unless
  // a choice here overrides it
  const coveredElsewhere = item.matchedBy && item.matchedBy !== item.title;

  /**
   * Nothing here can change an item that does not become an event of its own. The
   * controls are disabled rather than hidden, so the row still reads as part of the
   * run sheet and says why it takes no settings.
   */
  const reason = dispositionReason[item.disposition];
  const inert = reason !== null;

  return (
    <tr>
      <td>
        {item.title}
        {item.itemType === 'header' && <span className={style.muted}> · section</span>}
        {reason && <span className={style.muted}> · {reason}</span>}
        {coveredElsewhere && !inert && <span className={style.muted}> · rule: {item.matchedBy}</span>}
      </td>
      <td className={style.numeric}>
        {item.planCount}/{plansSampled}
      </td>
      <td className={style.numeric}>{lengthLabel(item.typicalLength)}</td>
      <td className={style.fit}>
        <Select
          size='sm'
          width='11rem'
          variant='ontime'
          value={timingOf(effect)}
          isDisabled={isSaving || inert}
          onChange={(event) => onChange(applyTiming(effect, event.target.value as TimingChoice))}
        >
          {Object.entries(timingLabels).map(([choice, label]) => (
            <option key={choice} value={choice}>
              {label}
            </option>
          ))}
        </Select>
      </td>
      {toggleKeys.map((key) => (
        <td key={key} className={style.fit}>
          <Switch
            variant='ontime'
            size='md'
            aria-label={`${toggleLabels[key].title} for ${item.title}`}
            isChecked={Boolean(effect[key])}
            isDisabled={isSaving || inert}
            onChange={(event) => onChange(applyToggle(effect, key, event.target.checked))}
          />
        </td>
      ))}
    </tr>
  );
}

import { IoAdd, IoArrowDown, IoArrowUp, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input, Switch } from '@chakra-ui/react';
import type { PcoInferredEntry, PcoRules } from 'ontime-types';
import { millisToString, parseUserTime, removeLeadingZero } from 'ontime-utils';

import * as Panel from '../../panel-utils/PanelUtils';

import { moveRunStep, newRunStep, runLength, runSteps, withRunSteps } from './pcoRuleUtils';

import style from './PcoPanel.module.scss';

interface PcoPreServiceRunProps {
  rules: PcoRules;
  save: (patch: Partial<PcoRules>) => void;
  isSaving: boolean;
}

const lengthLabel = (millis: number): string => removeLeadingZero(millisToString(millis));

const DEFAULT_LEAD_IN = { title: 'Power On', duration: 60 * 60 * 1000 };

/**
 * The morning before the run sheet starts.
 *
 * Planning Center holds it twice removed: as the plan's `rehearsal` times, which
 * carry their own names and clock times, and as headings that state a time in their
 * title and nowhere else. Both are read at import, so this panel configures the
 * reading rather than holding a copy of the morning -- a copy would go stale the
 * first time somebody moved the soundcheck in Planning Center.
 *
 * What is left to state here is the lead-in, and any step the plan genuinely does
 * not record.
 */
export default function PcoPreServiceRun({ rules, save, isSaving }: PcoPreServiceRunProps) {
  const steps = runSteps(rules);

  const write = (next: PcoInferredEntry[]) => save({ inferredEntries: withRunSteps(rules, next).inferredEntries });

  const replace = (index: number, step: Partial<PcoInferredEntry>) =>
    write(steps.map((existing, at) => (at === index ? { ...existing, ...step } : existing)));

  const setTitle = (index: number, title: string) => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === steps[index].title) {
      return;
    }
    // the name is what an import warning calls it, so the two are kept together
    replace(index, { title: trimmed, name: trimmed });
  };

  const setLength = (index: number, value: string) => {
    const duration = parseUserTime(value);
    if (!Number.isFinite(duration) || duration < 0 || duration === steps[index].duration) {
      return;
    }
    replace(index, { duration });
  };

  const setLeadInLength = (value: string) => {
    const duration = parseUserTime(value);
    if (!Number.isFinite(duration) || duration <= 0 || duration === rules.leadIn?.duration) {
      return;
    }
    save({ leadIn: { ...(rules.leadIn ?? DEFAULT_LEAD_IN), duration } });
  };

  const setLeadInTitle = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === rules.leadIn?.title) {
      return;
    }
    save({ leadIn: { ...(rules.leadIn ?? DEFAULT_LEAD_IN), title: trimmed } });
  };

  return (
    <>
      <Panel.Title>Before the run sheet</Panel.Title>
      <Panel.Description>
        The Planning Center plan starts at doors. The morning above it is read off the plan, so moving a soundcheck in
        Planning Center moves it here.
      </Panel.Description>

      <Panel.ListGroup>
        <Panel.ListItem>
          <Panel.Field
            title='Read the production run from the plan'
            description='Every rehearsal time on the plan becomes an entry, at the time and length Planning Center gives it. Two rehearsals at once keep one row, and the other is recorded in its note. Staffing call times are left out'
          />
          <Switch
            variant='ontime'
            size='lg'
            isChecked={rules.deriveRehearsalTimes}
            isDisabled={isSaving}
            onChange={(event) => save({ deriveRehearsalTimes: event.target.checked })}
          />
        </Panel.ListItem>
        <Panel.ListItem>
          <Panel.Field
            title='Read headings that state a time'
            description='A heading like "SERVICE BRIEFING 8:05am" is the only record that the briefing happens. Read, it becomes an entry at 8:05 running until whatever is next; left alone, it is dropped with every other heading'
          />
          <Switch
            variant='ontime'
            size='lg'
            isChecked={rules.deriveTimedHeaders}
            isDisabled={isSaving}
            onChange={(event) => save({ deriveTimedHeaders: event.target.checked })}
          />
        </Panel.ListItem>
        <Panel.ListItem>
          <Panel.Field
            title='Lead-in'
            description='Ends where the first rehearsal time starts, so the first timer has something to run against. Powering the building on is the one part of the morning Planning Center does not record'
          />
          <Panel.InlineElements>
            <Input
              size='sm'
              width='10rem'
              variant='ontime-filled'
              autoComplete='off'
              aria-label='Lead-in name'
              placeholder='No lead-in'
              defaultValue={rules.leadIn?.title ?? ''}
              isDisabled={isSaving}
              onBlur={(event) => setLeadInTitle(event.target.value)}
            />
            <Input
              size='sm'
              width='6rem'
              variant='ontime-filled'
              autoComplete='off'
              aria-label='Lead-in length'
              defaultValue={rules.leadIn ? lengthLabel(rules.leadIn.duration) : ''}
              isDisabled={isSaving || !rules.leadIn}
              onBlur={(event) => setLeadInLength(event.target.value)}
            />
            <IconButton
              size='sm'
              variant='ontime-ghosted'
              aria-label='Remove the lead-in'
              icon={<IoTrash />}
              isDisabled={isSaving || !rules.leadIn}
              onClick={() => save({ leadIn: null })}
            />
          </Panel.InlineElements>
        </Panel.ListItem>
      </Panel.ListGroup>

      <Panel.Title>
        Steps the plan does not hold
        <Panel.InlineElements>
          <Button
            variant='ontime-subtle'
            size='sm'
            rightIcon={<IoAdd />}
            isDisabled={isSaving}
            onClick={() => write([...steps, newRunStep()])}
          >
            Add step
          </Button>
        </Panel.InlineElements>
      </Panel.Title>
      <Panel.Description>
        Added ahead of the run sheet, one after another, ending where its first item begins -- so they follow the
        service rather than a fixed clock time. Normally empty: anything Planning Center records belongs there, where it
        stays current.
        {steps.length > 0 && ` This run adds up to ${lengthLabel(runLength(steps))}.`}
      </Panel.Description>

      <Panel.Table>
        <thead>
          <tr>
            <th className={style.fullWidth}>Step</th>
            <th className={style.fit}>Length</th>
            <th className={style.fit}>Before the sheet</th>
            <th className={style.fit} />
          </tr>
        </thead>
        <tbody>
          {steps.length === 0 && <Panel.TableEmpty label='The whole morning is read from the plan' />}
          {steps.map((step, index) => (
            <tr key={`${index}-${step.title}`}>
              <td>
                <Input
                  size='sm'
                  variant='ontime-filled'
                  autoComplete='off'
                  defaultValue={step.title}
                  isDisabled={isSaving}
                  onBlur={(event) => setTitle(index, event.target.value)}
                />
              </td>
              <td className={style.fit}>
                <Input
                  size='sm'
                  width='6rem'
                  variant='ontime-filled'
                  autoComplete='off'
                  aria-label={`Length of ${step.title}`}
                  defaultValue={lengthLabel(step.duration)}
                  isDisabled={isSaving}
                  onBlur={(event) => setLength(index, event.target.value)}
                />
              </td>
              <td className={style.numeric}>{lengthLabel(-step.offset)}</td>
              <td className={style.fit}>
                <Panel.InlineElements>
                  <IconButton
                    size='sm'
                    variant='ontime-ghosted'
                    aria-label={`Move ${step.title} earlier`}
                    icon={<IoArrowUp />}
                    isDisabled={isSaving || index === 0}
                    onClick={() => write(moveRunStep(steps, index, index - 1))}
                  />
                  <IconButton
                    size='sm'
                    variant='ontime-ghosted'
                    aria-label={`Move ${step.title} later`}
                    icon={<IoArrowDown />}
                    isDisabled={isSaving || index === steps.length - 1}
                    onClick={() => write(moveRunStep(steps, index, index + 1))}
                  />
                  <IconButton
                    size='sm'
                    variant='ontime-ghosted'
                    aria-label={`Remove ${step.title}`}
                    icon={<IoTrash />}
                    isDisabled={isSaving}
                    onClick={() => write(steps.filter((_, at) => at !== index))}
                  />
                </Panel.InlineElements>
              </td>
            </tr>
          ))}
        </tbody>
      </Panel.Table>
    </>
  );
}

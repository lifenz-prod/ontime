import { IoAdd, IoArrowDown, IoArrowUp, IoTrash } from 'react-icons/io5';
import { Button, IconButton, Input } from '@chakra-ui/react';
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

/**
 * The morning before the run sheet starts.
 *
 * Planning Center holds none of this: its plan opens at doors, and everything
 * earlier -- power on, soundcheck, the briefing, the prayer meeting -- belongs to
 * the production team. The run is entered as lengths in order and back-times as one
 * chain, so a service that moves takes the whole morning with it and a step that
 * gets longer pushes everything before it earlier.
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

  return (
    <>
      <Panel.Title>
        Before the run sheet
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
        The Planning Center plan starts at doors. These entries are added ahead of it, one after another, ending where
        its first item begins -- so they follow the service rather than a fixed clock time. This run adds up to{' '}
        {lengthLabel(runLength(steps))}.
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
          {steps.length === 0 && <Panel.TableEmpty label='Nothing runs before the sheet' />}
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

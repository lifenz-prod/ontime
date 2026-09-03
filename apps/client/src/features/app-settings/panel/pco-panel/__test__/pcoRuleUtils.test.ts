import { type PcoInferredEntry, type PcoRules, type PcoTimerRule, TimerType, TimeStrategy } from 'ontime-types';
import { describe, expect, it } from 'vitest';

import {
  applyTiming,
  applyToggle,
  describeEffect,
  effectForTitle,
  foldChoiceOf,
  handWrittenRules,
  hasServiceTypeEffect,
  importAsOf,
  isEffectEmpty,
  isPanelRule,
  moveRunStep,
  runSteps,
  serviceTypeEffectFor,
  timingOf,
  withEffectForTitle,
  withFoldChoice,
  withRunSteps,
  withServiceTypeEffect,
} from '../pcoRuleUtils';

const shippedRule: PcoTimerRule = {
  name: 'message is a fixed-duration countdown',
  match: { titleMatch: '^\\s*(message|sermon)\\b' },
  effect: { timerType: TimerType.CountDown, countToEnd: false, timeStrategy: TimeStrategy.LockDuration },
};

const rulesWith = (timerRules: PcoTimerRule[]) => ({ timerRules }) as PcoRules;

describe('isPanelRule', () => {
  it('claims a rule that matches a title and nothing else', () => {
    expect(isPanelRule({ name: 'x', match: { titleContains: 'welcome' }, effect: {} })).toBe(true);
  });

  it('leaves a regex rule alone', () => {
    expect(isPanelRule(shippedRule)).toBe(false);
  });

  it('leaves a rule that also narrows by type or position alone', () => {
    // flattening these into a title row would quietly widen what they match
    expect(isPanelRule({ name: 'x', match: { titleContains: 'a', itemType: 'header' }, effect: {} })).toBe(false);
    expect(isPanelRule({ name: 'x', match: { titleContains: 'a', servicePosition: 'pre' }, effect: {} })).toBe(false);
  });
});

describe('effectForTitle', () => {
  const rules = rulesWith([
    shippedRule,
    { name: 'Pre Service Video', match: { titleContains: 'Pre Service Video' }, effect: { hideTimer: true } },
  ]);

  it('finds the effect the panel wrote', () => {
    expect(effectForTitle(rules, 'Pre Service Video')).toEqual({ hideTimer: true });
  });

  it('matches the title case insensitively', () => {
    expect(effectForTitle(rules, 'pre service video')).toEqual({ hideTimer: true });
  });

  it('is empty for a title with no rule of ours', () => {
    expect(effectForTitle(rules, 'Welcome')).toEqual({});
  });

  it('does not read a hand-written rule as a title rule', () => {
    // the shipped rule covers Message, but it is not ours to edit
    expect(effectForTitle(rules, 'Message')).toEqual({});
  });
});

describe('timingOf and applyTiming', () => {
  it('reads the three states', () => {
    expect(timingOf({})).toBe('default');
    expect(timingOf({ countToEnd: true })).toBe('count-to-end');
    expect(timingOf({ countToEnd: false })).toBe('fixed-duration');
  });

  it('writes a fixed duration countdown', () => {
    expect(applyTiming({}, 'fixed-duration')).toEqual({
      timerType: TimerType.CountDown,
      countToEnd: false,
      timeStrategy: TimeStrategy.LockDuration,
    });
  });

  it('writes a countdown to a time', () => {
    expect(applyTiming({}, 'count-to-end')).toEqual({
      timerType: TimerType.CountDown,
      countToEnd: true,
      timeStrategy: TimeStrategy.LockEnd,
    });
  });

  it('clears the timing keys rather than writing the shipped values into the rule', () => {
    // so an event with no opinion keeps following defaultEffect when that changes
    const set = applyTiming({ hideTimer: true }, 'fixed-duration');
    expect(applyTiming(set, 'default')).toEqual({ hideTimer: true });
  });

  it('leaves the other keys alone', () => {
    expect(applyTiming({ skip: true }, 'count-to-end').skip).toBe(true);
  });
});

describe('applyToggle', () => {
  it('sets a switch', () => {
    expect(applyToggle({}, 'hideTimer', true)).toEqual({ hideTimer: true });
  });

  it('removes the key instead of writing false', () => {
    // a rule should hold only what was actually chosen
    expect(applyToggle({ hideTimer: true, skip: true }, 'hideTimer', false)).toEqual({ skip: true });
  });
});

describe('withEffectForTitle', () => {
  it('puts a new rule ahead of the shipped ones, because first match wins', () => {
    const next = withEffectForTitle(rulesWith([shippedRule]), 'Message', { hideTimer: true });

    expect(next.timerRules[0].match.titleContains).toBe('Message');
    expect(next.timerRules[1]).toBe(shippedRule);
  });

  it('updates in place, keeping the order', () => {
    const rules = rulesWith([
      { name: 'A', match: { titleContains: 'A' }, effect: { skip: true } },
      { name: 'B', match: { titleContains: 'B' }, effect: { hideTimer: true } },
    ]);
    const next = withEffectForTitle(rules, 'B', { hideTimer: true, skip: true });

    expect(next.timerRules.map((rule) => rule.name)).toEqual(['A', 'B']);
    expect(next.timerRules[1].effect).toEqual({ hideTimer: true, skip: true });
  });

  it('removes the rule when the last choice is cleared', () => {
    const rules = rulesWith([{ name: 'A', match: { titleContains: 'A' }, effect: { skip: true } }]);
    const cleared = applyToggle(effectForTitle(rules, 'A'), 'skip', false);

    expect(withEffectForTitle(rules, 'A', cleared).timerRules).toEqual([]);
  });

  it('never leaves a rule that matches and does nothing', () => {
    const next = withEffectForTitle(rulesWith([]), 'Welcome', {});
    expect(next.timerRules).toEqual([]);
  });

  it('names the rule after the title, so it reads in an import warning', () => {
    const next = withEffectForTitle(rulesWith([]), 'Pre Service Video', { hideTimer: true });
    expect(next.timerRules[0].name).toBe('Pre Service Video');
  });
});

describe('handWrittenRules', () => {
  it('separates the rules the panel cannot round-trip', () => {
    const rules = rulesWith([shippedRule, { name: 'A', match: { titleContains: 'A' }, effect: { skip: true } }]);
    expect(handWrittenRules(rules)).toEqual([shippedRule]);
  });
});

describe('describeEffect', () => {
  it('says when nothing is set', () => {
    expect(describeEffect({})).toBe('No changes');
  });

  it('reads the choices back in plain words', () => {
    expect(describeEffect({ countToEnd: false, hideTimer: true })).toBe('Fixed duration · Hide timer');
  });

  it('says when a rule renames an event', () => {
    expect(describeEffect({ title: 'Message - LINK' })).toBe('rename to "Message - LINK"');
  });
});

describe('isEffectEmpty', () => {
  it('treats an effect of only undefined values as empty', () => {
    expect(isEffectEmpty({ hideTimer: undefined })).toBe(true);
    expect(isEffectEmpty({ hideTimer: true })).toBe(false);
  });
});

describe('the pre-service run', () => {
  const minute = 60 * 1000;

  const step = (title: string, minutes: number): PcoInferredEntry => ({
    name: title,
    title,
    section: 'pre',
    anchor: 'pre-start',
    offset: 0,
    duration: minutes * minute,
  });

  const rulesWithRun = (steps: PcoInferredEntry[], others: PcoInferredEntry[] = []) =>
    ({ inferredEntries: [...steps, ...others] }) as PcoRules;

  it('chains the steps so the last one ends where the run sheet starts', () => {
    const { inferredEntries } = withRunSteps(rulesWithRun([]), [step('Call Time', 5), step('Soundcheck', 20)]);

    expect(inferredEntries.map((entry) => entry.offset)).toEqual([-25 * minute, -20 * minute]);
  });

  it('re-times everything ahead of a step that gets longer', () => {
    const steps = [step('Call Time', 5), step('Soundcheck', 20)];
    const longer = [{ ...steps[0] }, { ...steps[1], duration: 30 * minute }];

    expect(withRunSteps(rulesWithRun(steps), longer).inferredEntries.map((entry) => entry.offset)).toEqual([
      -35 * minute,
      -30 * minute,
    ]);
  });

  it('leaves an entry anchored somewhere else alone', () => {
    // the table only owns the chain; a hand-written entry is not part of it
    const other: PcoInferredEntry = { ...step('Debrief', 10), anchor: 'service-end', section: 'service', offset: 0 };
    const rules = rulesWithRun([step('Call Time', 5)], [other]);

    expect(runSteps(rules)).toHaveLength(1);
    expect(withRunSteps(rules, runSteps(rules)).inferredEntries).toContainEqual(other);
  });

  it('moves a step within the run', () => {
    const steps = [step('A', 5), step('B', 5), step('C', 5)];
    expect(moveRunStep(steps, 2, 0).map((entry) => entry.title)).toEqual(['C', 'A', 'B']);
  });

  it('refuses a move that would fall off either end', () => {
    const steps = [step('A', 5), step('B', 5)];
    expect(moveRunStep(steps, 0, -1)).toBe(steps);
    expect(moveRunStep(steps, 1, 2)).toBe(steps);
  });
});

describe('rules the import page writes against one service type', () => {
  const empty = { timerRules: [], serviceTypeRules: {} } as unknown as PcoRules;

  it('writes a choice under the service type it was made on', () => {
    const next = withServiceTypeEffect(empty, '156118', 'Fun', { hideTimer: true });

    expect(next.serviceTypeRules['156118']).toEqual([
      { name: 'Fun', match: { titleContains: 'Fun' }, effect: { hideTimer: true } },
    ]);
    // the organisation-wide rules are not where a per-plan-type choice belongs
    expect(next.timerRules).toEqual([]);
  });

  it('leaves the other service types alone', () => {
    const one = withServiceTypeEffect(empty, '156118', 'Fun', { hideTimer: true });
    const two = withServiceTypeEffect(one, '158458', 'Fun', { skip: true });

    expect(two.serviceTypeRules['156118'][0].effect).toEqual({ hideTimer: true });
    expect(two.serviceTypeRules['158458'][0].effect).toEqual({ skip: true });
  });

  it('replaces a choice rather than stacking a second rule on the same title', () => {
    const one = withServiceTypeEffect(empty, '156118', 'Fun', { hideTimer: true });
    const two = withServiceTypeEffect(one, '156118', 'Fun', { skip: true });

    expect(two.serviceTypeRules['156118']).toHaveLength(1);
    expect(two.serviceTypeRules['156118'][0].effect).toEqual({ skip: true });
  });

  it('puts a new choice first, since first match wins', () => {
    const one = withServiceTypeEffect(empty, '156118', 'Fun', { hideTimer: true });
    const two = withServiceTypeEffect(one, '156118', 'Welcome', { skip: true });

    expect(two.serviceTypeRules['156118'].map((rule) => rule.name)).toEqual(['Welcome', 'Fun']);
  });

  it('removes the rule when a row is reset, rather than leaving one that does nothing', () => {
    const one = withServiceTypeEffect(empty, '156118', 'Fun', { hideTimer: true });
    const reset = withServiceTypeEffect(one, '156118', 'Fun', {});

    expect(reset.serviceTypeRules['156118']).toBeUndefined();
    expect(hasServiceTypeEffect(reset, '156118', 'Fun')).toBe(false);
  });

  it('reads back only what the service type explicitly holds', () => {
    const rules = withServiceTypeEffect(empty, '156118', 'Fun', { hideTimer: true });

    expect(serviceTypeEffectFor(rules, '156118', 'Fun')).toEqual({ hideTimer: true });
    // nothing is set for these, so a change starts from empty and does not freeze the defaults
    expect(serviceTypeEffectFor(rules, '156118', 'Welcome')).toEqual({});
    expect(serviceTypeEffectFor(rules, '158458', 'Fun')).toEqual({});
  });

  it('survives rules written before service type rules existed', () => {
    const old = { timerRules: [] } as unknown as PcoRules;
    expect(hasServiceTypeEffect(old, '156118', 'Fun')).toBe(false);
    expect(serviceTypeEffectFor(old, '156118', 'Fun')).toEqual({});
    expect(withServiceTypeEffect(old, '156118', 'Fun', { skip: true }).serviceTypeRules['156118']).toHaveLength(1);
  });
});

describe('importAsOf', () => {
  it('reads a disposition back as the choice the row shows', () => {
    expect(importAsOf('event')).toBe('event');
    expect(importAsOf('block')).toBe('block');
    expect(importAsOf('ignored')).toBe('omit');
  });

  it('shows a folded or merged item as an event, since it does reach the rundown', () => {
    // its row is disabled with a reason, so the select is only ever read here
    expect(importAsOf('collapsed')).toBe('event');
    expect(importAsOf('merged')).toBe('event');
  });
});

describe('how much of a folded section folds', () => {
  const withFolds = (collapseSections: PcoRules['collapseSections']) => ({ collapseSections }) as PcoRules;
  const worship = { name: 'worship', match: { itemType: 'header' as const, titleContains: 'praise & worship' } };

  it('reads the shipped default as songs only', () => {
    expect(foldChoiceOf(withFolds([{ ...worship, membersMatch: { itemType: 'song' } }]))).toBe('songs');
  });

  it('reads a rule with no member match as folding the whole section', () => {
    expect(foldChoiceOf(withFolds([worship]))).toBe('section');
  });

  it('needs every fold to agree before it claims songs only', () => {
    const mixed = withFolds([{ ...worship, membersMatch: { itemType: 'song' } }, { ...worship, name: 'other' }]);
    expect(foldChoiceOf(mixed)).toBe('section');
  });

  it('says section when there is nothing folded at all, so the control reads as off', () => {
    expect(foldChoiceOf(withFolds([]))).toBe('section');
  });

  it('switches every fold to the songs', () => {
    const next = withFoldChoice(withFolds([worship]), 'songs');
    expect(next.collapseSections[0].membersMatch).toEqual({ itemType: 'song' });
  });

  it('takes the member match off rather than writing one that matches everything', () => {
    const songs = withFoldChoice(withFolds([worship]), 'songs');
    const back = withFoldChoice(songs, 'section');

    expect(back.collapseSections[0]).not.toHaveProperty('membersMatch');
    expect(foldChoiceOf(back)).toBe('section');
  });

  it('leaves the rest of a fold rule alone', () => {
    const named = withFolds([{ ...worship, title: 'Praise & Worship', listContents: false }]);
    const next = withFoldChoice(named, 'songs');

    expect(next.collapseSections[0].title).toBe('Praise & Worship');
    expect(next.collapseSections[0].listContents).toBe(false);
  });
});

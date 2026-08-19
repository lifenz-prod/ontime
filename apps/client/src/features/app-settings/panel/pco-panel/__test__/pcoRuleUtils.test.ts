import { type PcoRules, type PcoTimerRule, TimerType, TimeStrategy } from 'ontime-types';
import { describe, expect, it } from 'vitest';

import {
  applyTiming,
  applyToggle,
  describeEffect,
  effectForTitle,
  handWrittenRules,
  isEffectEmpty,
  isPanelRule,
  timingOf,
  withEffectForTitle,
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
});

describe('isEffectEmpty', () => {
  it('treats an effect of only undefined values as empty', () => {
    expect(isEffectEmpty({ hideTimer: undefined })).toBe(true);
    expect(isEffectEmpty({ hideTimer: true })).toBe(false);
  });
});

import { type PcoRuleEffect, type PcoRules, type PcoTimerRule, TimerType, TimeStrategy } from 'ontime-types';

/**
 * Reading and writing the rules this panel owns.
 *
 * The panel does not ask anyone to write a regex. Each row it shows is one run
 * sheet title, and the rule behind it matches that title as a literal substring.
 * A rule shaped that way is "ours" and round-trips through the panel; anything
 * else was written by hand and is shown but not edited.
 */

/** how an event gets its time, as the panel offers it */
export type TimingChoice = 'default' | 'count-to-end' | 'fixed-duration';

export const timingLabels: Record<TimingChoice, string> = {
  default: 'Use default',
  'count-to-end': 'Countdown to Time',
  'fixed-duration': 'Fixed duration',
};

/** the effect keys the panel exposes as switches */
export const toggleKeys = ['hideTimer', 'showAsAuxTimer', 'skip'] as const;
export type ToggleKey = (typeof toggleKeys)[number];

export const toggleLabels: Record<ToggleKey, { title: string; description: string }> = {
  hideTimer: { title: 'Hide timer', description: 'The event runs without showing a countdown' },
  showAsAuxTimer: { title: 'Show as aux timer', description: 'Runs on the auxiliary timer instead of the main one' },
  skip: { title: 'Skip', description: 'Playback passes over the event' },
};

/**
 * Whether a rule is one of ours: it matches a title and nothing else.
 * A rule that also narrows by item type or position was written by hand, and
 * flattening it into a title row would quietly change what it does.
 */
export function isPanelRule(rule: PcoTimerRule): boolean {
  const { titleContains, titleMatch, itemType, servicePosition } = rule.match;
  return Boolean(titleContains) && !titleMatch && !itemType && !servicePosition;
}

function panelRuleIndex(rules: PcoRules, title: string): number {
  const wanted = title.trim().toLowerCase();
  return rules.timerRules.findIndex(
    (rule) => isPanelRule(rule) && rule.match.titleContains?.trim().toLowerCase() === wanted,
  );
}

/** the effect the panel holds for a title, empty when nothing is set */
export function effectForTitle(rules: PcoRules, title: string): PcoRuleEffect {
  const index = panelRuleIndex(rules, title);
  return index === -1 ? {} : rules.timerRules[index].effect;
}

export function isEffectEmpty(effect: PcoRuleEffect): boolean {
  return Object.values(effect).every((value) => value === undefined);
}

export function timingOf(effect: PcoRuleEffect): TimingChoice {
  if (effect.countToEnd === true) return 'count-to-end';
  if (effect.countToEnd === false) return 'fixed-duration';
  return 'default';
}

/**
 * Sets the timing on an effect.
 *
 * `default` clears all three keys rather than writing the shipped values into the
 * rule, so an event with no opinion keeps following `defaultEffect` when that
 * changes.
 */
export function applyTiming(effect: PcoRuleEffect, choice: TimingChoice): PcoRuleEffect {
  const { timerType: _timerType, countToEnd: _countToEnd, timeStrategy: _timeStrategy, ...rest } = effect;

  if (choice === 'count-to-end') {
    return { ...rest, timerType: TimerType.CountDown, countToEnd: true, timeStrategy: TimeStrategy.LockEnd };
  }
  if (choice === 'fixed-duration') {
    return { ...rest, timerType: TimerType.CountDown, countToEnd: false, timeStrategy: TimeStrategy.LockDuration };
  }
  return rest;
}

export function applyToggle(effect: PcoRuleEffect, key: ToggleKey, value: boolean): PcoRuleEffect {
  if (value) {
    return { ...effect, [key]: true };
  }
  // removed rather than set false, so the rule holds only what was actually chosen
  const next = { ...effect };
  delete next[key];
  return next;
}

/**
 * Puts an effect back into the rules for one title.
 *
 * A new rule goes to the FRONT of the list. First match wins, so a choice made in
 * the panel has to sit ahead of the shipped regex rules or it would appear to do
 * nothing. An emptied effect removes the rule instead of leaving a rule that
 * matches and does nothing.
 */
export function withEffectForTitle(rules: PcoRules, title: string, effect: PcoRuleEffect): PcoRules {
  const index = panelRuleIndex(rules, title);
  const timerRules = [...rules.timerRules];

  if (isEffectEmpty(effect)) {
    if (index !== -1) {
      timerRules.splice(index, 1);
    }
    return { ...rules, timerRules };
  }

  const rule: PcoTimerRule = { name: title, match: { titleContains: title }, effect };

  if (index === -1) {
    timerRules.unshift(rule);
  } else {
    timerRules[index] = rule;
  }

  return { ...rules, timerRules };
}

/** rules written by hand, which the panel lists but does not edit */
export function handWrittenRules(rules: PcoRules): PcoTimerRule[] {
  return rules.timerRules.filter((rule) => !isPanelRule(rule));
}

/** a plain description of what a hand-written rule matches */
export function describeMatch(rule: PcoTimerRule): string {
  const parts: string[] = [];
  if (rule.match.titleContains) parts.push(`title contains "${rule.match.titleContains}"`);
  if (rule.match.titleMatch) parts.push(`title matches /${rule.match.titleMatch}/i`);
  if (rule.match.itemType) parts.push(`type is ${rule.match.itemType}`);
  if (rule.match.servicePosition) parts.push(`position is ${rule.match.servicePosition}`);
  return parts.length > 0 ? parts.join(', ') : 'matches nothing';
}

/** a plain description of what an effect does, for the summary line on a row */
export function describeEffect(effect: PcoRuleEffect): string {
  const parts: string[] = [];
  const timing = timingOf(effect);
  if (timing !== 'default') parts.push(timingLabels[timing]);
  for (const key of toggleKeys) {
    if (effect[key]) parts.push(toggleLabels[key].title);
  }
  if (effect.colour) parts.push(`colour ${effect.colour}`);
  if (effect.isPublic !== undefined) parts.push(effect.isPublic ? 'public' : 'not public');
  return parts.length > 0 ? parts.join(' · ') : 'No changes';
}

export function removeRuleAt(rules: PcoRules, index: number): PcoRules {
  const timerRules = [...rules.timerRules];
  timerRules.splice(index, 1);
  return { ...rules, timerRules };
}

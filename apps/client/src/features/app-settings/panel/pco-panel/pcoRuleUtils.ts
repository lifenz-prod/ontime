import {
  type PcoInferredEntry,
  type PcoItemDisposition,
  type PcoItemImportAs,
  type PcoRuleEffect,
  type PcoRules,
  type PcoTimerRule,
  EndAction,
  TimerType,
  TimeStrategy,
} from 'ontime-types';

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

/* -------------------------------------------------------------------------- */
/* rules scoped to one service type, which the import page writes               */
/* -------------------------------------------------------------------------- */

/**
 * A run sheet item means different things on different service types -- "Message"
 * is forty minutes on Central AM and twenty-five on Central PM -- so a choice made
 * while importing one plan is remembered against its service type and left out of
 * the others. These are applied ahead of the organisation-wide rules.
 */
export function serviceTypeRulesOf(rules: PcoRules, serviceTypeId: string): PcoTimerRule[] {
  return rules.serviceTypeRules?.[serviceTypeId] ?? [];
}

function ruleIndexIn(list: PcoTimerRule[], title: string): number {
  const wanted = title.trim().toLowerCase();
  return list.findIndex((rule) => isPanelRule(rule) && rule.match.titleContains?.trim().toLowerCase() === wanted);
}

/** whether this service type holds a choice of its own for a title */
export function hasServiceTypeEffect(rules: PcoRules, serviceTypeId: string, title: string): boolean {
  return ruleIndexIn(serviceTypeRulesOf(rules, serviceTypeId), title) !== -1;
}

/**
 * What this service type explicitly holds for a title, empty when nothing is set.
 *
 * The distinction from the resolved effect matters when writing. A row's controls
 * show the resolved effect, because that is what the import will actually do -- but
 * a change has to be applied to this, or toggling one switch would freeze today's
 * `defaultEffect` into the rule and the row would stop following the defaults it
 * never had an opinion about.
 */
export function serviceTypeEffectFor(rules: PcoRules, serviceTypeId: string, title: string): PcoRuleEffect {
  const list = serviceTypeRulesOf(rules, serviceTypeId);
  const index = ruleIndexIn(list, title);
  return index === -1 ? {} : list[index].effect;
}

/**
 * Writes one title's effect against one service type.
 *
 * An emptied effect removes the rule rather than leaving one that matches and does
 * nothing, which is also how a row is reset to following the defaults.
 */
export function withServiceTypeEffect(
  rules: PcoRules,
  serviceTypeId: string,
  title: string,
  effect: PcoRuleEffect,
): PcoRules {
  const list = [...serviceTypeRulesOf(rules, serviceTypeId)];
  const index = ruleIndexIn(list, title);

  if (isEffectEmpty(effect)) {
    if (index !== -1) {
      list.splice(index, 1);
    }
  } else {
    const rule: PcoTimerRule = { name: title, match: { titleContains: title }, effect };
    if (index === -1) {
      // first match wins, so a choice has to sit ahead of anything already here
      list.unshift(rule);
    } else {
      list[index] = rule;
    }
  }

  const serviceTypeRules = { ...(rules.serviceTypeRules ?? {}) };
  if (list.length === 0) {
    delete serviceTypeRules[serviceTypeId];
  } else {
    serviceTypeRules[serviceTypeId] = list;
  }
  return { ...rules, serviceTypeRules };
}

/** what an item becomes, as the import page offers it */
export const importAsLabels: Record<PcoItemImportAs, string> = {
  event: 'Timed event',
  block: 'Block',
  omit: 'Leave out',
};

/**
 * The import choice for a row.
 *
 * Read off the disposition rather than the effect, so a row shows what the import
 * will actually do with it -- including when a fold or a merge decided that and no
 * per-item rule is involved.
 */
export function importAsOf(disposition: PcoItemDisposition): PcoItemImportAs {
  if (disposition === 'block') return 'block';
  if (disposition === 'ignored') return 'omit';
  return 'event';
}

export function applyImportAs(effect: PcoRuleEffect, choice: PcoItemImportAs): PcoRuleEffect {
  return { ...effect, importAs: choice };
}

export const endActionLabels: Record<EndAction, string> = {
  [EndAction.None]: 'Stop at end',
  [EndAction.Stop]: 'Stop playback',
  [EndAction.LoadNext]: 'Load next',
  [EndAction.PlayNext]: 'Play next',
  [EndAction.PlayNextDelayed]: 'Play next after delay',
};

export function applyEndAction(effect: PcoRuleEffect, action: EndAction): PcoRuleEffect {
  return { ...effect, endAction: action };
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
  if (effect.title) parts.push(`rename to "${effect.title}"`);
  if (effect.colour) parts.push(`colour ${effect.colour}`);
  if (effect.isPublic !== undefined) parts.push(effect.isPublic ? 'public' : 'not public');
  return parts.length > 0 ? parts.join(' · ') : 'No changes';
}

export function removeRuleAt(rules: PcoRules, index: number): PcoRules {
  const timerRules = [...rules.timerRules];
  timerRules.splice(index, 1);
  return { ...rules, timerRules };
}

/* -------------------------------------------------------------------------- */
/* the pre-service run                                                         */
/* -------------------------------------------------------------------------- */

/**
 * A step of the pre-service run: one contiguous chain ending where Planning
 * Center's first item begins.
 *
 * An inferred entry anchored anywhere else was written by hand for some other
 * reason, and the table below leaves it alone.
 */
export function isRunStep(entry: PcoInferredEntry): boolean {
  return entry.section === 'pre' && entry.anchor === 'pre-start';
}

export function runSteps(rules: PcoRules): PcoInferredEntry[] {
  return rules.inferredEntries.filter(isRunStep);
}

/**
 * Puts a run back into the rules, re-timing it.
 *
 * Offsets are never typed in. Each step follows the one before and the last hands
 * over to the run sheet, so a length changed anywhere moves everything ahead of it
 * and the chain cannot drift out of step with itself.
 */
export function withRunSteps(rules: PcoRules, steps: PcoInferredEntry[]): PcoRules {
  let offset = -steps.reduce((total, step) => total + step.duration, 0);

  const chained = steps.map((step) => {
    const placed: PcoInferredEntry = { ...step, section: 'pre', anchor: 'pre-start', offset };
    offset += step.duration;
    return placed;
  });

  return { ...rules, inferredEntries: [...chained, ...rules.inferredEntries.filter((entry) => !isRunStep(entry))] };
}

/** how far ahead of the run sheet the whole run starts */
export function runLength(steps: PcoInferredEntry[]): number {
  return steps.reduce((total, step) => total + step.duration, 0);
}

export function newRunStep(): PcoInferredEntry {
  return {
    name: 'New step',
    title: 'New step',
    section: 'pre',
    anchor: 'pre-start',
    offset: 0,
    duration: 5 * 60 * 1000,
  };
}

/** returns the list unchanged when the move would fall off either end */
export function moveRunStep(steps: PcoInferredEntry[], from: number, to: number): PcoInferredEntry[] {
  if (to < 0 || to >= steps.length) {
    return steps;
  }
  const next = [...steps];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

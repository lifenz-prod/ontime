/**
 * Asserted against the real Central AM run sheet for 23 August 2026.
 * Every expected clock time below is read off that sheet, not derived from the
 * implementation, so a regression in the timing model fails here.
 */

import {
  isOntimeBlock,
  isOntimeEvent,
  OntimeEvent,
  OntimeRundownEntry,
  SupportedEvent,
  TimeStrategy,
  TimerType,
  type PcoRules,
} from 'ontime-types';
import { MILLIS_PER_HOUR, MILLIS_PER_MINUTE, MILLIS_PER_SECOND } from 'ontime-utils';
import { describe, expect, it } from 'vitest';

import { regenerateInstances } from '../../rundown-service/serviceInstanceUtils.js';
import { defaultPcoRules } from '../pcoRules.js';
import { buildRundownFromPlan, groupPlanTimesByDay, parseTitleTime } from '../pcoRundownBuilder.js';
import { localTimeOfDayMs } from '../pcoTime.js';
import type { PcoItem } from '../pcoTypes.js';

import { items, itemTimes, plan, planTimes } from './fixtures/centralAm.js';
import { items as fullItems, itemTimes as fullItemTimes } from './fixtures/centralAmFullSheet.js';

/** the shipped configuration, exactly as an installation receives it */
const shippedRules: PcoRules = { ...defaultPcoRules, timezone: 'Pacific/Auckland' };

/**
 * The timing model with the church's own configuration taken back off: nothing
 * folded, nothing merged, nothing dropped, headings as blocks, and only the
 * briefing inferred.
 *
 * The production run is derived off too, so these stay tests of how items are laid
 * out rather than of what the plan's rehearsal times add above them. The
 * derivation has its own describe block, and what the shipped rules produce
 * together is asserted in one place, "the corrected rundown".
 */
const rules: PcoRules = {
  ...shippedRules,
  serviceNames: ['9am', '11am'],
  headersBecome: 'block',
  preBoundaryTitleMatch: 'prayer meeting',
  collapseSections: [],
  mergeIntoPrevious: [],
  deriveRehearsalTimes: false,
  deriveTimedHeaders: false,
  leadIn: null,
  ignoreItems: [
    { titleMatch: '^\\s*service briefing', itemType: 'header' },
    { titleMatch: '^\\s*broadcast brief', itemType: 'header' },
  ],
  inferredEntries: [
    {
      name: 'Service Briefing',
      title: 'Service Briefing',
      section: 'pre',
      anchor: 'pre-start',
      offset: -15 * MILLIS_PER_MINUTE,
      duration: 15 * MILLIS_PER_MINUTE,
    },
  ],
};

/** a clock time as written on the run sheet */
const at = (hours: number, minutes = 0, seconds = 0): number =>
  hours * MILLIS_PER_HOUR + minutes * MILLIS_PER_MINUTE + seconds * MILLIS_PER_SECOND;

const build = (overrides: Partial<Parameters<typeof buildRundownFromPlan>[0]> = {}) =>
  buildRundownFromPlan({ plan, planTimes, items, itemTimes, rules, ...overrides });

/** delays carry no title, so reading one has to be guarded */
const titleOf = (entry: OntimeRundownEntry): string => ('title' in entry ? entry.title : '');
const titles = (rundown: ReturnType<typeof build>['rundown']) => rundown.map(titleOf);

const eventNamed = (rundown: ReturnType<typeof build>['rundown'], title: string): OntimeEvent => {
  const found = rundown.find((entry) => isOntimeEvent(entry) && entry.title === title);
  if (!found || !isOntimeEvent(found)) {
    throw new Error(`no event titled "${title}" in [${titles(rundown).join(', ')}]`);
  }
  return found;
};

/** a PCO item, for the run sheet shapes the fixtures do not carry */
const item = (
  id: string,
  sequence: number,
  title: string,
  length: string,
  itemType: 'song' | 'header' | 'media' | 'item' = 'item',
): PcoItem => {
  const [minutes, seconds] = length.split(':').map(Number);
  return {
    type: 'Item',
    id,
    attributes: {
      title,
      description: '',
      html_details: null,
      length: minutes * 60 + (seconds ?? 0),
      sequence,
      item_type: itemType,
      service_position: 'during',
    },
  };
};

const boundaryIndexOf = (result: ReturnType<typeof build>): number =>
  result.rundown.findIndex((entry) => entry.id === result.serviceProfiles.boundaryBlockId);

describe('timezone handling', () => {
  it('reads a UTC timestamp as an Auckland time of day', () => {
    // 21:00Z in August is 09:00 NZST the following morning
    expect(localTimeOfDayMs('2026-08-22T21:00:00Z', 'Pacific/Auckland')).toBe(at(9));
    expect(localTimeOfDayMs('2026-08-22T23:00:00Z', 'Pacific/Auckland')).toBe(at(11));
  });
});

describe('groupPlanTimesByDay', () => {
  it('separates the midweek rehearsal from the Sunday services', () => {
    const days = groupPlanTimesByDay(planTimes, rules.timezone);

    expect(days).toHaveLength(2);
    expect(days[0].dateKey).toBe('2026-08-19');
    expect(days[0].serviceTimes).toHaveLength(0);
    expect(days[1].dateKey).toBe('2026-08-23');
    expect(days[1].serviceTimes.map((time) => time.id)).toEqual(['t-9am', 't-11am']);
  });

  it('labels each day so a caller can offer the choice', () => {
    const days = groupPlanTimesByDay(planTimes, rules.timezone);
    expect(days[0].label).toContain('Wednesday');
    expect(days[1].label).toContain('Sunday');
  });
});

describe('day selection', () => {
  it('defaults to the day that actually holds services', () => {
    expect(build().day.dateKey).toBe('2026-08-23');
  });

  it('refuses the midweek rehearsal day, which has no services', () => {
    expect(() => build({ targetDate: '2026-08-19' })).toThrow(/no service times/i);
  });

  it('refuses a day that is not on the plan at all, naming what is available', () => {
    expect(() => build({ targetDate: '2026-08-20' })).toThrow(/2026-08-19, 2026-08-23/);
  });

  it('reports every day the plan covers', () => {
    expect(build().availableDays.map((day) => day.dateKey)).toEqual(['2026-08-19', '2026-08-23']);
  });
});

describe('pre-service items back-time to the service start', () => {
  it('places the whole pre run exactly as the sheet does', () => {
    const { rundown } = build();

    expect(eventNamed(rundown, 'Prayer Meeting').timeStart).toBe(at(8, 20));
    expect(eventNamed(rundown, 'Prayer Meeting').timeEnd).toBe(at(8, 45));
    expect(eventNamed(rundown, 'Doors Open').timeStart).toBe(at(8, 45));
    expect(eventNamed(rundown, 'Doors Open').timeEnd).toBe(at(8, 57, 20));
    expect(eventNamed(rundown, 'Online Pre Service Message').timeStart).toBe(at(8, 57, 20));
    expect(eventNamed(rundown, 'Pre Service Video').timeStart).toBe(at(8, 58, 20));
  });

  it('lands the last pre-service item exactly on the service start', () => {
    expect(eventNamed(build().rundown, 'Pre Service Video').timeEnd).toBe(at(9));
  });

  it('starts the pre run 40:00 before the service, where the sheet puts it', () => {
    // 25:00 prayer + 12:20 doors + 1:00 online + 1:40 video = 40:00, so 8:20
    expect(eventNamed(build().rundown, 'Prayer Meeting').timeStart).toBe(at(9) - at(0, 40));
  });
});

describe('reading a clock time out of a title', () => {
  it('reads the time two headers state and nothing else records', () => {
    expect(parseTitleTime('SERVICE BRIEFING 8:05AM')).toBe(at(8, 5));
    expect(parseTitleTime('BROADCAST BRIEF 8:10am')).toBe(at(8, 10));
  });

  it('says nothing about a heading that states no time', () => {
    expect(parseTitleTime('PRAISE & WORSHIP')).toBeNull();
    expect(parseTitleTime('DRAFT RUNSHEET')).toBeNull();
  });

  it('ignores a bare time, which is far more likely to be a length', () => {
    // "Father's Day VID (1:58)" is a duration, and reading it as 1:58am would be worse
    expect(parseTitleTime("Father's Day VID (1:58) // BROADCAST")).toBeNull();
  });

  it('puts noon and midnight on the right side of the clock', () => {
    expect(parseTitleTime('Doors 12:00am')).toBe(at(0));
    expect(parseTitleTime('Lunch 12:30pm')).toBe(at(12, 30));
    expect(parseTitleTime('Rehearsal 1:00pm')).toBe(at(13));
  });

  it('refuses a time that is not one', () => {
    expect(parseTitleTime('Room 25:99pm')).toBeNull();
  });
});

describe('the production run, read off the plan', () => {
  const derived = () => buildRundownFromPlan({ plan, planTimes, items, itemTimes, rules: shippedRules });

  it('takes its rows from the rehearsal times, with the names the plan gives them', () => {
    const result = derived();
    const preTitles = titles(result.rundown).slice(0, boundaryIndexOf(result));

    expect(preTitles).toEqual([
      'Power On',
      'Service Sync',
      'Call Time - Creative Team',
      'Band Soundcheck + Rehearsal',
      'Creative Team Prayer',
      'Vocal Soundcheck',
      'Mix Changes',
      'Link Worship Record',
      'Worship Rehearsal',
      'Production Checks',
      'SERVICE BRIEFING',
      'BROADCAST BRIEF',
      'Prayer Meeting',
    ]);
  });

  it('places each step where the plan places it', () => {
    const { rundown } = derived();

    expect(eventNamed(rundown, 'Service Sync').timeStart).toBe(at(6, 15));
    expect(eventNamed(rundown, 'Service Sync').timeEnd).toBe(at(6, 25));
    expect(eventNamed(rundown, 'Production Checks').timeEnd).toBe(at(8, 5));
  });

  it('leaves the gap the plan leaves, rather than stretching an entry across it', () => {
    const { rundown } = derived();

    expect(eventNamed(rundown, 'Service Sync').timeEnd).toBe(at(6, 25));
    expect(eventNamed(rundown, 'Call Time - Creative Team').timeStart).toBe(at(6, 30));
    expect(eventNamed(rundown, 'Call Time - Creative Team').linkStart).toBeNull();
  });

  it('keeps one row for two rehearsals in different rooms, and records the other in its note', () => {
    const band = eventNamed(derived().rundown, 'Band Soundcheck + Rehearsal');

    expect(band.timeStart).toBe(at(6, 35));
    expect(band.timeEnd).toBe(at(6, 55));
    expect(band.note).toBe('Vocal Rehearsal - Backstage');
  });

  it('never lets a staffing call time become a row', () => {
    // the producer's morning runs 07:30 to 12:45, straight through both services
    expect(titles(derived().rundown)).not.toContain('Producer Call Time');
  });

  it('runs the briefs at the times their titles state, handing over to the run sheet', () => {
    const { rundown } = derived();

    expect(eventNamed(rundown, 'SERVICE BRIEFING').timeStart).toBe(at(8, 5));
    expect(eventNamed(rundown, 'SERVICE BRIEFING').timeEnd).toBe(at(8, 10));
    expect(eventNamed(rundown, 'BROADCAST BRIEF').timeStart).toBe(at(8, 10));
    // the prayer meeting back-times to 8:20, and the brief ends exactly there
    expect(eventNamed(rundown, 'BROADCAST BRIEF').timeEnd).toBe(at(8, 20));
    expect(eventNamed(rundown, 'Prayer Meeting').timeStart).toBe(at(8, 20));
  });

  it('drops the time from the title, since the entry now sits at it', () => {
    expect(titles(derived().rundown)).not.toContain('SERVICE BRIEFING 8:05AM');
  });

  it('opens with an hour of lead-in, ending where the first rehearsal time starts', () => {
    const powerOn = eventNamed(derived().rundown, 'Power On');

    expect(powerOn.timeStart).toBe(at(5, 15));
    expect(powerOn.timeEnd).toBe(at(6, 15));
  });

  it('moves the lead-in when the plan moves, rather than holding a clock time', () => {
    // the whole production morning pushed back half an hour
    const shift = (iso: string) => new Date(new Date(iso).valueOf() + 30 * MILLIS_PER_MINUTE).toISOString();
    const later = planTimes.map((time) =>
      time.attributes.time_type === 'rehearsal'
        ? { ...time, attributes: { ...time.attributes, starts_at: shift(time.attributes.starts_at) } }
        : time,
    );
    const { rundown } = buildRundownFromPlan({ plan, planTimes: later, items, itemTimes, rules: shippedRules });

    expect(eventNamed(rundown, 'Service Sync').timeStart).toBe(at(6, 45));
    expect(eventNamed(rundown, 'Power On').timeStart).toBe(at(5, 45));
  });

  it('is not mirrored, because the morning happens once', () => {
    const result = derived();
    const mirrored = regenerateInstances(result.rundown, result.serviceProfiles);

    expect(mirrored.filter((entry) => titleOf(entry) === 'Worship Rehearsal')).toHaveLength(1);
    expect(mirrored.filter((entry) => titleOf(entry) === 'Prayer Meeting')).toHaveLength(1);
    // doors, which each service does for itself, is the one either side of the boundary
    expect(mirrored.filter((entry) => titleOf(entry) === 'Doors Open')).toHaveLength(2);
  });

  it('can be turned off, leaving the morning to start at the run sheet', () => {
    const { rundown } = buildRundownFromPlan({
      plan,
      planTimes,
      items,
      itemTimes,
      rules: { ...shippedRules, deriveRehearsalTimes: false, deriveTimedHeaders: false, leadIn: null },
    });

    expect(titles(rundown)).not.toContain('Worship Rehearsal');
    expect(titles(rundown)[0]).toBe('Prayer Meeting');
  });

  it('takes a rule written against a step, since a step is an entry like any other', () => {
    const { rundown } = buildRundownFromPlan({
      plan,
      planTimes,
      items,
      itemTimes,
      rules: {
        ...shippedRules,
        serviceTypeRules: {
          '156118': [
            { name: 'Worship Rehearsal', match: { titleContains: 'Worship Rehearsal' }, effect: { hideTimer: true } },
          ],
        },
      },
      serviceTypeId: '156118',
    });

    expect(eventNamed(rundown, 'Worship Rehearsal').hideTimer).toBe(true);
    expect(eventNamed(rundown, 'Production Checks').hideTimer).toBe(false);
  });

  it('leaves a step out when a rule says to, without stretching the one above it', () => {
    const { rundown } = buildRundownFromPlan({
      plan,
      planTimes,
      items,
      itemTimes,
      rules: {
        ...shippedRules,
        timerRules: [
          { name: 'no mix changes', match: { titleContains: 'Mix Changes' }, effect: { importAs: 'omit' } },
        ],
      },
    });

    expect(titles(rundown)).not.toContain('Mix Changes');
    // the row is gone and the gap is left: the plan still says the soundcheck ends at 07:10
    expect(eventNamed(rundown, 'Vocal Soundcheck').timeEnd).toBe(at(7, 10));
    expect(eventNamed(rundown, 'Link Worship Record').timeStart).toBe(at(7, 15));
  });

  it('names a timed heading without the time, which is what a rule has to match', () => {
    const { rundown } = buildRundownFromPlan({
      plan,
      planTimes,
      items,
      itemTimes,
      rules: {
        ...shippedRules,
        timerRules: [
          { name: 'briefing', match: { titleContains: 'SERVICE BRIEFING' }, effect: { showAsAuxTimer: true } },
        ],
      },
    });

    expect(eventNamed(rundown, 'SERVICE BRIEFING').showAsAuxTimer).toBe(true);
  });

  it('says so when the plan holds no rehearsal times to read', () => {
    const servicesOnly = planTimes.filter((time) => time.attributes.time_type === 'service');
    const { warnings } = buildRundownFromPlan({
      plan,
      planTimes: servicesOnly,
      items,
      itemTimes,
      rules: shippedRules,
    });

    expect(warnings.join(' ')).toMatch(/no rehearsal times/i);
  });
});

describe('the inferred service briefing', () => {
  it('runs 8:05 to 8:20, the time its header claims', () => {
    const briefing = eventNamed(build().rundown, 'Service Briefing');

    expect(briefing.timeStart).toBe(at(8, 5));
    expect(briefing.timeEnd).toBe(at(8, 20));
  });

  it('sits at the top of PRE, immediately before the prayer meeting', () => {
    const result = build();
    const preTitles = titles(result.rundown).slice(0, boundaryIndexOf(result));

    expect(preTitles.indexOf('Service Briefing')).toBe(0);
    expect(preTitles.indexOf('Prayer Meeting')).toBe(1);
  });

  it('tracks the plan rather than a fixed clock time', () => {
    // drop the 1:40 pre-service video and the whole run, briefing included, slides later
    const withoutVideo = items.filter((entry) => entry.attributes.title !== 'Pre Service Video');
    const briefing = eventNamed(build({ items: withoutVideo }).rundown, 'Service Briefing');

    expect(briefing.timeStart).toBe(at(8, 6, 40));
    expect(briefing.timeEnd).toBe(at(8, 21, 40));
  });

  it('is not carried into the mirrored service, because PRE runs once', () => {
    const result = build();
    const mirrored = regenerateInstances(result.rundown, result.serviceProfiles);

    expect(mirrored.filter((entry) => titleOf(entry) === 'Service Briefing')).toHaveLength(1);
  });

  it('counts down to its end time, like everything else in the house style', () => {
    const briefing = eventNamed(build().rundown, 'Service Briefing');

    expect(briefing.timerType).toBe(TimerType.CountDown);
    expect(briefing.countToEnd).toBe(true);
    expect(briefing.timeStrategy).toBe(TimeStrategy.LockEnd);
  });

  it('leaves the stranded briefing header out of the rundown', () => {
    expect(titles(build().rundown)).not.toContain('SERVICE BRIEFING 8:05AM');
  });
});

describe('the service itself accumulates forward from 9:00', () => {
  it.each([
    ['I Thank God', at(9, 0, 0), at(9, 4, 0)],
    ['O Praise The Name (Anástasis)', at(9, 4, 0), at(9, 9, 30)],
    ['Jesus Have It All', at(9, 9, 30), at(9, 16, 30)],
    ['I Exalt Thee', at(9, 16, 30), at(9, 20, 0)],
    ['MC Moment', at(9, 20, 0), at(9, 24, 0)],
    ['Welcome', at(9, 24, 0), at(9, 25, 0)],
    ['Meet & Greet', at(9, 25, 0), at(9, 26, 0)],
    ['Message (Incl. Ministry & Altar Call)', at(9, 26, 0), at(10, 11, 0)],
    ['EOS Announcements', at(10, 11, 0), at(10, 12, 0)],
    ['End', at(10, 12, 0), at(10, 12, 0)],
  ])('%s runs %d to %d', (title, expectedStart, expectedEnd) => {
    const event = eventNamed(build().rundown, title as string);
    expect(event.timeStart).toBe(expectedStart);
    expect(event.timeEnd).toBe(expectedEnd);
  });
});

describe('sectioning', () => {
  it('puts the boundary block immediately after the prayer meeting', () => {
    const result = build();
    const index = boundaryIndexOf(result);

    expect(index).toBeGreaterThan(-1);
    expect(titleOf(result.rundown[index - 1])).toBe('Prayer Meeting');
    expect(result.rundown[index].type).toBe(SupportedEvent.Block);
    expect(titleOf(result.rundown[index])).toBe('9am');
  });

  it('keeps only the briefing and the prayer meeting in PRE', () => {
    const result = build();
    expect(titles(result.rundown).slice(0, boundaryIndexOf(result))).toEqual(['Service Briefing', 'Prayer Meeting']);
  });

  it('puts doors, walk-in and the pre-service video in the master section, not PRE', () => {
    const result = build();
    const serviceTitles = titles(result.rundown).slice(boundaryIndexOf(result) + 1);

    expect(serviceTitles.slice(0, 3)).toEqual(['Doors Open', 'Online Pre Service Message', 'Pre Service Video']);
  });

  it('turns every PCO header into an Ontime block', () => {
    const { rundown } = build();
    // the briefing header is absent by rule, see ignoreItems
    for (const title of ['PRAISE & WORSHIP', 'WELCOME & ANNOUNCEMENTS', 'MESSAGE', 'END']) {
      const found = rundown.find((entry) => titleOf(entry) === title);
      expect(found && isOntimeBlock(found), `${title} should be a block`).toBe(true);
    }
  });

  it('numbers cues positionally, skipping blocks', () => {
    const cues = build()
      .rundown.filter(isOntimeEvent)
      .map((entry) => entry.cue);
    expect(cues).toEqual(cues.map((_, index) => String(index + 1)));
  });
});

describe('per-service item variants', () => {
  it('drops the 11am doors item, which PCO excludes from the 9am', () => {
    expect(titles(build().rundown)).not.toContain('Doors Open // 11am');
  });

  it('strips the service suffix from the item it keeps', () => {
    const { rundown } = build();
    expect(titles(rundown)).toContain('Doors Open');
    expect(titles(rundown)).not.toContain('Doors Open // 9am');
  });

  it('says which items it left out and why', () => {
    expect(build().warnings.join('\n')).toMatch(/Excluded from the 9am service.*"Doors Open \/\/ 11am"/);
  });

  it('keeps both variants when master exclusions are not respected', () => {
    const { rundown } = build({ rules: { ...rules, respectMasterExclusions: false } });
    // both survive, and both lose their suffix, which is exactly the double-up to avoid
    expect(titles(rundown).filter((title) => title === 'Doors Open')).toHaveLength(2);
  });

  it('leaves titles alone when the strip rule is empty', () => {
    const { rundown } = build({ rules: { ...rules, titleStrip: '' } });
    expect(titles(rundown)).toContain('Doors Open // 9am');
  });
});

describe('timer rules', () => {
  it('makes the message a fixed-duration countdown', () => {
    const message = eventNamed(build().rundown, 'Message (Incl. Ministry & Altar Call)');

    expect(message.timerType).toBe(TimerType.CountDown);
    expect(message.countToEnd).toBe(false);
    expect(message.timeStrategy).toBe(TimeStrategy.LockDuration);
    expect(message.duration).toBe(45 * MILLIS_PER_MINUTE);
  });

  it('does not mistake "Online Pre Service Message" for the message', () => {
    // regression: an unanchored /message/ caught this row too
    const online = eventNamed(build().rundown, 'Online Pre Service Message');
    expect(online.countToEnd).toBe(true);
    expect(online.timeStrategy).toBe(TimeStrategy.LockEnd);
  });

  it('makes every other timer count down to a time of day', () => {
    const { rundown } = build();

    // only up to the message: everything after it holds its own duration instead,
    // see "holding durations after something that can overrun"
    for (const title of ['Doors Open', 'Pre Service Video', 'I Thank God', 'Welcome', 'Meet & Greet']) {
      const event = eventNamed(rundown, title);
      expect(event.countToEnd, `${title} should count to end`).toBe(true);
      expect(event.timeStrategy, `${title} should be end-anchored`).toBe(TimeStrategy.LockEnd);
    }
  });

  it('carries the PCO description across as the event note', () => {
    expect(eventNamed(build().rundown, 'Prayer Meeting').note).toBe('Ps A. Speaker');
  });

  it('drops items matched by an ignore rule', () => {
    const { rundown } = build({ rules: { ...rules, ignoreItems: [{ titleMatch: '^fall like rain$' }] } });
    expect(titles(rundown)).not.toContain('Fall Like Rain');
  });

  it('does not let an empty match object swallow the rundown', () => {
    expect(titles(build({ rules: { ...rules, ignoreItems: [{}] } }).rundown)).toContain('I Thank God');
  });

  it('reports the zero-length rows rather than hiding them', () => {
    expect(build().warnings.join('\n')).toMatch(/imported as 0:00.*"Fall Like Rain".*"End"/);
  });
});

describe('service profiles', () => {
  it('derives the mirror offset from the gap between the two service times', () => {
    const { serviceProfiles } = build();

    expect(serviceProfiles.services).toHaveLength(2);
    expect(serviceProfiles.services[0]).toMatchObject({ name: '9am', offset: 0 });
    expect(serviceProfiles.services[1]).toMatchObject({ name: '11am', offset: 2 * MILLIS_PER_HOUR });
  });

  it('falls back to the PCO plan time name when no name is configured', () => {
    const { serviceProfiles } = build({ rules: { ...rules, serviceNames: [] } });
    expect(serviceProfiles.services.map((service) => service.name)).toEqual(['9:00 AM', '11:00 AM']);
  });
});

describe('divergence the offset mirror cannot express', () => {
  it('warns that the 11am has no Online Pre Service Message', () => {
    expect(build().warnings.join('\n')).toMatch(
      /"Online Pre Service Message" is excluded from the 11:00 AM service.*mirror will still include it/,
    );
  });

  it('stays quiet about the prayer meeting, which is in PRE and never mirrored', () => {
    const prayerWarnings = build().warnings.filter(
      (warning) => warning.includes('Prayer Meeting') && warning.includes('excluded'),
    );
    expect(prayerWarnings).toEqual([]);
  });

  it('stays quiet when the two services match', () => {
    expect(build({ itemTimes: [] }).warnings.join('\n')).not.toMatch(/excluded from/);
  });

  it('warns that the plan spans more than one day', () => {
    expect(build().warnings.join('\n')).toMatch(/times on 2 days/);
  });
});

describe('preAnchor', () => {
  /** the same Sunday with the production morning stripped out of the plan */
  const servicesOnly = planTimes.filter((time) => time.attributes.time_type === 'service');

  it('back-times from the service when the day has no other plan time', () => {
    const { rundown } = build({ planTimes: servicesOnly, rules: { ...rules, preAnchor: 'plan-time' } });
    expect(eventNamed(rundown, 'Pre Service Video').timeEnd).toBe(at(9));
  });

  it('anchors to a plan time when the day has one to anchor to', () => {
    // the producer's call time, the only non-service time left once rehearsals are derived
    const { rundown } = build({ rules: { ...rules, deriveRehearsalTimes: true, preAnchor: 'plan-time' } });
    expect(eventNamed(rundown, 'Prayer Meeting').timeStart).toBe(at(7, 30));
  });

  it('will not anchor the run sheet to a rehearsal time that is now an entry of its own', () => {
    // 06:15 is the service sync, which is a row in the production run above
    const { rundown } = build({ rules: { ...rules, deriveRehearsalTimes: true, preAnchor: 'plan-time' } });
    expect(eventNamed(rundown, 'Prayer Meeting').timeStart).not.toBe(at(6, 15));
  });
});

describe('handing off to the existing dual-service mirror', () => {
  it('reproduces the 11am column of the run sheet', () => {
    const result = build();
    const mirrored = regenerateInstances(result.rundown, result.serviceProfiles);
    const eleven = mirrored.filter((entry) => entry.generatedFor === result.serviceProfiles.services[1].id);

    const clone = (title: string): OntimeEvent => {
      const master = eventNamed(result.rundown, title);
      const found = eleven.filter(isOntimeEvent).find((entry) => entry.mirrorOf === master.id);
      if (!found) {
        throw new Error(`no 11am clone of "${title}"`);
      }
      return found;
    };

    // every one of these is read off the 11:00am column
    expect(clone('Doors Open').timeStart).toBe(at(10, 45));
    expect(clone('Pre Service Video').timeStart).toBe(at(10, 58, 20));
    expect(clone('I Thank God').timeStart).toBe(at(11));
    expect(clone('Jesus Have It All').timeStart).toBe(at(11, 9, 30));
    expect(clone('Message (Incl. Ministry & Altar Call)').timeStart).toBe(at(11, 26));
    expect(clone('EOS Announcements').timeStart).toBe(at(12, 11));
    expect(clone('End').timeStart).toBe(at(12, 12));
  });

  it('opens the mirrored section with a block named after the service', () => {
    const result = build();
    const mirrored = regenerateInstances(result.rundown, result.serviceProfiles);
    const eleven = mirrored.filter((entry) => entry.generatedFor === result.serviceProfiles.services[1].id);

    expect(eleven[0]).toMatchObject({ type: SupportedEvent.Block, title: '11am' });
  });

  it('leaves the PRE section un-mirrored so it only runs once', () => {
    const result = build();
    const mirrored = regenerateInstances(result.rundown, result.serviceProfiles);

    expect(mirrored.filter((entry) => titleOf(entry) === 'Prayer Meeting')).toHaveLength(1);
    expect(mirrored.filter((entry) => titleOf(entry) === 'Doors Open')).toHaveLength(2);
  });
});

describe('rules the settings panel writes', () => {
  /** the panel writes literal substrings, never regex */
  const withRules = (timerRules: PcoRules['timerRules']) => build({ rules: { ...rules, timerRules } });

  it('hides the timer on the pre-service video', () => {
    const { rundown } = withRules([
      {
        name: 'pre-service video has no timer',
        match: { titleContains: 'pre service video' },
        effect: { hideTimer: true },
      },
    ]);

    expect(eventNamed(rundown, 'Pre Service Video').hideTimer).toBe(true);
    expect(eventNamed(rundown, 'Welcome').hideTimer).toBe(false);
  });

  it('shows an item as an aux timer', () => {
    const { rundown } = withRules([
      {
        name: 'altar call runs on the aux timer',
        match: { titleContains: 'ministry' },
        effect: { showAsAuxTimer: true },
      },
    ]);

    expect(eventNamed(rundown, 'Message (Incl. Ministry & Altar Call)').showAsAuxTimer).toBe(true);
  });

  it('makes an item a fixed-duration countdown instead of counting to a time', () => {
    const { rundown } = withRules([
      {
        name: 'message and altar call are countdowns',
        match: { titleContains: 'message' },
        effect: { timerType: TimerType.CountDown, countToEnd: false, timeStrategy: TimeStrategy.LockDuration },
      },
    ]);

    const message = eventNamed(rundown, 'Message (Incl. Ministry & Altar Call)');
    expect(message.countToEnd).toBe(false);
    expect(message.timeStrategy).toBe(TimeStrategy.LockDuration);

    /**
     * What comes before still counts down to its end time. Only Doors Open is
     * checked, and not Welcome: an unanchored /message/ catches "Online Pre Service
     * Message" too, and everything after that now holds its duration. Which is why
     * the shipped rule anchors the pattern to the start of the title.
     */
    expect(eventNamed(rundown, 'Doors Open').countToEnd).toBe(true);
  });

  it('matches a title containing regex characters without escaping', () => {
    const { rundown } = withRules([
      { name: 'meet and greet', match: { titleContains: 'Meet & Greet' }, effect: { skip: true } },
    ]);

    expect(eventNamed(rundown, 'Meet & Greet').skip).toBe(true);
  });

  it('applies the first matching rule only', () => {
    const { rundown } = withRules([
      { name: 'first', match: { titleContains: 'welcome' }, effect: { colour: 'red' } },
      { name: 'second', match: { titleContains: 'welcome' }, effect: { colour: 'blue' } },
    ]);

    expect(eventNamed(rundown, 'Welcome').colour).toBe('red');
  });

  it('narrows a rule to a position, so a pre-service item is left alone', () => {
    const { rundown } = withRules([
      { name: 'during only', match: { titleContains: 'o', servicePosition: 'during' }, effect: { skip: true } },
    ]);

    expect(eventNamed(rundown, 'Doors Open').skip).toBe(false);
    expect(eventNamed(rundown, 'MC Moment').skip).toBe(true);
  });
});

describe('folding a section into one event', () => {
  const folded = (overrides: Partial<PcoRules['collapseSections'][number]> = {}) =>
    build({
      rules: {
        ...rules,
        collapseSections: [
          { name: 'worship', match: { itemType: 'header', titleContains: 'praise & worship' }, ...overrides },
        ],
      },
    });

  it('replaces the section with a single event of its total length', () => {
    const { rundown } = folded();
    // 4:00 + 5:30 + 7:00 + 3:30 + 4:00 = 24:00
    const worship = eventNamed(rundown, 'PRAISE & WORSHIP');

    expect(worship.timeStart).toBe(at(9));
    expect(worship.duration).toBe(24 * MILLIS_PER_MINUTE);
    expect(titles(rundown)).not.toContain('I Thank God');
  });

  it('leaves everything after the section where the sheet puts it', () => {
    expect(eventNamed(folded().rundown, 'Welcome').timeStart).toBe(at(9, 24));
  });

  it('stops at the next heading rather than swallowing the rest of the service', () => {
    expect(titles(folded().rundown)).toContain('Welcome');
    expect(titles(folded().rundown)).toContain('Meet & Greet');
  });

  it('can be given a name of its own', () => {
    expect(titles(folded({ title: 'Praise & Worship' }).rundown)).toContain('Praise & Worship');
  });

  it('keeps the set list as the note', () => {
    expect(eventNamed(folded().rundown, 'PRAISE & WORSHIP').note).toBe(
      ['I Thank God', 'O Praise The Name (Anástasis)', 'Jesus Have It All', 'I Exalt Thee', 'MC Moment'].join('\n'),
    );
  });

  it('can be asked not to', () => {
    expect(eventNamed(folded({ listContents: false }).rundown, 'PRAISE & WORSHIP').note).toBe('');
  });

  it('folds only the members a rule names, leaving the rest their own rows', () => {
    // Planning Center types the songs `song` and the MC moment `item`, and somebody
    // cues that moment: folding it away takes the section's one cue with it
    const { rundown } = folded({ title: 'Praise & Worship', membersMatch: { itemType: 'song' } });

    // 4:00 + 5:30 + 7:00 + 3:30 = 20:00, and the 4:00 MC moment follows it
    expect(eventNamed(rundown, 'Praise & Worship').duration).toBe(20 * MILLIS_PER_MINUTE);
    expect(eventNamed(rundown, 'MC Moment').timeStart).toBe(at(9, 20));
    expect(eventNamed(rundown, 'MC Moment').duration).toBe(4 * MILLIS_PER_MINUTE);
    // and nothing after it has moved
    expect(eventNamed(rundown, 'Welcome').timeStart).toBe(at(9, 24));
  });

  it('lists only what it folded, not what it left alone', () => {
    const { rundown } = folded({ title: 'Praise & Worship', membersMatch: { itemType: 'song' } });

    expect(eventNamed(rundown, 'Praise & Worship').note).toBe(
      ['I Thank God', 'O Praise The Name (Anástasis)', 'Jesus Have It All', 'I Exalt Thee'].join('\n'),
    );
  });

  describe('a section a non-member splits in two', () => {
    /** the shape of a communion week: songs, an MC thought, then more songs */
    const split = [
      item('s-1', 1, 'PRAISE & WORSHIP', '0:00', 'header'),
      item('s-2', 2, 'Praise', '4:00', 'song'),
      item('s-3', 3, 'Cornerstone', '6:00', 'song'),
      item('s-4', 4, 'MC Communion Thought', '4:00', 'item'),
      item('s-5', 5, 'O Praise The Name', '5:00', 'song'),
      item('s-6', 6, 'Christ And Christ Crucified TAG', '3:00', 'song'),
      item('s-7', 7, 'MESSAGE', '0:00', 'header'),
      item('s-8', 8, 'Message', '40:00'),
    ];

    const splitRundown = () =>
      buildRundownFromPlan({
        plan,
        planTimes,
        items: split,
        itemTimes: [],
        rules: {
          ...rules,
          headersBecome: 'nothing',
          collapseSections: [
            {
              name: 'worship',
              match: { itemType: 'header', titleContains: 'praise & worship' },
              title: 'Praise & Worship',
              membersMatch: { itemType: 'song' },
            },
          ],
        },
      }).rundown;

    it('keeps the run sheet order rather than gathering the songs together', () => {
      // after the PRE entry and the boundary block, which this shape does not test
      expect(titles(splitRundown()).slice(-4)).toEqual([
        'Praise & Worship',
        'MC Communion Thought',
        'Praise & Worship (cont.)',
        'Message',
      ]);
    });

    it('gives each run the length of the songs actually in it', () => {
      const rundown = splitRundown();

      expect(eventNamed(rundown, 'Praise & Worship').duration).toBe(10 * MILLIS_PER_MINUTE);
      expect(eventNamed(rundown, 'MC Communion Thought').timeStart).toBe(at(9, 10));
      expect(eventNamed(rundown, 'Praise & Worship (cont.)').timeStart).toBe(at(9, 14));
      expect(eventNamed(rundown, 'Praise & Worship (cont.)').duration).toBe(8 * MILLIS_PER_MINUTE);
    });

    it('keeps each run listing its own songs', () => {
      const rundown = splitRundown();

      expect(eventNamed(rundown, 'Praise & Worship').note).toBe('Praise\nCornerstone');
      expect(eventNamed(rundown, 'Praise & Worship (cont.)').note).toBe(
        'O Praise The Name\nChrist And Christ Crucified TAG',
      );
    });
  });

  it('leaves a heading to the header rule when the fold swallows nothing after it', () => {
    // nothing under the heading matches, so there is no fold and no empty event
    const { rundown } = folded({ title: 'Praise & Worship', membersMatch: { itemType: 'media' } });

    expect(titles(rundown)).not.toContain('Praise & Worship');
    expect(titles(rundown)).toContain('I Thank God');
  });

  it('survives a rule that drops every heading, since the fold needs the heading', () => {
    const { rundown } = build({
      rules: {
        ...rules,
        headersBecome: 'nothing',
        collapseSections: [{ name: 'worship', match: { itemType: 'header', titleContains: 'praise & worship' } }],
      },
    });

    expect(titles(rundown)).toContain('PRAISE & WORSHIP');
    expect(titles(rundown)).not.toContain('MESSAGE');
  });
});

describe('merging an item into the one above it', () => {
  const merged = build({ rules: { ...rules, mergeIntoPrevious: [{ titleContains: 'online pre service message' }] } });

  it('gives its length to the entry above rather than taking it out of the run', () => {
    expect(titles(merged.rundown)).not.toContain('Online Pre Service Message');
    expect(eventNamed(merged.rundown, 'Doors Open').duration).toBe(at(0, 13, 20));
  });

  it('leaves the published doors time where it was', () => {
    // ignoring the minute instead would move doors from 8:45 to 8:46
    expect(eventNamed(merged.rundown, 'Doors Open').timeStart).toBe(at(8, 45));
    expect(eventNamed(merged.rundown, 'Pre Service Video').timeEnd).toBe(at(9));
  });

  it('stops reporting it as a divergence, because the entry above carries the right total', () => {
    // PCO holds an 11am doors item a minute longer to account for this one, so the
    // mirror's 13:20 is right and a warning here would only read as a fault
    expect(merged.warnings.join('\n')).not.toMatch(/"Online Pre Service Message" is excluded/);
  });

  it('keeps an item that has nothing above it, and says so', () => {
    const stranded = build({ rules: { ...rules, mergeIntoPrevious: [{ titleContains: 'prayer meeting' }] } });

    expect(titles(stranded.rundown)).toContain('Prayer Meeting');
    expect(stranded.warnings.join('\n')).toMatch(/Nothing above them to merge into.*"Prayer Meeting"/);
  });
});

describe('what a heading becomes', () => {
  it('is a block by default in this configuration', () => {
    expect(build().rundown.find((entry) => titleOf(entry) === 'MESSAGE')).toSatisfy(isOntimeBlock);
  });

  it('can be dropped entirely', () => {
    const { rundown } = build({ rules: { ...rules, headersBecome: 'nothing' } });

    for (const title of ['PRAISE & WORSHIP', 'WELCOME & ANNOUNCEMENTS', 'MESSAGE', 'END']) {
      expect(titles(rundown)).not.toContain(title);
    }
    // dropping the headings moves nothing: they carry no length
    expect(eventNamed(rundown, 'I Thank God').timeStart).toBe(at(9));
  });

  it('can be an event, for a sheet whose headings carry length', () => {
    const { rundown } = build({ rules: { ...rules, headersBecome: 'event' } });
    expect(rundown.find((entry) => titleOf(entry) === 'MESSAGE')).toSatisfy(isOntimeEvent);
  });
});

describe('renaming an event', () => {
  it('replaces the title the run sheet uses', () => {
    const { rundown } = build({
      rules: {
        ...rules,
        timerRules: [{ name: 'shorter', match: { titleContains: 'ministry' }, effect: { title: 'Message' } }],
      },
    });

    expect(titles(rundown)).toContain('Message');
    expect(titles(rundown)).not.toContain('Message (Incl. Ministry & Altar Call)');
  });

  it('is ignored in the default effect, which would otherwise retitle the rundown', () => {
    const { rundown } = build({ rules: { ...rules, defaultEffect: { ...rules.defaultEffect, title: 'Everything' } } });
    expect(titles(rundown)).not.toContain('Everything');
  });
});

describe('a PRE section nothing on the run sheet closes', () => {
  const inferredOnly = build({ rules: { ...rules, preBoundaryTitleMatch: '' } });

  it('says nothing, because a blank boundary is a decision, not a failure', () => {
    expect(inferredOnly.warnings.join('\n')).not.toMatch(/PRE boundary/);
  });

  it('leaves PRE to the inferred entries and puts every PCO item after the boundary', () => {
    const preTitles = titles(inferredOnly.rundown).slice(0, boundaryIndexOf(inferredOnly));

    expect(preTitles).toEqual(['Service Briefing']);
    expect(titles(inferredOnly.rundown).slice(boundaryIndexOf(inferredOnly) + 1)).toContain('Prayer Meeting');
  });
});

describe('linking each entry to the one above it', () => {
  it('links everything except the first entry of the morning', () => {
    const { rundown } = build();
    const events = rundown.filter(isOntimeEvent);

    expect(events[0].linkStart).toBeNull();
    expect(events.slice(1).every((event) => event.linkStart !== null)).toBe(true);
  });

  it('links across the boundary block, since the times meet there', () => {
    const result = build();
    const events = result.rundown.filter(isOntimeEvent);
    const doors = eventNamed(result.rundown, 'Doors Open');
    const above = events[events.indexOf(doors) - 1];

    expect(doors.linkStart).toBe(above.id);
    expect(above.timeEnd).toBe(doors.timeStart);
  });

  it('leaves the mirrored service unlinked at its first entry and linked after it', () => {
    const result = build();
    const mirrored = regenerateInstances(result.rundown, result.serviceProfiles);
    const eleven = mirrored
      .filter((entry) => entry.generatedFor === result.serviceProfiles.services[1].id)
      .filter(isOntimeEvent);

    // linking it would drag the 11am back to the end of the 9am
    expect(eleven[0].linkStart).toBeNull();
    expect(eleven.slice(1).every((event) => event.linkStart !== null)).toBe(true);
  });

  it('points every link at an entry that is actually in the rundown', () => {
    const { rundown } = build();
    const ids = new Set(rundown.map((entry) => entry.id));

    for (const event of rundown.filter(isOntimeEvent)) {
      if (event.linkStart !== null) {
        expect(ids.has(event.linkStart), `${event.title} links to a missing entry`).toBe(true);
      }
    }
  });

  it('does not link across a gap, which would move an entry', () => {
    // anchoring PRE to a 7:00 rehearsal leaves it ending well before the service
    const withRehearsal = [
      ...planTimes,
      {
        type: 'PlanTime' as const,
        id: 't-sun-rehearsal',
        attributes: {
          name: 'Rehearsal',
          starts_at: '2026-08-22T19:00:00Z',
          ends_at: '2026-08-22T20:00:00Z',
          time_type: 'rehearsal' as const,
        },
      },
    ];
    const result = build({ planTimes: withRehearsal, rules: { ...rules, preAnchor: 'plan-time' } });
    const firstOfService = eventNamed(result.rundown, 'I Thank God');

    expect(eventNamed(result.rundown, 'Pre Service Video').timeEnd).not.toBe(firstOfService.timeStart);
    expect(firstOfService.linkStart).toBeNull();
  });
});

describe('holding durations after something that can overrun', () => {
  const held = build({
    rules: {
      ...rules,
      timerRules: [
        {
          name: 'message',
          match: { titleContains: 'ministry' },
          effect: { timerType: TimerType.CountDown, countToEnd: false, timeStrategy: TimeStrategy.LockDuration },
        },
      ],
    },
  });

  it('makes everything after it keep its own length', () => {
    for (const title of ['Fall Like Rain', 'EOS Announcements', 'End']) {
      const event = eventNamed(held.rundown, title);
      expect(event.countToEnd, `${title} should hold its duration`).toBe(false);
      expect(event.timeStrategy, `${title} should be duration-anchored`).toBe(TimeStrategy.LockDuration);
    }
  });

  it('leaves what comes before it counting down to a time', () => {
    expect(eventNamed(held.rundown, 'I Thank God').countToEnd).toBe(true);
    expect(eventNamed(held.rundown, 'Welcome').countToEnd).toBe(true);
  });

  it('changes no times, only what happens when one moves', () => {
    expect(eventNamed(held.rundown, 'EOS Announcements').timeStart).toBe(at(10, 11));
    expect(eventNamed(held.rundown, 'EOS Announcements').duration).toBe(MILLIS_PER_MINUTE);
  });

  it('does not carry out of PRE into the service', () => {
    // a section starts where the run sheet says it starts, whatever ran before it
    const fromPre = build({
      rules: {
        ...rules,
        inferredEntries: [
          {
            ...rules.inferredEntries[0],
            effect: { countToEnd: false, timeStrategy: TimeStrategy.LockDuration },
          },
        ],
      },
    });

    // the briefing holds its duration, so the rest of PRE does too
    expect(eventNamed(fromPre.rundown, 'Prayer Meeting').countToEnd).toBe(false);
    // but the service still counts down to its own times
    expect(eventNamed(fromPre.rundown, 'Doors Open').countToEnd).toBe(true);
  });

  it('can be turned off', () => {
    const loose = build({
      rules: {
        ...rules,
        fixedDurationCarriesForward: false,
        timerRules: [{ name: 'message', match: { titleContains: 'ministry' }, effect: { countToEnd: false } }],
      },
    });

    expect(eventNamed(loose.rundown, 'EOS Announcements').countToEnd).toBe(true);
  });
});

describe('the corrected rundown', () => {
  /**
   * The whole run sheet, against the rundown a producer corrected by hand and
   * exported. Every row of that export is below, so a rule that stops reproducing
   * it fails here and names the row that moved.
   *
   * Only the 9am is asserted: the 11am in the export is the dual-service mirror's
   * work, not the builder's, and is covered by "handing off to the existing
   * dual-service mirror" above.
   */
  const result = buildRundownFromPlan({
    plan,
    planTimes,
    items: fullItems,
    itemTimes: fullItemTimes,
    rules: shippedRules,
  });

  const corrected: [title: string, start: number, duration: number][] = [
    // the hour before the first rehearsal time, the one entry not read off the plan
    ['Power On', at(5, 15), at(1, 0)],
    // the production run, read off the plan's rehearsal times
    ['Service Sync', at(6, 15), at(0, 10)],
    // note the gap: the plan says 06:25 to 06:30 is nobody's
    ['Call Time - Creative Team', at(6, 30), at(0, 5)],
    // the vocalists rehearse alongside this one; they are in its note
    ['Band Soundcheck + Rehearsal', at(6, 35), at(0, 20)],
    ['Creative Team Prayer', at(6, 55), at(0, 10)],
    ['Vocal Soundcheck', at(7, 5), at(0, 5)],
    ['Mix Changes', at(7, 10), at(0, 5)],
    ['Link Worship Record', at(7, 15), at(0, 5)],
    ['Worship Rehearsal', at(7, 20), at(0, 25)],
    ['Production Checks', at(7, 45), at(0, 20)],
    // the two times the opening headers claim, in their titles and nowhere else
    ['SERVICE BRIEFING', at(8, 5), at(0, 5)],
    ['LINK BRIEF', at(8, 10), at(0, 10)],
    // the run sheet's own first item, which the briefs hand over to
    ['Prayer Meeting', at(8, 20), at(0, 25)],
    // -- 9AM SERVICE ---------------------------------------------------------
    // 13:20 is doors plus the online message merged into it
    ['Doors Open', at(8, 45), at(0, 13, 20)],
    ['Pre Service Video', at(8, 58, 20), at(0, 1, 40)],
    // five songs and the MC moment, folded into one segment
    // the four songs fold; the MC moment between the set and the welcome is cued,
    // so it keeps the row Planning Center gives it
    ['Praise & Worship', at(9), at(0, 18)],
    ['MC Moment', at(9, 18), at(0, 4)],
    ['Welcome & Meet & Greet', at(9, 22), at(0, 1)],
    ['Fun', at(9, 23), at(0, 4)],
    ['Honour All Men', at(9, 27), at(0, 2)],
    ["Father's Day VID", at(9, 29), at(0, 2)],
    ['Message - LINK', at(9, 31), at(0, 40)],
    ['EOS Announcements', at(10, 11), at(0, 1)],
    ['End', at(10, 12), 0],
  ];

  it('reproduces every row', () => {
    const actual = result.rundown.filter(isOntimeEvent).map((event) => [event.title, event.timeStart, event.duration]);

    expect(actual).toEqual(corrected);
  });

  it('holds durations from the message to the end of the service', () => {
    // an overrunning message must push the announcements, not eat them
    for (const title of ['Message - LINK', 'EOS Announcements', 'End']) {
      expect(eventNamed(result.rundown, title).countToEnd, title).toBe(false);
    }
    expect(eventNamed(result.rundown, 'Praise & Worship').countToEnd).toBe(true);
  });

  it('links every entry except the first of the morning and the one after the gap', () => {
    const events = result.rundown.filter(isOntimeEvent);
    expect(events[0].title).toBe('Power On');

    // the plan leaves 06:25 to 06:30 to nobody, so the call time starts on its own
    const unlinked = events.filter((event) => event.linkStart === null).map((event) => event.title);
    expect(unlinked).toEqual(['Power On', 'Call Time - Creative Team']);
  });

  it('marks every event public', () => {
    expect(result.rundown.filter(isOntimeEvent).every((event) => event.isPublic)).toBe(true);
  });

  it('has one block, naming the service, where the hand correction put it', () => {
    const blocks = result.rundown.filter(isOntimeBlock);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].title).toBe('9AM SERVICE');

    const index = boundaryIndexOf(result);
    expect(titleOf(result.rundown[index - 1])).toBe('Prayer Meeting');
    expect(titleOf(result.rundown[index + 1])).toBe('Doors Open');
  });

  it('keeps the set list on the folded worship segment', () => {
    // folding four songs into one segment would otherwise lose them entirely
    expect(eventNamed(result.rundown, 'Praise & Worship').note).toBe(
      ['Just That Good *NEW', 'I Know That I Know', 'Jesus Have It All', 'Here I Am To Worship TAG'].join('\n'),
    );
  });

  it('renames the linked message but leaves an unlinked one alone', () => {
    expect(eventNamed(result.rundown, 'Message - LINK').timerType).toBe(TimerType.CountDown);
    expect(eventNamed(result.rundown, 'Message - LINK').countToEnd).toBe(false);

    const unlinked = fullItems.map((item) =>
      item.id === 'f-21' ? { ...item, attributes: { ...item.attributes, title: 'Message' } } : item,
    );
    const plain = buildRundownFromPlan({
      plan,
      planTimes,
      items: unlinked,
      itemTimes: fullItemTimes,
      rules: shippedRules,
    });

    expect(titles(plain.rundown)).toContain('Message');
    expect(titles(plain.rundown)).not.toContain('Message - LINK');
  });
});

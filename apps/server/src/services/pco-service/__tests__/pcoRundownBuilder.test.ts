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
} from 'ontime-types';
import { MILLIS_PER_HOUR, MILLIS_PER_MINUTE, MILLIS_PER_SECOND } from 'ontime-utils';
import { describe, expect, it } from 'vitest';

import { regenerateInstances } from '../../rundown-service/serviceInstanceUtils.js';
import { defaultPcoRules, type PcoRules } from '../pcoRules.js';
import { buildRundownFromPlan, groupPlanTimesByDay } from '../pcoRundownBuilder.js';
import { localTimeOfDayMs } from '../pcoTime.js';

import { items, itemTimes, plan, planTimes } from './fixtures/centralAm.js';

const rules: PcoRules = { ...defaultPcoRules, timezone: 'Pacific/Auckland' };

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
    // 25:00 prayer + 12:20 doors + 1:00 online + 1:40 video = 40:00, so 8:20.
    // The 8:05 briefing is not in the data at all, only in a header's title text.
    const { rundown } = build();
    const briefing = rundown.find((entry) => titleOf(entry).startsWith('SERVICE BRIEFING'));

    expect(briefing && isOntimeBlock(briefing)).toBe(true);
    // the block itself carries no time, but the first pre entry proves the anchor
    expect(eventNamed(rundown, 'Prayer Meeting').timeStart).toBe(at(9) - at(0, 40));
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

  it('keeps only the prayer meeting in PRE', () => {
    // the briefing header is a `during` item, so it lands in the master section
    // rather than in PRE, even though it opens the sheet
    const result = build();
    expect(titles(result.rundown).slice(0, boundaryIndexOf(result))).toEqual(['Prayer Meeting']);
  });

  it('puts doors, walk-in and the pre-service video in the master section, not PRE', () => {
    const result = build();
    const serviceTitles = titles(result.rundown).slice(boundaryIndexOf(result) + 1);

    expect(serviceTitles.slice(0, 3)).toEqual(['Doors Open', 'Online Pre Service Message', 'Pre Service Video']);
  });

  it('turns every PCO header into an Ontime block', () => {
    const { rundown } = build();
    for (const title of ['SERVICE BRIEFING 8:05AM', 'PRAISE & WORSHIP', 'WELCOME & ANNOUNCEMENTS', 'MESSAGE', 'END']) {
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

    for (const title of ['Doors Open', 'Pre Service Video', 'I Thank God', 'EOS Announcements', 'End']) {
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
  it('back-times from the service when the day has no other plan time', () => {
    // this Sunday carries only the two service times, so plan-time has nothing to anchor to
    const { rundown } = build({ rules: { ...rules, preAnchor: 'plan-time' } });
    expect(eventNamed(rundown, 'Pre Service Video').timeEnd).toBe(at(9));
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

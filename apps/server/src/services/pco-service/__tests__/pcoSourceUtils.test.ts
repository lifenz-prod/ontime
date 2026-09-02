import type { PcoPinnedServiceType, PcoRules } from 'ontime-types';
import { describe, expect, it } from 'vitest';

import { defaultPcoRules } from '../pcoRules.js';
import { groupPlanTimesByDay } from '../pcoRundownBuilder.js';
import type { PcoItem, PcoPlan, PcoServiceType } from '../pcoTypes.js';
import {
  findPinnedBySourceName,
  findPlanBySourceName,
  knownItemsFromPlans,
  maskCredentialId,
  planSheetItems,
  pinnedSourceNames,
  planSourceName,
  planSourceNames,
  planSummary,
  resolveServiceType,
} from '../pcoSourceUtils.js';

import {
  items as centralAmItems,
  plan as centralAmPlan,
  planTimes as centralAmPlanTimes,
} from './fixtures/centralAm.js';

const serviceType = (id: string, name: string): PcoServiceType => ({
  type: 'ServiceType',
  id,
  attributes: { name, sequence: null },
});

const planOn = (id: string, sortDate: string | null, dates: string | null = null): PcoPlan => ({
  type: 'Plan',
  id,
  attributes: {
    dates,
    short_dates: null,
    sort_date: sortDate,
    series_title: null,
    title: null,
    total_length: null,
    items_count: null,
  },
});

describe('resolveServiceType', () => {
  const serviceTypes = [
    serviceType('101', 'Central AM'),
    serviceType('202', 'Central PM'),
    serviceType('303', 'North AM'),
  ];

  it('uses the id pinned in the environment ahead of the rules file', () => {
    const found = resolveServiceType(serviceTypes, {
      pinnedServiceTypeId: '303',
      serviceTypeId: '101',
      serviceTypeName: 'Central AM',
    });
    expect(found.id).toBe('303');
  });

  it('uses the id from the rules file', () => {
    expect(resolveServiceType(serviceTypes, { serviceTypeId: '202' }).id).toBe('202');
  });

  it('lists the available ids when a pinned id does not exist', () => {
    expect(() => resolveServiceType(serviceTypes, { serviceTypeId: '999' })).toThrowError(/999.*Available.*101/s);
  });

  it('matches a name case insensitively on a substring', () => {
    expect(resolveServiceType(serviceTypes, { serviceTypeName: 'central am' }).id).toBe('101');
    expect(resolveServiceType(serviceTypes, { serviceTypeName: '  NORTH  ' }).id).toBe('303');
  });

  it('refuses a name which matches more than one service type', () => {
    expect(() => resolveServiceType(serviceTypes, { serviceTypeName: 'central' })).toThrowError(
      /matches 2 Planning Center service types/,
    );
  });

  it('refuses a name which matches nothing', () => {
    expect(() => resolveServiceType(serviceTypes, { serviceTypeName: 'kids' })).toThrowError(/No Planning Center/);
  });

  it('needs no configuration when the organisation has a single service type', () => {
    expect(resolveServiceType([serviceType('101', 'Sunday')], {}).id).toBe('101');
  });

  it('refuses to guess between several unconfigured service types', () => {
    expect(() => resolveServiceType(serviceTypes, {})).toThrowError(/pin one on the Planning Center tab/);
  });

  it('reports an organisation with no service types', () => {
    expect(() => resolveServiceType([], { serviceTypeId: '101' })).toThrowError(/no service types/);
  });
});

describe('planSourceName', () => {
  it('names a plan by the date it runs on', () => {
    // sort_date is the local wall clock of the first service, not a UTC instant
    expect(centralAmPlan.attributes.sort_date).toBe('2026-08-23T09:00:00Z');
    expect(planSourceName(centralAmPlan)).toBe('2026-08-23');
  });

  it('does not shift an evening service to the next day', () => {
    // the regression that a timezone conversion of sort_date would introduce:
    // Central PM's 6pm service is stamped 18:00Z, which is 6am on the 24th in Auckland
    expect(planSourceName(planOn('1', '2026-08-23T18:00:00Z'))).toBe('2026-08-23');
  });

  it('reads the prose date when the plan carries no sort_date', () => {
    expect(planSourceName(planOn('1', null, '23 August 2026'))).toBe('2026-08-23');
    expect(planSourceName(planOn('1', null, 'August 23, 2026'))).toBe('2026-08-23');
  });

  it('falls back to the plan id when there is no date at all', () => {
    expect(planSourceName(planOn('71234567', null))).toBe('plan-71234567');
  });
});

describe('planSourceNames', () => {
  it('keeps the order it was given, so index 1 is the soonest plan', () => {
    const plans = [planOn('1', '2026-08-23T09:00:00Z'), planOn('2', '2026-08-30T09:00:00Z')];
    expect(planSourceNames(plans)).toEqual(['2026-08-23', '2026-08-30']);
  });

  it('distinguishes two plans which fall on the same date', () => {
    const plans = [planOn('11', '2026-08-23T09:00:00Z'), planOn('22', '2026-08-23T18:00:00Z')];
    expect(planSourceNames(plans)).toEqual(['2026-08-23', '2026-08-23 (22)']);
  });
});

describe('findPlanBySourceName', () => {
  const plans = [planOn('11', '2026-08-23T09:00:00Z'), planOn('22', '2026-08-30T09:00:00Z')];

  it('finds a plan by its name', () => {
    expect(findPlanBySourceName(plans, '2026-08-30')?.id).toBe('22');
  });

  it('ignores surrounding whitespace and case', () => {
    expect(findPlanBySourceName(plans, ' 2026-08-23 ')?.id).toBe('11');
    expect(findPlanBySourceName([planOn('33', null)], 'PLAN-33')?.id).toBe('33');
  });

  it('finds the disambiguated name of a same-date plan', () => {
    const sameDay = [planOn('11', '2026-08-23T09:00:00Z'), planOn('22', '2026-08-23T18:00:00Z')];
    expect(findPlanBySourceName(sameDay, '2026-08-23 (22)')?.id).toBe('22');
  });

  it('returns nothing for a name it does not hold', () => {
    expect(findPlanBySourceName(plans, '2026-09-06')).toBeUndefined();
  });
});

describe('resolveServiceType with pinned types', () => {
  const serviceTypes = [serviceType('101', 'Central AM'), serviceType('202', 'Central PM')];

  it('falls back to the first pinned service type', () => {
    const found = resolveServiceType(serviceTypes, { pinnedServiceTypes: [{ id: '202' }, { id: '101' }] });
    expect(found.id).toBe('202');
  });

  it('still prefers an explicitly configured id', () => {
    const found = resolveServiceType(serviceTypes, { serviceTypeId: '101', pinnedServiceTypes: [{ id: '202' }] });
    expect(found.id).toBe('101');
  });

  it('ignores a pinned type that no longer exists', () => {
    expect(() => resolveServiceType(serviceTypes, { pinnedServiceTypes: [{ id: '999' }] })).toThrowError(
      /pin one on the Planning Center tab/,
    );
  });
});

describe('planSummary', () => {
  it('describes a plan the way the import tab shows it', () => {
    const summary = planSummary(centralAmPlan, { id: '156118', name: 'Central AM ' });

    expect(summary).toMatchObject({
      serviceTypeId: '156118',
      serviceTypeName: 'Central AM',
      planId: centralAmPlan.id,
      date: '2026-08-23',
      dates: '23 August 2026',
      firstServiceTime: '09:00',
    });
  });

  it('reads the clock off the plan without converting it', () => {
    // sort_date is local wall clock, so an evening service reads as the evening
    expect(planSummary(planOn('1', '2026-08-23T18:00:00Z'), { id: '1', name: 'PM' }).firstServiceTime).toBe('18:00');
  });

  it('has no time when the plan carries no sort_date', () => {
    expect(planSummary(planOn('1', null, '23 August 2026'), { id: '1', name: 'AM' }).firstServiceTime).toBeNull();
  });
});

describe('knownItemsFromPlans', () => {
  const item = (
    title: string,
    length: number,
    itemType: PcoItem['attributes']['item_type'] = 'item',
    servicePosition: PcoItem['attributes']['service_position'] = 'during',
  ): PcoItem => ({
    type: 'Item',
    id: `i-${title}-${length}`,
    attributes: {
      title,
      description: '',
      html_details: null,
      length,
      sequence: 1,
      item_type: itemType,
      service_position: servicePosition,
    },
  });

  const rules: PcoRules = { ...defaultPcoRules };

  it('collapses the per-service title variants into one thing to configure', () => {
    const known = knownItemsFromPlans([[item('Doors Open // 9am', 740), item('Doors Open // 11am', 800)]], rules);

    expect(known).toHaveLength(1);
    expect(known[0].title).toBe('Doors Open');
  });

  it('counts the plans an item appears in, not the number of items', () => {
    const known = knownItemsFromPlans(
      [[item('Welcome', 60), item('Welcome', 60)], [item('Welcome', 60)], [item('Meet & Greet', 60)]],
      rules,
    );

    expect(known.find((entry) => entry.title === 'Welcome')?.planCount).toBe(2);
    expect(known.find((entry) => entry.title === 'Meet & Greet')?.planCount).toBe(1);
  });

  it('puts what happens every week first', () => {
    const known = knownItemsFromPlans([[item('Rare Thing', 60), item('Welcome', 60)], [item('Welcome', 60)]], rules);

    expect(known.map((entry) => entry.title)).toEqual(['Welcome', 'Rare Thing']);
  });

  it('reports a typical length, ignoring the weeks with none', () => {
    const known = knownItemsFromPlans([[item('Message', 2700)], [item('Message', 0)], [item('Message', 2900)]], rules);

    expect(known[0].typicalLength).toBe(2800);
  });

  it('has no typical length when nothing is ever timed', () => {
    expect(knownItemsFromPlans([[item('End', 0)]], rules)[0].typicalLength).toBeNull();
  });

  it('names the rule already claiming an item', () => {
    const known = knownItemsFromPlans([[item('Message (Incl. Ministry)', 2700), item('Welcome', 60)]], rules);

    // the shipped rule makes anything titled message a fixed-duration countdown
    expect(known.find((entry) => entry.title.startsWith('Message'))?.matchedBy).toBe(
      'message is a fixed-duration countdown',
    );
    expect(known.find((entry) => entry.title === 'Welcome')?.matchedBy).toBeNull();
  });

  it('keeps the item type and position, so a rule can narrow to them', () => {
    const known = knownItemsFromPlans([[item('PRAISE & WORSHIP', 0, 'header', 'during')]], rules);

    expect(known[0]).toMatchObject({ itemType: 'header', servicePosition: 'during' });
  });

  it('skips items with no title at all', () => {
    expect(knownItemsFromPlans([[item('', 60), item('Welcome', 60)]], rules)).toHaveLength(1);
  });
});

describe('pinnedSourceNames', () => {
  const pinned = (id: string, name: string, group: string | null = null): PcoPinnedServiceType => ({
    id,
    name,
    group,
  });

  it('names a source after the service type, not a date', () => {
    // the point of addressing by favourite: the button still works next Sunday
    expect(pinnedSourceNames([pinned('1', 'Central AM'), pinned('2', 'Central PM')])).toEqual([
      'Central AM',
      'Central PM',
    ]);
  });

  it('trims the names PCO pads', () => {
    expect(pinnedSourceNames([pinned('1', 'Central PM ')])).toEqual(['Central PM']);
  });

  it('qualifies a name two campuses share with its group', () => {
    const names = pinnedSourceNames([pinned('1', 'Sunday AM', 'Central'), pinned('2', 'Sunday AM', 'North')]);
    expect(names).toEqual(['Central Sunday AM', 'North Sunday AM']);
  });

  it('leaves a unique name alone even when it has a group', () => {
    expect(pinnedSourceNames([pinned('1', 'Central AM', 'Central')])).toEqual(['Central AM']);
  });

  it('falls back to the id when even the group does not separate them', () => {
    const names = pinnedSourceNames([pinned('1', 'Sunday AM', 'Central'), pinned('2', 'Sunday AM', 'Central')]);
    expect(names).toEqual(['Central Sunday AM', 'Central Sunday AM (2)']);
  });

  it('separates duplicates when neither carries a group', () => {
    const names = pinnedSourceNames([pinned('1', 'Sunday AM'), pinned('2', 'Sunday AM')]);
    expect(names).toEqual(['Sunday AM', 'Sunday AM (2)']);
  });
});

describe('findPinnedBySourceName', () => {
  const pinned: PcoPinnedServiceType[] = [
    { id: '156118', name: 'Central AM', group: 'Central' },
    { id: '158458', name: 'Central PM', group: 'Central' },
  ];

  it('finds the service type behind a source name', () => {
    expect(findPinnedBySourceName(pinned, 'Central PM')?.id).toBe('158458');
  });

  it('ignores case and surrounding whitespace, as a recall payload may carry either', () => {
    expect(findPinnedBySourceName(pinned, ' central am ')?.id).toBe('156118');
  });

  it('finds a qualified duplicate by its qualified name', () => {
    const shared: PcoPinnedServiceType[] = [
      { id: '1', name: 'Sunday AM', group: 'Central' },
      { id: '2', name: 'Sunday AM', group: 'North' },
    ];
    expect(findPinnedBySourceName(shared, 'North Sunday AM')?.id).toBe('2');
  });

  it('returns nothing for a service type which is not pinned', () => {
    expect(findPinnedBySourceName(pinned, 'North AM')).toBeUndefined();
  });
});

describe('maskCredentialId', () => {
  it('shows enough of a long id to recognise it, not enough to use it', () => {
    expect(maskCredentialId('abcdef1234567890abcdef')).toBe('abcd…cdef');
  });

  it('hides a short id completely rather than revealing most of it', () => {
    expect(maskCredentialId('abcdef')).toBe('••••••');
    expect(maskCredentialId('abcdefghijkl')).toBe('••••••••••••');
  });

  it('never returns an empty label', () => {
    expect(maskCredentialId('')).toBe('••••');
  });
});

describe('what the import will do with each item', () => {
  const item = (title: string, itemType: PcoItem['attributes']['item_type'] = 'item'): [PcoItem[]] => [
    [
      {
        type: 'Item',
        id: `i-${title}`,
        attributes: {
          title,
          description: '',
          html_details: null,
          length: 60,
          sequence: 1,
          item_type: itemType,
          service_position: 'during',
        },
      },
    ],
  ];

  const dispositionFor = (
    title: string,
    itemType: PcoItem['attributes']['item_type'] = 'item',
    rules = defaultPcoRules,
  ) => knownItemsFromPlans(item(title, itemType), rules)[0].disposition;

  it('reads the shipped rules back as plain words', () => {
    expect(dispositionFor('PRAISE & WORSHIP', 'header')).toBe('collapsed');
    expect(dispositionFor('Online Pre Service Message')).toBe('merged');
    expect(dispositionFor('Welcome')).toBe('event');
    // the shipped rules drop nothing now: the prayer meeting used to be dropped as a
    // duplicate of a hand-written production run, and the run is read off the plan
    expect(dispositionFor('Prayer Meeting')).toBe('event');
  });

  it('follows what headings are set to become', () => {
    // the panel must not offer timer settings on something that imports as a divider
    expect(dispositionFor('MESSAGE', 'header')).toBe('ignored');
    expect(dispositionFor('MESSAGE', 'header', { ...defaultPcoRules, headersBecome: 'block' })).toBe('block');
    expect(dispositionFor('MESSAGE', 'header', { ...defaultPcoRules, headersBecome: 'event' })).toBe('event');
  });

  it('lets a fold claim a heading a rule would otherwise drop', () => {
    // the builder folds before it ignores, and this has to say the same thing
    expect(
      dispositionFor('PRAISE & WORSHIP', 'header', { ...defaultPcoRules, ignoreItems: [{ itemType: 'header' }] }),
    ).toBe('collapsed');
  });
});

describe('one plan as the import page lists it', () => {
  const rules: PcoRules = { ...defaultPcoRules, timezone: 'Pacific/Auckland' };
  const days = groupPlanTimesByDay(centralAmPlanTimes, rules.timezone);
  const sunday = days.find((day) => day.serviceTimes.length > 0);

  const sheet = (overrides: Partial<PcoRules> = {}, serviceTypeId = '156118') =>
    planSheetItems(centralAmItems, { ...rules, ...overrides }, serviceTypeId, sunday);

  const titles = () => sheet().map((row) => row.title);
  const row = (title: string) => sheet().find((entry) => entry.title === title);

  describe('the production run above the run sheet', () => {
    it('lists the plan rehearsal times as rows of their own', () => {
      expect(titles().slice(0, 11)).toEqual([
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
      ]);
    });

    it('places each one on the clock, which the run sheet items cannot be', () => {
      expect(row('Service Sync')?.startsAt).toBe(6 * 3600_000 + 15 * 60_000);
      expect(row('Service Sync')?.duration).toBe(10 * 60_000);
      // an item's place depends on the whole build, so the page does not claim one
      expect(row('Prayer Meeting')?.startsAt).toBeNull();
    });

    it('opens with the lead-in, ending where the first rehearsal time starts', () => {
      expect(row('Power On')?.source).toBe('lead-in');
      expect(row('Power On')?.startsAt).toBe(5 * 3600_000 + 15 * 60_000);
    });

    it('says what runs alongside a row, where the plan overlaps two rehearsals', () => {
      expect(row('Band Soundcheck + Rehearsal')?.alongside).toBe('Vocal Rehearsal - Backstage');
      expect(row('Vocal Soundcheck')?.alongside).toBeNull();
    });

    it('leaves out the midweek rehearsal, which belongs to a morning this is not building', () => {
      // the plan carries a Wednesday rehearsal alongside the Sunday production run
      expect(days.map((day) => day.dateKey)).toEqual(['2026-08-19', '2026-08-23']);
      expect(titles()).not.toContain('Midweek Rehearsal');
    });

    it('leaves out staffing call times, which belong to no row', () => {
      expect(titles()).not.toContain('Producer Call Time');
    });

    it('lists no production run when the rehearsal times are not being read', () => {
      const withoutRun = planSheetItems(centralAmItems, { ...rules, deriveRehearsalTimes: false }, '156118', sunday);
      expect(withoutRun.map((entry) => entry.title)).not.toContain('Service Sync');
      expect(withoutRun[0].source).toBe('item');
    });
  });

  describe('a heading whose title states a time', () => {
    it('is named as the entry will be named, so a rule written here reaches it', () => {
      expect(row('SERVICE BRIEFING')?.sourceTitle).toBe('SERVICE BRIEFING 8:05AM');
      expect(row('BROADCAST BRIEF')?.sourceTitle).toBe('BROADCAST BRIEF 8:10am');
    });

    it('is imported rather than dropped with the other headings', () => {
      expect(row('SERVICE BRIEFING')?.disposition).toBe('event');
      expect(row('SERVICE BRIEFING')?.startsAt).toBe(8 * 3600_000 + 5 * 60_000);
      // the headings that state no time still follow headersBecome
      expect(row('PRAISE & WORSHIP')?.disposition).toBe('collapsed');
      expect(row('WELCOME & ANNOUNCEMENTS')?.disposition).toBe('ignored');
    });

    it('takes a per-row choice like any other row', () => {
      const omitted = sheet({
        serviceTypeRules: {
          '156118': [
            { name: 'SERVICE BRIEFING', match: { titleContains: 'SERVICE BRIEFING' }, effect: { importAs: 'omit' } },
          ],
        },
      });
      expect(omitted.find((entry) => entry.title === 'SERVICE BRIEFING')?.disposition).toBe('ignored');
    });
  });

  describe('the run sheet', () => {
    it('keeps the order Planning Center holds it in', () => {
      expect(titles().slice(11, 16)).toEqual([
        'BROADCAST BRIEF',
        'Prayer Meeting',
        'Doors Open',
        'Doors Open',
        'Online Pre Service Message',
      ]);
    });

    it('keeps the title a rule has to match alongside the one a person reads', () => {
      const doors = sheet().filter((entry) => entry.title === 'Doors Open');
      expect(doors.map((entry) => entry.sourceTitle)).toEqual(['Doors Open // 11am', 'Doors Open // 9am']);
    });

    it('says what the import will do with each row', () => {
      expect(row('Prayer Meeting')?.disposition).toBe('event');
      expect(row('Online Pre Service Message')?.disposition).toBe('merged');
    });

    it('carries the length the plan states, in milliseconds', () => {
      expect(row('Prayer Meeting')?.duration).toBe(25 * 60 * 1000);
    });
  });

  describe('rules scoped to a service type', () => {
    const scoped = {
      serviceTypeRules: {
        '156118': [{ name: 'Welcome', match: { titleContains: 'welcome' }, effect: { hideTimer: true } }],
      },
    };

    it('applies to the service type it was written for', () => {
      const own = sheet(scoped).find((entry) => entry.sourceTitle === 'Welcome');
      expect(own?.effect.hideTimer).toBe(true);
      expect(own?.matchedByServiceType).toBe(true);
    });

    it('leaves the same plan read as another service type untouched', () => {
      const other = sheet(scoped, '158458').find((entry) => entry.sourceTitle === 'Welcome');
      expect(other?.effect.hideTimer).toBeUndefined();
      expect(other?.matchedByServiceType).toBe(false);
    });

    it('reports an organisation-wide rule as such, so a row does not claim to be local', () => {
      const message = sheet().find((entry) => entry.sourceTitle?.startsWith('Message'));
      expect(message?.matchedBy).toBe('message is a fixed-duration countdown');
      expect(message?.matchedByServiceType).toBe(false);
    });

    it('reaches a production run row, which is an entry like any other', () => {
      const quiet = sheet({
        serviceTypeRules: {
          '156118': [
            { name: 'Worship Rehearsal', match: { titleContains: 'Worship Rehearsal' }, effect: { hideTimer: true } },
          ],
        },
      });
      expect(quiet.find((entry) => entry.title === 'Worship Rehearsal')?.effect.hideTimer).toBe(true);
    });
  });

  describe('importAs read back as a disposition', () => {
    const withRule = (effect: Record<string, unknown>) =>
      sheet({
        serviceTypeRules: { '156118': [{ name: 'Welcome', match: { titleContains: 'welcome' }, effect }] },
      }).find((entry) => entry.sourceTitle === 'Welcome')?.disposition;

    it('shows the choice that was made', () => {
      expect(withRule({ importAs: 'block' })).toBe('block');
      expect(withRule({ importAs: 'omit' })).toBe('ignored');
      expect(withRule({ importAs: 'event' })).toBe('event');
    });
  });
});

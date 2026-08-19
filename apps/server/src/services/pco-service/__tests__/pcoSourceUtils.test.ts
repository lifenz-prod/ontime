import { describe, expect, it } from 'vitest';

import type { PcoPlan, PcoServiceType } from '../pcoTypes.js';
import { findPlanBySourceName, planSourceName, planSourceNames, resolveServiceType } from '../pcoSourceUtils.js';

import { plan as centralAmPlan } from './fixtures/centralAm.js';

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
    expect(() => resolveServiceType(serviceTypes, {})).toThrowError(/set serviceTypeId or serviceTypeName/);
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

/**
 * The real Central AM plan for Sunday 23 August 2026, shaped as the API returns
 * it. Names are anonymised; every length, sequence, position and timestamp below
 * has been checked against the live plan (89267631).
 *
 * `PlanTime.starts_at` is a true UTC instant, so 9am NZST (UTC+12 in August)
 * arrives as 21:00Z the day before. Plan times deliberately span two dates so the
 * day selector is exercised.
 *
 * `Plan.sort_date` is NOT a UTC instant, despite the Z: PCO writes the
 * organisation's local wall clock there. Hence 09:00Z for a service whose
 * `starts_at` is 21:00Z. See `planDateKey`.
 *
 * Two things this fixture pins down, both read off the plan:
 *
 * 1. `service_position: 'pre'` items back-time as one run ending at 9:00 --
 *    prayer 25:00 + doors 12:20 + online 1:00 + video 1:40 = 40:00, and
 *    9:00 - 40:00 = 8:20, where the prayer meeting starts.
 *
 * 2. Doors Open exists TWICE, once per service, each excluded from the other.
 *    The 11am variant is 1:00 longer because the 9am carries an extra "Online
 *    Pre Service Message" that the 11am does not. Both land on :58:20.
 *
 * The "SERVICE BRIEFING 8:05AM" header carries no length and sits in `during`,
 * at sequence 1. The 8:05 briefing is therefore nowhere in the data -- it exists
 * only as text in that title, 15 minutes ahead of the prayer meeting. Representing
 * it as a real entry is what `rules.inferredEntries` is for.
 */

import type { PcoItem, PcoItemTime, PcoPlan, PcoPlanTime } from '../../pcoTypes.js';

export const plan: PcoPlan = {
  type: 'Plan',
  id: '71234567',
  attributes: {
    dates: '23 August 2026',
    short_dates: 'Aug 23',
    // local wall clock with a spurious Z, as PCO writes it
    sort_date: '2026-08-23T09:00:00Z',
    series_title: null,
    title: 'Central AM',
    total_length: 4320,
    items_count: 21,
  },
};

const planTime = (
  id: string,
  name: string,
  startsAt: string,
  endsAt: string,
  timeType: PcoPlanTime['attributes']['time_type'],
): PcoPlanTime => ({
  type: 'PlanTime',
  id,
  attributes: { name, starts_at: startsAt, ends_at: endsAt, time_type: timeType },
});

export const planTimes: PcoPlanTime[] = [
  // a midweek rehearsal on a different date, which must not be mistaken for the service day
  planTime('t-wed', 'Midweek Rehearsal', '2026-08-19T07:00:00Z', '2026-08-19T09:00:00Z', 'rehearsal'),
  planTime('t-9am', '9:00 AM', '2026-08-22T21:00:00Z', '2026-08-22T22:12:00Z', 'service'),
  planTime('t-11am', '11:00 AM', '2026-08-22T23:00:00Z', '2026-08-23T00:12:00Z', 'service'),
];

/** lengths are given as m:ss off the sheet and converted to the seconds PCO stores */
const secs = (mmss: string): number => {
  const [minutes, seconds] = mmss.split(':').map(Number);
  return minutes * 60 + (seconds ?? 0);
};

const item = (
  id: string,
  sequence: number,
  title: string,
  length: string,
  itemType: PcoItem['attributes']['item_type'] = 'item',
  servicePosition: PcoItem['attributes']['service_position'] = 'during',
  description = '',
): PcoItem => ({
  type: 'Item',
  id,
  attributes: {
    title,
    description,
    html_details: null,
    length: secs(length),
    sequence,
    item_type: itemType,
    service_position: servicePosition,
  },
});

export const items: PcoItem[] = [
  // the briefing header opens the sheet but belongs to `during` and has no length
  item('i-01', 1, 'SERVICE BRIEFING 8:05AM', '0:00', 'header'),

  // -- pre-service, back-timed to 9:00 --------------------------------------
  item('i-02', 2, 'Prayer Meeting', '25:00', 'item', 'pre', 'Ps A. Speaker'),
  item('i-03', 3, 'Doors Open // 11am', '13:20', 'item', 'pre'),
  item('i-04', 4, 'Doors Open // 9am', '12:20', 'item', 'pre'),
  item('i-05', 5, 'Online Pre Service Message', '1:00', 'item', 'pre'),
  item('i-06', 6, 'Pre Service Video', '1:40', 'song', 'pre'),

  // -- the service itself, forward from 9:00 --------------------------------
  item('i-07', 7, 'PRAISE & WORSHIP', '0:00', 'header'),
  item('i-08', 8, 'I Thank God', '4:00', 'song', 'during', 'WL - E. Leader'),
  item('i-09', 9, 'O Praise The Name (Anástasis)', '5:30', 'song', 'during', 'WL - D. Leader'),
  item('i-10', 10, 'Jesus Have It All', '7:00', 'song', 'during', 'WL - E. Leader'),
  item('i-11', 11, 'I Exalt Thee', '3:30', 'song', 'during', 'WL - D. Leader'),
  item('i-12', 12, 'MC Moment', '4:00', 'item', 'during', 'Ps B. Speaker'),
  item('i-13', 13, 'WELCOME & ANNOUNCEMENTS', '0:00', 'header'),
  item('i-14', 14, 'Welcome', '1:00', 'item', 'during', 'Ps B. Speaker'),
  item('i-15', 15, 'Meet & Greet', '1:00'),
  item('i-16', 16, 'MESSAGE', '0:00', 'header'),
  item('i-17', 17, 'Message (Incl. Ministry & Altar Call)', '45:00', 'item', 'during', 'Ps C. Speaker'),
  item('i-18', 18, 'Fall Like Rain', '0:00', 'song', 'during', 'WL - D. Leader'),
  item('i-19', 19, 'Here I Am To Worship / Worthy Of It All TAG', '0:00', 'song', 'during', 'WL - D. Leader'),
  item('i-20', 20, 'EOS Announcements', '1:00', 'item', 'during', 'Bibles'),
  item('i-21', 21, 'End', '0:00'),
  item('i-22', 22, 'END', '0:00', 'header'),
];

const excludedFrom = (id: string, itemId: string, planTimeId: string, length: number): PcoItemTime => ({
  type: 'ItemTime',
  id,
  attributes: { exclude: true, length, length_offset: 0 },
  relationships: {
    item: { data: { type: 'Item', id: itemId } },
    plan_time: { data: { type: 'PlanTime', id: planTimeId } },
  },
});

export const itemTimes: PcoItemTime[] = [
  // the 9am-only rows: blank in the 11am column on the sheet
  excludedFrom('it-1', 'i-02', 't-11am', secs('25:00')), // Prayer Meeting - PRE, so harmless
  excludedFrom('it-2', 'i-04', 't-11am', secs('12:20')), // Doors Open // 9am - the mirror regenerates it
  excludedFrom('it-3', 'i-05', 't-11am', secs('1:00')), // Online Pre Service Message - a real divergence
  // the 11am-only row: blank in the 9am column, so it never reaches the master
  excludedFrom('it-4', 'i-03', 't-9am', secs('13:20')), // Doors Open // 11am
];

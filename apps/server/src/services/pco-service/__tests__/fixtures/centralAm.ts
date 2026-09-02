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
 * Three things this fixture pins down, all read off the plan:
 *
 * 1. `service_position: 'pre'` items back-time as one run ending at 9:00 --
 *    prayer 25:00 + doors 12:20 + online 1:00 + video 1:40 = 40:00, and
 *    9:00 - 40:00 = 8:20, where the prayer meeting starts.
 *
 * 2. Doors Open exists TWICE, once per service, each excluded from the other.
 *    The 11am variant is 1:00 longer because the 9am carries an extra "Online
 *    Pre Service Message" that the 11am does not. Both land on :58:20.
 *
 * 3. The morning above the run sheet is in the plan twice removed: as `rehearsal`
 *    times carrying their own names and clock times, and as two headers stating a
 *    time in their title and nowhere else. The two meet exactly -- the last
 *    rehearsal time ends at 8:05, which is what the first header claims -- and the
 *    briefs hand over to the prayer meeting at 8:20.
 *
 * Item ids are opaque and were assigned before the second header was transcribed,
 * so they no longer run in step with `sequence`. Order comes from `sequence`.
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

/**
 * The production morning, which the plan holds as `rehearsal` times.
 *
 * Transcribed from the live plan with its two awkward shapes intact, because both
 * are what the builder has to get right:
 *
 * 1. A **gap**. The sync ends at 06:25 and the call time starts at 06:30. The plan
 *    means it, so the rundown holds a gap there and the entries either side do not
 *    link.
 * 2. An **overlap**. The band and the vocalists rehearse in different rooms from
 *    06:35 to 06:55. A rundown is linear, so one of them keeps the row.
 *
 * Production Checks ends at 08:05, which is exactly what the SERVICE BRIEFING
 * header below claims -- the two halves of the morning meet without either
 * knowing about the other.
 */
export const planTimes: PcoPlanTime[] = [
  // a midweek rehearsal on a different date, which must not be mistaken for the service day
  planTime('t-wed', 'Midweek Rehearsal', '2026-08-19T07:00:00Z', '2026-08-19T09:00:00Z', 'rehearsal'),

  planTime('t-r1', 'Service Sync', '2026-08-22T18:15:00Z', '2026-08-22T18:25:00Z', 'rehearsal'),
  planTime('t-r2', 'Call Time - Creative Team', '2026-08-22T18:30:00Z', '2026-08-22T18:35:00Z', 'rehearsal'),
  planTime('t-r3', 'Band Soundcheck + Rehearsal', '2026-08-22T18:35:00Z', '2026-08-22T18:55:00Z', 'rehearsal'),
  planTime('t-r4', 'Vocal Rehearsal - Backstage', '2026-08-22T18:35:00Z', '2026-08-22T18:55:00Z', 'rehearsal'),
  planTime('t-r5', 'Creative Team Prayer', '2026-08-22T18:55:00Z', '2026-08-22T19:05:00Z', 'rehearsal'),
  planTime('t-r6', 'Vocal Soundcheck', '2026-08-22T19:05:00Z', '2026-08-22T19:10:00Z', 'rehearsal'),
  planTime('t-r7', 'Mix Changes', '2026-08-22T19:10:00Z', '2026-08-22T19:15:00Z', 'rehearsal'),
  planTime('t-r8', 'Link Worship Record', '2026-08-22T19:15:00Z', '2026-08-22T19:20:00Z', 'rehearsal'),
  planTime('t-r9', 'Worship Rehearsal', '2026-08-22T19:20:00Z', '2026-08-22T19:45:00Z', 'rehearsal'),
  planTime('t-r10', 'Production Checks', '2026-08-22T19:45:00Z', '2026-08-22T20:05:00Z', 'rehearsal'),

  /**
   * A staffing call time, which is what `other` is for. It runs from before the
   * production checks to after the second service, so it belongs to no row of a
   * rundown -- the plan carries a dozen more like it.
   */
  planTime('t-o1', 'Producer Call Time', '2026-08-22T19:30:00Z', '2026-08-23T00:45:00Z', 'other'),

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
  /**
   * Two headers open the sheet, both `during` and both lengthless. They are the
   * only record anywhere that the briefing and the broadcast brief happen, and
   * they say when in their titles rather than in any field -- which is why the
   * builder reads the title. Left in `during` they would lay out forward from the
   * service and land at 9:00 announcing a briefing four hours past.
   */
  item('i-01', 1, 'SERVICE BRIEFING 8:05AM', '0:00', 'header'),
  item('i-1b', 2, 'BROADCAST BRIEF 8:10am', '0:00', 'header'),

  // -- pre-service, back-timed to 9:00 --------------------------------------
  item('i-02', 3, 'Prayer Meeting', '25:00', 'item', 'pre', 'Ps A. Speaker'),
  item('i-03', 4, 'Doors Open // 11am', '13:20', 'item', 'pre'),
  item('i-04', 5, 'Doors Open // 9am', '12:20', 'item', 'pre'),
  item('i-05', 6, 'Online Pre Service Message', '1:00', 'item', 'pre'),
  item('i-06', 7, 'Pre Service Video', '1:40', 'song', 'pre'),

  // -- the service itself, forward from 9:00 --------------------------------
  item('i-07', 8, 'PRAISE & WORSHIP', '0:00', 'header'),
  item('i-08', 9, 'I Thank God', '4:00', 'song', 'during', 'WL - E. Leader'),
  item('i-09', 10, 'O Praise The Name (Anástasis)', '5:30', 'song', 'during', 'WL - D. Leader'),
  item('i-10', 11, 'Jesus Have It All', '7:00', 'song', 'during', 'WL - E. Leader'),
  item('i-11', 12, 'I Exalt Thee', '3:30', 'song', 'during', 'WL - D. Leader'),
  item('i-12', 13, 'MC Moment', '4:00', 'item', 'during', 'Ps B. Speaker'),
  item('i-13', 14, 'WELCOME & ANNOUNCEMENTS', '0:00', 'header'),
  item('i-14', 15, 'Welcome', '1:00', 'item', 'during', 'Ps B. Speaker'),
  item('i-15', 16, 'Meet & Greet', '1:00'),
  item('i-16', 17, 'MESSAGE', '0:00', 'header'),
  item('i-17', 18, 'Message (Incl. Ministry & Altar Call)', '45:00', 'item', 'during', 'Ps C. Speaker'),
  item('i-18', 19, 'Fall Like Rain', '0:00', 'song', 'during', 'WL - D. Leader'),
  item('i-19', 20, 'Here I Am To Worship / Worthy Of It All TAG', '0:00', 'song', 'during', 'WL - D. Leader'),
  item('i-20', 21, 'EOS Announcements', '1:00', 'item', 'during', 'Bibles'),
  item('i-21', 22, 'End', '0:00'),
  item('i-22', 23, 'END', '0:00', 'header'),
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

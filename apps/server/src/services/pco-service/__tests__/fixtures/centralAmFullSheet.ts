/**
 * A second Central AM run sheet, reconstructed item for item from an Ontime export
 * of the plan alongside the Planning Center run sheet it was built from.
 *
 * Where `centralAm.ts` is trimmed to the timing questions, this one is the whole
 * sheet: the three headers that open it, the worship set, the announcements, the
 * message. It exists so the shipped rules can be asserted against a rundown a
 * person actually corrected by hand -- see "the corrected rundown" in the tests.
 *
 * Speaker names are anonymised. Every title, length and sequence is as exported.
 *
 * The plan and its times are shared with `centralAm.ts`: a 9:00 and an 11:00
 * service on the same Sunday. Only the item list differs, and only the item list
 * is under test here.
 */

import type { PcoItem, PcoItemTime } from '../../pcoTypes.js';

export { plan, planTimes } from './centralAm.js';

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
   * Three headers open the sheet, all `during` with no length. Two of them are the
   * only record anywhere that the briefing and the link brief happen, and they say
   * so in their titles rather than in any field.
   */
  item('f-01', 1, 'DRAFT RUNSHEET', '0:00', 'header'),
  item('f-02', 2, 'SERVICE BRIEFING 8:05am', '0:00', 'header'),
  item('f-03', 3, 'LINK BRIEF 8:10am', '0:00', 'header'),

  // -- pre-service, back-timed to 9:00 ---------------------------------------
  item('f-04', 4, 'Prayer Meeting', '25:00', 'item', 'pre', 'Ps A. Speaker'),
  item('f-05', 5, 'Doors Open // 11am', '13:20', 'item', 'pre'),
  item('f-06', 6, 'Doors Open // 9am', '12:20', 'item', 'pre'),
  item('f-07', 7, 'Online Pre Service Message', '1:00', 'item', 'pre'),
  item('f-08', 8, 'Pre Service Video', '1:40', 'media', 'pre'),

  // -- the service, forward from 9:00 ----------------------------------------
  item('f-09', 9, 'PRAISE & WORSHIP', '0:00', 'header'),
  item('f-10', 10, 'Just That Good *NEW', '4:00', 'song', 'during', 'WL - D. Leader'),
  item('f-11', 11, 'I Know That I Know', '3:30', 'song', 'during', 'WL - D. Leader\nStart in Chorus'),
  item('f-12', 12, 'Jesus Have It All', '7:00', 'song', 'during', 'WL - J. Leader & D. Leader'),
  item('f-13', 13, 'Here I Am To Worship TAG', '3:30', 'song', 'during', 'WL - J. Leader'),
  item('f-14', 14, 'MC Moment', '4:00', 'item', 'during', 'Ps B. Speaker'),

  item('f-15', 15, 'WELCOME & ANNOUNCEMENTS', '0:00', 'header'),
  item('f-16', 16, 'Welcome & Meet & Greet', '1:00', 'item', 'during', 'Ps B. Speaker\nNext Steps Lounge'),
  item('f-17', 17, 'Fun', '4:00', 'item', 'during', "Dual MC's\nNever Have I Ever (Crowd Game)"),
  item('f-18', 18, 'Honour All Men', '2:00', 'item', 'during', 'Talk to Gift (Socks)\nGift at Doors'),
  item('f-19', 19, "Father's Day VID", '2:00', 'media', 'during', "What's Your Dad Do"),

  item('f-20', 20, 'MESSAGE', '0:00', 'header'),
  item(
    'f-21',
    21,
    'Message (Incl. Altar Call) // One Way Link',
    '40:00',
    'item',
    'during',
    'Ps C. Speaker\n9am: South, North, West, East, TGA, Online & Locals\n11am: South & North',
  ),
  item('f-22', 22, 'EOS Announcements', '1:00', 'item', 'during', 'Bibles\nTogether Forever Promo'),
  item('f-23', 23, 'End', '0:00'),
  item('f-24', 24, 'END', '0:00', 'header'),
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
  // 9am only, blank in the 11am column on the sheet
  excludedFrom('ft-1', 'f-04', 't-11am', secs('25:00')),
  excludedFrom('ft-2', 'f-06', 't-11am', secs('12:20')),
  excludedFrom('ft-3', 'f-07', 't-11am', secs('1:00')),
  // 11am only, so it never reaches the master. It is the 1:00 longer of the two
  // because the 9am carries the online message and the 11am does not
  excludedFrom('ft-4', 'f-05', 't-9am', secs('13:20')),
];

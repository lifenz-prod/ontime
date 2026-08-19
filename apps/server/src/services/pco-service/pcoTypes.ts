/**
 * Types for the Planning Center Online (PCO) Services API v2
 * https://api.planningcenteronline.com/docs/apps/services/versions/2018-11-01
 *
 * PCO speaks JSON:API, so every payload is wrapped in a data/included/meta envelope
 * and the domain fields live under `attributes`.
 */

export type PcoResource<TType extends string, TAttributes> = {
  type: TType;
  id: string;
  attributes: TAttributes;
  relationships?: Record<string, { data: { type: string; id: string } | { type: string; id: string }[] | null }>;
};

export type PcoCollection<TResource> = {
  data: TResource[];
  /** present when the request used `include=` */
  included?: PcoResource<string, Record<string, unknown>>[];
  /**
   * JSON:API pagination. `links.next` is the reliable cursor -- prefer it over
   * meta.next, which is not always present.
   */
  links?: { next?: string; self?: string };
  meta?: {
    total_count?: number;
    count?: number;
    /** absent on the last page */
    next?: { offset: number };
  };
};

export type PcoSingle<TResource> = {
  data: TResource;
  included?: PcoResource<string, Record<string, unknown>>[];
};

export type PcoServiceTypeAttributes = {
  name: string;
  sequence: number | null;
};
export type PcoServiceType = PcoResource<'ServiceType', PcoServiceTypeAttributes>;

export type PcoPlanAttributes = {
  /** human readable list of all service times, eg "August 23, 2026" */
  dates: string | null;
  short_dates: string | null;
  /** chronologically first service time, used for sorting */
  sort_date: string | null;
  series_title: string | null;
  title: string | null;
  /** total length in seconds of all `during` items */
  total_length: number | null;
  items_count: number | null;
};
export type PcoPlan = PcoResource<'Plan', PcoPlanAttributes>;

/** PCO distinguishes rehearsals from services from everything else */
export type PcoTimeType = 'rehearsal' | 'service' | 'other';

export type PcoPlanTimeAttributes = {
  name: string | null;
  /** ISO-8601, UTC. Planned start */
  starts_at: string;
  /** ISO-8601, UTC. Planned end */
  ends_at: string | null;
  time_type: PcoTimeType;
  live_starts_at?: string | null;
  live_ends_at?: string | null;
};
export type PcoPlanTime = PcoResource<'PlanTime', PcoPlanTimeAttributes>;

/**
 * Where in the service an item sits, and what kind of item it is.
 * Defined in ontime-types because the rules that match on them are edited in the
 * settings panel; re-exported here so the API shapes below read as one unit.
 */
import type { PcoItemType, PcoServicePosition } from 'ontime-types';

export type { PcoItemType, PcoServicePosition };

export type PcoItemAttributes = {
  title: string | null;
  description: string | null;
  html_details: string | null;
  /** duration in SECONDS */
  length: number | null;
  sequence: number | null;
  item_type: PcoItemType;
  service_position: PcoServicePosition;
  key_name?: string | null;
};
export type PcoItem = PcoResource<'Item', PcoItemAttributes>;

/**
 * Per (item x plan_time) override.
 * This is where a plan expresses "this song is only in the 9am" (`exclude`)
 * or "this segment is longer in the 11am" (`length` / `length_offset`).
 */
export type PcoItemTimeAttributes = {
  exclude: boolean | null;
  /** duration in SECONDS for this specific plan time */
  length: number | null;
  length_offset: number | null;
  live_start_at?: string | null;
  live_end_at?: string | null;
};
export type PcoItemTime = PcoResource<'ItemTime', PcoItemTimeAttributes>;

/**
 * A note attached to an item, grouped under a named category.
 *
 * This is where the run sheet's extra columns actually live. On the LIFE NZ
 * plans the categories are "Media No." (playback codes) and "Producer Notes"
 * (the timer instructions a caller reads), NOT `Item.description`.
 */
export type PcoItemNoteAttributes = {
  content: string | null;
  category_name: string | null;
};
export type PcoItemNote = PcoResource<'ItemNote', PcoItemNoteAttributes>;

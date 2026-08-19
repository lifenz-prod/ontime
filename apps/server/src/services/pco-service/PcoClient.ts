/**
 * Client for the Planning Center Online Services API v2.
 *
 * Auth is a Personal Access Token: an Application ID + Secret pair created at
 * https://api.planningcenteronline.com/oauth/applications, sent as HTTP Basic.
 * There is no user-facing flow, which suits a self-hosted server acting as a
 * single trusted client. The credential shape is deliberately isolated behind
 * `PcoCredentials` so an OAuth bearer token can be swapped in later without
 * touching any of the calling code.
 *
 * Two behaviours here are hard-won rather than obvious, both carried over from
 * the LIFE NZ Lookbook integration (see pco-integration-info.md):
 *
 * 1. NEVER fetch a single page of a PCO list. The default page size silently
 *    truncates -- this org has 327 service types, so an unpaginated call returns
 *    25 of them and looks successful. Every list request forces per_page=100 and
 *    follows `links.next` to the end.
 * 2. The `future` / `after` / `before` plan filters are unreliable for "the plan
 *    on this exact date". Query a window, then match the calendar date in code.
 */

import type {
  PcoCollection,
  PcoItem,
  PcoItemNote,
  PcoItemTime,
  PcoPlan,
  PcoPlanTime,
  PcoResource,
  PcoServiceType,
  PcoSingle,
} from './pcoTypes.js';

const PCO_BASE_URL = 'https://api.planningcenteronline.com/services/v2';

/** PCO allows 100 requests per 20 seconds; we back off on 429 rather than pre-throttling */
const MAX_RETRIES = 3;
const PER_PAGE = 100;
/** guards against a malformed links.next loop */
const MAX_PAGES = 200;

export type PcoCredentials = {
  applicationId: string;
  secret: string;
};

export class PcoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PcoError';
  }
}

function authHeader({ applicationId, secret }: PcoCredentials): string {
  return `Basic ${Buffer.from(`${applicationId}:${secret}`).toString('base64')}`;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extracts a useful message out of a PCO error body.
 * PCO returns JSON:API errors: { errors: [{ title, detail, status }] }
 */
function describeError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body);
    const first = parsed?.errors?.[0];
    if (first) {
      return `PCO ${status}: ${first.title ?? 'error'}${first.detail ? ` - ${first.detail}` : ''}`;
    }
  } catch {
    // fall through to the raw body
  }
  return `PCO ${status}: ${body.slice(0, 300)}`;
}

/** everything a plan's run sheet is reconstructed from */
export type PcoPlanContent = {
  items: PcoItem[];
  itemTimes: PcoItemTime[];
  itemNotes: PcoItemNote[];
};

export class PcoClient {
  constructor(private readonly credentials: PcoCredentials) {
    if (!credentials.applicationId || !credentials.secret) {
      throw new PcoError('Missing Planning Center application id or secret');
    }
  }

  /** Single request with rate-limit aware retries. `url` may be absolute (a links.next cursor). */
  private async request<T>(pathOrUrl: string, params: Record<string, string | number> = {}): Promise<T> {
    const url = pathOrUrl.startsWith('http') ? new URL(pathOrUrl) : new URL(`${PCO_BASE_URL}${pathOrUrl}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; ; attempt++) {
      const response = await fetch(url, {
        headers: { Authorization: authHeader(this.credentials), Accept: 'application/json' },
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      // 429 carries Retry-After in seconds; 5xx is worth one more try
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < MAX_RETRIES) {
        const retryAfter = Number(response.headers.get('Retry-After'));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000);
        continue;
      }

      const body = await response.text().catch(() => '');
      if (response.status === 401) {
        throw new PcoError(
          'Planning Center rejected the credentials (401). The token is wrong or has been revoked.',
          401,
        );
      }
      if (response.status === 403) {
        throw new PcoError(
          'Planning Center denied access (403). The token is valid but lacks permission for the Services product.',
          403,
        );
      }
      throw new PcoError(describeError(response.status, body), response.status);
    }
  }

  /**
   * Walks every page of a list, following `links.next` and falling back to
   * meta.next offsets. `included` is accumulated AND deduplicated by id, because
   * the same related record is repeated on each page that references it.
   */
  private async requestAll<TResource extends PcoResource<string, object>>(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<{ data: TResource[]; included: PcoResource<string, Record<string, unknown>>[]; pages: number }> {
    const data: TResource[] = [];
    const includedById = new Map<string, PcoResource<string, Record<string, unknown>>>();

    let nextUrl: string | null = null;
    let offset = 0;
    let pages = 0;

    for (; pages < MAX_PAGES; pages++) {
      const page: PcoCollection<TResource> = nextUrl
        ? await this.request<PcoCollection<TResource>>(nextUrl)
        : await this.request<PcoCollection<TResource>>(path, { ...params, per_page: PER_PAGE, offset });

      data.push(...page.data);
      for (const resource of page.included ?? []) {
        // dedupe across pages; type+id is the JSON:API identity
        includedById.set(`${resource.type}:${resource.id}`, resource);
      }

      // an empty page ends the walk even when a next cursor is offered: PCO keeps
      // handing out `links.next` past the end of some lists, and following it to
      // MAX_PAGES burns through the rate limit and costs minutes
      if (page.links?.next && page.data.length > 0) {
        nextUrl = page.links.next;
        continue;
      }

      const metaNext = page.meta?.next?.offset;
      if (metaNext === undefined || metaNext <= offset || page.data.length === 0) {
        break;
      }
      nextUrl = null;
      offset = metaNext;
    }

    return { data, included: [...includedById.values()], pages: pages + 1 };
  }

  /** Cheap call used to verify a credential pair works */
  async verify(): Promise<{ serviceTypes: PcoServiceType[] }> {
    return { serviceTypes: await this.getServiceTypes() };
  }

  async getServiceTypes(): Promise<PcoServiceType[]> {
    const { data } = await this.requestAll<PcoServiceType>('/service_types');
    return data;
  }

  /**
   * Upcoming plans for a service type, soonest first.
   * Paginated, because a busy service type has far more than one page of plans.
   */
  async getFuturePlans(serviceTypeId: string, limit = 10): Promise<PcoPlan[]> {
    const { data } = await this.requestAll<PcoPlan>(`/service_types/${serviceTypeId}/plans`, {
      filter: 'future',
      order: 'sort_date',
    });
    return data.slice(0, limit);
  }

  /**
   * Finds the plan on an exact calendar date.
   *
   * PCO's own date filters are unreliable here, so this pulls a window of future
   * plans and matches the date in code, preferring `sort_date` and falling back
   * to the human-readable `dates` string.
   */
  async findPlanForDate(serviceTypeId: string, dateKey: string): Promise<PcoPlan | null> {
    const plans = await this.getFuturePlans(serviceTypeId, 50);
    return plans.find((plan) => planDateKey(plan) === dateKey) ?? null;
  }

  async getPlan(serviceTypeId: string, planId: string): Promise<PcoPlan> {
    const { data } = await this.request<PcoSingle<PcoPlan>>(`/service_types/${serviceTypeId}/plans/${planId}`);
    return data;
  }

  async getPlanTimes(serviceTypeId: string, planId: string): Promise<PcoPlanTime[]> {
    const { data } = await this.requestAll<PcoPlanTime>(`/service_types/${serviceTypeId}/plans/${planId}/plan_times`);
    return data;
  }

  /**
   * The whole run sheet in as few requests as possible.
   *
   * `include=item_times,item_notes` pulls the per-service overrides and the note
   * categories (Media No., Producer Notes) alongside the items. If the include is
   * rejected we fall back to per-item requests for item_times, which is slower
   * but keeps the divergence detection working.
   */
  async getPlanContent(serviceTypeId: string, planId: string): Promise<PcoPlanContent> {
    const basePath = `/service_types/${serviceTypeId}/plans/${planId}/items`;

    let items: PcoItem[] = [];
    let itemTimes: PcoItemTime[] = [];
    let itemNotes: PcoItemNote[] = [];

    try {
      const { data, included } = await this.requestAll<PcoItem>(basePath, { include: 'item_times,item_notes' });
      items = data;
      itemTimes = included.filter((resource): resource is PcoItemTime => resource.type === 'ItemTime');
      itemNotes = included.filter((resource): resource is PcoItemNote => resource.type === 'ItemNote');
    } catch {
      // the include was rejected; get the items on their own
      const { data } = await this.requestAll<PcoItem>(basePath);
      items = data;
    }

    items = items.sort((a, b) => (a.attributes.sequence ?? 0) - (b.attributes.sequence ?? 0));

    if (itemTimes.length === 0 && items.length > 0) {
      itemTimes = await this.getItemTimesPerItem(basePath, items);
    }

    return { items, itemTimes, itemNotes };
  }

  /** One request per item. Only used when the bulk include did not return item_times. */
  private async getItemTimesPerItem(basePath: string, items: PcoItem[]): Promise<PcoItemTime[]> {
    const collected: PcoItemTime[] = [];
    for (const item of items) {
      const { data } = await this.requestAll<PcoItemTime>(`${basePath}/${item.id}/item_times`);
      // the per-item route omits the item relationship, so stamp it on ourselves
      for (const itemTime of data) {
        collected.push({
          ...itemTime,
          relationships: { ...itemTime.relationships, item: { data: { type: 'Item', id: item.id } } },
        });
      }
    }
    return collected;
  }
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * The plan's date as YYYY-MM-DD.
 *
 * `sort_date` is authoritative and is read AS WRITTEN, not converted. It looks like
 * a UTC instant and is not one: PCO stamps it with the organisation's local wall
 * clock and appends a spurious `Z`. Verified against two live service types on the
 * same Sunday --
 *
 *   Central AM  sort_date 2026-08-23T09:00:00Z   service starts_at 2026-08-22T21:00:00Z
 *   Central PM  sort_date 2026-08-23T18:00:00Z   service starts_at 2026-08-23T06:00:00Z
 *
 * -- both of which are 9am and 6pm Auckland on the 23rd. Putting `sort_date`
 * through a timezone conversion moves the evening service to the 24th, so do not
 * "fix" this by converting it. `PlanTime.starts_at` above IS a real UTC instant and
 * is converted, in pcoTime.ts.
 *
 * The `dates` string is a last resort, and is also already local prose
 * ("August 23, 2026").
 */
export function planDateKey(plan: PcoPlan): string | null {
  const sortDate = plan.attributes.sort_date;
  if (sortDate?.includes('T')) {
    return sortDate.split('T')[0];
  }

  const dates = plan.attributes.dates;
  if (!dates) {
    return null;
  }
  const match = /(\d{1,2})?\s*([A-Za-z]+)\s*(\d{1,2})?,?\s*(\d{4})/.exec(dates);
  if (!match) {
    return null;
  }
  const monthIndex = MONTHS.indexOf(match[2].toLowerCase());
  const day = Number(match[1] ?? match[3]);
  if (monthIndex < 0 || !day) {
    return null;
  }
  return `${match[4]}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

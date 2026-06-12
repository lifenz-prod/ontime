import { OntimeBlock, OntimeEvent, ServiceProfiles, SupportedEvent } from 'ontime-types';
import { MILLIS_PER_HOUR } from 'ontime-utils';

import { regenerateInstances, stripGeneratedEntries } from '../serviceInstanceUtils.js';
import { makeOntimeEvent } from '../__mocks__/rundown.mocks.js';

const makeBlock = (id: string, title = '', extra: Partial<OntimeBlock> = {}): OntimeBlock => ({
  id,
  type: SupportedEvent.Block,
  title,
  ...extra,
});

const dualServiceProfiles: ServiceProfiles = {
  boundaryBlockId: 'boundary',
  services: [
    { id: 'svc-9', name: '9am', offset: 0 },
    { id: 'svc-11', name: '11am', offset: 2 * MILLIS_PER_HOUR },
  ],
};

describe('stripGeneratedEntries()', () => {
  it('removes entries tagged as generated', () => {
    const rundown = [
      makeOntimeEvent({ id: '1' }),
      makeBlock('gen-block', '11am', { generatedFor: 'svc-11' }),
      makeOntimeEvent({ id: 'gen-1', generatedFor: 'svc-11' }),
    ];
    expect(stripGeneratedEntries(rundown)).toMatchObject([{ id: '1' }]);
  });
});

describe('regenerateInstances()', () => {
  const rehearsalEvent = makeOntimeEvent({
    id: 'rehearsal-1',
    timeStart: 5.5 * MILLIS_PER_HOUR,
    timeEnd: 8.75 * MILLIS_PER_HOUR,
    duration: 3.25 * MILLIS_PER_HOUR,
  });
  const masterEventA = makeOntimeEvent({
    id: 'master-a',
    timeStart: 8.75 * MILLIS_PER_HOUR,
    timeEnd: 9 * MILLIS_PER_HOUR,
    duration: 0.25 * MILLIS_PER_HOUR,
    linkStart: null,
  });
  const masterEventB = makeOntimeEvent({
    id: 'master-b',
    timeStart: 9 * MILLIS_PER_HOUR,
    timeEnd: 10 * MILLIS_PER_HOUR,
    duration: MILLIS_PER_HOUR,
    linkStart: 'master-a',
  });

  const baseRundown = [rehearsalEvent, makeBlock('boundary', 'SERVICE'), masterEventA, masterEventB];

  it('generates a section per non-master service, shifted by its offset', () => {
    const result = regenerateInstances(baseRundown, dualServiceProfiles);

    // rehearsal + boundary + 2 master + generated block + 2 generated events
    expect(result).toHaveLength(7);

    const generated = result.filter((entry) => entry.generatedFor === 'svc-11');
    expect(generated).toHaveLength(3);

    const [block, eventA, eventB] = generated;
    expect(block).toMatchObject({ type: SupportedEvent.Block, title: '11am', mirrorOf: 'boundary' });
    expect(eventA).toMatchObject({
      timeStart: 10.75 * MILLIS_PER_HOUR,
      timeEnd: 11 * MILLIS_PER_HOUR,
      mirrorOf: 'master-a',
    });
    expect(eventB).toMatchObject({
      timeStart: 11 * MILLIS_PER_HOUR,
      timeEnd: 12 * MILLIS_PER_HOUR,
      mirrorOf: 'master-b',
    });

    // links are re-pointed within the generated section
    expect((eventB as OntimeEvent).linkStart).toBe(eventA.id);
    // the first generated event is not linked back into the master section
    expect((eventA as OntimeEvent).linkStart).toBeNull();
  });

  it('is idempotent: regenerating replaces previous generated sections', () => {
    const once = regenerateInstances(baseRundown, dualServiceProfiles);
    const twice = regenerateInstances(once, dualServiceProfiles);
    expect(twice).toHaveLength(once.length);
    expect(twice.filter((entry) => entry.generatedFor)).toHaveLength(3);
  });

  it('master edits flow into the regenerated section', () => {
    const once = regenerateInstances(baseRundown, dualServiceProfiles);
    const edited = once.map((entry) =>
      entry.id === 'master-b'
        ? { ...entry, duration: 2 * MILLIS_PER_HOUR, timeEnd: 11 * MILLIS_PER_HOUR }
        : entry,
    );
    const result = regenerateInstances(edited, dualServiceProfiles);
    const generatedB = result.find((entry) => entry.mirrorOf === 'master-b') as OntimeEvent;
    expect(generatedB.timeEnd).toBe(13 * MILLIS_PER_HOUR);
    expect(generatedB.duration).toBe(2 * MILLIS_PER_HOUR);
  });

  it('returns only the stripped rundown when there is no boundary', () => {
    const result = regenerateInstances(baseRundown, { boundaryBlockId: null, services: dualServiceProfiles.services });
    expect(result.filter((entry) => entry.generatedFor)).toHaveLength(0);
  });

  it('returns only the stripped rundown for a single service', () => {
    const result = regenerateInstances(baseRundown, {
      boundaryBlockId: 'boundary',
      services: [{ id: 'svc-6', name: '6pm', offset: 0 }],
    });
    expect(result.filter((entry) => entry.generatedFor)).toHaveLength(0);
    expect(result).toHaveLength(baseRundown.length);
  });

  it('wraps generated times over midnight', () => {
    const profiles: ServiceProfiles = {
      boundaryBlockId: 'boundary',
      services: [
        { id: 'svc-a', name: 'evening', offset: 0 },
        { id: 'svc-b', name: 'late', offset: 16 * MILLIS_PER_HOUR },
      ],
    };
    const result = regenerateInstances(baseRundown, profiles);
    const generatedB = result.find((entry) => entry.mirrorOf === 'master-b') as OntimeEvent;
    // 9am + 16h = 1am next day
    expect(generatedB.timeStart).toBe(1 * MILLIS_PER_HOUR);
  });
});

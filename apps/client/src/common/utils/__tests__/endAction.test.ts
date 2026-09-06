import { EndAction } from 'ontime-types';
import { describe, expect, it } from 'vitest';

import { endActionLabels, endActionOptions } from '../endAction';

/**
 * These labels are rendered by the event editor, its iPad and mobile twins, the
 * Interface panel's default and the Planning Center import page. They used to be
 * stated inline in each of them and had drifted into three vocabularies for the
 * same five actions, so this is the one place that says what they are called.
 */
describe('endActionLabels', () => {
  it('names every action the way the rundown editor names it', () => {
    expect(endActionLabels).toEqual({
      [EndAction.None]: 'None',
      [EndAction.Stop]: 'Stop rundown',
      [EndAction.LoadNext]: 'Load next event',
      [EndAction.PlayNext]: 'Play next event',
      [EndAction.PlayNextDelayed]: 'Play next after delay',
    });
  });

  it('covers every end action, so no surface can offer a partial list', () => {
    expect(Object.keys(endActionLabels).sort()).toEqual(Object.values(EndAction).sort());
  });

  it('offers them from doing nothing at the end of an event to doing the most', () => {
    expect(endActionOptions.map(([action]) => action)).toEqual([
      EndAction.None,
      EndAction.Stop,
      EndAction.LoadNext,
      EndAction.PlayNext,
      EndAction.PlayNextDelayed,
    ]);
  });
});

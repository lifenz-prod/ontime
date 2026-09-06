import { EndAction } from 'ontime-types';

/**
 * What each end action is called, everywhere it is offered.
 *
 * There are four places that offer this list -- the event editor and its iPad and
 * mobile twins, the Interface panel's default, and the Planning Center import page
 * -- and they had drifted into three different vocabularies for the same five
 * actions. The same setting under two names is a way to make somebody doubt they
 * set it, so the labels live here and nothing states them inline.
 *
 * Order is the order they are offered in: from doing nothing at the end of an
 * event to doing the most.
 */
export const endActionLabels: Record<EndAction, string> = {
  [EndAction.None]: 'None',
  [EndAction.Stop]: 'Stop rundown',
  [EndAction.LoadNext]: 'Load next event',
  [EndAction.PlayNext]: 'Play next event',
  [EndAction.PlayNextDelayed]: 'Play next after delay',
};

/** the actions in the order they are offered, for rendering a list of options */
export const endActionOptions = Object.entries(endActionLabels) as [EndAction, string][];

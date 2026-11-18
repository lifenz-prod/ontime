import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { OptionTitle } from '../../../common/components/view-params-editor/constants';
import { ViewOption } from '../../../common/components/view-params-editor/types';
import { isStringBoolean } from '../../../features/viewers/common/viewUtils';

export const scheduleOptions: ViewOption = {
  title: OptionTitle.Schedule,
  collapsible: true,
  options: [
    {
      id: 'stopCycle',
      title: 'Stop cycling through event pages',
      description: 'Schedule will not auto-cycle through events',
      type: 'boolean',
      defaultValue: false,
    },
    {
      id: 'cycleInterval',
      title: 'Cycle interval',
      description: 'How long (in seconds) should each schedule page be shown.',
      type: 'number',
      defaultValue: 10,
    },
    {
      id: 'showProjected',
      title: 'Show projected time',
      description: 'Whether scheduled times should account for runtime offset.',
      type: 'boolean',
      defaultValue: false,
    },
  ],
};

type ScheduleOptions = {
  cycleInterval: number;
  stopCycle: boolean;
  showProjected: boolean;
};

/** Backstage shows the schedule without cycling unless the view settings say otherwise */
export const BACKSTAGE_STOP_CYCLE_DEFAULT = true;

/** Reads a boolean param, falling back to the default when the param is absent */
function getBooleanParam(searchParams: URLSearchParams, id: string, defaultValue: boolean): boolean {
  const value = searchParams.get(id);
  return value === null ? defaultValue : isStringBoolean(value);
}

export function getScheduleOptionsFromParams(
  searchParams: URLSearchParams,
  stopCycleDefault = false,
): ScheduleOptions {
  return {
    cycleInterval: Number(searchParams.get('cycleInterval')) || 10,
    stopCycle: getBooleanParam(searchParams, 'stopCycle', stopCycleDefault),
    showProjected: isStringBoolean(searchParams.get('showProjected')),
  };
}

/**
 * Hook exposes the schedule component options
 * @param stopCycleDefault - used when the URL has no stopCycle param (Backstage defaults to not cycling)
 */
export function useScheduleOptions(stopCycleDefault = false) {
  const [searchParams] = useSearchParams();
  const options = useMemo(
    () => getScheduleOptionsFromParams(searchParams, stopCycleDefault),
    [searchParams, stopCycleDefault],
  );
  return options;
}

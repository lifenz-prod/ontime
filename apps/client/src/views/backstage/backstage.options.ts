import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CustomFields, OntimeEvent } from 'ontime-types';

import {
  getTimeOption,
  makeOptionsFromCustomFields,
  OptionTitle,
} from '../../common/components/view-params-editor/constants';
import { ViewOption } from '../../common/components/view-params-editor/types';
import { BACKSTAGE_STOP_CYCLE_DEFAULT, scheduleOptions } from '../common/schedule/schedule.options';

/** Backstage shows event notes unless the view settings pick another source */
export const BACKSTAGE_SECONDARY_DEFAULT = 'note';

export const getBackstageOptions = (timeFormat: string, customFields: CustomFields): ViewOption[] => {
  const secondaryOptions = makeOptionsFromCustomFields(customFields, { note: 'Note', none: 'None' });

  return [
    { title: OptionTitle.ClockOptions, collapsible: true, options: [getTimeOption(timeFormat)] },
    {
      title: OptionTitle.DataSources,
      collapsible: true,
      options: [
        {
          id: 'secondary-src',
          title: 'Event secondary text',
          description: 'Select the data source for auxiliary text shown in now and next cards',
          type: 'option',
          values: secondaryOptions,
          defaultValue: BACKSTAGE_SECONDARY_DEFAULT,
        },
      ],
    },
    {
      ...scheduleOptions,
      options: scheduleOptions.options.map((opt) =>
        opt.id === 'stopCycle' ? { ...opt, defaultValue: BACKSTAGE_STOP_CYCLE_DEFAULT } : opt,
      ) as typeof scheduleOptions.options,
    },
  ];
};

type BackstageOptions = {
  secondarySource: keyof OntimeEvent | null;
};

/**
 * Utility extract the view options from URL Params
 * the names and fallback are manually matched with timerOptions
 */
function getOptionsFromParams(searchParams: URLSearchParams): BackstageOptions {
  // we manually make an object that matches the key above
  return {
    // an absent param means the default the settings drawer shows, not "no source"
    secondarySource: (searchParams.get('secondary-src') ?? BACKSTAGE_SECONDARY_DEFAULT) as keyof OntimeEvent,
  };
}

/**
 * Hook exposes the backstage view options
 */
export function useBackstageOptions(): BackstageOptions {
  const [searchParams] = useSearchParams();
  const options = useMemo(() => getOptionsFromParams(searchParams), [searchParams]);
  return options;
}

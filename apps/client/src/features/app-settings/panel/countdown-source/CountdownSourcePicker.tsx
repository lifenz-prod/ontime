import { useState } from 'react';
import { Select } from '@chakra-ui/react';
import type { CountdownSource } from 'ontime-types';

import { maybeAxiosError } from '../../../../common/api/utils';
import { postViewSettings } from '../../../../common/api/viewSettings';
import useViewSettings from '../../../../common/hooks-query/useViewSettings';
import { countdownSourceLabels } from '../../../../common/utils/countdownSource';
import * as Panel from '../../panel-utils/PanelUtils';

/**
 * Picks which integration feeds the countdown views.
 * Shown in both the QLab and the Mitti panel: whichever one you are in, you can see
 * and change which of the two is actually on screen.
 */
export default function CountdownSourcePicker() {
  const { data, status, refetch } = useViewSettings();
  const [error, setError] = useState<string | undefined>(undefined);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = async (source: CountdownSource) => {
    if (source === data.countdownSource) {
      return;
    }

    setIsSaving(true);
    try {
      await postViewSettings({ ...data, countdownSource: source });
      setError(undefined);
    } catch (saveError) {
      setError(maybeAxiosError(saveError));
    } finally {
      setIsSaving(false);
      await refetch();
    }
  };

  return (
    <>
      <Panel.Title>Countdown source</Panel.Title>
      <Panel.ListGroup>
        <Panel.ListItem>
          <Panel.Field
            title='Show countdown from'
            description='Which playback system the countdown views follow'
            error={error}
          />
          <Select
            variant='ontime'
            size='sm'
            width='10rem'
            value={data.countdownSource}
            isDisabled={isSaving || status === 'pending'}
            onChange={(event) => handleChange(event.target.value as CountdownSource)}
          >
            <option value='qlab'>{countdownSourceLabels.qlab}</option>
            <option value='mitti'>{countdownSourceLabels.mitti}</option>
          </Select>
        </Panel.ListItem>
      </Panel.ListGroup>
    </>
  );
}

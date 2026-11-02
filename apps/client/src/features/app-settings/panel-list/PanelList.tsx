import { Fragment } from 'react';
import { Tooltip } from '@chakra-ui/react';

import { isKeyEnter } from '../../../common/utils/keyEvent';
import { cx } from '../../../common/utils/styleUtils';
import { tooltipDelayFast } from '../../../ontimeConfig';
import { SettingsOption, SettingsOptionId, useAppSettingsMenu } from '../useAppSettingsMenu';
import useAppSettingsNavigation from '../useAppSettingsNavigation';

import style from './PanelList.module.scss';

export interface PanelBaseProps {
  location?: string;
}

interface PanelListProps extends PanelBaseProps {
  selectedPanel: string;
}

export default function PanelList({ selectedPanel }: PanelListProps) {
  const { options } = useAppSettingsMenu();

  return (
    <ul className={style.tabs}>
      {options.map((panel) => {
        const isSelected = selectedPanel === panel.id;
        if (panel.highlight) {
          return (
            <Tooltip key={panel.id} label={panel.highlight} openDelay={tooltipDelayFast} shouldWrapChildren>
              <PanelListItem panel={panel} isSelected={isSelected} />
            </Tooltip>
          );
        }
        return <PanelListItem key={panel.id} panel={panel} isSelected={isSelected} />;
      })}
    </ul>
  );
}

interface PanelListItemProps {
  panel: SettingsOption;
  isSelected: boolean;
}

function PanelListItem(props: PanelListItemProps) {
  const { panel, isSelected } = props;
  const { setLocation } = useAppSettingsNavigation();

  const classes = cx([
    style.primary,
    isSelected && style.active,
    panel.split && style.split,
    panel.highlight && style.highlight,
  ]);

  return (
    <Fragment key={panel.id}>
      <li
        key={panel.id}
        onClick={() => setLocation(panel.id as SettingsOptionId)}
        onKeyDown={(event) => {
          isKeyEnter(event) && setLocation(panel.id as SettingsOptionId);
        }}
        className={classes}
        tabIndex={0}
        role='button'
      >
        {panel.label}
      </li>
    </Fragment>
  );
}

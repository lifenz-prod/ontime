import { useEffect, useState } from 'react';
import { Switch } from '@chakra-ui/react';

import { useElectronEvent } from '../../../../common/hooks/useElectronEvent';
import * as Panel from '../../panel-utils/PanelUtils';

export default function AutoLaunchSettings() {
  const { isElectron, sendToElectron } = useElectronEvent();
  const [autoLaunch, setAutoLaunch] = useState(false);

  // read the current value from the OS login-item registry on mount
  useEffect(() => {
    if (!isElectron) {
      return;
    }

    const ipcRenderer = window.require('electron').ipcRenderer;
    ipcRenderer
      .invoke('get-auto-launch')
      .then((enabled: boolean) => setAutoLaunch(Boolean(enabled)))
      .catch(() => setAutoLaunch(false));
  }, [isElectron]);

  // auto launch is an OS-level setting only available in the desktop app
  if (!isElectron) {
    return null;
  }

  const handleToggle = (enabled: boolean) => {
    setAutoLaunch(enabled);
    sendToElectron('set-auto-launch', enabled);
  };

  return (
    <Panel.Card>
      <Panel.SubHeader>Application</Panel.SubHeader>
      <Panel.Divider />
      <Panel.Section>
        <Panel.ListGroup>
          <Panel.ListItem>
            <Panel.Field
              title='Launch on boot'
              description='Automatically start Ontime when this computer starts up.'
            />
            <Switch
              variant='ontime'
              size='lg'
              isChecked={autoLaunch}
              onChange={(event) => handleToggle(event.target.checked)}
            />
          </Panel.ListItem>
        </Panel.ListGroup>
      </Panel.Section>
    </Panel.Card>
  );
}

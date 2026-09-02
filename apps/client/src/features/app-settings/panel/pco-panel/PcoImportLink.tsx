import { IoOpenOutline } from 'react-icons/io5';
import { Link } from 'react-router-dom';
import { Button } from '@chakra-ui/react';

import * as Panel from '../../panel-utils/PanelUtils';

/**
 * The way out to the import page.
 *
 * Choosing a plan used to happen here, which put an operator's task -- done against
 * a run sheet, item by item, minutes before a service -- inside a settings dialog
 * sized for preferences. Settings keeps what is genuinely configuration: the
 * connection, the credentials, the pins and the defaults.
 */
export default function PcoImportLink() {
  return (
    <Panel.Card>
      <Panel.SubHeader>
        Import a plan
        <Panel.InlineElements>
          <Button as={Link} to='/pco-import' variant='ontime-filled' size='sm' rightIcon={<IoOpenOutline />}>
            Open the import page
          </Button>
        </Panel.InlineElements>
      </Panel.SubHeader>
      <Panel.Divider />
      <Panel.Section>
        <Panel.Paragraph>
          Pick one of the upcoming plans, go through its run sheet deciding what each item becomes, and import it. What
          you choose there is remembered against that service type, so the next plan opens with the same choices already
          made.
        </Panel.Paragraph>
      </Panel.Section>
    </Panel.Card>
  );
}

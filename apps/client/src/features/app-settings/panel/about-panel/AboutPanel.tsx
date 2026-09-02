import ExternalLink from '../../../../common/components/link/external-link/ExternalLink';
import { documentationUrl, githubUrl } from '../../../../externals';
import * as Panel from '../../panel-utils/PanelUtils';

import AppVersion from './AppVersion';

export default function AboutPanel() {
  return (
    <>
      <Panel.Header>About Ontime</Panel.Header>
      <Panel.Section>
        <Panel.SubHeader>Current version</Panel.SubHeader>
        <AppVersion />
        <Panel.SubHeader>Links</Panel.SubHeader>
        <ExternalLink href={documentationUrl}>Read the docs</ExternalLink>
        <ExternalLink href={githubUrl}>Follow the project on GitHub</ExternalLink>
      </Panel.Section>
    </>
  );
}

import { DatabaseModel, MittiSettings } from 'ontime-types';

import { dbModel } from '../../models/dataModel.js';

export function parseMittiSettings(data: Partial<DatabaseModel>): MittiSettings {
  if (!data.mitti) {
    return { ...dbModel.mitti };
  }

  return {
    enabled: typeof data.mitti.enabled === 'boolean' ? data.mitti.enabled : dbModel.mitti.enabled,
    host: typeof data.mitti.host === 'string' ? data.mitti.host : dbModel.mitti.host,
    port: typeof data.mitti.port === 'number' ? data.mitti.port : dbModel.mitti.port,
    listenPort: typeof data.mitti.listenPort === 'number' ? data.mitti.listenPort : dbModel.mitti.listenPort,
    warningThreshold:
      typeof data.mitti.warningThreshold === 'number' ? data.mitti.warningThreshold : dbModel.mitti.warningThreshold,
    dangerThreshold:
      typeof data.mitti.dangerThreshold === 'number' ? data.mitti.dangerThreshold : dbModel.mitti.dangerThreshold,
    timeout: typeof data.mitti.timeout === 'number' ? data.mitti.timeout : dbModel.mitti.timeout,
    relayHost: typeof data.mitti.relayHost === 'string' && data.mitti.relayHost !== '' ? data.mitti.relayHost : null,
    relayPort: typeof data.mitti.relayPort === 'number' ? data.mitti.relayPort : null,
  };
}

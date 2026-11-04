import { DatabaseModel, MittiRelay, MittiSettings } from 'ontime-types';

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
    relays: parseMittiRelays(data.mitti),
  };
}

function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * Reads the relay list, keeping only entries with a host and a usable port.
 * Projects saved before relays became a list carry a single relayHost / relayPort pair: we carry it over.
 */
export function parseMittiRelays(mitti: unknown): MittiRelay[] {
  if (!mitti || typeof mitti !== 'object') {
    return [];
  }
  const source = mitti as { relays?: unknown; relayHost?: unknown; relayPort?: unknown };

  if (Array.isArray(source.relays)) {
    const seen = new Set<string>();
    return source.relays.flatMap((relay) => {
      if (!relay || typeof relay !== 'object') return [];
      const { host, port } = relay as { host?: unknown; port?: unknown };
      if (typeof host !== 'string' || host.trim() === '' || !isValidPort(port)) return [];
      // the same destination twice would get every packet twice
      const key = `${host.trim()}:${port}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ host: host.trim(), port }];
    });
  }

  if (typeof source.relayHost === 'string' && source.relayHost.trim() !== '' && isValidPort(source.relayPort)) {
    return [{ host: source.relayHost.trim(), port: source.relayPort }];
  }

  return [];
}

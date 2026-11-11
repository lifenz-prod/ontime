import type {
  AbletonSettings,
  AutomationSettings,
  CustomFields,
  MittiSettings,
  OntimeRundown,
  ProjectData,
  QlabSettings,
  ServiceProfiles,
  Settings,
  TimecodeSettings,
  URLPreset,
  ViewSettings,
} from '../index.js';

export type DatabaseModel = {
  rundown: OntimeRundown;
  project: ProjectData;
  settings: Settings;
  viewSettings: ViewSettings;
  urlPresets: URLPreset[];
  customFields: CustomFields;
  automation: AutomationSettings;
  qlab: QlabSettings;
  mitti: MittiSettings;
  ableton: AbletonSettings;
  timecode: TimecodeSettings;
  serviceProfiles: ServiceProfiles;
};

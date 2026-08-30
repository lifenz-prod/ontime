import type { TimeFormat } from './TimeFormat.type.js';

export type Settings = {
  app: 'ontime';
  version: string;
  serverPort: number;
  editorKey: null | string;
  operatorKey: null | string;
  timeFormat: TimeFormat;
  language: string;
  /** seconds an event overruns before the "play next after delay" end action advances */
  endActionDelay: number;
};

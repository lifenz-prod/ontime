export type ServiceProfile = {
  id: string;
  name: string;
  /** Start time in milliseconds since midnight (e.g. 9 * 3600000 for 9:00 AM) */
  startTime: number;
};

export type ServiceProfiles = ServiceProfile[];

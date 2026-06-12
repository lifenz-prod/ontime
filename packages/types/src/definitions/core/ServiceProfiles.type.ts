export type ServiceProfile = {
  id: string;
  name: string;
  /** Milliseconds added to the master section's times for this instance; the authored master is 0 */
  offset: number;
};

export type ServiceProfiles = {
  /** Block that begins the master service section; entries before it are rehearsal */
  boundaryBlockId: string | null;
  /** Ordered service instances; the first (offset 0) is the authored master, the rest are generated */
  services: ServiceProfile[];
};

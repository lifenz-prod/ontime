// views no longer offered in the menu (minimal, clock, timeline, public, lower, studio, countdown, info)
// still have routes, pending removal
export const navigatorConstants = [
  { url: 'quick-start', label: 'Quick Start' },
  { url: 'timer', label: 'Timer' },
  { url: 'backstage', label: 'Backstage' },
  { url: 'cuescreen', label: 'Cuescreen' },
  { url: 'cuescreennow', label: 'Cuescreen NOW/NEXT' },
  { url: 'mobilecuescreen', label: 'Mobile Cue Screen' },
  { url: 'qlabcountdown', label: 'Video Countdown' },
];

// default time format to use for users in 12 hour clocks
export const FORMAT_12 = 'h:mm:ss a';
// default time format to use for users in 24 hour clocks
export const FORMAT_24 = 'HH:mm:ss';

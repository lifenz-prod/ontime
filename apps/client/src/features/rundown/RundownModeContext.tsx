import { createContext, useContext } from 'react';

interface RundownModeContextType {
  hideRowActions: boolean;
  hideEndTime: boolean;
  playbackOnly: boolean;
  /** only offer + Event when adding between rows, delays and blocks confuse volunteers */
  eventOnlyQuickAdd?: boolean;
}

const RundownModeContext = createContext<RundownModeContextType>({
  hideRowActions: false,
  hideEndTime: false,
  playbackOnly: false,
});

export const useRundownMode = () => useContext(RundownModeContext);
export default RundownModeContext;

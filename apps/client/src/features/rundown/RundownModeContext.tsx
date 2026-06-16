import { createContext, useContext } from 'react';

interface RundownModeContextType {
  hideRowActions: boolean;
  hideEndTime: boolean;
  playbackOnly: boolean;
}

const RundownModeContext = createContext<RundownModeContextType>({ hideRowActions: false, hideEndTime: false, playbackOnly: false });

export const useRundownMode = () => useContext(RundownModeContext);
export default RundownModeContext;

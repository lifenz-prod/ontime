import { createContext, useContext } from 'react';

interface RundownModeContextType {
  hideRowActions: boolean;
  hideEndTime: boolean;
}

const RundownModeContext = createContext<RundownModeContextType>({ hideRowActions: false, hideEndTime: false });

export const useRundownMode = () => useContext(RundownModeContext);
export default RundownModeContext;

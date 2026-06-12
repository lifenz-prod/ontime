import { create } from 'zustand';

import useRundown from '../hooks-query/useRundown';
import useServiceProfiles from '../hooks-query/useServiceProfiles';

/** synthesized tab showing the rehearsal entries before the boundary block */
export const PRE_TAB_ID = 'pre-service';

type ServiceSwitcherStore = {
  activeTabId: string | null;
  setActiveTab: (id: string | null) => void;
};

const useServiceSwitcherStore = create<ServiceSwitcherStore>((set) => ({
  activeTabId: null,
  setActiveTab: (activeTabId) => set({ activeTabId }),
}));

export type ServiceTab = {
  id: string;
  name: string;
};

/**
 * Exposes the service tabs (PRE + one per service instance) and a
 * filtered view of the rundown order for the selected tab.
 * Selecting a tab only changes what is visible, it does not change any times.
 */
export default function useServiceSwitcher() {
  const { data: serviceProfiles } = useServiceProfiles();
  const { data } = useRundown();
  const activeTabId = useServiceSwitcherStore((state) => state.activeTabId);
  const setActiveTab = useServiceSwitcherStore((state) => state.setActiveTab);

  const { boundaryBlockId, services } = serviceProfiles;
  const order = data?.order ?? [];
  const rundown = data?.rundown ?? {};
  const boundaryIndex = boundaryBlockId ? order.indexOf(boundaryBlockId) : -1;

  const isConfigured = boundaryIndex >= 0 && services.length > 0;

  const tabs: ServiceTab[] = [];
  if (isConfigured) {
    if (boundaryIndex > 0) {
      tabs.push({ id: PRE_TAB_ID, name: 'PRE' });
    }
    for (const service of services) {
      tabs.push({ id: service.id, name: service.name });
    }
  }

  /** selecting the active tab again clears the filter */
  const selectTab = (id: string) => setActiveTab(activeTabId === id ? null : id);

  const getVisibleOrder = (): string[] => {
    if (!isConfigured || activeTabId === null) {
      return order;
    }
    if (activeTabId === PRE_TAB_ID) {
      return order.slice(0, boundaryIndex);
    }
    const masterServiceId = services[0]?.id;
    if (activeTabId === masterServiceId) {
      // the master section spans from the boundary block to the first generated entry
      const sectionOrder: string[] = [];
      for (let i = boundaryIndex; i < order.length; i++) {
        const entry = rundown[order[i]];
        if (entry?.generatedFor) break;
        sectionOrder.push(order[i]);
      }
      return sectionOrder;
    }
    return order.filter((id) => rundown[id]?.generatedFor === activeTabId);
  };

  return {
    tabs,
    activeTabId,
    selectTab,
    isConfigured,
    visibleOrder: getVisibleOrder(),
  };
}

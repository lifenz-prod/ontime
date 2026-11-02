import { create } from 'zustand';

type DeviationConfirmStore = {
  /** settles the confirmation currently on screen */
  resolve: ((confirmed: boolean) => void) | null;
  /** asks the user whether to edit a generated section, resolves to their answer */
  request: () => Promise<boolean>;
};

export const useDeviationConfirm = create<DeviationConfirmStore>((set, get) => ({
  resolve: null,
  request: () => {
    // only one question at a time: a second edit while asking is dropped
    if (get().resolve) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      set({
        resolve: (confirmed) => {
          set({ resolve: null });
          resolve(confirmed);
        },
      });
    });
  },
}));

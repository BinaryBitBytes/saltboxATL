"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type ReceivingSessionState = {
  orderId: string | null;
  palletId: string | null;
  setWorking: (orderId: string, palletId: string | null) => void;
  clear: () => void;
};

export const useReceivingSession = create<ReceivingSessionState>()(
  persist(
    (set) => ({
      orderId: null,
      palletId: null,
      setWorking: (orderId, palletId) => set({ orderId, palletId }),
      clear: () => set({ orderId: null, palletId: null }),
    }),
    { name: "saltbox-receiving-session" },
  ),
);

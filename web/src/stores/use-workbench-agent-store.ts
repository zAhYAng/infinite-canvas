import { create } from "zustand";
import { nanoid } from "nanoid";

type WorkbenchAgentAction = { id: string; prompt: string; run: boolean };

type WorkbenchAgentStore = {
    imageAction: WorkbenchAgentAction | null;
    videoAction: WorkbenchAgentAction | null;
    dispatchImage: (action: Omit<WorkbenchAgentAction, "id">) => void;
    dispatchVideo: (action: Omit<WorkbenchAgentAction, "id">) => void;
    clearImage: (id: string) => void;
    clearVideo: (id: string) => void;
};

export const useWorkbenchAgentStore = create<WorkbenchAgentStore>((set) => ({
    imageAction: null,
    videoAction: null,
    dispatchImage: (action) => set({ imageAction: { id: nanoid(), ...action } }),
    dispatchVideo: (action) => set({ videoAction: { id: nanoid(), ...action } }),
    clearImage: (id) => set((state) => (state.imageAction?.id === id ? { imageAction: null } : state)),
    clearVideo: (id) => set((state) => (state.videoAction?.id === id ? { videoAction: null } : state)),
}));

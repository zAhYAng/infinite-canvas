import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "../utils/canvas-agent-ops";

export type AgentCanvasBridge = {
    snapshot: CanvasAgentSnapshot;
    applyOps: (ops: CanvasAgentOp[]) => CanvasAgentSnapshot;
    undoOps: () => CanvasAgentSnapshot | null;
};

type AgentCanvasBridgeStore = {
    bridge: AgentCanvasBridge | null;
    setBridge: (bridge: AgentCanvasBridge | null) => void;
};

export const useAgentCanvasBridgeStore = create<AgentCanvasBridgeStore>((set) => ({
    bridge: null,
    setBridge: (bridge) => set({ bridge }),
}));

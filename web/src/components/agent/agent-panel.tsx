"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { Bot, PanelRightClose } from "lucide-react";
import { Button, Segmented, Tooltip } from "antd";
import { motion } from "motion/react";

import { CanvasLocalAgentPanel } from "@/app/(user)/canvas/components/canvas-local-agent-panel";
import { useCanvasAgentStore } from "@/app/(user)/canvas/stores/use-canvas-agent-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

export function AgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { width, panelOpen, confirmTools, setAgentState } = useCanvasAgentStore();
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX));
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    return (
        <motion.aside
            className="relative z-[70] flex h-full shrink-0 flex-col border-l"
            initial={false}
            animate={{ width: panelOpen ? width : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelOpen ? "auto" : "none", background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
        >
            <div style={{ width: Math.max(0, width - 1) }} className="flex h-full flex-col">
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整 Agent 面板宽度" />
                <header className="flex h-14 shrink-0 items-center justify-between border-b px-4" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex min-w-0 items-center gap-2">
                        <Bot className="size-4" />
                        <div className="min-w-0">
                            <div className="text-sm font-semibold">Agent</div>
                            <div className="text-xs" style={{ color: theme.node.muted }}>全站助手</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <Tooltip title="工具确认：风险会确认生成和写入素材，全部确认所有写操作">
                            <Segmented size="small" value={confirmTools} onChange={(value) => setAgentState({ confirmTools: value as typeof confirmTools })} options={[{ label: "关", value: "off" }, { label: "风险", value: "risky" }, { label: "全部", value: "all" }]} />
                        </Tooltip>
                        <Tooltip title="收起 Agent">
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" icon={<PanelRightClose className="size-4" />} onClick={() => setAgentState({ panelOpen: false })} />
                        </Tooltip>
                    </div>
                </header>
                <CanvasLocalAgentPanel embedded />
            </div>
        </motion.aside>
    );
}

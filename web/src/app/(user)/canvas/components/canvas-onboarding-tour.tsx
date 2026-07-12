"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Compass, Cpu, Sparkles, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { onboardingCardPosition } from "../utils/canvas-onboarding-layout";

const ONBOARDING_STORAGE_KEY = "infinite-canvas:canvas-onboarding:v1";

const steps = [
    {
        id: "navigation",
        selector: '[data-onboarding="canvas-navigation"]',
        icon: Compass,
        eyebrow: "画布导航",
        title: "先认识你的工作区",
        description: "顶部用于切换项目、管理素材、撤销操作和随时回到工作台。画布上的节点和连线就是你的生成流程。",
    },
    {
        id: "agent",
        selector: '[data-onboarding="canvas-agent-composer"]',
        icon: Bot,
        eyebrow: "让 Agent 开始",
        title: "直接说出你想做什么",
        description: "描述目标、风格和已有素材。Agent 会把需求整理成节点、提示词和可确认的工作流，再由你决定何时生成。",
    },
    {
        id: "model",
        selector: '[data-onboarding="canvas-agent-model"]',
        icon: Cpu,
        eyebrow: "选择模型",
        title: "为 Agent 选一个文本模型",
        description: "Agent 使用这里的文本模型规划画布；图片和视频节点会分别遵循它们已配置的模型能力和限制。",
    },
] as const;

type HighlightRect = { top: number; left: number; width: number; height: number };

export function CanvasOnboardingTour({ onOpenAgent }: { onOpenAgent: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reduceMotion = useReducedMotion();
    const [open, setOpen] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const [targetRect, setTargetRect] = useState<HighlightRect | null>(null);
    const cardRef = useRef<HTMLElement>(null);
    const [cardSize, setCardSize] = useState({ width: 420, height: 260 });
    const step = steps[stepIndex];

    const finish = () => {
        localStorage.setItem(ONBOARDING_STORAGE_KEY, "completed");
        setOpen(false);
    };

    useEffect(() => {
        if (localStorage.getItem(ONBOARDING_STORAGE_KEY)) return;
        const timer = window.setTimeout(() => setOpen(true), 420);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (!open || step.id === "navigation") return;
        onOpenAgent();
    }, [onOpenAgent, open, step.id]);

    useLayoutEffect(() => {
        if (!open) return;
        let frame = 0;
        let retryTimer = 0;
        const updateTarget = () => {
            const target = document.querySelector<HTMLElement>(step.selector);
            if (!target) {
                setTargetRect(null);
                return;
            }
            const rect = target.getBoundingClientRect();
            setTargetRect({ top: rect.top - 8, left: rect.left - 8, width: rect.width + 16, height: rect.height + 16 });
        };
        const scheduleUpdate = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(updateTarget);
        };
        scheduleUpdate();
        retryTimer = window.setTimeout(scheduleUpdate, 560);
        window.addEventListener("resize", scheduleUpdate);
        window.addEventListener("scroll", scheduleUpdate, true);
        return () => {
            window.cancelAnimationFrame(frame);
            window.clearTimeout(retryTimer);
            window.removeEventListener("resize", scheduleUpdate);
            window.removeEventListener("scroll", scheduleUpdate, true);
        };
    }, [open, step.selector]);

    useLayoutEffect(() => {
        if (!open || !cardRef.current) return;
        const card = cardRef.current;
        const measure = () => setCardSize({ width: card.offsetWidth, height: card.offsetHeight });
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(card);
        return () => observer.disconnect();
    }, [open, step.id]);

    useEffect(() => {
        if (!open) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") finish();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [open]);

    if (!open) return null;

    const Icon = step.icon;
    const isLastStep = stepIndex === steps.length - 1;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const cardPosition = onboardingCardPosition(step.id, targetRect, cardSize, viewport);

    return (
        <div className="fixed inset-0 z-[300]" aria-live="polite">
            {targetRect ? (
                <motion.div
                    className="pointer-events-none fixed rounded-xl border-2"
                    initial={false}
                    animate={targetRect}
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 34 }}
                    style={{ borderColor: "#55b8a5", boxShadow: "0 0 0 9999px rgba(16, 24, 32, .62), 0 0 0 5px rgba(85, 184, 165, .16)" }}
                />
            ) : (
                <div className="fixed inset-0 bg-black/60" />
            )}

            <motion.section
                ref={cardRef}
                className="fixed z-10 max-h-[calc(100dvh-32px)] w-[min(420px,calc(100vw-32px))] overflow-y-auto rounded-lg border p-5 shadow-2xl"
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
                style={{ ...cardPosition, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg" style={{ background: "rgba(85, 184, 165, .14)", color: "#2d8e7d" }}>
                        {step.id === "agent" ? <Sparkles className="size-5" /> : <Icon className="size-5" />}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium" style={{ color: theme.node.muted }}>{step.eyebrow} · {stepIndex + 1}/{steps.length}</div>
                        <h2 className="mt-1 text-base font-semibold leading-6">{step.title}</h2>
                        <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{step.description}</p>
                    </div>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.muted }} onClick={finish} aria-label="跳过画布引导" title="跳过引导">
                        <X className="size-4" />
                    </button>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                    <button type="button" className="text-sm transition hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-35" style={{ color: theme.node.muted }} disabled={stepIndex === 0} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>
                        <ChevronLeft className="mr-1 inline size-4" />上一步
                    </button>
                    <button type="button" className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-white transition hover:opacity-90" style={{ background: "#2d8e7d" }} onClick={() => (isLastStep ? finish() : setStepIndex((current) => current + 1))}>
                        {isLastStep ? "开始创作" : step.id === "navigation" ? "打开 Agent" : "下一步"}
                        {!isLastStep ? <ChevronRight className="size-4" /> : null}
                    </button>
                </div>
            </motion.section>
        </div>
    );
}

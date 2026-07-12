"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Compass, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { navigationTools } from "@/constant/navigation-tools";
import { useThemeStore } from "@/stores/use-theme-store";
import { canvasThemes } from "@/lib/canvas-theme";

const STORAGE_KEY = "infinite-canvas:home-navigation-tour:v1";
const CARD_WIDTH = 360;
const SAFE_MARGIN = 16;

const descriptions: Record<(typeof navigationTools)[number]["slug"], string> = {
    canvas: "新建、整理和运行你的创作工作流；需要时可在画布里直接让 Agent 生成节点与分镜。",
    image: "生成图片、参考图编辑和批量出图都在这里完成。",
    video: "用已配置的视频模型生成任务，并在提交前检查时长、分辨率和参考素材限制。",
    prompts: "沉淀可复用的提示词、风格和成功案例，下一次创作可以直接调用。",
    assets: "统一管理图片、视频、音频和文本素材，供工作台与画布引用。",
};

type Rect = { top: number; left: number; width: number; height: number };

export function HomeNavigationTour() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reduceMotion = useReducedMotion();
    const [open, setOpen] = useState(false);
    const [stepIndex, setStepIndex] = useState(0);
    const [rect, setRect] = useState<Rect | null>(null);
    const isCompact = typeof window !== "undefined" && window.innerWidth < 768;
    const steps = isCompact ? [{ slug: "menu", label: "顶部菜单", description: "打开左上角菜单，可以进入我的画布、生图工作台、视频创作台、提示词库和我的素材。" }] : navigationTools.map((tool) => ({ ...tool, description: descriptions[tool.slug] }));
    const step = steps[Math.min(stepIndex, steps.length - 1)];
    const selector = step.slug === "menu" ? '[data-home-navigation="menu"]' : `[data-home-navigation="${step.slug}"]`;

    const finish = () => {
        localStorage.setItem(STORAGE_KEY, "completed");
        setOpen(false);
    };

    useEffect(() => {
        if (localStorage.getItem(STORAGE_KEY)) return;
        const timer = window.setTimeout(() => setOpen(true), 360);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        if (stepIndex < steps.length) return;
        setStepIndex(0);
    }, [stepIndex, steps.length]);

    useLayoutEffect(() => {
        if (!open) return;
        let frame = 0;
        const update = () => {
            const target = document.querySelector<HTMLElement>(selector);
            if (!target) {
                setRect(null);
                return;
            }
            const box = target.getBoundingClientRect();
            setRect({ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 });
        };
        const schedule = () => {
            window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(update);
        };
        schedule();
        window.addEventListener("resize", schedule);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener("resize", schedule);
        };
    }, [open, selector]);

    if (!open) return null;

    const cardLeft = clamp((rect?.left || window.innerWidth / 2) + (rect?.width || 0) / 2 - CARD_WIDTH / 2, SAFE_MARGIN, window.innerWidth - CARD_WIDTH - SAFE_MARGIN);
    const cardTop = clamp((rect?.top || 72) + (rect?.height || 0) + 18, 82, window.innerHeight - 248);
    const isLast = stepIndex === steps.length - 1;

    return (
        <div className="fixed inset-0 z-[300]" aria-live="polite">
            {rect ? (
                <motion.div
                    className="pointer-events-none fixed rounded-lg border-2"
                    initial={false}
                    animate={rect}
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 34 }}
                    style={{ borderColor: "#55b8a5", boxShadow: "0 0 0 9999px rgba(16, 24, 32, .62), 0 0 0 5px rgba(85, 184, 165, .16)" }}
                />
            ) : (
                <div className="fixed inset-0 bg-black/60" />
            )}
            <motion.section
                className="fixed z-10 max-h-[calc(100dvh-32px)] w-[min(360px,calc(100vw-32px))] overflow-y-auto rounded-lg border p-5 shadow-2xl"
                initial={reduceMotion ? false : { opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
                style={{ top: cardTop, left: cardLeft, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-lg" style={{ background: "rgba(85, 184, 165, .14)", color: "#2d8e7d" }}>
                        <Compass className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium" style={{ color: theme.node.muted }}>顶部菜单 · {stepIndex + 1}/{steps.length}</div>
                        <h2 className="mt-1 text-base font-semibold leading-6">{step.label}</h2>
                        <p className="mt-2 text-sm leading-6" style={{ color: theme.node.muted }}>{step.description}</p>
                    </div>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.muted }} onClick={finish} aria-label="跳过菜单引导" title="跳过引导">
                        <X className="size-4" />
                    </button>
                </div>
                <div className="mt-5 flex items-center justify-between gap-3">
                    <button type="button" disabled={stepIndex === 0} className="text-sm transition hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-35" style={{ color: theme.node.muted }} onClick={() => setStepIndex((current) => Math.max(0, current - 1))}>
                        <ChevronLeft className="mr-1 inline size-4" />上一步
                    </button>
                    <button type="button" className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-sm font-medium text-white transition hover:opacity-90" style={{ background: "#2d8e7d" }} onClick={() => (isLast ? finish() : setStepIndex((current) => current + 1))}>
                        {isLast ? "开始创作" : "下一项"}
                        {!isLast ? <ChevronRight className="size-4" /> : null}
                    </button>
                </div>
            </motion.section>
        </div>
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

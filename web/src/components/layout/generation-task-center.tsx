"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CircleAlert, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { Badge, Button, Empty, Popover, Tag, Tooltip } from "antd";
import localforage from "localforage";
import { useRouter } from "next/navigation";

import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { sortVideoTaskSummaries, summarizeCanvasVideoTasks, summarizeWorkbenchVideoTasks, type VideoTaskSummary, type WorkbenchVideoTaskLog } from "@/services/generation-task-center";

const workbenchLogStore = localforage.createInstance({ name: "infinite-canvas", storeName: "video_generation_logs" });

export function GenerationTaskCenter({ triggerClassName }: { triggerClassName?: string }) {
    const router = useRouter();
    const projects = useCanvasStore((state) => state.projects);
    const [open, setOpen] = useState(false);
    const [logs, setLogs] = useState<WorkbenchVideoTaskLog[]>([]);
    const [loading, setLoading] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const values: WorkbenchVideoTaskLog[] = [];
            await workbenchLogStore.iterate((value) => {
                if (value && typeof value === "object") values.push(value as WorkbenchVideoTaskLog);
            });
            setLogs(values);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!open) return;
        void refresh();
        const timer = window.setInterval(() => void refresh(), 5000);
        return () => window.clearInterval(timer);
    }, [open, refresh]);

    const tasks = useMemo(() => sortVideoTaskSummaries([...summarizeCanvasVideoTasks(projects), ...summarizeWorkbenchVideoTasks(logs)]), [logs, projects]);
    const activeCount = tasks.filter((task) => task.status === "running").length;
    const actionableTasks = tasks.filter((task) => task.status !== "completed").slice(0, 8);

    const content = (
        <section className="w-[min(380px,calc(100vw-32px))]">
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <div className="text-sm font-semibold text-stone-950 dark:text-stone-100">视频任务</div>
                    <div className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">画布和视频创作台的进行中任务</div>
                </div>
                <Tooltip title="刷新任务">
                    <Button type="text" shape="circle" size="small" icon={<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />} onClick={() => void refresh()} aria-label="刷新视频任务" />
                </Tooltip>
            </div>
            {actionableTasks.length ? (
                <div className="thin-scrollbar max-h-[min(520px,calc(100dvh-156px))] space-y-2 overflow-y-auto pr-1">
                    {actionableTasks.map((task) => <TaskRow key={task.id} task={task} onOpen={() => {
                        setOpen(false);
                        router.push(task.href);
                    }} />)}
                </div>
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前没有进行中的视频任务" className="!my-6" />
            )}
        </section>
    );

    return (
        <Popover content={content} trigger="click" placement="bottomRight" open={open} onOpenChange={setOpen} arrow={false}>
            <Tooltip title="视频任务">
                <span>
                    <Badge count={activeCount} overflowCount={9} size="small" offset={[-1, 3]}>
                        <Button type="text" shape="circle" className={`!h-8 !w-8 !min-w-8 ${triggerClassName || ""}`} style={{ color: "currentColor" }} icon={<Activity className="size-4" />} aria-label="打开视频任务" />
                    </Badge>
                </span>
            </Tooltip>
        </Popover>
    );
}

function TaskRow({ task, onOpen }: { task: VideoTaskSummary; onOpen: () => void }) {
    const running = task.status === "running";
    return (
        <div className="border border-stone-200 px-3 py-2.5 dark:border-stone-800">
            <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 grid size-7 shrink-0 place-items-center ${running ? "text-sky-600 dark:text-sky-300" : "text-red-600 dark:text-red-300"}`}>
                    {running ? <LoaderCircle className="size-4 animate-spin" /> : <CircleAlert className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">{task.title}</span>
                        <Tag className="m-0 shrink-0 text-[11px]">{task.source === "canvas" ? "画布" : "视频创作台"}</Tag>
                    </div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-stone-500 dark:text-stone-400">{task.prompt}</div>
                    <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-stone-500 dark:text-stone-400">
                        <span className="max-w-40 truncate">{task.model}</span>
                        {task.retryCount ? <span>已自动重试 {task.retryCount} 次</span> : null}
                        <span>{relativeTime(task.updatedAt)}</span>
                    </div>
                    {task.detail ? <div className={`mt-1.5 text-xs leading-5 ${running ? "text-stone-500 dark:text-stone-400" : "text-red-600 dark:text-red-300"}`}>{task.detail}</div> : null}
                </div>
            </div>
            <div className="mt-2 flex justify-end">
                <Button type="link" size="small" className="!h-7 !px-0" icon={<ExternalLink className="size-3.5" />} iconPlacement="end" onClick={onOpen}>
                    {running ? "查看任务" : "查看并重试"}
                </Button>
            </div>
        </div>
    );
}

function relativeTime(value: number) {
    const elapsed = Math.max(0, Date.now() - value);
    if (elapsed < 60_000) return "刚刚";
    if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
    if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
    return `${Math.floor(elapsed / 86_400_000)} 天前`;
}

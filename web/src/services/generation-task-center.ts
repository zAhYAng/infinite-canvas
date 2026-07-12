import type { CanvasNodeData } from "@/app/(user)/canvas/types";

export type VideoTaskSummary = {
    id: string;
    source: "canvas" | "workbench";
    status: "running" | "failed" | "completed";
    title: string;
    prompt: string;
    model: string;
    updatedAt: number;
    detail?: string;
    retryCount: number;
    href: string;
};

type CanvasTaskProject = { id: string; title: string; updatedAt: string; nodes: CanvasNodeData[] };
export type WorkbenchVideoTaskLog = {
    id: string;
    createdAt?: number;
    title?: string;
    prompt?: string;
    model?: string;
    status?: string;
    retryCount?: number;
    error?: string;
};

export function summarizeCanvasVideoTasks(projects: CanvasTaskProject[]): VideoTaskSummary[] {
    return projects.flatMap((project) =>
        project.nodes.flatMap((node) => {
            if (node.type !== "video") return [];
            const metadata = node.metadata;
            const running = Boolean(metadata?.videoTask && !metadata.content);
            const failed = metadata?.status === "error";
            if (!running && !failed) return [];
            return [{
                id: `canvas:${project.id}:${node.id}`,
                source: "canvas" as const,
                status: failed ? "failed" as const : "running" as const,
                title: project.title || "未命名画布",
                prompt: metadata?.prompt || metadata?.composerContent || "视频任务",
                model: metadata?.model || metadata?.videoTask?.model || "未选择模型",
                updatedAt: timestamp(project.updatedAt),
                detail: failed ? metadata?.errorDetails || "视频生成失败，请打开画布查看修正建议。" : metadata?.videoTask?.id ? "正在生成，可打开画布继续查看。" : "正在提交任务，请勿关闭来源画布。",
                retryCount: 0,
                href: `/canvas/${project.id}`,
            }];
        }),
    );
}

export function summarizeWorkbenchVideoTasks(logs: WorkbenchVideoTaskLog[]): VideoTaskSummary[] {
    return logs.flatMap((log) => {
        const status = taskStatus(log.status);
        if (!status) return [];
        return [{
            id: `workbench:${log.id}`,
            source: "workbench" as const,
            status,
            title: log.title || "视频创作台任务",
            prompt: log.prompt || "视频任务",
            model: log.model || "未选择模型",
            updatedAt: Number(log.createdAt) || 0,
            detail: status === "failed" ? log.error || "视频生成失败，请打开视频创作台查看修正建议。" : status === "running" ? "正在生成，打开视频创作台可恢复轮询。" : "视频已生成。",
            retryCount: Math.max(0, Number(log.retryCount) || 0),
            href: "/video",
        }];
    });
}

export function sortVideoTaskSummaries(tasks: VideoTaskSummary[]) {
    return [...tasks].sort((left, right) => right.updatedAt - left.updatedAt);
}

function taskStatus(status?: string): VideoTaskSummary["status"] | null {
    if (status === "生成中" || status === "pending") return "running";
    if (status === "失败" || status === "failed") return "failed";
    if (status === "成功" || status === "success") return "completed";
    return null;
}

function timestamp(value: string) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

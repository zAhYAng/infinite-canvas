import { describe, expect, test } from "bun:test";

import { sortVideoTaskSummaries, summarizeCanvasVideoTasks, summarizeWorkbenchVideoTasks } from "../src/services/generation-task-center";

describe("generation task center", () => {
    test("shows only actionable canvas video tasks without exposing task credentials", () => {
        const tasks = summarizeCanvasVideoTasks([
            {
                id: "project-1",
                title: "广告分镜",
                updatedAt: "2026-07-12T04:00:00.000Z",
                nodes: [
                    { id: "video-running", type: "video", title: "运行中", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt: "镜头推进", model: "grok-video", videoTask: { provider: "openai", model: "grok-video", channelId: "ttapi", baseUrl: "https://api.ttapi.io", id: "task_public", idempotencyKey: "secret-idempotency-key" } } },
                    { id: "video-failed", type: "video", title: "失败", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { status: "error", errorDetails: "参考图数量不符合模型限制" } },
                    { id: "video-finished", type: "video", title: "完成", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "https://media.v2api.top/video.mp4" } },
                ],
            },
        ]);

        expect(tasks).toHaveLength(2);
        expect(tasks.map((task) => task.status)).toEqual(["running", "failed"]);
        expect(JSON.stringify(tasks)).not.toContain("secret-idempotency-key");
        expect(tasks[0]?.href).toBe("/canvas/project-1");
    });

    test("maps persisted workbench logs and preserves retry context", () => {
        const tasks = summarizeWorkbenchVideoTasks([
            { id: "pending", createdAt: 20, title: "产品展示", prompt: "包包旋转", model: "grok-fast", status: "生成中", retryCount: 1 },
            { id: "failed", createdAt: 30, prompt: "海边", model: "grok-video", status: "失败", error: "Job failed, Please try again later." },
            { id: "done", createdAt: 10, status: "成功" },
        ]);

        expect(tasks.map((task) => task.status)).toEqual(["running", "failed", "completed"]);
        expect(tasks[0]?.retryCount).toBe(1);
        expect(tasks[1]?.detail).toContain("Job failed");
        expect(sortVideoTaskSummaries(tasks).map((task) => task.id)).toEqual(["workbench:failed", "workbench:pending", "workbench:done"]);
    });
});

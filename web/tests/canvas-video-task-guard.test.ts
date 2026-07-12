import { describe, expect, test } from "bun:test";

import {
    findPendingVideoSubmissionNode,
    hasMissingVideoTaskDependencies,
    hasPendingVideoTasks,
    hasRunningGenerationForNode,
    isSubmittingVideoTaskNode,
    popHistoryWithoutPendingVideoTasks,
    touchesPendingVideoTask,
} from "../src/app/(user)/canvas/utils/canvas-video-task-guard";
import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types";

describe("canvas pending video task guards", () => {
    test("distinguishes a durable submission draft from a pollable public task", () => {
        const draft = videoNode("draft", undefined);
        const pollable = videoNode("pollable", "task_public");

        expect(isSubmittingVideoTaskNode(draft)).toBe(true);
        expect(isSubmittingVideoTaskNode(pollable)).toBe(false);
        expect(hasPendingVideoTasks([draft, pollable])).toBe(true);
        expect(touchesPendingVideoTask([draft, pollable], new Set(["pollable"]))).toBe(true);
        expect(touchesPendingVideoTask([draft, pollable], new Set(["other"]))).toBe(false);
    });

    test("skips transient pending-task snapshots when taking a history entry", () => {
        const safeEntry = { id: "safe", nodes: [] as CanvasNodeData[] };
        const history = [safeEntry, { id: "draft", nodes: [videoNode("draft", undefined)] }, { id: "pollable", nodes: [videoNode("pollable", "task_public")] }];

        expect(popHistoryWithoutPendingVideoTasks(history)).toBe(safeEntry);
        expect(history).toEqual([]);
    });

    test("protects source assets referenced by a pending video task", () => {
        const source: CanvasNodeData = {
            id: "source-image",
            type: CanvasNodeType.Image,
            title: "source",
            position: { x: 0, y: 0 },
            width: 640,
            height: 360,
            metadata: { content: "blob:source", mimeType: "image/png" },
        };
        const pending = videoNode("draft", undefined);
        pending.metadata!.references = [{ url: "asset://source-image", name: "source", role: "first_frame", kind: "image", mime: "image/png" }];
        pending.metadata!.videoTaskOriginNodeId = "origin";

        expect(touchesPendingVideoTask([source, pending], new Set(["source-image"]))).toBe(true);
        expect(touchesPendingVideoTask([source, pending], new Set(["origin"]))).toBe(true);
    });

    test("tracks multiple resumed tasks independently", () => {
        const requests = new Map([
            ["video-a", { runningNodeId: "video-a" }],
            ["video-b", { runningNodeId: "video-b" }],
        ]);

        expect(hasRunningGenerationForNode(requests.values(), "video-a")).toBe(true);
        expect(hasRunningGenerationForNode(requests.values(), "video-b")).toBe(true);
        requests.delete("video-a");
        expect(hasRunningGenerationForNode(requests.values(), "video-a")).toBe(false);
        expect(hasRunningGenerationForNode(requests.values(), "video-b")).toBe(true);
    });

    test("finds a persisted pending child for the same generation origin", () => {
        const source: CanvasNodeData = {
            id: "source",
            type: CanvasNodeType.Text,
            title: "source",
            position: { x: 0, y: 0 },
            width: 320,
            height: 180,
            metadata: { content: "prompt" },
        };
        const pending = videoNode("video-child", "task_public");

        expect(findPendingVideoSubmissionNode([source, pending], [{ id: "connection", fromNodeId: "source", toNodeId: "video-child" }], "source")?.id).toBe("video-child");
        expect(findPendingVideoSubmissionNode([pending], [], "video-child")?.id).toBe("video-child");

        pending.metadata!.videoTaskOriginNodeId = "source";
        expect(findPendingVideoSubmissionNode([source, pending], [], "source")?.id).toBe("video-child");
    });

    test("detects a persisted asset reference whose source node is missing", () => {
        const pending = videoNode("draft", undefined);
        pending.metadata!.references = [{ url: "asset://missing-image", name: "missing", role: "", kind: "image", mime: "image/png" }];

        expect(hasMissingVideoTaskDependencies(pending, [pending])).toBe(true);
    });
});

function videoNode(id: string, taskId: string | undefined): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Video,
        title: id,
        position: { x: 0, y: 0 },
        width: 640,
        height: 360,
        metadata: {
            status: "loading",
            videoTask: {
                id: taskId,
                provider: "openai",
                model: "default::grok-imagine-video-1.5-fast",
                channelId: "default",
                baseUrl: "https://v2api.top",
                idempotencyKey: "stable-idempotency-key",
            },
        },
    };
}

import { describe, expect, test } from "bun:test";

import { runStoryboardImages, runStoryboardVideo } from "../src/app/(user)/canvas/utils/storyboard-workflow";
import type { CanvasNodeData, CanvasStoryboardWorkflow } from "../src/app/(user)/canvas/types";

const workflow: CanvasStoryboardWorkflow = {
    id: "workflow-1",
    state: "awaiting_confirmation",
    prompt: "产品广告",
    shotPrompts: ["镜头一", "镜头二", "镜头三", "镜头四"],
    imageNodeIds: ["image-1", "image-2", "image-3", "image-4"],
    videoNodeId: "video-1",
    videoPrompt: "产品旋转展示",
};

function node(id: string, type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

describe("storyboard workflow", () => {
    test("runs four images before requesting a main-image selection", async () => {
        const nodes = [...workflow.imageNodeIds.map((id, index) => node(id, "image", { prompt: workflow.shotPrompts[index] })), node("video-1", "video")];
        const generated: string[] = [];
        const updates: Partial<CanvasStoryboardWorkflow>[] = [];

        await runStoryboardImages(workflow, {
            findNode: (id) => nodes.find((item) => item.id === id),
            generateNode: async (id) => {
                generated.push(id);
            },
            update: (_, patch) => updates.push(patch),
        });

        expect(generated).toEqual(workflow.imageNodeIds);
        expect(updates).toEqual([{ state: "running", error: undefined }, { state: "awaiting_selection" }]);
    });

    test("connects the chosen main image before it submits the video", async () => {
        const readyWorkflow = { ...workflow, state: "awaiting_selection" as const };
        const nodes = [node("image-1", "image", { content: "https://media.v2api.top/image.png" }), node("video-1", "video", { prompt: "产品旋转展示" })];
        const events: string[] = [];
        const updates: Partial<CanvasStoryboardWorkflow>[] = [];

        await runStoryboardVideo(readyWorkflow, "image-1", {
            findNode: (id) => nodes.find((item) => item.id === id),
            connect: (from, to) => events.push(`connect:${from}:${to}`),
            generateNode: async (id, mode, prompt) => events.push(`generate:${id}:${mode}:${prompt}`),
            update: (_, patch) => updates.push(patch),
        });

        expect(events).toEqual(["connect:image-1:video-1", "generate:video-1:video:产品旋转展示"]);
        expect(updates).toEqual([{ state: "running", selectedImageId: "image-1", error: undefined }, { state: "completed" }]);
    });
});

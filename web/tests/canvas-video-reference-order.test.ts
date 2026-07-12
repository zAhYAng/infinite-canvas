import { describe, expect, test } from "bun:test";

import { buildNodeGenerationContext } from "../src/app/(user)/canvas/components/canvas-node-generation";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/app/(user)/canvas/types";

describe("canvas first/last frame ordering", () => {
    test("orders TTAPI Grok reference images by role instead of connection insertion", () => {
        const nodes: CanvasNodeData[] = [imageNode("first"), imageNode("last"), videoNode()];
        const connections: CanvasConnection[] = [
            { id: "last-connected-first", fromNodeId: "last", toNodeId: "video" },
            { id: "first-connected-last", fromNodeId: "first", toNodeId: "video" },
        ];

        const context = buildNodeGenerationContext("video", nodes, connections, "move from first to last");

        expect(context.referenceImages.map((image) => image.id)).toEqual(["first", "last"]);
        expect(context.aiReferences.map((reference) => reference.role)).toEqual(["first_frame", "last_frame"]);
    });
});

function imageNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 512,
        height: 512,
        metadata: { content: `https://images.example/${id}.png`, mimeType: "image/png" },
    };
}

function videoNode(): CanvasNodeData {
    return {
        id: "video",
        type: CanvasNodeType.Video,
        title: "video",
        position: { x: 0, y: 0 },
        width: 640,
        height: 360,
        metadata: {
            videoTaskType: "first-last-frame",
            references: [
                { url: "asset://last", name: "last", role: "last_frame", kind: "image", mime: "image/png" },
                { url: "asset://first", name: "first", role: "first_frame", kind: "image", mime: "image/png" },
            ],
        },
    };
}

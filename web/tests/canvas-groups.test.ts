import { describe, expect, test } from "bun:test";

import { CanvasNodeType, type CanvasNodeData } from "@/app/(user)/canvas/types";
import { detachDeletedGroups, groupDragClosure, updateGroupMembershipAfterDrag } from "@/app/(user)/canvas/utils/canvas-groups";

function node(id: string, type: CanvasNodeType, x: number, y: number, width = 100, height = 100): CanvasNodeData {
    return { id, type, title: id, position: { x, y }, width, height, metadata: {} };
}

describe("canvas groups", () => {
    test("adds a dragged node to the group containing its center and removes it when dragged out", () => {
        const group = node("group", CanvasNodeType.Group, 0, 0, 400, 300);
        const image = node("image", CanvasNodeType.Image, 100, 100);
        const grouped = updateGroupMembershipAfterDrag([group, image], ["image"]);
        expect(grouped.find((item) => item.id === "image")?.metadata?.groupId).toBe("group");
        expect(grouped.find((item) => item.id === "group")?.metadata?.groupChildIds).toEqual(["image"]);

        const movedOut = updateGroupMembershipAfterDrag(grouped.map((item) => (item.id === "image" ? { ...item, position: { x: 600, y: 600 } } : item)), ["image"]);
        expect(movedOut.find((item) => item.id === "image")?.metadata?.groupId).toBeUndefined();
        expect(movedOut.find((item) => item.id === "group")?.metadata?.groupChildIds).toEqual([]);
    });

    test("dragging a group includes all of its members", () => {
        const group = { ...node("group", CanvasNodeType.Group, 0, 0), metadata: { groupChildIds: ["image"] } };
        const image = { ...node("image", CanvasNodeType.Image, 20, 20), metadata: { groupId: "group" } };
        expect(Array.from(groupDragClosure([group, image], ["group"]))).toEqual(["group", "image"]);
    });

    test("deleting a group leaves its former members intact and detached", () => {
        const group = { ...node("group", CanvasNodeType.Group, 0, 0), metadata: { groupChildIds: ["image"] } };
        const image = { ...node("image", CanvasNodeType.Image, 20, 20), metadata: { groupId: "group" } };
        const next = detachDeletedGroups([image], ["group"]);
        expect(next).toHaveLength(1);
        expect(next[0].metadata?.groupId).toBeUndefined();
    });
});

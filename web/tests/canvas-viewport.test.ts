import { describe, expect, test } from "bun:test";

import { CanvasNodeType, type CanvasNodeData } from "../src/app/(user)/canvas/types";
import { fitViewportToNodes, zoomViewportAtPoint } from "../src/app/(user)/canvas/utils/canvas-viewport";

function node(id: string, x: number, y: number, width = 340, height = 240): CanvasNodeData {
    return { id, type: CanvasNodeType.Text, title: id, position: { x, y }, width, height, metadata: {} };
}

describe("canvas viewport", () => {
    test("keeps the wheel anchor stable across consecutive zoom events", () => {
        const anchor = { x: 720, y: 360 };
        const initial = { x: 100, y: -80, k: 1 };
        const world = { x: (anchor.x - initial.x) / initial.k, y: (anchor.y - initial.y) / initial.k };
        const afterFirst = zoomViewportAtPoint(initial, 1.2, anchor);
        const afterSecond = zoomViewportAtPoint(afterFirst, 1.44, anchor);

        expect(afterSecond.k).toBeCloseTo(1.44);
        expect(afterSecond.x + world.x * afterSecond.k).toBeCloseTo(anchor.x);
        expect(afterSecond.y + world.y * afterSecond.k).toBeCloseTo(anchor.y);
    });

    test("fits nodes created outside the origin back into the visible canvas", () => {
        const viewport = fitViewportToNodes([node("expanded", 9600, -4200, 680, 480)], { width: 1200, height: 800 });
        const screenCenter = {
            x: viewport.x + (9600 + 340) * viewport.k,
            y: viewport.y + (-4200 + 240) * viewport.k,
        };

        expect(screenCenter.x).toBeCloseTo(600);
        expect(screenCenter.y).toBeCloseTo(400);
    });
});

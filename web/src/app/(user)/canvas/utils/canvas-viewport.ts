import type { CanvasNodeData, Position, ViewportTransform } from "../types";

export type CanvasViewportSize = {
    width: number;
    height: number;
};

const MIN_SCALE = 0.05;
const MAX_SCALE = 5;

export function clampCanvasScale(scale: number) {
    return Math.min(Math.max(scale, MIN_SCALE), MAX_SCALE);
}

export function zoomViewportAtPoint(viewport: ViewportTransform, scale: number, anchor: Position): ViewportTransform {
    const k = clampCanvasScale(scale);
    const worldX = (anchor.x - viewport.x) / viewport.k;
    const worldY = (anchor.y - viewport.y) / viewport.k;
    return {
        x: anchor.x - worldX * k,
        y: anchor.y - worldY * k,
        k,
    };
}

export function fitViewportToNodes(nodes: CanvasNodeData[], viewportSize: CanvasViewportSize, padding = 120): ViewportTransform {
    if (!nodes.length) return { x: viewportSize.width / 2, y: viewportSize.height / 2, k: 1 };

    const bounds = nodes.reduce(
        (result, node) => ({
            left: Math.min(result.left, node.position.x),
            top: Math.min(result.top, node.position.y),
            right: Math.max(result.right, node.position.x + node.width),
            bottom: Math.max(result.bottom, node.position.y + node.height),
        }),
        { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
    );
    const width = Math.max(1, bounds.right - bounds.left);
    const height = Math.max(1, bounds.bottom - bounds.top);
    const availableWidth = Math.max(1, viewportSize.width - padding * 2);
    const availableHeight = Math.max(1, viewportSize.height - padding * 2);
    const k = clampCanvasScale(Math.min(availableWidth / width, availableHeight / height));
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;

    return {
        x: viewportSize.width / 2 - centerX * k,
        y: viewportSize.height / 2 - centerY * k,
        k,
    };
}

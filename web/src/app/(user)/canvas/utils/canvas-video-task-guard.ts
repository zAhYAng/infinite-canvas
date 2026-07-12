import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { referenceNodeId } from "./migrate-references";

export function isPendingVideoTaskNode(node: CanvasNodeData | undefined): boolean {
    return Boolean(node?.type === CanvasNodeType.Video && node.metadata?.videoTask && !node.metadata.content);
}

export function isSubmittingVideoTaskNode(node: CanvasNodeData | undefined): boolean {
    return Boolean(isPendingVideoTaskNode(node) && !node?.metadata?.videoTask?.id);
}

export function hasPendingVideoTasks(nodes: CanvasNodeData[]): boolean {
    return nodes.some(isPendingVideoTaskNode);
}

export function touchesPendingVideoTask(nodes: CanvasNodeData[], nodeIds: Set<string>): boolean {
    return nodes.some((node) => {
        if (!isPendingVideoTaskNode(node)) return false;
        if (nodeIds.has(node.id)) return true;
        if (node.metadata?.videoTaskOriginNodeId && nodeIds.has(node.metadata.videoTaskOriginNodeId)) return true;
        return (node.metadata?.references || []).some((reference) => nodeIds.has(referenceNodeId(reference)));
    });
}

export function hasRunningGenerationForNode(requests: Iterable<{ runningNodeId: string }>, nodeId: string): boolean {
    for (const request of requests) {
        if (request.runningNodeId === nodeId) return true;
    }
    return false;
}

export function findPendingVideoSubmissionNode(nodes: CanvasNodeData[], connections: CanvasConnection[], originNodeId: string): CanvasNodeData | undefined {
    const direct = nodes.find((node) => node.id === originNodeId && isPendingVideoTaskNode(node));
    if (direct) return direct;
    const attributed = nodes.find((node) => node.metadata?.videoTaskOriginNodeId === originNodeId && isPendingVideoTaskNode(node));
    if (attributed) return attributed;
    const targetIds = new Set(connections.filter((connection) => connection.fromNodeId === originNodeId).map((connection) => connection.toNodeId));
    return nodes.find((node) => targetIds.has(node.id) && isPendingVideoTaskNode(node));
}

export function hasMissingVideoTaskDependencies(node: CanvasNodeData, nodes: CanvasNodeData[]): boolean {
    const nodeIds = new Set(nodes.map((item) => item.id));
    return (node.metadata?.references || []).some((reference) => {
        const sourceNodeId = referenceNodeId(reference);
        return Boolean(sourceNodeId && !nodeIds.has(sourceNodeId));
    });
}

export function popHistoryWithoutPendingVideoTasks<T extends { nodes: CanvasNodeData[] }>(entries: T[]): T | undefined {
    let entry = entries.pop();
    while (entry && hasPendingVideoTasks(entry.nodes)) entry = entries.pop();
    return entry;
}

import { CanvasNodeType, type CanvasNodeData } from "../types";

export function isCanvasGroup(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Group;
}

export function groupDragClosure(nodes: CanvasNodeData[], selectedIds: Iterable<string>) {
    const ids = new Set(selectedIds);
    let changed = true;
    while (changed) {
        changed = false;
        nodes.forEach((node) => {
            if (!ids.has(node.id)) return;
            [...(node.metadata?.batchChildIds || []), ...(isCanvasGroup(node) ? node.metadata?.groupChildIds || [] : [])].forEach((childId) => {
                if (ids.has(childId)) return;
                ids.add(childId);
                changed = true;
            });
        });
    }
    return ids;
}

export function updateGroupMembershipAfterDrag(nodes: CanvasNodeData[], draggedIds: Iterable<string>) {
    const dragged = new Set(draggedIds);
    const groups = nodes.filter(isCanvasGroup);
    const groupIds = new Set(groups.map((group) => group.id));
    const assignments = new Map<string, string | undefined>();

    nodes.forEach((node) => {
        if (isCanvasGroup(node)) return;
        const currentGroupId = groupIds.has(node.metadata?.groupId || "") ? node.metadata?.groupId : undefined;
        assignments.set(node.id, currentGroupId);
    });

    nodes.forEach((node) => {
        if (!dragged.has(node.id) || isCanvasGroup(node)) return;
        const centerX = node.position.x + node.width / 2;
        const centerY = node.position.y + node.height / 2;
        const containingGroup = groups.find((group) => centerX >= group.position.x && centerX <= group.position.x + group.width && centerY >= group.position.y && centerY <= group.position.y + group.height);
        assignments.set(node.id, containingGroup?.id);
    });

    return applyGroupAssignments(nodes, assignments);
}

export function detachDeletedGroups(nodes: CanvasNodeData[], deletedIds: Iterable<string>) {
    const deleted = new Set(deletedIds);
    const groups = new Set(nodes.filter(isCanvasGroup).map((node) => node.id));
    const assignments = new Map<string, string | undefined>();

    nodes.forEach((node) => {
        if (isCanvasGroup(node)) return;
        const groupId = node.metadata?.groupId;
        assignments.set(node.id, groupId && groups.has(groupId) && !deleted.has(groupId) ? groupId : undefined);
    });
    return applyGroupAssignments(nodes, assignments);
}

export function remapCopiedGroupLinks(nodes: CanvasNodeData[], idMap: Map<string, string>) {
    const groupIds = new Set(nodes.filter(isCanvasGroup).map((node) => node.id));
    const assignments = new Map<string, string | undefined>();

    nodes.forEach((node) => {
        if (isCanvasGroup(node)) return;
        const copiedGroupId = node.metadata?.groupId ? idMap.get(node.metadata.groupId) || node.metadata.groupId : undefined;
        assignments.set(node.id, copiedGroupId && groupIds.has(copiedGroupId) ? copiedGroupId : undefined);
    });

    return applyGroupAssignments(nodes, assignments);
}

function applyGroupAssignments(nodes: CanvasNodeData[], assignments: Map<string, string | undefined>) {
    const childIdsByGroup = new Map<string, string[]>();
    assignments.forEach((groupId, nodeId) => {
        if (!groupId) return;
        const childIds = childIdsByGroup.get(groupId) || [];
        childIds.push(nodeId);
        childIdsByGroup.set(groupId, childIds);
    });

    return nodes.map((node) => {
        if (isCanvasGroup(node)) {
            const groupChildIds = childIdsByGroup.get(node.id) || [];
            return { ...node, metadata: { ...node.metadata, groupChildIds } };
        }
        const groupId = assignments.get(node.id);
        const metadata = { ...node.metadata };
        if (groupId) metadata.groupId = groupId;
        else delete metadata.groupId;
        return { ...node, metadata };
    });
}

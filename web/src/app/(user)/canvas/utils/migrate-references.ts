import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasVideoTaskType } from "../types";
import type { AIReference, ReferenceKind, ReferenceRole } from "../types/reference";

type LegacyMetadata = Omit<CanvasNodeMetadata, "references"> & { references?: unknown };

export function migrateCanvasNodeReferences(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        if (!node.metadata) return node;
        return { ...node, metadata: { ...node.metadata, references: migrateReferences(node.metadata, nodes) } };
    });
}

export function migrateReferences(metadata: LegacyMetadata | undefined | null, allNodes: CanvasNodeData[]): AIReference[] {
    const rawReferences = metadata?.references;
    if (!Array.isArray(rawReferences) || !rawReferences.length) return [];
    if (isAIReferenceArray(rawReferences)) return rawReferences;

    const nodeById = new Map(allNodes.map((node) => [node.id, node]));
    const videoTaskType = metadata?.videoTaskType;
    return rawReferences
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .map((value, index) => {
            const source = nodeById.get(value) || nodeById.get(value.replace(/^asset:\/\//, ""));
            return (
                (source ? nodeToAIReference(source, legacyRole(videoTaskType, index)) : null) || {
                    url: legacyReferenceUrl(value),
                    name: "",
                    role: legacyRole(videoTaskType, index),
                    kind: inferKindFromUrl(value) || "image",
                    mime: inferMimeFromUrl(value),
                }
            );
        });
}

export function nodeToAIReference(node: CanvasNodeData, role: ReferenceRole = ""): AIReference | null {
    const kind = referenceKindFromNode(node);
    if (!kind) return null;
    const metadata = node.metadata || {};
    return {
        url: `asset://${node.id}`,
        name: node.title || "",
        role,
        kind,
        mime: metadata.mimeType || fallbackMime(kind),
    };
}

export function referenceNodeId(reference: Pick<AIReference, "url">) {
    return reference.url.startsWith("asset://") ? reference.url.slice("asset://".length) : "";
}

function isAIReferenceArray(value: unknown[]): value is AIReference[] {
    return value.every((item) => {
        if (!item || typeof item !== "object") return false;
        const reference = item as Partial<AIReference>;
        return typeof reference.url === "string" && typeof reference.name === "string" && isReferenceRole(reference.role) && isReferenceKind(reference.kind) && typeof reference.mime === "string";
    });
}

function referenceKindFromNode(node: CanvasNodeData): ReferenceKind | null {
    if (node.type === CanvasNodeType.Image) return "image";
    if (node.type === CanvasNodeType.Video) return "video";
    if (node.type === CanvasNodeType.Audio) return "audio";
    return null;
}

function legacyRole(videoTaskType: CanvasVideoTaskType | undefined, index: number): ReferenceRole {
    if (videoTaskType !== "first-last-frame") return "";
    if (index === 0) return "first_frame";
    if (index === 1) return "last_frame";
    return "";
}

function legacyReferenceUrl(value: string) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
    return `asset://${value}`;
}

function inferKindFromUrl(value: string): ReferenceKind | null {
    const lower = value.toLowerCase();
    if (lower.startsWith("video:") || /\.(mp4|mov|webm|m4v)(\?|#|$)/.test(lower)) return "video";
    if (lower.startsWith("audio:") || /\.(mp3|wav|m4a|aac|ogg)(\?|#|$)/.test(lower)) return "audio";
    if (lower.startsWith("image:") || /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/.test(lower)) return "image";
    return null;
}

function inferMimeFromUrl(value: string) {
    const lower = value.toLowerCase();
    if (/\.(png)(\?|#|$)/.test(lower)) return "image/png";
    if (/\.(jpe?g)(\?|#|$)/.test(lower)) return "image/jpeg";
    if (/\.(webp)(\?|#|$)/.test(lower)) return "image/webp";
    if (/\.(gif)(\?|#|$)/.test(lower)) return "image/gif";
    if (/\.(mp4|m4v)(\?|#|$)/.test(lower)) return "video/mp4";
    if (/\.(mov)(\?|#|$)/.test(lower)) return "video/quicktime";
    if (/\.(webm)(\?|#|$)/.test(lower)) return "video/webm";
    if (/\.(mp3)(\?|#|$)/.test(lower)) return "audio/mpeg";
    if (/\.(wav)(\?|#|$)/.test(lower)) return "audio/wav";
    if (/\.(m4a|aac)(\?|#|$)/.test(lower)) return "audio/aac";
    return "";
}

function fallbackMime(kind: ReferenceKind) {
    if (kind === "image") return "image/png";
    if (kind === "audio") return "audio/mpeg";
    return "video/mp4";
}

function isReferenceKind(value: unknown): value is ReferenceKind {
    return value === "image" || value === "video" || value === "audio";
}

function isReferenceRole(value: unknown): value is ReferenceRole {
    return value === "" || value === "mask" || value === "first_frame" || value === "last_frame";
}

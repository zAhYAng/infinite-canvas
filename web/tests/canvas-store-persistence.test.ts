import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

const writes: Array<{ name: string; value: string }> = [];
const storedValues = new Map<string, string>();

mock.module("@/lib/localforage-storage", () => ({
    localForageStorage: {
        getItem: async (name: string) => storedValues.get(name) || null,
        setItem: async (name: string, value: string) => {
            storedValues.set(name, value);
            writes.push({ name, value });
        },
        removeItem: async (name: string) => {
            storedValues.delete(name);
        },
    },
}));

let useCanvasStore: typeof import("../src/app/(user)/canvas/stores/use-canvas-store").useCanvasStore;

beforeAll(async () => {
    ({ useCanvasStore } = await import("../src/app/(user)/canvas/stores/use-canvas-store"));
});

beforeEach(() => {
    useCanvasStore.setState({
        hydrated: true,
        projects: [
            {
                id: "project-1",
                title: "video",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                nodes: [],
                connections: [],
                chatSessions: [],
                activeChatId: null,
                backgroundMode: "lines",
                showImageInfo: false,
                viewport: { x: 0, y: 0, k: 1 },
            },
        ],
    });
    writes.length = 0;
    storedValues.clear();
});

describe("canvas video task persistence", () => {
    test("durably writes a pending submission before the action resolves", async () => {
        const videoTask = {
            provider: "openai" as const,
            model: "default::grok-imagine-video-1.5-fast",
            channelId: "default",
            baseUrl: "https://v2api.top",
            idempotencyKey: "stable-idempotency-key",
        };

        await useCanvasStore.getState().updateProjectAndPersist("project-1", {
            nodes: [
                {
                    id: "video-1",
                    type: "video" as const,
                    title: "pending",
                    position: { x: 0, y: 0 },
                    width: 640,
                    height: 360,
                    metadata: { status: "loading", videoTask },
                },
            ],
        });

        expect(writes).toHaveLength(1);
        const persisted = JSON.parse(writes[0].value) as { state: { projects: Array<{ nodes: Array<{ metadata?: { videoTask?: typeof videoTask } }> }> } };
        expect(persisted.state.projects[0].nodes[0].metadata?.videoTask).toEqual(videoTask);
    });

    test("refuses to delete projects that still own pending video tasks", () => {
        const base = useCanvasStore.getState().projects[0];
        const pending = {
            ...base,
            id: "pending-project",
            nodes: [
                {
                    id: "video-1",
                    type: "video" as const,
                    title: "pending",
                    position: { x: 0, y: 0 },
                    width: 640,
                    height: 360,
                    metadata: {
                        videoTask: {
                            provider: "openai" as const,
                            model: "default::grok-imagine-video-1.5-fast",
                            channelId: "default",
                            baseUrl: "https://v2api.top",
                            idempotencyKey: "stable-idempotency-key",
                        },
                    },
                },
            ],
        };
        useCanvasStore.setState({ projects: [pending, { ...base, id: "safe-project" }] });

        const result = useCanvasStore.getState().deleteProjects(["pending-project", "safe-project"]);

        expect(result).toEqual({ deletedIds: ["safe-project"], blockedIds: ["pending-project"] });
        expect(useCanvasStore.getState().projects.map((project) => project.id)).toEqual(["pending-project"]);
    });

    test("preserves local projects with pending video tasks during sync replacement", () => {
        const base = useCanvasStore.getState().projects[0];
        const pending = {
            ...base,
            nodes: [
                {
                    id: "video-1",
                    type: "video" as const,
                    title: "pending",
                    position: { x: 0, y: 0 },
                    width: 640,
                    height: 360,
                    metadata: {
                        videoTask: {
                            provider: "openai" as const,
                            model: "default::grok-imagine-video-1.5-fast",
                            channelId: "default",
                            baseUrl: "https://v2api.top",
                            idempotencyKey: "stable-idempotency-key",
                        },
                    },
                },
            ],
        };
        useCanvasStore.setState({ projects: [pending] });

        useCanvasStore.getState().replaceProjects([
            { ...base, nodes: [] },
            { ...base, id: "remote-project" },
        ]);

        const projects = useCanvasStore.getState().projects;
        expect(projects.map((project) => project.id)).toEqual(["project-1", "remote-project"]);
        expect(projects[0].nodes[0].metadata?.videoTask?.idempotencyKey).toBe("stable-idempotency-key");
    });

    test("reads the latest persisted project and prevents a stale write from removing its pending task", async () => {
        const base = useCanvasStore.getState().projects[0];
        const pending = {
            ...base,
            updatedAt: "2026-01-01T00:00:01.000Z",
            nodes: [
                {
                    id: "video-1",
                    type: "video" as const,
                    title: "pending",
                    position: { x: 0, y: 0 },
                    width: 640,
                    height: 360,
                    metadata: {
                        status: "loading" as const,
                        videoTask: {
                            provider: "openai" as const,
                            model: "default::grok-imagine-video-1.5-fast",
                            channelId: "default",
                            baseUrl: "https://v2api.top",
                            idempotencyKey: "shared-key",
                        },
                    },
                },
            ],
        };
        storedValues.set("infinite-canvas:canvas_store", JSON.stringify({ state: { projects: [pending] }, version: 0 }));

        const latest = await useCanvasStore.getState().readProjectForVideoSubmission("project-1");
        expect(latest?.nodes[0].metadata?.videoTask?.idempotencyKey).toBe("shared-key");

        await useCanvasStore.getState().updateProjectAndPersist("project-1", { viewport: { x: 10, y: 20, k: 1 } });
        let persisted = JSON.parse(storedValues.get("infinite-canvas:canvas_store")!) as { state: { projects: Array<{ nodes: Array<{ metadata?: { content?: string; videoTask?: { idempotencyKey?: string }; settledVideoTaskKey?: string } }> }> } };
        expect(persisted.state.projects[0].nodes[0].metadata?.videoTask?.idempotencyKey).toBe("shared-key");

        useCanvasStore.setState({
            projects: [
                {
                    ...pending,
                    nodes: pending.nodes.map((node) => ({ ...node, metadata: { status: "error" as const, errorDetails: "stale error" } })),
                },
            ],
        });
        await useCanvasStore.getState().updateProjectAndPersist("project-1", { viewport: { x: 30, y: 40, k: 1 } });
        persisted = JSON.parse(storedValues.get("infinite-canvas:canvas_store")!);
        expect(persisted.state.projects[0].nodes[0].metadata?.videoTask?.idempotencyKey).toBe("shared-key");

        useCanvasStore.setState({
            projects: [
                {
                    ...pending,
                    nodes: pending.nodes.map((node) => ({ ...node, metadata: { status: "success" as const, content: "blob:finished-video", settledVideoTaskKey: "shared-key" } })),
                },
            ],
        });
        await useCanvasStore.getState().updateProjectAndPersist("project-1", { viewport: { x: 25, y: 35, k: 1 } });
        persisted = JSON.parse(storedValues.get("infinite-canvas:canvas_store")!);
        expect(persisted.state.projects[0].nodes[0].metadata?.content).toBe("blob:finished-video");

        storedValues.set("infinite-canvas:canvas_store", JSON.stringify({ state: { projects: [pending] }, version: 0 }));
        useCanvasStore.setState({ projects: [pending] });

        useCanvasStore.setState({
            projects: [
                {
                    ...pending,
                    nodes: pending.nodes.map((node) => ({ ...node, metadata: { status: "success" as const, content: "blob:stale-video" } })),
                },
            ],
        });
        await useCanvasStore.getState().updateProjectAndPersist("project-1", { viewport: { x: 20, y: 30, k: 1 } });
        persisted = JSON.parse(storedValues.get("infinite-canvas:canvas_store")!);
        expect(persisted.state.projects[0].nodes[0].metadata?.videoTask?.idempotencyKey).toBe("shared-key");

        useCanvasStore.setState({
            projects: [
                {
                    ...pending,
                    nodes: pending.nodes.map((node) => ({ ...node, metadata: { status: "error" as const, errorDetails: "terminal failure", settledVideoTaskKey: "shared-key" } })),
                },
            ],
        });
        await useCanvasStore.getState().updateProjectAndPersist("project-1", { viewport: { x: 50, y: 60, k: 1 } });
        persisted = JSON.parse(storedValues.get("infinite-canvas:canvas_store")!);
        expect(persisted.state.projects[0].nodes[0].metadata?.videoTask).toBeUndefined();
        expect(persisted.state.projects[0].nodes[0].metadata?.settledVideoTaskKey).toBe("shared-key");
    });

    test("flushes a queued completion before another video submission reads the project", async () => {
        const base = useCanvasStore.getState().projects[0];
        const pending = {
            ...base,
            nodes: [
                {
                    id: "video-1",
                    type: "video" as const,
                    title: "pending",
                    position: { x: 0, y: 0 },
                    width: 640,
                    height: 360,
                    metadata: {
                        status: "loading" as const,
                        videoTask: {
                            id: "task_public",
                            provider: "openai" as const,
                            model: "default::grok-imagine-video-1.5-fast",
                            channelId: "default",
                            baseUrl: "https://v2api.top",
                            idempotencyKey: "shared-key",
                        },
                    },
                },
            ],
        };
        await useCanvasStore.getState().updateProjectAndPersist("project-1", { nodes: pending.nodes });

        useCanvasStore.setState({
            projects: [
                {
                    ...pending,
                    nodes: pending.nodes.map((node) => ({
                        ...node,
                        metadata: {
                            status: "success" as const,
                            content: "blob:finished-video",
                            settledVideoTaskKey: "shared-key",
                        },
                    })),
                },
            ],
        });

        const latest = await useCanvasStore.getState().readProjectForVideoSubmission("project-1");

        expect(latest?.nodes[0].metadata?.content).toBe("blob:finished-video");
        expect(latest?.nodes[0].metadata?.videoTask).toBeUndefined();
    });

    test("does not let a stale tab resurrect a settled video task", async () => {
        const base = useCanvasStore.getState().projects[0];
        const stalePending = {
            ...base,
            nodes: [
                {
                    id: "video-1",
                    type: "video" as const,
                    title: "pending",
                    position: { x: 0, y: 0 },
                    width: 640,
                    height: 360,
                    metadata: {
                        status: "loading" as const,
                        videoTask: {
                            id: "task_public",
                            provider: "openai" as const,
                            model: "default::grok-imagine-video-1.5-fast",
                            channelId: "default",
                            baseUrl: "https://v2api.top",
                            idempotencyKey: "shared-key",
                        },
                    },
                },
            ],
        };
        const settled = {
            ...stalePending,
            nodes: stalePending.nodes.map((node) => ({
                ...node,
                metadata: {
                    status: "success" as const,
                    content: "blob:finished-video",
                    settledVideoTaskKey: "shared-key",
                },
            })),
        };
        storedValues.set("infinite-canvas:canvas_store", JSON.stringify({ state: { projects: [settled] }, version: 0 }));
        useCanvasStore.setState({ projects: [stalePending] });

        await useCanvasStore.getState().updateProjectAndPersist("project-1", { viewport: { x: 10, y: 20, k: 1 } });

        const persisted = JSON.parse(storedValues.get("infinite-canvas:canvas_store")!) as {
            state: { projects: Array<{ nodes: Array<{ metadata?: { content?: string; videoTask?: unknown } }> }> };
        };
        expect(persisted.state.projects[0].nodes[0].metadata?.content).toBe("blob:finished-video");
        expect(persisted.state.projects[0].nodes[0].metadata?.videoTask).toBeUndefined();
    });
});

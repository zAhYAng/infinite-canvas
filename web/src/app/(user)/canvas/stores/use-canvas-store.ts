import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "../types";
import { hasPendingVideoTasks, isPendingVideoTaskNode } from "../utils/canvas-video-task-guard";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => { deletedIds: string[]; blockedIds: string[] };
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
    updateProjectAndPersist: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => Promise<void>;
    readProjectForVideoSubmission: (id: string) => Promise<CanvasProject | null>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let queuedPersistValue: StorageValue<CanvasStore> | null = null;
let queuedPersistName = CANVAS_STORE_KEY;
let persistWriteChain = Promise.resolve();

function writeCanvasStorage(name: string, value: StorageValue<CanvasStore>) {
    const write = persistWriteChain
        .catch(() => undefined)
        .then(async () => {
            const existing = await readCanvasStorage(name);
            const nextProjects = (value.state as PersistedCanvasState).projects;
            const mergedValue = existing
                ? {
                      ...value,
                      state: {
                          ...value.state,
                          projects: preservePersistedPendingProjects(existing.state.projects, nextProjects),
                      },
                  }
                : value;
            await localForageStorage.setItem(name, JSON.stringify(mergedValue));
        });
    persistWriteChain = write.catch(() => undefined);
    return write;
}

async function flushCanvasStorage() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    const value = queuedPersistValue;
    queuedPersistValue = null;
    if (!value) return;
    await writeCanvasStorage(queuedPersistName, value);
}

async function readCanvasStorage(name: string): Promise<StorageValue<CanvasStore> | null> {
    const value = await localForageStorage.getItem(name);
    if (!value) return null;
    try {
        return JSON.parse(value) as StorageValue<CanvasStore>;
    } catch {
        return null;
    }
}

function preservePersistedPendingProjects(existingProjects: CanvasProject[], nextProjects: CanvasProject[]) {
    const existingById = new Map(existingProjects.map((project) => [project.id, project]));
    const next = nextProjects.map((project) => {
        const existing = existingById.get(project.id);
        return existing && !canReplacePersistedPendingProject(existing, project) ? existing : project;
    });
    const nextIds = new Set(nextProjects.map((project) => project.id));
    for (const existing of existingProjects) {
        if (!nextIds.has(existing.id) && hasPendingVideoTasks(existing.nodes)) next.push(existing);
    }
    return next;
}

function canReplacePersistedPendingProject(existing: CanvasProject, next: CanvasProject) {
    const nextById = new Map(next.nodes.map((node) => [node.id, node]));
    const resurrectsSettledTask = existing.nodes.some((existingNode) => {
        const settledKey = existingNode.metadata?.settledVideoTaskKey;
        const nextTask = nextById.get(existingNode.id)?.metadata?.videoTask;
        return Boolean(settledKey && nextTask && settledKey === (nextTask.idempotencyKey || nextTask.id));
    });
    if (resurrectsSettledTask) return false;

    const pendingNodes = existing.nodes.filter(isPendingVideoTaskNode);
    if (!pendingNodes.length) return true;
    return pendingNodes.every((pendingNode) => {
        const nextNode = nextById.get(pendingNode.id);
        if (!nextNode) return false;
        const existingTask = pendingNode.metadata?.videoTask;
        const existingTaskKey = existingTask?.idempotencyKey || existingTask?.id;
        if (nextNode.metadata?.content) return Boolean(existingTaskKey && nextNode.metadata.settledVideoTaskKey === existingTaskKey);
        const nextTask = nextNode.metadata?.videoTask;
        if (existingTask && nextTask) {
            const sameTask = existingTask.idempotencyKey ? existingTask.idempotencyKey === nextTask.idempotencyKey : Boolean(existingTask.id && existingTask.id === nextTask.id);
            if (!sameTask) return false;
            return !existingTask.id || existingTask.id === nextTask.id;
        }
        return Boolean(existingTaskKey && nextNode.metadata?.status === "error" && nextNode.metadata.errorDetails && nextNode.metadata.settledVideoTaskKey === existingTaskKey);
    });
}

function updatedProjects(projects: CanvasProject[], id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) {
    return projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project));
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        queuedPersistName = name;
        queuedPersistValue = value;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            const queuedValue = queuedPersistValue;
            queuedPersistValue = null;
            if (queuedValue) void writeCanvasStorage(queuedPersistName, queuedValue);
        }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) => {
                const selected = get().projects.filter((project) => ids.includes(project.id));
                const blockedIds = selected.filter((project) => hasPendingVideoTasks(project.nodes)).map((project) => project.id);
                const deletedIds = selected.filter((project) => !blockedIds.includes(project.id)).map((project) => project.id);
                if (deletedIds.length) set((state) => ({ projects: state.projects.filter((project) => !deletedIds.includes(project.id)) }));
                return { deletedIds, blockedIds };
            },
            replaceProjects: (projects) =>
                set((state) => {
                    const pendingProjects = new Map(state.projects.filter((project) => hasPendingVideoTasks(project.nodes)).map((project) => [project.id, project]));
                    const nextProjects = projects.map((project) => pendingProjects.get(project.id) || project);
                    const incomingIds = new Set(projects.map((project) => project.id));
                    for (const project of pendingProjects.values()) {
                        if (!incomingIds.has(project.id)) nextProjects.push(project);
                    }
                    return { projects: nextProjects };
                }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: updatedProjects(state.projects, id, patch),
                })),
            updateProjectAndPersist: async (id, patch) => {
                set((state) => ({ projects: updatedProjects(state.projects, id, patch) }));
                await flushCanvasStorage();
            },
            readProjectForVideoSubmission: async (id) => {
                await flushCanvasStorage();
                await persistWriteChain.catch(() => undefined);
                const stored = await readCanvasStorage(CANVAS_STORE_KEY);
                return ((stored?.state as PersistedCanvasState | undefined)?.projects || []).find((project) => project.id === id) || null;
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => () => {
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

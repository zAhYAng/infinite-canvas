import { getCachedCanvasCapability } from "@/services/api/canvas-capabilities";
import { fetchPrompts, ALL_PROMPTS_OPTION } from "@/services/api/prompts";
import { uploadImage } from "@/services/image-storage";
import { preflightGeneration } from "@/app/(user)/canvas/utils/generation-preflight";
import { useCanvasStore } from "@/app/(user)/canvas/stores/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { modelOptionLabel, normalizeModelOptionValue, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";

export const SITE_TOOL_NAMES = ["site_navigate", "canvas_list_projects", "workbench_image_get_config", "workbench_image_generate", "workbench_video_get_config", "workbench_video_generate", "prompts_search", "assets_list", "assets_add"] as const;
export type SiteToolName = (typeof SITE_TOOL_NAMES)[number];

export const SITE_TOOL_LABELS: Record<SiteToolName, string> = {
    site_navigate: "网站跳转",
    canvas_list_projects: "画布列表",
    workbench_image_get_config: "生图配置",
    workbench_image_generate: "生图工作台",
    workbench_video_get_config: "视频配置",
    workbench_video_generate: "视频创作台",
    prompts_search: "搜索提示词",
    assets_list: "素材列表",
    assets_add: "添加素材",
};

export function isSiteTool(name: string): name is SiteToolName {
    return (SITE_TOOL_NAMES as readonly string[]).includes(name);
}

export function shouldConfirmSiteTool(name: SiteToolName, mode: "off" | "risky" | "all") {
    if (mode === "off") return false;
    if (mode === "all") return name !== "canvas_list_projects" && name !== "workbench_image_get_config" && name !== "workbench_video_get_config" && name !== "prompts_search" && name !== "assets_list";
    return name === "workbench_image_generate" || name === "workbench_video_generate" || name === "assets_add";
}

export async function runSiteTool(name: SiteToolName, input: Record<string, unknown>, navigate: (path: string) => void): Promise<unknown> {
    if (name === "site_navigate") return navigateSite(input, navigate);
    if (name === "canvas_list_projects") return listCanvasProjects(input);
    if (name === "workbench_image_get_config") return getImageConfig();
    if (name === "workbench_image_generate") return runImageWorkbench(input, navigate);
    if (name === "workbench_video_get_config") return getVideoConfig();
    if (name === "workbench_video_generate") return runVideoWorkbench(input, navigate);
    if (name === "prompts_search") return searchPrompts(input);
    if (name === "assets_list") return listAssets(input);
    return addAsset(input);
}

function navigateSite(input: Record<string, unknown>, navigate: (path: string) => void) {
    const path = String(input.path || "").trim();
    if (!/^\/(?:$|canvas(?:\/[-\w.]+)?$|image$|video$|prompts$|assets$|config$)/.test(path)) throw new Error("不支持的站内路径");
    navigate(path);
    return { ok: true, path };
}

function listCanvasProjects(input: Record<string, unknown>) {
    const { projects, hydrated } = useCanvasStore.getState();
    if (!hydrated) throw new Error("画布仍在加载中");
    const keyword = text(input.keyword).toLowerCase();
    const filtered = keyword ? projects.filter((project) => project.title.toLowerCase().includes(keyword)) : projects;
    const page = paginate(input, filtered.length);
    return { total: filtered.length, ...page, items: filtered.slice(page.start, page.end).map((project) => ({ id: project.id, title: project.title, createdAt: project.createdAt, updatedAt: project.updatedAt, nodeCount: project.nodes.length, connectionCount: project.connections.length })) };
}

function getImageConfig() {
    const { config } = useConfigStore.getState();
    const model = config.imageModel || config.model;
    return { current: { model, quality: config.quality, size: config.size, count: config.count }, models: selectableModelsByCapability(config, "image").map((value) => ({ value, label: modelOptionLabel(config, value), capability: getCachedCanvasCapability(config, value) })), countRange: { min: 1, max: 10 } };
}

function getVideoConfig() {
    const { config } = useConfigStore.getState();
    const model = config.videoModel || config.model;
    return { current: { model, size: config.size, seconds: config.videoSeconds, resolution: config.vquality, generateAudio: config.videoGenerateAudio !== "false", watermark: config.videoWatermark === "true" }, models: selectableModelsByCapability(config, "video").map((value) => ({ value, label: modelOptionLabel(config, value), capability: getCachedCanvasCapability(config, value) })) };
}

function runImageWorkbench(input: Record<string, unknown>, navigate: (path: string) => void) {
    const configStore = useConfigStore.getState();
    const current = configStore.config;
    const model = resolveModel(input.model, current.channels, current.imageModel || current.model);
    const count = input.count == null ? current.count : String(Math.max(1, Math.min(10, Math.floor(Number(input.count)) || 1)));
    const next = { ...current, model, imageModel: model, quality: optionalText(input.quality, current.quality), size: optionalText(input.size, current.size), count };
    assertPlan(preflightGeneration({ config: next, mode: "image", prompt: text(input.prompt) }));
    configStore.updateConfig("imageModel", model);
    configStore.updateConfig("quality", next.quality);
    configStore.updateConfig("size", next.size);
    configStore.updateConfig("count", count);
    const run = input.run === true;
    navigate("/image");
    useWorkbenchAgentStore.getState().dispatchImage({ prompt: text(input.prompt), run });
    return { ok: true, navigated: "/image", run, model, note: run ? "已通过页面生成链路提交" : "已填入工作台，等待用户确认生成" };
}

function runVideoWorkbench(input: Record<string, unknown>, navigate: (path: string) => void) {
    const configStore = useConfigStore.getState();
    const current = configStore.config;
    const model = resolveModel(input.model, current.channels, current.videoModel || current.model);
    const next = {
        ...current,
        model,
        videoModel: model,
        size: optionalText(input.size, current.size),
        videoSeconds: optionalText(input.seconds, current.videoSeconds),
        vquality: optionalText(input.resolution, current.vquality),
        videoGenerateAudio: typeof input.generateAudio === "boolean" ? String(input.generateAudio) : current.videoGenerateAudio,
        videoWatermark: typeof input.watermark === "boolean" ? String(input.watermark) : current.videoWatermark,
    };
    assertPlan(preflightGeneration({ config: next, mode: "video", prompt: text(input.prompt) }));
    configStore.updateConfig("videoModel", model);
    configStore.updateConfig("size", next.size);
    configStore.updateConfig("videoSeconds", next.videoSeconds);
    configStore.updateConfig("vquality", next.vquality);
    configStore.updateConfig("videoGenerateAudio", next.videoGenerateAudio);
    configStore.updateConfig("videoWatermark", next.videoWatermark);
    const run = input.run === true;
    navigate("/video");
    useWorkbenchAgentStore.getState().dispatchVideo({ prompt: text(input.prompt), run });
    return { ok: true, navigated: "/video", run, model, note: run ? "已通过页面视频任务链路提交" : "已填入工作台，等待用户确认生成" };
}

async function searchPrompts(input: Record<string, unknown>) {
    const page = paginate(input, Number.MAX_SAFE_INTEGER);
    const tags = Array.isArray(input.tags) ? input.tags.filter((item): item is string => typeof item === "string") : [];
    const result = await fetchPrompts({ keyword: text(input.keyword), category: optionalText(input.category, ALL_PROMPTS_OPTION), tag: tags, page: page.page, pageSize: page.pageSize });
    return { total: result.total, page: page.page, pageSize: page.pageSize, categories: result.categories, tags: result.tags.slice(0, 60), items: result.items.map((item) => ({ id: item.id, title: item.title, prompt: item.prompt, category: item.category, tags: item.tags, coverUrl: item.coverUrl, githubUrl: item.githubUrl })) };
}

function listAssets(input: Record<string, unknown>) {
    const { assets, hydrated } = useAssetStore.getState();
    if (!hydrated) throw new Error("素材仍在加载中");
    const kind = input.kind === "text" || input.kind === "image" || input.kind === "video" ? input.kind : "all";
    const keyword = text(input.keyword).toLowerCase();
    const filtered = assets.filter((asset) => (kind === "all" || asset.kind === kind) && (!keyword || [asset.title, asset.note, asset.source, ...asset.tags].filter(Boolean).join(" ").toLowerCase().includes(keyword)));
    const page = paginate(input, filtered.length);
    return { total: filtered.length, ...page, items: filtered.slice(page.start, page.end).map((asset) => ({ id: asset.id, kind: asset.kind, title: asset.title, tags: asset.tags, source: asset.source, note: asset.note, createdAt: asset.createdAt, updatedAt: asset.updatedAt, coverUrl: asset.coverUrl || undefined, content: asset.kind === "text" ? asset.data.content : undefined })) };
}

async function addAsset(input: Record<string, unknown>) {
    const title = text(input.title);
    if (!title) throw new Error("请提供素材标题");
    const tags = Array.isArray(input.tags) ? input.tags.filter((item): item is string => typeof item === "string") : [];
    const source = optionalText(input.source, "Agent");
    const note = text(input.note) || undefined;
    const store = useAssetStore.getState();
    if (input.kind === "text") {
        const content = text(input.content);
        if (!content) throw new Error("文本素材需要 content");
        return { ok: true, id: store.addAsset({ kind: "text", title, coverUrl: "", tags, source, note, data: { content } }) };
    }
    if (input.kind === "image") {
        const sourceUrl = text(input.imageUrl);
        if (!sourceUrl) throw new Error("图片素材需要 imageUrl");
        const image = await uploadImage(sourceUrl).catch(() => {
            throw new Error("图片无法读取，请提供 data URL 或允许跨域访问的 URL");
        });
        return { ok: true, id: store.addAsset({ kind: "image", title, coverUrl: image.url, tags, source, note, data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType } }) };
    }
    throw new Error("assets_add 仅支持 text 或 image");
}

function assertPlan(plan: ReturnType<typeof preflightGeneration>) {
    if (!plan.valid) throw new Error(plan.diagnostics.map((item) => item.message).join("；") || "生成参数不合法");
}

function resolveModel(value: unknown, channels: Parameters<typeof normalizeModelOptionValue>[1], fallback: string) {
    return typeof value === "string" && value.trim() ? normalizeModelOptionValue(value, channels) || value.trim() : fallback;
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, fallback: string) {
    const next = text(value);
    return next || fallback;
}

function paginate(input: Record<string, unknown>, total: number) {
    const pageSize = Math.max(1, Math.min(100, Math.floor(Number(input.pageSize)) || 20));
    const page = Math.max(1, Math.min(Math.max(1, Math.ceil(total / pageSize)), Math.floor(Number(input.page)) || 1));
    const start = (page - 1) * pageSize;
    return { page, pageSize, start, end: start + pageSize };
}

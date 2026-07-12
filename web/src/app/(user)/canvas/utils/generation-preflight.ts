import { getCachedCanvasCapability, type CanvasModelCapability, type GenerationOperation, type GenerationOperationId } from "@/services/api/canvas-capabilities";
import { getGrokVideoCreateDiagnostics, isGrokVideoModel } from "@/services/api/grok-video-contract";
import { modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

export type GenerationPreflightMode = "image" | "video";
export type GenerationDiagnostic = { field: "model" | "prompt" | "references" | "seconds" | "resolution" | "size" | "count" | "media"; message: string };
export type ValidatedGenerationPlan = {
    valid: boolean;
    strict: boolean;
    model: string;
    operation?: GenerationOperationId;
    capability?: CanvasModelCapability;
    diagnostics: GenerationDiagnostic[];
};

export function preflightGeneration({ config, mode, prompt, references = [], referenceCount, videoReferenceCount = 0, audioReferenceCount = 0 }: { config: AiConfig; mode: GenerationPreflightMode; prompt: string; references?: ReferenceImage[]; referenceCount?: number; videoReferenceCount?: number; audioReferenceCount?: number }): ValidatedGenerationPlan {
    const model = modelOptionName(config.model || (mode === "video" ? config.videoModel : config.imageModel));
    const operation: GenerationOperationId = mode === "video" ? "videos.create" : references.length ? "images.edit" : "images.generate";
    const capability = getCachedCanvasCapability(config, config.model || (mode === "video" ? config.videoModel : config.imageModel));
    const imageCount = referenceCount ?? references.length;
    const grokVideoModel = isGrokVideoModel(model);
    const grokTextModelSelectedForVideo = mode === "video" && /^grok(?:[-_]|$)/i.test(model) && !grokVideoModel;
    const grokDiagnostics = grokVideoModel ? getGrokVideoCreateDiagnostics({ model, prompt, seconds: config.videoSeconds, size: config.size, resolution: config.vquality, imageCount }) : grokTextModelSelectedForVideo ? [{ field: "model" as const, message: `${model} 不是可用于视频生成的 Grok 模型` }] : [];
    if (!capability?.known || !capability.profile) {
        if (grokDiagnostics.length) return { valid: false, strict: true, model, operation, capability, diagnostics: grokDiagnostics };
        return { valid: Boolean(prompt.trim() && model), strict: grokVideoModel, model, operation, capability, diagnostics: prompt.trim() ? [] : [{ field: "prompt", message: "请输入提示词" }] };
    }

    const operationProfile = capability.profile.operations.find((item) => item.id === operation);
    const diagnostics: GenerationDiagnostic[] = [];
    if (!operationProfile) diagnostics.push({ field: "model", message: `${model} 未声明 ${operation} 能力` });
    if (!prompt.trim()) diagnostics.push({ field: "prompt", message: "请输入提示词" });
    if (operationProfile) validateOperation(operationProfile, config, prompt, imageCount, videoReferenceCount, audioReferenceCount, diagnostics);
    return { valid: diagnostics.length === 0, strict: true, model, operation, capability, diagnostics };
}

function validateOperation(operation: GenerationOperation, config: AiConfig, prompt: string, imageCount: number, videoReferenceCount: number, audioReferenceCount: number, diagnostics: GenerationDiagnostic[]) {
    const limits = operation.limits;
    if (limits.prompt_max_chars && Array.from(prompt.trim()).length > limits.prompt_max_chars) diagnostics.push({ field: "prompt", message: `提示词不能超过 ${limits.prompt_max_chars} 个字符` });
    if (limits.require_exactly_one_image && imageCount !== 1) diagnostics.push({ field: "references", message: "该模型需要且只能使用 1 张参考图" });
    else if (imageCount < (limits.min_images || 0) || (limits.max_images && imageCount > limits.max_images)) diagnostics.push({ field: "references", message: `参考图数量应为 ${limits.min_images || 0}-${limits.max_images || "不限"} 张` });
    if (operation.id === "videos.create") {
        if (videoReferenceCount || audioReferenceCount) diagnostics.push({ field: "media", message: "当前模型不支持参考视频或参考音频" });
        const seconds = Math.floor(Number(config.videoSeconds));
        if (!Number.isFinite(seconds) || seconds < (limits.min_seconds || 1) || (limits.max_seconds && seconds > limits.max_seconds)) diagnostics.push({ field: "seconds", message: `时长应为 ${limits.min_seconds || 1}-${limits.max_seconds || "不限"} 秒` });
        if (imageCount > 1 && limits.max_seconds_with_multiple_images && seconds > limits.max_seconds_with_multiple_images) diagnostics.push({ field: "seconds", message: `多张参考图时最长支持 ${limits.max_seconds_with_multiple_images} 秒` });
        const resolution = normalizeResolution(config.vquality);
        if (limits.forced_resolution && resolution !== limits.forced_resolution) diagnostics.push({ field: "resolution", message: `该模型仅支持 ${limits.forced_resolution}` });
        else if (limits.resolutions?.length && !limits.resolutions.includes(resolution)) diagnostics.push({ field: "resolution", message: `仅支持 ${limits.resolutions.join("、")}` });
    }
    if (operation.id !== "videos.create" && limits.max_image_count && Number(config.count) > limits.max_image_count) diagnostics.push({ field: "count", message: `一次最多生成 ${limits.max_image_count} 张图片` });
}

function normalizeResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "480" || normalized === "480p" || normalized === "low") return "480p";
    if (normalized === "1080" || normalized === "1080p") return "1080p";
    return "720p";
}

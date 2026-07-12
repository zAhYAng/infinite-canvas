const GROK_VIDEO_MODELS = ["grok-imagine-video", "grok-imagine-video-1.5", "grok-imagine-video-1.5-fast", "grok-imagine-video-1.5-preview", "grok-imagine-video-1.5-1080p"] as const;

type GrokVideoModel = (typeof GROK_VIDEO_MODELS)[number];

export type GrokVideoModelRules = {
    minSeconds: number;
    maxSeconds: number;
    maxImages: number;
    requiredImages?: number;
    resolutions: readonly ("480p" | "720p" | "1080p")[];
    forcedResolution?: "720p" | "1080p";
    promptLimit?: number;
};

export type GrokVideoCreateFields = {
    model: GrokVideoModel;
    prompt: string;
    seconds: string;
    duration: number;
    size: string;
    aspect_ratio: string;
    resolution: string;
    resolution_name: string;
};

export type GrokVideoCreateDiagnostic = {
    field: "model" | "prompt" | "references" | "seconds" | "resolution" | "size";
    message: string;
};

const MODEL_RULES: Record<GrokVideoModel, GrokVideoModelRules> = {
    "grok-imagine-video": {
        minSeconds: 1,
        maxSeconds: 15,
        maxImages: 7,
        resolutions: ["720p"],
        forcedResolution: "720p",
        promptLimit: 4096,
    },
    "grok-imagine-video-1.5": {
        minSeconds: 1,
        maxSeconds: 15,
        maxImages: 1,
        requiredImages: 1,
        resolutions: ["480p", "720p", "1080p"],
        promptLimit: 4096,
    },
    "grok-imagine-video-1.5-fast": {
        minSeconds: 6,
        maxSeconds: 30,
        maxImages: 7,
        resolutions: ["480p", "720p"],
    },
    "grok-imagine-video-1.5-preview": {
        minSeconds: 1,
        maxSeconds: 15,
        maxImages: 1,
        requiredImages: 1,
        resolutions: ["480p", "720p", "1080p"],
        promptLimit: 4096,
    },
    "grok-imagine-video-1.5-1080p": {
        minSeconds: 1,
        maxSeconds: 15,
        maxImages: 1,
        requiredImages: 1,
        resolutions: ["1080p"],
        forcedResolution: "1080p",
        promptLimit: 4096,
    },
};

const ASPECT_RATIOS = [
    { value: "2:3", ratio: 2 / 3 },
    { value: "3:2", ratio: 3 / 2 },
    { value: "1:1", ratio: 1 },
    { value: "9:16", ratio: 9 / 16 },
    { value: "16:9", ratio: 16 / 9 },
] as const;

export function isGrokVideoModel(model: string) {
    return getGrokVideoModelRules(model) !== null;
}

export function getGrokVideoModelRules(model: string): GrokVideoModelRules | null {
    return MODEL_RULES[normalizeModel(model)] || null;
}

export function normalizeGrokVideoSeconds(model: string, value: string | number) {
    const rules = requireModelRules(model);
    const requested = Math.floor(Number(value));
    const fallback = Math.max(rules.minSeconds, 6);
    return Math.min(rules.maxSeconds, Math.max(rules.minSeconds, Number.isFinite(requested) ? requested : fallback));
}

export function normalizeGrokVideoResolution(model: string, value: string) {
    const rules = requireModelRules(model);
    if (rules.forcedResolution) return rules.forcedResolution;
    const normalized = normalizeResolution(value);
    return rules.resolutions.includes(normalized) ? normalized : "720p";
}

export function normalizeGrokVideoAspectRatio(value: string) {
    const normalized = value.trim().toLowerCase();
    const exact = ASPECT_RATIOS.find((item) => item.value === normalized);
    if (exact) return exact.value;

    const dimensions = normalized.match(/^(\d+)\s*[x:]\s*(\d+)$/);
    const width = Number(dimensions?.[1]);
    const height = Number(dimensions?.[2]);
    if (!width || !height) return "16:9";

    const ratio = width / height;
    return ASPECT_RATIOS.reduce((closest, item) => (Math.abs(Math.log(ratio / item.ratio)) < Math.abs(Math.log(ratio / closest.ratio)) ? item : closest), ASPECT_RATIOS[0]).value;
}

export function getGrokVideoCreateDiagnostics({ model, prompt, seconds, size, resolution, imageCount }: { model: string; prompt: string; seconds: string | number; size: string; resolution: string; imageCount: number }): GrokVideoCreateDiagnostic[] {
    const normalizedModel = normalizeModel(model);
    const rules = getGrokVideoModelRules(normalizedModel);
    if (!rules) return [{ field: "model", message: `不支持的 Grok 视频模型：${model}` }];

    const diagnostics: GrokVideoCreateDiagnostic[] = [];
    const normalizedPrompt = prompt.trim();
    const requestedSeconds = Math.floor(Number(seconds));
    const normalizedResolution = normalizeResolution(resolution);

    if (!normalizedPrompt) diagnostics.push({ field: "prompt", message: "请输入视频提示词" });
    if (rules.promptLimit && Array.from(normalizedPrompt).length > rules.promptLimit) diagnostics.push({ field: "prompt", message: `${normalizedModel} 的提示词不能超过 ${rules.promptLimit} 个字符` });
    if (!Number.isFinite(requestedSeconds) || requestedSeconds < rules.minSeconds || requestedSeconds > rules.maxSeconds) diagnostics.push({ field: "seconds", message: `${normalizedModel} 支持 ${rules.minSeconds}-${rules.maxSeconds} 秒` });
    if (!rules.forcedResolution && !rules.resolutions.includes(normalizedResolution)) diagnostics.push({ field: "resolution", message: `${normalizedModel} 仅支持 ${rules.resolutions.join("、")}` });
    if (!isSupportedGrokVideoAspectRatio(size)) diagnostics.push({ field: "size", message: "视频尺寸必须为 2:3、3:2、1:1、9:16 或 16:9" });
    if (rules.requiredImages !== undefined && imageCount !== rules.requiredImages) diagnostics.push({ field: "references", message: `${normalizedModel} 需要且只能连接 ${rules.requiredImages} 张参考图` });
    else if (imageCount > rules.maxImages) diagnostics.push({ field: "references", message: `${normalizedModel} 最多支持 ${rules.maxImages} 张参考图` });
    if (normalizedModel === "grok-imagine-video" && imageCount > 1 && Number.isFinite(requestedSeconds) && requestedSeconds > 10) diagnostics.push({ field: "seconds", message: "grok-imagine-video 使用多张参考图时最长支持 10 秒" });

    return diagnostics;
}

export function buildGrokVideoCreateFields({ model, prompt, seconds, size, resolution, imageCount }: { model: string; prompt: string; seconds: string | number; size: string; resolution: string; imageCount: number }): GrokVideoCreateFields {
    const diagnostics = getGrokVideoCreateDiagnostics({ model, prompt, seconds, size, resolution, imageCount });
    if (diagnostics.length) throw new Error(diagnostics[0].message);
    const normalizedModel = normalizeModel(model);
    const normalizedPrompt = prompt.trim();
    const normalizedSeconds = requireGrokVideoSeconds(normalizedModel, seconds);
    const normalizedResolution = requireGrokVideoResolution(normalizedModel, resolution);
    const aspectRatio = requireGrokVideoAspectRatio(size);

    return {
        model: normalizedModel,
        prompt: normalizedPrompt,
        seconds: String(normalizedSeconds),
        duration: normalizedSeconds,
        size: sizeFor(aspectRatio, normalizedResolution),
        aspect_ratio: aspectRatio,
        resolution: normalizedResolution,
        resolution_name: normalizedResolution,
    };
}

function normalizeModel(model: string) {
    return model.trim().toLowerCase() as GrokVideoModel;
}

function requireModelRules(model: string) {
    const rules = MODEL_RULES[normalizeModel(model)];
    if (!rules) throw new Error(`不支持的 Grok 视频模型：${model}`);
    return rules;
}

function normalizeResolution(value: string): "480p" | "720p" | "1080p" {
    const normalized = value.trim().toLowerCase();
    if (normalized === "480" || normalized === "480p" || normalized === "low") return "480p";
    if (normalized === "1080" || normalized === "1080p") return "1080p";
    return "720p";
}

function requireGrokVideoSeconds(model: string, value: string | number) {
    const rules = requireModelRules(model);
    const seconds = Math.floor(Number(value));
    if (!Number.isFinite(seconds) || seconds < rules.minSeconds || seconds > rules.maxSeconds) throw new Error(`${model} 支持 ${rules.minSeconds}-${rules.maxSeconds} 秒`);
    return seconds;
}

function requireGrokVideoResolution(model: string, value: string) {
    const rules = requireModelRules(model);
    if (rules.forcedResolution) return rules.forcedResolution;
    const resolution = normalizeResolution(value);
    if (!rules.resolutions.includes(resolution)) throw new Error(`${model} 仅支持 ${rules.resolutions.join("、")}`);
    return resolution;
}

function requireGrokVideoAspectRatio(value: string) {
    const normalized = value.trim().toLowerCase();
    const exact = ASPECT_RATIOS.find((item) => item.value === normalized);
    if (exact) return exact.value;
    const dimensions = normalized.match(/^(\d+)\s*[x:]\s*(\d+)$/);
    const width = Number(dimensions?.[1]);
    const height = Number(dimensions?.[2]);
    if (!width || !height) throw new Error("视频尺寸必须为 2:3、3:2、1:1、9:16 或 16:9");
    const ratio = width / height;
    const closest = ASPECT_RATIOS.reduce((current, item) => (Math.abs(Math.log(ratio / item.ratio)) < Math.abs(Math.log(ratio / current.ratio)) ? item : current), ASPECT_RATIOS[0]);
    if (Math.abs(Math.log(ratio / closest.ratio)) > 0.02) throw new Error("视频尺寸必须为 2:3、3:2、1:1、9:16 或 16:9");
    return closest.value;
}

function isSupportedGrokVideoAspectRatio(value: string) {
    try {
        requireGrokVideoAspectRatio(value);
        return true;
    } catch {
        return false;
    }
}

function sizeFor(aspectRatio: string, resolution: string) {
    const shortSide = Number.parseInt(resolution, 10) || 720;
    if (aspectRatio === "9:16") return `${shortSide}x${Math.round((shortSide * 16) / 9)}`;
    if (aspectRatio === "2:3") return `${shortSide}x${Math.round((shortSide * 3) / 2)}`;
    if (aspectRatio === "1:1") return `${shortSide}x${shortSide}`;
    if (aspectRatio === "3:2") return `${Math.round((shortSide * 3) / 2)}x${shortSide}`;
    return `${Math.round((shortSide * 16) / 9)}x${shortSide}`;
}

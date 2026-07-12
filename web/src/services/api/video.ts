import axios from "axios";

import { dataUrlToFile } from "@/lib/image-utils";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { generationProfileHeaders } from "@/services/api/canvas-capabilities";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import { buildApiUrl, decodeChannelModel, modelOptionName, resolveModelChannel, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { buildGrokVideoCreateFields, isGrokVideoModel } from "./grok-video-contract";

type VideoResponse = { id: string; status?: string; error?: { code?: string; message?: string }; metadata?: Record<string, unknown>; url?: string; result_url?: string; video_url?: string; content?: { url?: string; video_url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ChatVideoResponse = {
    choices?: Array<{ message?: Record<string, unknown>; delta?: Record<string, unknown> } & Record<string, unknown>>;
    error?: { message?: string };
    code?: number;
    msg?: string;
    [key: string]: unknown;
};
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = {
    signal?: AbortSignal;
    existingTask?: VideoGenerationTask;
    onTaskCreated?: (task: VideoGenerationTask) => void | Promise<void>;
};

const GROK_SUBMIT_MAX_RETRIES = 3;
const GROK_SUBMIT_DEFAULT_RETRY_MS = 1000;
const GROK_SUBMIT_MAX_RETRY_MS = 60_000;
const GROK_TERMINAL_TASK_MAX_RETRIES = 1;
const GROK_TERMINAL_TASK_RETRY_DELAY_MS = 1500;

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = {
    id?: string;
    provider: "openai" | "seedance" | "chat";
    model: string;
    channelId: string;
    baseUrl: string;
    idempotencyKey?: string;
    result?: VideoGenerationResult;
};
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

export class VideoGenerationTaskFailedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VideoGenerationTaskFailedError";
    }
}

export class VideoSubmissionOutcomeUnknownError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "VideoSubmissionOutcomeUnknownError";
    }
}

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string, idempotencyKey?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
		...generationProfileHeaders(config, config.model),
        ...(contentType ? { "Content-Type": contentType } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    };
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    let task = options?.existingTask?.id ? options.existingTask : await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    let resumableGrokTask = isResumableGrokTask(task);
    let terminalTaskRetries = 0;
    if (!options?.existingTask?.id && resumableGrokTask) await options?.onTaskCreated?.(task);
    for (let attempt = 0; ; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") {
            if (terminalTaskRetries < GROK_TERMINAL_TASK_MAX_RETRIES && shouldRetryVideoTaskFailure(task, state.error)) {
                terminalTaskRetries += 1;
                task = await recreateVideoTaskAfterFailure(config, prompt, references, videoReferences, audioReferences, task, state.error, options?.signal);
                resumableGrokTask = isResumableGrokTask(task);
                await options?.onTaskCreated?.(task);
                continue;
            }
            const retrySummary = terminalTaskRetries ? `已自动重新创建 ${terminalTaskRetries} 次任务，仍未成功。` : "";
            throw new VideoGenerationTaskFailedError(`${state.error}${retrySummary}`);
        }
        if (!resumableGrokTask && attempt === 119) throw new Error(`${task.provider === "seedance" ? "Seedance " : ""}视频生成超时，请稍后重试`);
        await delay(task.provider === "seedance" ? 5000 : 2500, options?.signal);
    }
}

export function shouldRetryVideoTaskFailure(task: VideoGenerationTask, error: string) {
    return isResumableGrokTask(task) && /job\s+failed\W*please\s+try\s+again\s+later/i.test(error);
}

export async function recreateVideoTaskAfterFailure(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], task: VideoGenerationTask, error: string, signal?: AbortSignal) {
    if (!shouldRetryVideoTaskFailure(task, error)) throw new VideoGenerationTaskFailedError(error);
    await delay(GROK_TERMINAL_TASK_RETRY_DELAY_MS, signal);
    return createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences);
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const preparedTask = options?.existingTask && !options.existingTask.id ? options.existingTask : undefined;
    const selectedModel = (preparedTask?.model || config.model || config.videoModel).trim();
    const requestConfig = preparedTask ? resolveVideoTaskRequestConfig(config, preparedTask) : resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考素材");
    }
    if (isGrokVideoModel(requestConfig.model)) {
        return createGrokVideoTask(requestConfig, selectedModel, prompt, references, preparedTask || prepareGrokVideoTask(requestConfig, selectedModel), options);
    }
    if (isChatCompatibleVideoModel(requestConfig.model)) {
        return createChatVideoTask(requestConfig, selectedModel, prompt, references, options);
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (!task.id) throw new Error("视频任务尚未获得公开任务 ID");
    const requestConfig = resolveVideoTaskRequestConfig(config, task);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "chat") return task.result ? { status: "completed", result: task.result } : { status: "failed", error: "视频接口没有返回可播放的视频" };
    return task.provider === "seedance" ? pollSeedanceTask(requestConfig, task, options) : pollOpenAIVideoTask(requestConfig, task, options);
}

export function prepareVideoGenerationTask(config: AiConfig, prompt?: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = []): VideoGenerationTask {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (!isGrokVideoModel(requestConfig.model)) throw new Error("当前模型不支持可恢复的视频幂等提交");
    if (videoReferences.length || audioReferences.length) throw new Error("当前 Grok 视频接口不支持参考视频或参考音频");
    if (prompt !== undefined) {
        buildGrokVideoCreateFields({
            model: requestConfig.model,
            prompt,
            seconds: requestConfig.videoSeconds,
            size: requestConfig.size,
            resolution: requestConfig.vquality,
            imageCount: references.length,
        });
    }
    return prepareGrokVideoTask(requestConfig, selectedModel);
}

export function assertVideoGenerationTaskConfig(config: AiConfig, task: VideoGenerationTask) {
    const requestConfig = resolveVideoTaskRequestConfig(config, task);
    assertVideoConfig(requestConfig, requestConfig.model);
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob instanceof Blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model, ...taskOrigin(config, model) };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function createGrokVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], preparedTask: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTask> {
    const fields = buildGrokVideoCreateFields({
        model: modelOptionName(model),
        prompt,
        seconds: config.videoSeconds,
        size: config.size,
        resolution: config.vquality,
        imageCount: references.length,
    });
    const directImages = references.map(readDirectImageSource);
    const hasDirectImages = directImages.some(Boolean);
    const hasLocalImages = directImages.some((image) => !image);
    let body: FormData | (typeof fields & { images?: string[] });
    let contentType: string | undefined;

    if (!hasLocalImages) {
        body = { ...fields, ...(directImages.length ? { images: directImages as string[] } : {}) };
        contentType = "application/json";
    } else if (hasDirectImages) {
        const images = await Promise.all(
            references.map(async (image, index) => {
                if (directImages[index]) return directImages[index]!;
                const dataUrl = await imageToDataUrl(image);
                if (!dataUrl?.startsWith("data:")) throw new Error(`第 ${index + 1} 张参考图读取失败，请重新上传`);
                return dataUrl;
            }),
        );
        body = { ...fields, images };
        contentType = "application/json";
    } else {
        const form = new FormData();
        Object.entries(fields).forEach(([key, value]) => form.append(key, String(value)));
        for (let index = 0; index < references.length; index += 1) {
            const directImage = directImages[index];
            if (directImage) {
                form.append("images", directImage);
                continue;
            }
            const dataUrl = await imageToDataUrl(references[index]);
            if (!dataUrl?.startsWith("data:")) throw new Error(`第 ${index + 1} 张参考图读取失败，请重新上传`);
            form.append("images", dataUrlToFile({ ...references[index], dataUrl }));
        }
        body = form;
    }

    for (let attempt = 0; ; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
            // Once this POST is on the wire it may create a paid task. Do not bind
            // it to the UI polling signal and never retry ambiguous failures.
            const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config, contentType, preparedTask.idempotencyKey) })).data);
            if (!created.id) throw new Error("视频接口没有返回任务 ID");
            return { ...preparedTask, id: created.id };
        } catch (error) {
            if (!isRetryableGrokSubmitError(error) || attempt >= GROK_SUBMIT_MAX_RETRIES) throw new Error(grokSubmissionFailureMessage(error, attempt));
            await delay(readRetryAfterMs(error), options?.signal);
        }
    }
}

async function createChatVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const seconds = normalizeVideoSeconds(config.videoSeconds);
    const duration = Number(seconds);
    const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [];
    const images = await Promise.all(references.slice(0, 7).map((image) => imageToDataUrl(image)));
    const imageItems = images.filter(Boolean).map((url) => ({ type: "image_url" as const, image_url: { url } }));
    content.push({ type: "text", text: withVideoDurationPrompt(prompt, seconds) }, ...imageItems);
    const payload = { model: modelName, messages: [{ role: "user", content }], seconds: duration, duration };

    try {
        const response = (await axios.post<ChatVideoResponse>(aiApiUrl(config, "/chat/completions"), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data;
        const url = extractChatVideoUrl(response);
        if (!url) throw new Error("视频接口没有返回视频 URL");
        return { id: `chat-video-${Date.now()}`, provider: "chat", model, ...taskOrigin(config, model), result: { url: proxiedVideoUrl(url), mimeType: "video/mp4" } };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频生成失败"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        if (!task.id) throw new Error("视频任务尚未获得公开任务 ID");
        const taskID = encodeURIComponent(task.id);
        const payload = (await axios.get<ApiVideoResponse | ChatVideoResponse>(aiApiUrl(config, `/videos/${taskID}`), { headers: aiHeaders(config), signal: options?.signal })).data;
        const video = unwrapVideoResponse(payload as ApiVideoResponse);
        const status = String(video.status || "")
            .trim()
            .toLowerCase();
        const directUrl = videoResultUrl(video) || extractVideoUrl(collectResponseText(video.metadata).join("\n"));
        if (["completed", "succeeded", "success"].includes(status)) {
            try {
                const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${taskID}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
                await assertVideoBlob(content.data);
                return { status: "completed", result: { blob: content.data, mimeType: content.data.type || "video/mp4" } };
            } catch (error) {
                if (isAbortError(error, options?.signal)) throw error;
                if (directUrl) return { status: "completed", result: await videoResultFromUrl(proxiedVideoUrl(directUrl), options) };
                if (isRetryablePollError(error)) return { status: "pending" };
                throw error;
            }
        }
        if (["failed", "cancelled", "canceled", "expired"].includes(status)) {
            if (video.error?.code === "submission_outcome_unknown") throw new VideoSubmissionOutcomeUnknownError(video.error.message || "视频提交结果仍在确认中，请使用原任务继续重试");
            return { status: "failed", error: videoTaskFailureMessage(status, video.error) };
        }
        if (!status && directUrl) return { status: "completed", result: await videoResultFromUrl(proxiedVideoUrl(directUrl), options) };
        return { status: "pending" };
    } catch (error) {
        if (error instanceof VideoSubmissionOutcomeUnknownError) throw error;
        if (!isAbortError(error, options?.signal) && isRetryablePollError(error)) return { status: "pending" };
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    assertSeedanceVideoReferences(videoReferences);
    assertSeedanceAudioReferences(audioReferences);
    const content = await buildSeedanceContent(config, prompt, references, videoReferences, audioReferences);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const payload = {
        model: modelOptionName(model),
        content,
        ratio: normalizeSeedanceRatio(config.size),
        resolution: normalizeSeedanceResolution(config.vquality, modelOptionName(model)),
        duration: normalizeSeedanceDuration(config.videoSeconds),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };

    try {
        const created = unwrapSeedanceTask((await axios.post<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config), payload, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model, ...taskOrigin(config, model) };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask((await axios.get<ApiEnvelope<SeedanceTask>>(seedanceApiUrl(config, task.id), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(state);
        if (url) return { status: "completed", result: await videoResultFromUrl(proxiedVideoUrl(url), options) };
        if (state.status === "succeeded" || state.status === "completed") return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: readApiErrorMessage(state.error?.message) || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(config: AiConfig, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    for (const image of references.slice(0, SEEDANCE_REFERENCE_LIMITS.images)) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: "reference_image" });
    }
    for (const video of videoReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, SEEDANCE_REFERENCE_LIMITS.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、素材 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、素材 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        if (error instanceof InvalidVideoContentError || (axios.isAxiosError(error) && error.response)) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

function prepareGrokVideoTask(config: AiConfig, model: string): VideoGenerationTask {
    return {
        provider: "openai",
        model,
        ...taskOrigin(config, model),
        idempotencyKey: globalThis.crypto.randomUUID(),
    };
}

function taskOrigin(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return { channelId: channel.id, baseUrl: normalizeTaskBaseUrl(channel.baseUrl) };
}

function resolveVideoTaskRequestConfig(config: AiConfig, task: VideoGenerationTask): AiConfig {
    const decoded = decodeChannelModel(task.model);
    if (decoded && decoded.channelId !== task.channelId) throw new Error("视频任务保存的模型渠道与原渠道不一致");
    const channel = config.channels.find((item) => item.id === task.channelId);
    if (!channel) throw new Error("视频任务的原渠道已不存在，无法继续查询");
    if (normalizeTaskBaseUrl(channel.baseUrl) !== normalizeTaskBaseUrl(task.baseUrl)) throw new Error("视频任务原渠道的 Base URL 已变化，无法安全继续查询");
    return {
        ...config,
        model: modelOptionName(task.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeTaskBaseUrl(value: string) {
    return value.trim().replace(/\/+$/, "");
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function withVideoDurationPrompt(prompt: string, seconds: string) {
    return `${prompt.trim()}\n\n视频时长：${seconds} 秒。请按该时长生成视频。`;
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function readDirectImageSource(image: ReferenceImage) {
    return [image.url, image.dataUrl].map((value) => value?.trim() || "").find((value) => /^https?:\/\//i.test(value) || /^data:image\//i.test(value));
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function extractChatVideoUrl(payload: ChatVideoResponse) {
    if (payload.code && payload.code !== 0) throw new Error(payload.msg || "请求失败");
    if (payload.error?.message) throw new Error(payload.error.message);
    return extractVideoUrl(collectResponseText(payload).join("\n"));
}

function extractVideoUrl(text: string) {
    const decoded = decodeHtmlEntities(text);
    const src = decoded.match(/<video\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1] || decoded.match(/\bsrc=["']([^"']+)["']/i)?.[1];
    if (src) return src.trim();
    return decoded.match(/https?:\/\/[^\s"'<>`]+/i)?.[0]?.trim() || "";
}

function collectResponseText(value: unknown, texts: string[] = []) {
    if (typeof value === "string") {
        texts.push(value);
        return texts;
    }
    if (!value || typeof value !== "object") return texts;
    if (Array.isArray(value)) {
        value.forEach((item) => collectResponseText(item, texts));
        return texts;
    }
    Object.values(value).forEach((item) => collectResponseText(item, texts));
    return texts;
}

function decodeHtmlEntities(value: string) {
    return value
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function isChatCompatibleVideoModel(model: string) {
    const value = model.toLowerCase();
    return value.includes("firefly-veo");
}

function isResumableGrokTask(task: VideoGenerationTask) {
    return task.provider === "openai" && isGrokVideoModel(modelOptionName(task.model));
}

function proxiedVideoUrl(url: string) {
    try {
        const parsed = new URL(url);
        if (parsed.protocol === "http:" && parsed.host === "164.37.102.138:8001" && parsed.pathname === "/v1/files/video") {
            return `/api/video-proxy?url=${encodeURIComponent(url)}`;
        }
    } catch {
        return url;
    }
    return url;
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function isAbortError(error: unknown, signal?: AbortSignal) {
    return Boolean(signal?.aborted || axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError"));
}

function isRetryablePollError(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    if (!error.response) return true;
    const status = error.response.status;
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableGrokSubmitError(error: unknown) {
    if (!axios.isAxiosError(error)) return true;
    if (!error.response) return true;
    const status = error.response.status;
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function grokSubmissionFailureMessage(error: unknown, retries: number) {
    const reason = readAxiosError(error, "Grok 视频任务创建失败");
    const retrySummary = retries > 0 ? `已使用同一任务键自动重试 ${retries} 次，仍未创建任务。` : "任务未被创建。";
    return `${reason}。${retrySummary}${videoFailureGuidance(error)}`;
}

function videoFailureGuidance(error: unknown) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    if (status === 400 || status === 422) return "请检查提示词、参考图数量、时长和分辨率是否符合当前视频模型的限制。";
    if (status === 401 || status === 403) return "请检查 API Key、分组和该模型的调用权限。";
    if (status === 413) return "请压缩或减少参考素材后再试。";
    if (status === 415) return "请使用模型支持的图片或视频素材格式。";
    if (status === 404) return "任务可能已过期或原渠道已变更，请创建一个新任务。";
    if (status === 429) return "上游正在限流或额度不足，请稍后再试。";
    if (status && status >= 500) return "上游服务暂时不可用，稍后可重新提交。";
    if (!status && axios.isAxiosError(error)) return "网络连接未完成；已保留同一任务键，稍后重试不会重复计费。";
    return "请根据上方原因调整请求后再试。";
}

function videoTaskFailureMessage(status: string, error?: { code?: string; message?: string } | null) {
    const message = readApiErrorMessage(error?.message) || "上游没有提供更多原因";
    const code = error?.code?.trim();
    const prefix = status === "expired" ? "视频任务已过期，通常是排队或处理超过上游允许时间" : status === "cancelled" || status === "canceled" ? "视频任务已被取消" : "上游明确拒绝了该视频任务";
    return `${prefix}：${message}${code ? `（错误代码：${code}）` : ""}。请根据上游原因调整请求后再试。`;
}

function readRetryAfterMs(error: unknown) {
    if (!axios.isAxiosError(error)) return GROK_SUBMIT_DEFAULT_RETRY_MS;
    const headers = error.response?.headers as { get?: (name: string) => unknown; [key: string]: unknown } | undefined;
    const raw = headers?.get?.("retry-after") ?? headers?.["retry-after"];
    const value = String(raw ?? "").trim();
    if (!value) return GROK_SUBMIT_DEFAULT_RETRY_MS;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(GROK_SUBMIT_MAX_RETRY_MS, seconds * 1000);
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return Math.min(GROK_SUBMIT_MAX_RETRY_MS, Math.max(0, timestamp - Date.now()));
    return GROK_SUBMIT_DEFAULT_RETRY_MS;
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 400 || status === 422) return `${fallback}：请求参数或模型能力不匹配（HTTP ${status}）`;
    if (status === 404) return `${fallback}：任务不存在或已过期（HTTP 404）`;
    if (status === 408 || status === 425) return `${fallback}：上游尚未准备完成（HTTP ${status}）`;
    if (status === 409) return `${fallback}：同一任务仍在处理中（HTTP 409）`;
    if (status === 413) return `${fallback}：参考素材过大（HTTP 413）`;
    if (status === 415) return `${fallback}：参考素材格式不受支持（HTTP 415）`;
    if (status && status >= 500) return `${fallback}：上游服务暂时不可用（HTTP ${status}）`;
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

class InvalidVideoContentError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "InvalidVideoContentError";
    }
}

async function assertVideoBlob(blob: Blob) {
    const signature = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const isMp4 = signature.length >= 8 && signature[4] === 0x66 && signature[5] === 0x74 && signature[6] === 0x79 && signature[7] === 0x70;
    const isWebM = signature.length >= 4 && signature[0] === 0x1a && signature[1] === 0x45 && signature[2] === 0xdf && signature[3] === 0xa3;
    if (isMp4 || isWebM) return;

    const preview = await blob.slice(0, 64 * 1024).text();
    try {
        const payload = JSON.parse(preview) as { code?: number; msg?: string; message?: string; error?: { message?: string } | string };
        throw new InvalidVideoContentError(readApiErrorMessage(payload) || "视频下载返回了非视频内容");
    } catch (error) {
        if (error instanceof InvalidVideoContentError) throw error;
        throw new InvalidVideoContentError("视频下载返回了非视频内容");
    }
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function videoResultUrl(payload: VideoResponse | SeedanceTask) {
    return [payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)));
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            return readApiErrorMessage(JSON.parse(value)) || value;
        } catch {
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: { message?: unknown } | unknown };
    const nestedError = payload.error && typeof payload.error === "object" ? (payload.error as { message?: unknown }).message : payload.error;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(nestedError);
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}

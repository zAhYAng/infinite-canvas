import axios from "axios";

import { buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig, type ModelChannel } from "@/stores/use-config-store";

export type GenerationOperationId = "images.generate" | "images.edit" | "videos.create";

export type GenerationProfileLimits = {
    prompt_max_chars?: number;
    min_images?: number;
    max_images?: number;
    require_exactly_one_image?: boolean;
    min_seconds?: number;
    max_seconds?: number;
    max_seconds_with_multiple_images?: number;
    resolutions?: string[];
    forced_resolution?: string;
    aspect_ratios?: string[];
    min_image_count?: number;
    max_image_count?: number;
};

export type GenerationOperation = {
    id: GenerationOperationId;
    method: "POST";
    path: string;
    encoding: "json" | "multipart" | "json_or_multipart";
    required_fields?: string[];
    fields?: string[];
    limits: GenerationProfileLimits;
    async: boolean;
};

export type GenerationProfile = {
    version: number;
    operations: GenerationOperation[];
};

export type CanvasModelCapability = {
    id: string;
    model: string;
    channel: string;
    known: boolean;
    profile_id?: string;
    profile?: GenerationProfile;
    reason?: string;
};

type CapabilityResponse = {
    success: boolean;
    message?: string;
    data?: { version: number; data: CanvasModelCapability[] };
};

const capabilityCache = new Map<string, Map<string, CanvasModelCapability>>();

function cacheKey(baseUrl: string, apiKey: string) {
    return `${baseUrl.trim().replace(/\/+$/, "")}\n${apiKey}`;
}

export async function fetchCanvasCapabilities(channel: Pick<ModelChannel, "baseUrl" | "apiKey">) {
    const response = await axios.get<CapabilityResponse>(buildApiUrl(channel.baseUrl, "/canvas/capabilities"), {
        headers: { Authorization: `Bearer ${channel.apiKey}` },
        timeout: 15_000,
    });
    if (!response.data.success || !response.data.data) throw new Error(response.data.message || "读取模型能力失败");
    cacheCanvasCapabilities(channel, response.data.data.data);
    return response.data.data.data;
}

export function cacheCanvasCapabilities(channel: Pick<ModelChannel, "baseUrl" | "apiKey">, capabilities: CanvasModelCapability[]) {
    capabilityCache.set(cacheKey(channel.baseUrl, channel.apiKey), new Map(capabilities.map((item) => [item.model, item])));
}

export async function preloadCanvasCapabilities(channels: Pick<ModelChannel, "baseUrl" | "apiKey">[]) {
    await Promise.allSettled(channels.filter((channel) => channel.baseUrl.trim() && channel.apiKey.trim()).map(fetchCanvasCapabilities));
}

export function getCachedCanvasCapability(config: AiConfig, model: string) {
    const requestConfig = resolveModelRequestConfig(config, model);
    return capabilityCache.get(cacheKey(requestConfig.baseUrl, requestConfig.apiKey))?.get(modelOptionName(model));
}

export function getCachedGenerationProfileId(config: AiConfig, model: string) {
    const capability = getCachedCanvasCapability(config, model);
    return capability?.known ? capability.profile_id : undefined;
}

export function generationProfileHeaders(config: AiConfig, model: string) {
    const profileId = getCachedGenerationProfileId(config, model);
    return profileId ? { "X-NewAPI-Generation-Profile": profileId } : {};
}

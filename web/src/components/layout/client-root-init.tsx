"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { App } from "antd";

import { createModelChannel, encodeChannelModel, useConfigStore, type ModelCapability } from "@/stores/use-config-store";
import { IS_V2API_MANAGED, V2API_BASE_URL } from "@/constant/env";
import { exchangeCanvasHandoff } from "@/services/api/handoff";

const capabilityPatterns: Record<ModelCapability, RegExp> = {
    image: /image|gpt-image|dall-e|dalle|imagen|flux|sdxl|stable-diffusion|midjourney/i,
    video: /video|sora|veo|kling|wan|hailuo|seedance/i,
    audio: /audio|tts|speech|voice|music|sound/i,
    text: /$^/,
};

function modelCapability(model: string): ModelCapability {
    if (capabilityPatterns.image.test(model)) return "image";
    if (capabilityPatterns.video.test(model)) return "video";
    if (capabilityPatterns.audio.test(model)) return "audio";
    return "text";
}

function encodedModels(channelId: string, models: string[], capability?: ModelCapability) {
    return models.filter((model) => !capability || modelCapability(model) === capability).map((model) => encodeChannelModel(channelId, model));
}

function firstEncodedModel(channelId: string, models: string[], capability: ModelCapability) {
    return encodedModels(channelId, models, capability)[0] || "";
}

function isV2ApiBaseUrl(value: string) {
    const expected = V2API_BASE_URL.replace(/\/+$/, "").toLowerCase();
    return value.trim().replace(/\/+$/, "").toLowerCase() === expected;
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);

    useEffect(() => {
        if (handledConfigParams.current) return;
        const searchParams = new URLSearchParams(window.location.search);
        const handoff = searchParams.get("handoff");
        if (handoff) {
            handledConfigParams.current = true;
            searchParams.delete("handoff");
            window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
            void exchangeCanvasHandoff(handoff)
                .then((handoffConfig) => {
                    const channel = {
                        ...handoffConfig.channel,
                        apiFormat: handoffConfig.apiFormat,
                    };
                    const models = handoffConfig.models || channel.models || [];
                    const allModels = encodedModels(channel.id, models);
                    updateConfig("channels", [channel]);
                    updateConfig("baseUrl", handoffConfig.baseUrl);
                    updateConfig("apiKey", handoffConfig.apiKey);
                    updateConfig("apiFormat", handoffConfig.apiFormat);
                    updateConfig("models", allModels);
                    updateConfig("imageModels", encodedModels(channel.id, models, "image"));
                    updateConfig("videoModels", encodedModels(channel.id, models, "video"));
                    updateConfig("audioModels", encodedModels(channel.id, models, "audio"));
                    updateConfig("textModels", encodedModels(channel.id, models, "text"));
                    updateConfig("model", allModels[0] || "");
                    updateConfig("imageModel", firstEncodedModel(channel.id, models, "image"));
                    updateConfig("videoModel", firstEncodedModel(channel.id, models, "video"));
                    updateConfig("audioModel", firstEncodedModel(channel.id, models, "audio"));
                    updateConfig("textModel", firstEncodedModel(channel.id, models, "text"));
                    message.success("已连接 v2api 图片工作台");
                })
                .catch((error) => {
                    message.error(error instanceof Error ? error.message : "画布登录失败，请从 v2api 重新进入");
                });
            return;
        }
        if (IS_V2API_MANAGED) {
            const hasExternalConfig = config.channels.some((channel) => channel.baseUrl && !isV2ApiBaseUrl(channel.baseUrl));
            if (hasExternalConfig) {
                updateConfig("channels", []);
                updateConfig("baseUrl", V2API_BASE_URL);
                updateConfig("apiKey", "");
                updateConfig("models", []);
                updateConfig("imageModels", []);
                updateConfig("videoModels", []);
                updateConfig("audioModels", []);
                updateConfig("textModels", []);
                updateConfig("model", "");
                updateConfig("imageModel", "");
                updateConfig("videoModel", "");
                updateConfig("audioModel", "");
                updateConfig("textModel", "");
            }
            return;
        }
        const baseUrl = searchParams.get("baseUrl") || searchParams.get("baseurl");
        const apiKey = searchParams.get("apiKey") || searchParams.get("apikey");
        if (!baseUrl && !apiKey) return;
        handledConfigParams.current = true;
        searchParams.delete("baseUrl");
        searchParams.delete("baseurl");
        searchParams.delete("apiKey");
        searchParams.delete("apikey");
        window.history.replaceState(null, "", `${window.location.pathname}${searchParams.size ? `?${searchParams}` : ""}${window.location.hash}`);
        const firstChannel = config.channels[0];
        updateConfig(
            "channels",
            firstChannel
                ? config.channels.map((channel, index) =>
                      index === 0
                          ? {
                                ...channel,
                                ...(baseUrl ? { baseUrl } : {}),
                                ...(apiKey ? { apiKey } : {}),
                            }
                          : channel,
                  )
                : [createModelChannel({ id: "default", name: "默认渠道", baseUrl: baseUrl || undefined, apiKey: apiKey || "" })],
        );
        if (baseUrl) updateConfig("baseUrl", baseUrl);
        if (apiKey) updateConfig("apiKey", apiKey);
        openConfigDialog(false);
        message.success("已导入本地直连配置");
    }, [config.channels, message, openConfigDialog, updateConfig]);

    return <>{children}</>;
}

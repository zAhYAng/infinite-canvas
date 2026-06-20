"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { App, Button } from "antd";

import { createModelChannel, encodeChannelModel, useConfigStore, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
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

function encodedModelsFromChannels(channels: ReturnType<typeof createModelChannel>[], capability?: ModelCapability) {
    return channels.flatMap((channel) => encodedModels(channel.id, channel.models, capability));
}

function firstEncodedModel(channels: ReturnType<typeof createModelChannel>[], capability: ModelCapability) {
    return encodedModelsFromChannels(channels, capability)[0] || "";
}

function isV2ApiBaseUrl(value: string) {
    const expected = V2API_BASE_URL.replace(/\/+$/, "").toLowerCase();
    return value.trim().replace(/\/+$/, "").toLowerCase() === expected;
}

function hasManagedV2ApiConfig(config: AiConfig) {
    return config.channels.some((channel) => isV2ApiBaseUrl(channel.baseUrl) && channel.apiKey.trim() && channel.models.length);
}

function v2ApiAuthUrl(path: "/sign-in" | "/sign-up") {
    const baseUrl = V2API_BASE_URL.replace(/\/+$/, "");
    return `${baseUrl}${path}?redirect=${encodeURIComponent("/canvas-workspace")}`;
}

export function ClientRootInit({ children }: { children: ReactNode }) {
    const { message } = App.useApp();
    const handledConfigParams = useRef(false);
    const [showV2ApiGuide, setShowV2ApiGuide] = useState(false);
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
                    const rawChannels = handoffConfig.channels?.length ? handoffConfig.channels : [handoffConfig.channel];
                    const channels = rawChannels.map((channel, index) =>
                        createModelChannel({
                            id: channel.id || `v2api-${index + 1}`,
                            name: channel.name || "v2api",
                            baseUrl: channel.baseUrl || handoffConfig.baseUrl,
                            apiKey: channel.apiKey || handoffConfig.apiKey,
                            apiFormat: channel.apiFormat || handoffConfig.apiFormat,
                            models: channel.models || [],
                        }),
                    );
                    const firstChannel = channels[0];
                    const allModels = encodedModelsFromChannels(channels);
                    updateConfig("channels", channels);
                    updateConfig("baseUrl", firstChannel?.baseUrl || handoffConfig.baseUrl);
                    updateConfig("apiKey", firstChannel?.apiKey || handoffConfig.apiKey);
                    updateConfig("apiFormat", handoffConfig.apiFormat);
                    updateConfig("models", allModels);
                    updateConfig("imageModels", encodedModelsFromChannels(channels, "image"));
                    updateConfig("videoModels", encodedModelsFromChannels(channels, "video"));
                    updateConfig("audioModels", encodedModelsFromChannels(channels, "audio"));
                    updateConfig("textModels", encodedModelsFromChannels(channels, "text"));
                    updateConfig("model", allModels[0] || "");
                    updateConfig("imageModel", firstEncodedModel(channels, "image"));
                    updateConfig("videoModel", firstEncodedModel(channels, "video"));
                    updateConfig("audioModel", firstEncodedModel(channels, "audio"));
                    updateConfig("textModel", firstEncodedModel(channels, "text"));
                    setShowV2ApiGuide(false);
                    message.success("已连接 v2api 无限画布");
                })
                .catch((error) => {
                    setShowV2ApiGuide(true);
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
            setShowV2ApiGuide(!hasManagedV2ApiConfig(config));
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

    if (showV2ApiGuide) return <V2ApiManagedGuide />;

    return <>{children}</>;
}

function V2ApiManagedGuide() {
    return (
        <main className="flex min-h-dvh items-center justify-center bg-background px-4 text-foreground">
            <section className="w-full max-w-md rounded-lg border border-border/70 bg-card p-6 text-center shadow-sm">
                <div className="text-lg font-semibold">请从 v2api 进入无限画布</div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                    当前站点由 v2api 托管模型配置，不能在画布内手动添加渠道。请先登录或注册 v2api，再从主站的“无限画布”入口进入。
                </p>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    <Button type="primary" href={v2ApiAuthUrl("/sign-in")}>
                        登录 v2api
                    </Button>
                    <Button href={v2ApiAuthUrl("/sign-up")}>注册账号</Button>
                </div>
            </section>
        </main>
    );
}

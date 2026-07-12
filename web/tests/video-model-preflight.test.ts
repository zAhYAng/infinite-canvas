import { describe, expect, test } from "bun:test";

import { preflightGeneration } from "../src/app/(user)/canvas/utils/generation-preflight";
import { defaultConfig, selectableModelsByCapability, type AiConfig } from "../src/stores/use-config-store";

const channel = {
    id: "video",
    name: "Video",
    baseUrl: "https://v2api.top",
    apiKey: "test-key",
    apiFormat: "openai" as const,
    models: ["grok-imagine-video-1.5-fast", "grok-4.20-reasoning", "grok-4-1-fast-non-reasoning"],
};

const config: AiConfig = {
    ...defaultConfig,
    channels: [channel],
    models: channel.models.map((model) => `video::${model}`),
    videoModels: channel.models.map((model) => `video::${model}`),
    model: "video::grok-imagine-video-1.5-fast",
    videoModel: "video::grok-imagine-video-1.5-fast",
    videoSeconds: "3",
    vquality: "720",
};

describe("video model selection and preflight", () => {
    test("keeps only featured text models in the requested display order", () => {
        const textModels = ["grok-4.5", "gpt-4.1", "claude-opus-4-8", "gpt-5.6-luna", "gpt-5.5", "claude-sonnet-5", "gpt-5.6-sol", "gpt-5.6-terra"];
        const textConfig: AiConfig = {
            ...config,
            channels: [{ ...channel, models: textModels }],
            models: textModels.map((model) => `video::${model}`),
            textModels: textModels.map((model) => `video::${model}`),
        };

        expect(selectableModelsByCapability(textConfig, "text")).toEqual([
            "video::gpt-5.5",
            "video::gpt-5.6-terra",
            "video::gpt-5.6-sol",
            "video::gpt-5.6-luna",
            "video::claude-sonnet-5",
            "video::claude-opus-4-8",
            "video::grok-4.5",
        ]);
    });

    test("removes text-only Grok models from an accidentally mixed video list", () => {
        expect(selectableModelsByCapability(config, "video")).toEqual(["video::grok-imagine-video-1.5-fast"]);
    });

    test("blocks an invalid known Grok duration before capability data is loaded", () => {
        const plan = preflightGeneration({ config, mode: "video", prompt: "tracking shot" });

        expect(plan.strict).toBe(true);
        expect(plan.valid).toBe(false);
        expect(plan.diagnostics).toContainEqual(expect.objectContaining({ field: "seconds" }));
    });

    test("blocks too many reference images before capability data is loaded", () => {
        const plan = preflightGeneration({ config: { ...config, videoSeconds: "6" }, mode: "video", prompt: "tracking shot", referenceCount: 8 });

        expect(plan.strict).toBe(true);
        expect(plan.valid).toBe(false);
        expect(plan.diagnostics).toContainEqual(expect.objectContaining({ field: "references" }));
    });

    test("blocks a stale text-only Grok selection from creating a video", () => {
        const plan = preflightGeneration({ config: { ...config, model: "video::grok-4-1-fast-non-reasoning", videoModel: "video::grok-4-1-fast-non-reasoning", videoSeconds: "6" }, mode: "video", prompt: "tracking shot" });

        expect(plan.strict).toBe(true);
        expect(plan.valid).toBe(false);
        expect(plan.diagnostics).toContainEqual(expect.objectContaining({ field: "model" }));
    });
});

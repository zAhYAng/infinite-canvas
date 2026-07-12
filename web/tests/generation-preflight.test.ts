import { describe, expect, test } from "bun:test";

import { preflightGeneration } from "../src/app/(user)/canvas/utils/generation-preflight";
import { cacheCanvasCapabilities } from "../src/services/api/canvas-capabilities";
import { defaultConfig, type AiConfig } from "../src/stores/use-config-store";

const channel = { id: "video", name: "Video", baseUrl: "https://v2api.top", apiKey: "test-key", apiFormat: "openai" as const, models: ["grok-imagine-video-1.5"] };
const config: AiConfig = { ...defaultConfig, channels: [channel], model: "video::grok-imagine-video-1.5", videoModel: "video::grok-imagine-video-1.5", videoSeconds: "6", vquality: "720" };

cacheCanvasCapabilities(channel, [
    {
        id: "grok-imagine-video-1.5",
        model: "grok-imagine-video-1.5",
        channel: "video",
        known: true,
        profile_id: "gp_test",
        profile: {
            version: 1,
            operations: [
                {
                    id: "videos.create",
                    method: "POST",
                    path: "/v1/videos",
                    encoding: "json_or_multipart",
                    async: true,
                    required_fields: ["model", "prompt"],
                    limits: { min_images: 1, max_images: 1, require_exactly_one_image: true, min_seconds: 1, max_seconds: 15, resolutions: ["480p", "720p", "1080p"] },
                },
            ],
        },
    },
]);

describe("generation preflight", () => {
    test("blocks a one-image Grok model before submission", () => {
        const plan = preflightGeneration({ config, mode: "video", prompt: "animate", references: [] });
        expect(plan.valid).toBe(false);
        expect(plan.strict).toBe(true);
        expect(plan.diagnostics[0]?.field).toBe("references");
    });

    test("keeps an unknown direct model in manual compatibility mode", () => {
        const plan = preflightGeneration({ config: { ...config, model: "video::custom-video" }, mode: "video", prompt: "animate" });
        expect(plan.valid).toBe(true);
        expect(plan.strict).toBe(false);
    });
});

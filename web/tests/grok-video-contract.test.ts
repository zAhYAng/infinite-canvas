import { describe, expect, test } from "bun:test";

import { buildGrokVideoCreateFields, isGrokVideoModel, normalizeGrokVideoAspectRatio } from "../src/services/api/grok-video-contract";

describe("Grok video request contract", () => {
    test("base model rejects unsupported persisted options instead of changing them", () => {
        expect(() =>
            buildGrokVideoCreateFields({
                model: "grok-imagine-video",
                prompt: "  sunrise over a city  ",
                seconds: "20",
                size: "720x1280",
                resolution: "1080",
                imageCount: 0,
            }),
        ).toThrow("支持 1-15 秒");
    });

    test("fast model rejects unsupported duration and resolution", () => {
        expect(() => buildGrokVideoCreateFields({ model: "grok-imagine-video-1.5-fast", prompt: "tracking shot", seconds: 3, size: "3:4", resolution: "1080p", imageCount: 7 })).toThrow("支持 6-30 秒");
        expect(() => buildGrokVideoCreateFields({ model: "grok-imagine-video-1.5-fast", prompt: "tracking shot", seconds: 6, size: "3:4", resolution: "1080p", imageCount: 7 })).toThrow("仅支持 480p、720p");
    });

    test("native 1.5 supports one reference image and 1080p", () => {
        const fields = buildGrokVideoCreateFields({
            model: "grok-imagine-video-1.5",
            prompt: "slow push in",
            seconds: 5,
            size: "16:9",
            resolution: "1080",
            imageCount: 1,
        });

        expect(fields.model).toBe("grok-imagine-video-1.5");
        expect(fields.resolution).toBe("1080p");
        expect(fields.size).toBe("1920x1080");
    });

    test("compatibility aliases stay public and preserve their resolution semantics", () => {
        const preview = buildGrokVideoCreateFields({ model: "grok-imagine-video-1.5-preview", prompt: "animate", seconds: 8, size: "1:1", resolution: "480", imageCount: 1 });
        const high = buildGrokVideoCreateFields({ model: "grok-imagine-video-1.5-1080p", prompt: "animate", seconds: 8, size: "1:1", resolution: "480", imageCount: 1 });

        expect(preview.model).toBe("grok-imagine-video-1.5-preview");
        expect(preview.resolution).toBe("480p");
        expect(high.model).toBe("grok-imagine-video-1.5-1080p");
        expect(high.resolution).toBe("1080p");
    });

    test("rejects requests that NewAPI would reject before creating a paid task", () => {
        expect(() => buildGrokVideoCreateFields({ model: "grok-imagine-video-1.5", prompt: "animate", seconds: 5, size: "16:9", resolution: "720", imageCount: 0 })).toThrow("需要且只能连接 1 张参考图");
        expect(() => buildGrokVideoCreateFields({ model: "grok-imagine-video", prompt: "animate", seconds: 15, size: "16:9", resolution: "720", imageCount: 2 })).toThrow("使用多张参考图时最长支持 10 秒");
        expect(() => buildGrokVideoCreateFields({ model: "grok-imagine-video-1.5-fast", prompt: "animate", seconds: 10, size: "16:9", resolution: "720", imageCount: 8 })).toThrow("最多支持 7 张参考图");
    });

    test("only recognizes the five asynchronous video models", () => {
        expect(isGrokVideoModel("grok-imagine-video-1.5-fast")).toBe(true);
        expect(isGrokVideoModel("grok-4-1-fast-non-reasoning")).toBe(false);
        expect(normalizeGrokVideoAspectRatio("1792x1024")).toBe("16:9");
    });
});

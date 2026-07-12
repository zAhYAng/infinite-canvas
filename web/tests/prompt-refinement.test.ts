import { describe, expect, test } from "bun:test";

import { buildPromptRefinementMessages, normalizeRefinedPrompt } from "../src/lib/prompt-refinement";

describe("prompt refinement", () => {
    test("asks image models for a directly usable prompt", () => {
        const messages = buildPromptRefinementMessages("image", "一只在窗边睡觉的猫");

        expect(messages[0].content).toContain("构图");
        expect(messages[0].content).toContain("只输出一段可直接提交");
        expect(messages[1]).toEqual({ role: "user", content: "一只在窗边睡觉的猫" });
    });

    test("keeps video prompt refinement focused on action and camera continuity", () => {
        const messages = buildPromptRefinementMessages("video", "机器人走过雨夜街道");

        expect(messages[0].content).toContain("主体动作");
        expect(messages[0].content).toContain("镜头运动");
    });

    test("removes an accidental markdown fence from the result", () => {
        expect(normalizeRefinedPrompt("```\n电影感街景\n``` ")).toBe("电影感街景");
    });
});

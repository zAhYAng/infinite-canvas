import type { AiTextMessage } from "@/services/api/image";

export type PromptRefinementMode = "image" | "video";

const REFINEMENT_INSTRUCTIONS: Record<PromptRefinementMode, string> = {
    image: "保留用户的主体、用途和风格意图，补足画面主体细节、构图、视角、光线、色彩、材质和氛围。没有明确给出的文字、品牌或人物特征不得擅自编造。",
    video: "保留用户的主体、用途和风格意图，补足主体动作、动作节奏、镜头语言、镜头运动、场景、光线、色彩和氛围。动作与镜头要连续、可执行，避免增加没有明确给出的文字、品牌或人物特征。",
};

export function buildPromptRefinementMessages(mode: PromptRefinementMode, prompt: string): AiTextMessage[] {
    return [
        {
            role: "system",
            content: `你是专业的${mode === "image" ? "AI 生图" : "AI 视频"}提示词编辑器。${REFINEMENT_INSTRUCTIONS[mode]}只输出一段可直接提交给生成模型的最终提示词，不要解释、标题、列表、Markdown 或引号。`,
        },
        { role: "user", content: prompt.trim() },
    ];
}

export function normalizeRefinedPrompt(value: string) {
    return value
        .trim()
        .replace(/^```[^\n]*\n?/, "")
        .replace(/\n?```$/, "")
        .trim();
}

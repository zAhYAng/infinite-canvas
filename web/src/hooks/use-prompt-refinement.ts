"use client";

import { useCallback, useState } from "react";
import { App } from "antd";

import { buildPromptRefinementMessages, normalizeRefinedPrompt, type PromptRefinementMode } from "@/lib/prompt-refinement";
import { requestImageQuestion } from "@/services/api/image";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

export function usePromptRefinement(mode: PromptRefinementMode, onRefined: (prompt: string) => void) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [refining, setRefining] = useState(false);

    const refinePrompt = useCallback(
        async (prompt: string) => {
            const source = prompt.trim();
            if (!source || refining) return;

            const model = effectiveConfig.textModel || effectiveConfig.model;
            const requestConfig = { ...effectiveConfig, model };
            if (!isAiConfigReady(requestConfig, model)) {
                message.warning("请先配置可用的文本模型");
                openConfigDialog(true);
                return;
            }

            setRefining(true);
            try {
                const answer = await requestImageQuestion(requestConfig, buildPromptRefinementMessages(mode, source), () => undefined);
                const refined = normalizeRefinedPrompt(answer);
                if (!refined || refined === "没有返回内容") throw new Error("文本模型没有返回可用的提示词");
                onRefined(refined);
                message.success("已润色提示词");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "提示词润色失败");
            } finally {
                setRefining(false);
            }
        },
        [effectiveConfig, isAiConfigReady, message, mode, onRefined, openConfigDialog, refining],
    );

    return { refinePrompt, refining };
}

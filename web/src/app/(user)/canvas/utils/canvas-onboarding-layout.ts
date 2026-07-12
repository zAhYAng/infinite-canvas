export type OnboardingRect = { left: number; top: number; width: number; height: number };
export type OnboardingViewport = { width: number; height: number };

const SAFE_MARGIN = 16;

export function onboardingCardPosition(step: "navigation" | "agent" | "model", target: OnboardingRect | null, card: { width: number; height: number }, viewport: OnboardingViewport) {
    const maxLeft = Math.max(SAFE_MARGIN, viewport.width - card.width - SAFE_MARGIN);
    const maxTop = Math.max(SAFE_MARGIN, viewport.height - card.height - SAFE_MARGIN);
    if (step === "navigation" || !target) {
        return {
            left: clamp((viewport.width - card.width) / 2, SAFE_MARGIN, maxLeft),
            top: clamp(viewport.height - card.height - 24, SAFE_MARGIN, maxTop),
        };
    }
    return {
        left: clamp(target.left + target.width - card.width, SAFE_MARGIN, maxLeft),
        top: clamp(target.top - card.height - SAFE_MARGIN, SAFE_MARGIN, maxTop),
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

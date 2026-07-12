import { expect, test } from "bun:test";

import { onboardingCardPosition } from "../src/app/(user)/canvas/utils/canvas-onboarding-layout";

test("places the Agent guide above its highlighted composer inside the viewport", () => {
    const position = onboardingCardPosition(
        "agent",
        { left: 748, top: 536, width: 516, height: 176 },
        { width: 420, height: 232 },
        { width: 1280, height: 720 },
    );

    expect(position.top + 232).toBeLessThanOrEqual(520);
    expect(position.left).toBeGreaterThanOrEqual(16);
    expect(position.left + 420).toBeLessThanOrEqual(1264);
});

test("keeps the Agent guide controls visible on a low mobile viewport", () => {
    const position = onboardingCardPosition(
        "agent",
        { left: 12, top: 526, width: 336, height: 150 },
        { width: 360, height: 286 },
        { width: 360, height: 640 },
    );

    expect(position.top).toBeGreaterThanOrEqual(16);
    expect(position.top + 286).toBeLessThanOrEqual(624);
    expect(position.left).toBe(16);
});

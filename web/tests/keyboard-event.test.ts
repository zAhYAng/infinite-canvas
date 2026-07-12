import { expect, test } from "bun:test";

import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";

type KeyboardEventLike = Parameters<typeof isPlainEnterKey>[0];

function enterEvent(overrides: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
    return { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, ...overrides };
}

test("plain Enter submits only outside IME composition", () => {
    expect(isPlainEnterKey(enterEvent())).toBe(true);
    expect(isPlainEnterKey(enterEvent({ shiftKey: true }))).toBe(false);
    expect(isPlainEnterKey(enterEvent({ nativeEvent: { isComposing: true } }))).toBe(false);
    expect(isPlainEnterKey(enterEvent({ nativeEvent: { keyCode: 229 } }))).toBe(false);
    expect(isImeComposing(enterEvent({ isComposing: true }))).toBe(true);
});

import { describe, expect, test } from "bun:test";

import { canvasVideoSubmissionLockName, type CanvasVideoSubmissionLockManager, withCanvasVideoSubmissionLock } from "../src/app/(user)/canvas/utils/canvas-video-submission-lock";

describe("canvas video submission locks", () => {
    test("fails closed when Web Locks are unavailable", async () => {
        let called = false;

        await expect(
            withCanvasVideoSubmissionLock(
                "project",
                "origin",
                () => {
                    called = true;
                },
                null,
            ),
        ).rejects.toThrow("Web Locks");
        expect(called).toBe(false);
    });

    test("serializes submissions for the same project and origin node", async () => {
        const manager = new TestLockManager();
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = withCanvasVideoSubmissionLock(
            "project/1",
            "node 1",
            async () => {
                events.push("first:start");
                await firstGate;
                events.push("first:end");
            },
            manager,
        );
        const second = withCanvasVideoSubmissionLock(
            "project/1",
            "node 1",
            async () => {
                events.push("second:start");
                events.push("second:end");
            },
            manager,
        );

        await Promise.resolve();
        expect(events).toEqual(["first:start"]);
        releaseFirst();
        await Promise.all([first, second]);
        expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
        expect(manager.names).toEqual([canvasVideoSubmissionLockName("project/1", "node 1"), canvasVideoSubmissionLockName("project/1", "node 1")]);
    });

    test("does not block a different origin node", async () => {
        const manager = new TestLockManager();
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = withCanvasVideoSubmissionLock(
            "project",
            "node-a",
            async () => {
                events.push("a:start");
                await firstGate;
                events.push("a:end");
            },
            manager,
        );
        const second = withCanvasVideoSubmissionLock(
            "project",
            "node-b",
            async () => {
                events.push("b:start");
                events.push("b:end");
            },
            manager,
        );

        await waitUntil(() => events.includes("b:end"));
        expect(events).toEqual(["a:start", "b:start", "b:end"]);
        releaseFirst();
        await Promise.all([first, second]);
    });

    test("lets a waiting tab reuse the durable task instead of creating another paid submission", async () => {
        const manager = new TestLockManager();
        let durableTask: { id?: string; idempotencyKey: string } | undefined;
        let createdKeys = 0;
        let submissions = 0;
        const runTab = () =>
            withCanvasVideoSubmissionLock(
                "project",
                "origin",
                async () => {
                    let task = durableTask;
                    if (!task) {
                        createdKeys += 1;
                        task = { idempotencyKey: `key-${createdKeys}` };
                        durableTask = task;
                    }
                    if (!task.id) {
                        submissions += 1;
                        task = { ...task, id: "task_public" };
                        durableTask = task;
                    }
                    return task;
                },
                manager,
            );

        const [first, second] = await Promise.all([runTab(), runTab()]);

        expect(createdKeys).toBe(1);
        expect(submissions).toBe(1);
        expect(first).toEqual(second);
        expect(first.idempotencyKey).toBe("key-1");
    });
});

class TestLockManager implements CanvasVideoSubmissionLockManager {
    readonly names: string[] = [];
    private tails = new Map<string, Promise<void>>();

    async request<T>(name: string, callback: () => Promise<T> | T): Promise<T> {
        this.names.push(name);
        const previous = this.tails.get(name) || Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>((resolve) => {
            release = resolve;
        });
        const tail = previous.then(() => current);
        this.tails.set(name, tail);
        await previous;
        try {
            return await callback();
        } finally {
            release();
            if (this.tails.get(name) === tail) this.tails.delete(name);
        }
    }
}

async function waitUntil(predicate: () => boolean) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error("condition was not reached");
}

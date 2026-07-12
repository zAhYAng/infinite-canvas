import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

type MockResponse = { data: unknown };
type PostHandler = (...args: unknown[]) => Promise<MockResponse>;
type GetHandler = (url: string, ...args: unknown[]) => Promise<MockResponse>;

const defaultPost: PostHandler = async () => ({ data: { id: "task_public", status: "queued" } });
const defaultGet: GetHandler = async (url) => {
    if (url.endsWith("/content")) return { data: new Blob([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])], { type: "video/mp4" }) };
    return { data: { id: "task_public", status: "completed", metadata: { url: "https://media.example/video.mp4" } } };
};
let postHandler = defaultPost;
let getHandler = defaultGet;
const post = mock((...args: unknown[]) => postHandler(...args));
const get = mock((url: string, ...args: unknown[]) => getHandler(url, ...args));

mock.module("axios", () => ({
    default: {
        post,
        get,
        isCancel: () => false,
        isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean } | null)?.isAxiosError),
    },
}));

mock.module("@/services/image-storage", () => ({
    imageToDataUrl: async (image: { dataUrl?: string }) => {
        const source = image.dataUrl || "";
        if (!source.startsWith("blob:")) return source;
        const blob = await (await fetch(source)).blob();
        return `data:${blob.type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`;
    },
}));

let createVideoGenerationTask: typeof import("../src/services/api/video").createVideoGenerationTask;
let pollVideoGenerationTask: typeof import("../src/services/api/video").pollVideoGenerationTask;
let prepareVideoGenerationTask: typeof import("../src/services/api/video").prepareVideoGenerationTask;
let requestVideoGeneration: typeof import("../src/services/api/video").requestVideoGeneration;
let VideoSubmissionOutcomeUnknownError: typeof import("../src/services/api/video").VideoSubmissionOutcomeUnknownError;
let defaultConfig: typeof import("../src/stores/use-config-store").defaultConfig;

beforeAll(async () => {
    ({ createVideoGenerationTask, pollVideoGenerationTask, prepareVideoGenerationTask, requestVideoGeneration, VideoSubmissionOutcomeUnknownError } = await import("../src/services/api/video"));
    ({ defaultConfig } = await import("../src/stores/use-config-store"));
});

beforeEach(() => {
    postHandler = defaultPost;
    getHandler = defaultGet;
    post.mockClear();
    get.mockClear();
});

describe("NewAPI Grok video flow", () => {
    test("submits a public image through /v1/videos without TTAPI credentials", async () => {
        const config = videoConfig("grok-imagine-video-1.5-preview");
        const task = await createVideoGenerationTask(config, "animate the subject", [
            {
                id: "image-1",
                name: "reference.png",
                type: "image/png",
                dataUrl: "",
                url: "https://images.example/reference.png",
            },
        ]);

        expect(task).toMatchObject({ id: "task_public", provider: "openai", model: "default::grok-imagine-video-1.5-preview", channelId: "default", baseUrl: "https://v2api.top" });
        expect(task.idempotencyKey).toBeString();
        expect(post).toHaveBeenCalledTimes(1);
        const [url, body, request] = post.mock.calls[0] as unknown as [string, Record<string, unknown>, { headers: Record<string, string> }];
        expect(url).toBe("https://v2api.top/v1/videos");
        expect(body).toMatchObject({
            model: "grok-imagine-video-1.5-preview",
            prompt: "animate the subject",
            seconds: "6",
            duration: 6,
            aspect_ratio: "16:9",
            resolution: "720p",
            images: ["https://images.example/reference.png"],
        });
        expect(request.headers.Authorization).toBe("Bearer newapi-test-key");
        expect(request.headers).not.toHaveProperty("TT-API-KEY");
    });

    test("records the task channel origin without persisting its API key", async () => {
        const task = await createVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), "tracking shot");

        expect(task).toMatchObject({
            channelId: "default",
            baseUrl: "https://v2api.top",
        });
        expect(task).not.toHaveProperty("apiKey");
    });

    test("refuses to poll through a fallback channel when the task channel is missing", async () => {
        const config = videoConfig("grok-imagine-video-1.5-fast");
        const task = await createVideoGenerationTask(config, "tracking shot");
        get.mockClear();
        const fallback = {
            ...config,
            channels: [{ id: "fallback", name: "fallback", baseUrl: "https://fallback.example", apiKey: "fallback-key", apiFormat: "openai" as const, models: ["grok-imagine-video-1.5-fast"] }],
        };

        await expect(pollVideoGenerationTask(fallback, task)).rejects.toThrow("原渠道已不存在");
        expect(get).not.toHaveBeenCalled();
    });

    test("refuses to poll when the original channel Base URL changed", async () => {
        const config = videoConfig("grok-imagine-video-1.5-fast");
        const task = await createVideoGenerationTask(config, "tracking shot");
        get.mockClear();
        const changed = {
            ...config,
            channels: config.channels.map((channel) => ({ ...channel, baseUrl: "https://changed.example" })),
        };

        await expect(pollVideoGenerationTask(changed, task)).rejects.toThrow("Base URL 已变化");
        expect(get).not.toHaveBeenCalled();
    });

    test("polls the public task and downloads content from NewAPI", async () => {
        const config = videoConfig("grok-imagine-video-1.5-fast");
        const task = await createVideoGenerationTask(config, "tracking shot");
        const state = await pollVideoGenerationTask(config, task);

        expect(state.status).toBe("completed");
        if (state.status === "completed") {
            expect(state.result.blob).toBeInstanceOf(Blob);
            expect(state.result.mimeType).toBe("video/mp4");
        }
        expect(get.mock.calls.map((call) => call[0])).toEqual(["https://v2api.top/v1/videos/task_public", "https://v2api.top/v1/videos/task_public/content"]);
    });

    test("keeps data URIs in JSON and converts local blob images to multipart files", async () => {
        const config = videoConfig("grok-imagine-video-1.5");
        const dataUri = "data:image/png;base64,iVBORw0KGgo=";
        await createVideoGenerationTask(config, "animate", [{ id: "data", name: "data.png", type: "image/png", dataUrl: dataUri }]);
        expect((post.mock.calls[0][1] as { images: string[] }).images).toEqual([dataUri]);

        post.mockClear();
        const blobUrl = URL.createObjectURL(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
        try {
            await createVideoGenerationTask(config, "animate", [{ id: "blob", name: "local.png", type: "image/png", dataUrl: blobUrl }]);
            const [url, body, request] = post.mock.calls[0] as unknown as [string, FormData, { headers: Record<string, string> }];
            expect(url).toBe("https://v2api.top/v1/videos");
            expect(body).toBeInstanceOf(FormData);
            expect(body.get("model")).toBe("grok-imagine-video-1.5");
            expect(body.get("images")).toBeInstanceOf(File);
            expect(request.headers).not.toHaveProperty("Content-Type");
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    });

    test("preserves image order for mixed local files and public URLs", async () => {
        const config = videoConfig("grok-imagine-video");
        const localUrl = URL.createObjectURL(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
        try {
            await createVideoGenerationTask(config, "first frame to last frame", [
                { id: "first", name: "first.png", type: "image/png", dataUrl: localUrl },
                { id: "last", name: "last.png", type: "image/png", dataUrl: "", url: "https://images.example/last.png" },
            ]);

            const [, body, request] = post.mock.calls[0] as unknown as [string, { images: string[] }, { headers: Record<string, string> }];
            expect(body).not.toBeInstanceOf(FormData);
            expect(body.images[0]).toStartWith("data:image/png;base64,");
            expect(body.images[1]).toBe("https://images.example/last.png");
            expect(request.headers["Content-Type"]).toBe("application/json");
        } finally {
            URL.revokeObjectURL(localUrl);
        }
    });

    test("retries throttled Grok submissions with the same idempotency key", async () => {
        let attempts = 0;
        postHandler = async () => {
            attempts += 1;
            if (attempts < 3) throw mockAxiosError(429, { "retry-after": "0" });
            return { data: { id: "task_public", status: "queued" } };
        };

        await expect(createVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), "tracking shot")).resolves.toMatchObject({ id: "task_public" });
        expect(post).toHaveBeenCalledTimes(3);
        const idempotencyKeys = post.mock.calls.map((call) => (call[2] as { headers: Record<string, string> }).headers["Idempotency-Key"]);
        expect(new Set(idempotencyKeys).size).toBe(1);
        expect(idempotencyKeys[0]).toBeString();
    });

    test("retries recoverable Grok submission failures with the same idempotency key", async () => {
        let attempts = 0;
        postHandler = async () => {
            attempts += 1;
            if (attempts < 3) throw mockAxiosError(503, { "retry-after": "0" });
            return { data: { id: "task_public", status: "queued" } };
        };

        await expect(createVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), "tracking shot")).resolves.toMatchObject({ id: "task_public" });
        expect(post).toHaveBeenCalledTimes(3);
        const idempotencyKeys = post.mock.calls.map((call) => (call[2] as { headers: Record<string, string> }).headers["Idempotency-Key"]);
        expect(new Set(idempotencyKeys).size).toBe(1);
    });

    test("does not retry invalid Grok generation parameters and explains the correction", async () => {
        postHandler = async () => {
            throw mockAxiosError(422);
        };

        await expect(createVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), "tracking shot")).rejects.toThrow("请求参数或模型能力不匹配");
        expect(post).toHaveBeenCalledTimes(1);
    });

    test("keeps temporary polling errors pending", async () => {
        getHandler = async () => {
            throw mockAxiosError(503);
        };

        const state = await pollVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), publicTask());
        expect(state).toEqual({ status: "pending" });
    });

    test("returns the upstream task failure reason and code", async () => {
        getHandler = async () => ({
            data: {
                id: "task_public",
                status: "failed",
                error: { code: "invalid_reference_image", message: "reference image count must be 0 or 1" },
            },
        });

        const state = await pollVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), publicTask());
        expect(state).toEqual({
            status: "failed",
            error: expect.stringContaining("invalid_reference_image"),
        });
    });

    test("recreates a Grok task once when TTAPI reports a temporary job failure", async () => {
        let submitted = 0;
        const persistedTaskIds: string[] = [];
        postHandler = async () => {
            submitted += 1;
            return { data: { id: submitted === 1 ? "task_first" : "task_retry", status: "queued" } };
        };
        getHandler = async (url) => {
            if (url.endsWith("task_first")) {
                return { data: { id: "task_first", status: "failed", error: { code: "job_failed", message: "Job failed, Please try again later." } } };
            }
            if (url.endsWith("/content")) return { data: new Blob([new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])], { type: "video/mp4" }) };
            return { data: { id: "task_retry", status: "completed" } };
        };

        await expect(
            requestVideoGeneration(videoConfig("grok-imagine-video-1.5-fast"), "tracking shot", [], [], [], {
                onTaskCreated: (task) => persistedTaskIds.push(task.id || ""),
            }),
        ).resolves.toMatchObject({ blob: expect.any(Blob) });
        expect(post).toHaveBeenCalledTimes(2);
        expect(persistedTaskIds).toEqual(["task_first", "task_retry"]);
        const idempotencyKeys = post.mock.calls.map((call) => (call[2] as { headers: Record<string, string> }).headers["Idempotency-Key"]);
        expect(new Set(idempotencyKeys).size).toBe(2);
    });

    test("rejects successful HTML responses instead of storing them as video", async () => {
        getHandler = async (url) => {
            if (url.endsWith("/content")) return { data: new Blob(["<html>upstream error</html>"], { type: "text/html" }) };
            return { data: { id: "task_public", status: "completed" } };
        };

        await expect(pollVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), publicTask())).rejects.toThrow("非视频内容");
    });

    test("rejects HTML content even when the server labels it video/mp4", async () => {
        getHandler = async (url) => {
            if (url.endsWith("/content")) return { data: new Blob(["<html>upstream error</html>"], { type: "video/mp4" }) };
            return { data: { id: "task_public", status: "completed" } };
        };

        await expect(pollVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), publicTask())).rejects.toThrow();
    });

    test("rejects an empty video/mp4 response", async () => {
        getHandler = async (url) => {
            if (url.endsWith("/content")) return { data: new Blob([], { type: "video/mp4" }) };
            return { data: { id: "task_public", status: "completed" } };
        };

        await expect(pollVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), publicTask())).rejects.toThrow();
    });

    test("accepts MP4 and WebM signatures when content type is generic", async () => {
        const signatures = [new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])];

        for (const signature of signatures) {
            getHandler = async (url) => {
                if (url.endsWith("/content")) return { data: new Blob([signature], { type: "application/octet-stream" }) };
                return { data: { id: "task_public", status: "completed" } };
            };
            const state = await pollVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), publicTask());
            expect(state.status).toBe("completed");
        }
    });

    test("URL-encodes persisted public task IDs", async () => {
        await pollVideoGenerationTask(videoConfig("grok-imagine-video-1.5-fast"), { ...publicTask(), id: "task/with?query" });
        expect(get.mock.calls.map((call) => call[0])).toEqual(["https://v2api.top/v1/videos/task%2Fwith%3Fquery", "https://v2api.top/v1/videos/task%2Fwith%3Fquery/content"]);
    });

    test("persists a task returned after polling was cancelled and does not re-submit it", async () => {
        const controller = new AbortController();
        let persistedTask: import("../src/services/api/video").VideoGenerationTask | undefined;
        postHandler = async () => {
            controller.abort();
            return { data: { id: "task_public", status: "queued" } };
        };

        await expect(
            requestVideoGeneration(videoConfig("grok-imagine-video-1.5-fast"), "tracking shot", [], [], [], {
                signal: controller.signal,
                onTaskCreated: (task) => {
                    persistedTask = task;
                },
            }),
        ).rejects.toThrow();
        expect(persistedTask?.id).toBe("task_public");
        expect(post).toHaveBeenCalledTimes(1);

        post.mockClear();
        getHandler = defaultGet;
        await expect(requestVideoGeneration(videoConfig("grok-imagine-video-1.5-fast"), "ignored", [], [], [], { existingTask: persistedTask })).resolves.toMatchObject({ blob: expect.any(Blob) });
        expect(post).not.toHaveBeenCalled();
    });

    test("waits for durable task persistence before starting to poll", async () => {
        let releasePersistence!: () => void;
        let markPersistenceStarted!: () => void;
        const persistenceStarted = new Promise<void>((resolve) => {
            markPersistenceStarted = resolve;
        });
        const persistenceFinished = new Promise<void>((resolve) => {
            releasePersistence = resolve;
        });

        const generation = requestVideoGeneration(videoConfig("grok-imagine-video-1.5-fast"), "tracking shot", [], [], [], {
            onTaskCreated: async () => {
                markPersistenceStarted();
                await persistenceFinished;
            },
        });

        await persistenceStarted;
        expect(get).not.toHaveBeenCalled();

        releasePersistence();
        await expect(generation).resolves.toMatchObject({ blob: expect.any(Blob) });
        expect(get).toHaveBeenCalledTimes(2);
    });

    test("replays an unresolved submission with the same idempotency key", async () => {
        const config = videoConfig("grok-imagine-video-1.5-fast");
        const draft = prepareVideoGenerationTask(config);
        postHandler = async () => {
            throw mockAxiosError(503, { "retry-after": "0" });
        };

        await expect(requestVideoGeneration(config, "tracking shot", [], [], [], { existingTask: draft })).rejects.toThrow("Grok 视频任务创建失败");
        const failedKeys = post.mock.calls.map((call) => (call[2] as { headers: Record<string, string> }).headers["Idempotency-Key"]);
        expect(post).toHaveBeenCalledTimes(4);
        expect(new Set(failedKeys)).toEqual(new Set([draft.idempotencyKey]));

        postHandler = defaultPost;
        post.mockClear();
        let persistedTask: import("../src/services/api/video").VideoGenerationTask | undefined;
        await expect(
            requestVideoGeneration(config, "tracking shot", [], [], [], {
                existingTask: draft,
                onTaskCreated: (task) => {
                    persistedTask = task;
                },
            }),
        ).resolves.toMatchObject({ blob: expect.any(Blob) });

        const keys = post.mock.calls.map((call) => (call[2] as { headers: Record<string, string> }).headers["Idempotency-Key"]);
        expect(keys).toEqual([draft.idempotencyKey]);
        expect(persistedTask).toMatchObject({ id: "task_public", idempotencyKey: draft.idempotencyKey });
    });

    test("keeps an uncertain failed task recoverable instead of treating it as terminal", async () => {
        getHandler = async () => ({
            data: {
                id: "task_public",
                status: "failed",
                error: { code: "submission_outcome_unknown", message: "submission outcome is still being reconciled" },
            },
        });

        const task = publicTask();
        const error = await requestVideoGeneration(videoConfig("grok-imagine-video-1.5-fast"), "ignored", [], [], [], { existingTask: task }).catch((reason) => reason);

        expect(error).toBeInstanceOf(VideoSubmissionOutcomeUnknownError);
        expect(post).not.toHaveBeenCalled();
        expect(task).toMatchObject({ id: "task_public", idempotencyKey: "video-idempotency-key" });
    });
});

function publicTask() {
    return {
        id: "task_public",
        provider: "openai" as const,
        model: "default::grok-imagine-video-1.5-fast",
        channelId: "default",
        baseUrl: "https://v2api.top",
        idempotencyKey: "video-idempotency-key",
    };
}

function mockAxiosError(status?: number, headers: Record<string, string> = {}) {
    return Object.assign(new Error(status ? `request failed with status ${status}` : "network error"), {
        isAxiosError: true,
        response: status ? { status, headers, data: undefined } : undefined,
    });
}

function videoConfig(model: string) {
    const channel = {
        id: "default",
        name: "v2api",
        baseUrl: "https://v2api.top",
        apiKey: "newapi-test-key",
        apiFormat: "openai" as const,
        models: [model],
    };
    return {
        ...defaultConfig,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        channels: [channel],
        model: `default::${model}`,
        videoModel: `default::${model}`,
        videoSeconds: "6",
        vquality: "720",
        size: "1280x720",
        models: [`default::${model}`],
        videoModels: [`default::${model}`],
    };
}

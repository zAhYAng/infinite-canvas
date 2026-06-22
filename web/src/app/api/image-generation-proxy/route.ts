import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 15000;
const IMAGE_PROXY_TIMEOUT_MS = 10 * 60 * 1000;
const ALLOWED_IMAGE_HOSTS = new Set(["v2api.top", "www.v2api.top", "api.v2api.top"]);

type ProxyBody = {
    url?: string;
    apiKey?: string;
    body?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
    let payload: ProxyBody;
    try {
        payload = (await request.json()) as ProxyBody;
    } catch {
        return new Response("Invalid image proxy payload", { status: 400 });
    }

    let url: URL;
    try {
        url = new URL(String(payload.url || ""));
    } catch {
        return new Response("Invalid image generation url", { status: 400 });
    }
    if (url.protocol !== "https:") return new Response("Unsupported image generation url", { status: 400 });
    if (!ALLOWED_IMAGE_HOSTS.has(url.host) || url.pathname !== "/v1/images/generations") return new Response("Image generation host is not allowed", { status: 403 });
    if (!payload.apiKey) return new Response("Missing API key", { status: 400 });

    const encoder = new TextEncoder();
    const controller = new AbortController();
    const stream = new ReadableStream({
        start(streamController) {
            const heartbeat = setInterval(() => {
                streamController.enqueue(encoder.encode(`${JSON.stringify({ type: "ping" })}\n`));
            }, HEARTBEAT_MS);
            const timer = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);

            void (async () => {
                try {
                    const response = await fetch(url, {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${payload.apiKey}`,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify(payload.body || {}),
                        signal: controller.signal,
                    });
                    const text = await response.text();
                    const result = parseJson(text);
                    streamController.enqueue(encoder.encode(`${JSON.stringify(response.ok ? { type: "result", payload: result } : { type: "error", status: response.status, payload: result, message: responseErrorMessage(result) || response.statusText || "请求失败" })}\n`));
                } catch (error) {
                    streamController.enqueue(encoder.encode(`${JSON.stringify({ type: "error", message: error instanceof Error && error.name === "AbortError" ? "图片生成代理超时" : error instanceof Error ? error.message : "图片生成代理失败" })}\n`));
                } finally {
                    clearInterval(heartbeat);
                    clearTimeout(timer);
                    streamController.close();
                }
            })();
        },
        cancel() {
            controller.abort();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    });
}

function parseJson(text: string) {
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { msg: text.slice(0, 500) };
    }
}

function responseErrorMessage(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "";
    const record = value as Record<string, unknown>;
    const error = record.error && typeof record.error === "object" && !Array.isArray(record.error) ? (record.error as Record<string, unknown>) : undefined;
    return typeof record.msg === "string" ? record.msg : typeof error?.message === "string" ? error.message : "";
}

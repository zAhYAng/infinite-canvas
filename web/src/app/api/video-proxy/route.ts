import type { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_VIDEO_HOSTS = new Set(["164.37.102.138:8001"]);
const VIDEO_PROXY_TIMEOUT_MS = 120000;

export async function GET(request: NextRequest) {
    const target = request.nextUrl.searchParams.get("url") || "";
    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return new Response("Invalid video url", { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return new Response("Unsupported video url", { status: 400 });
    if (!ALLOWED_VIDEO_HOSTS.has(url.host) || url.pathname !== "/v1/files/video") return new Response("Video host is not allowed", { status: 403 });

    const headers = new Headers();
    const range = request.headers.get("range");
    if (range) headers.set("Range", range);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VIDEO_PROXY_TIMEOUT_MS);
    try {
        const response = await fetch(url, { headers, signal: controller.signal });
        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders(response.headers),
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return new Response("Video proxy timeout", { status: 504 });
        return new Response(error instanceof Error ? error.message : "Video proxy error", { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

function responseHeaders(headers: Headers) {
    const result = new Headers();
    ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"].forEach((key) => {
        const value = headers.get(key);
        if (value) result.set(key, value);
    });
    result.set("Cache-Control", "no-store");
    return result;
}

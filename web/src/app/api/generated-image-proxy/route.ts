import type { NextRequest } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_IMAGE_PATH_PREFIX = "/opt/new-api/static-custom/generated-images/";
const IMAGE_PROXY_TIMEOUT_MS = 120000;

export async function GET(request: NextRequest) {
    const target = request.nextUrl.searchParams.get("url") || "";
    let url: URL;
    try {
        url = new URL(target);
    } catch {
        return new Response("Invalid image url", { status: 400 });
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return new Response("Unsupported image url", { status: 400 });
    if (!url.pathname.startsWith(ALLOWED_IMAGE_PATH_PREFIX)) return new Response("Image path is not allowed", { status: 403 });
    if (!(await isPublicHost(url.hostname))) return new Response("Image host is not allowed", { status: 403 });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);
    try {
        const response = await fetch(url, { signal: controller.signal });
        return new Response(response.body, {
            status: response.status,
            headers: responseHeaders(response.headers),
        });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return new Response("Image proxy timeout", { status: 504 });
        return new Response(error instanceof Error ? error.message : "Image proxy error", { status: 502 });
    } finally {
        clearTimeout(timer);
    }
}

async function isPublicHost(hostname: string) {
    const directIp = isIP(hostname);
    if (directIp) return isPublicIp(hostname);
    try {
        const records = await lookup(hostname, { all: true });
        return records.length > 0 && records.every((record) => isPublicIp(record.address));
    } catch {
        return false;
    }
}

function isPublicIp(address: string) {
    if (address.includes(":")) return isPublicIpv6(address);
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false;
    return true;
}

function isPublicIpv6(address: string) {
    const value = address.toLowerCase();
    return value !== "::1" && !value.startsWith("fc") && !value.startsWith("fd") && !value.startsWith("fe80:");
}

function responseHeaders(headers: Headers) {
    const result = new Headers();
    ["content-type", "content-length", "etag", "last-modified"].forEach((key) => {
        const value = headers.get(key);
        if (value) result.set(key, value);
    });
    result.set("Cache-Control", "no-store");
    return result;
}

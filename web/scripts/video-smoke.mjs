const required = ["NEWAPI_SMOKE_BASE_URL", "NEWAPI_SMOKE_API_KEY", "NEWAPI_SMOKE_VIDEO_MODEL"];
const missing = required.filter((name) => !process.env[name]?.trim());

if (process.env.ALLOW_PAID_VIDEO_SMOKE !== "yes" || missing.length) {
    throw new Error(`Refusing to create a paid video task. Set ALLOW_PAID_VIDEO_SMOKE=yes and ${[...missing, ...required.filter((name) => !missing.includes(name))].join(", ")} at runtime.`);
}

const baseUrl = process.env.NEWAPI_SMOKE_BASE_URL.replace(/\/+$/, "");
const apiKey = process.env.NEWAPI_SMOKE_API_KEY;
const model = process.env.NEWAPI_SMOKE_VIDEO_MODEL;
const seconds = Number(process.env.NEWAPI_SMOKE_SECONDS || 6);
const size = process.env.NEWAPI_SMOKE_SIZE || "16:9";
const resolution = process.env.NEWAPI_SMOKE_RESOLUTION || "480p";
const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

const models = await request("/v1/models");
const modelIds = Array.isArray(models.data) ? models.data.map((item) => String(item?.id || "")) : [];
if (!modelIds.includes(model)) throw new Error(`The supplied key cannot see ${model} in /v1/models.`);

const task = await request("/v1/videos", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
        model,
        prompt: "A concise product beauty shot with stable composition and smooth camera movement.",
        seconds,
        duration: seconds,
        size,
        resolution,
    }),
});
const taskId = String(task.id || task.data?.id || "");
if (!taskId || /jobId|job_/i.test(taskId)) throw new Error("/v1/videos did not return a valid public task ID.");

process.stdout.write(`Created public task ${taskId}. Polling without printing credentials.\n`);
const deadline = Date.now() + 20 * 60_000;
while (Date.now() < deadline) {
    const state = await request(`/v1/videos/${encodeURIComponent(taskId)}`);
    const data = state.data || state;
    const status = String(data.status || "").toLowerCase();
    if (["completed", "succeeded", "success"].includes(status)) {
        const content = await fetch(`${baseUrl}/v1/videos/${encodeURIComponent(taskId)}/content`, { headers: { Authorization: `Bearer ${apiKey}` } });
        if (!content.ok) throw new Error(`Video content request failed with HTTP ${content.status}.`);
        const signature = new Uint8Array(await content.arrayBuffer()).slice(0, 16);
        const isMp4 = signature.length >= 8 && signature[4] === 0x66 && signature[5] === 0x74 && signature[6] === 0x79 && signature[7] === 0x70;
        const isWebm = signature.length >= 4 && signature[0] === 0x1a && signature[1] === 0x45 && signature[2] === 0xdf && signature[3] === 0xa3;
        if (!isMp4 && !isWebm) throw new Error("Video content did not have an MP4 or WebM file signature.");
        process.stdout.write(`Video smoke passed for ${taskId}.\n`);
        process.exit(0);
    }
    if (["failed", "cancelled", "canceled", "expired"].includes(status)) throw new Error(`Video task ${taskId} failed: ${JSON.stringify(data.error || data.message || data.msg || status)}`);
    await delay(3_000);
}

throw new Error(`Video task ${taskId} did not finish before the 20 minute smoke deadline.`);

async function request(path, init) {
    const response = await fetch(`${baseUrl}${path}`, init ? { ...init, headers: init.headers || headers } : { headers: { Authorization: `Bearer ${apiKey}` } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Request ${path} failed with HTTP ${response.status}: ${JSON.stringify(payload?.error || payload?.message || payload?.msg || "unknown error")}`);
    return payload;
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

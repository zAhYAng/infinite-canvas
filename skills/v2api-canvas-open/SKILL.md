---
name: v2api-canvas-open
description: Open image.v2api.top Infinite Canvas and connect it to the local MCP bridge. Use when the user asks to open, launch, connect, or prepare the V2API Infinite Canvas for Codex operation.
---

# V2API Canvas Open

## Workflow

1. Start the local bridge from the plugin/repo root and keep it running:

```bash
node scripts/start-canvas-agent.mjs
```

The bridge prints:

```text
Local URL: http://127.0.0.1:17371
Connect token: ...
```

2. Open the web canvas:

```text
https://image.v2api.top/
```

If the user already has a specific project URL such as `https://image.v2api.top/canvas/<id>`, use that URL.

3. If browser-control tools are available, Codex should open the canvas page itself, open `Agent` -> `本机`, fill the printed Local URL and Connect token, then click `连接`.

If browser-control tools are unavailable, blocked, or cannot access the active browser/page, ask the user to do the same UI steps manually. Treat manual user connection as a fallback, not the primary path.

4. After connection, Codex should operate the canvas from the Codex conversation by using the `infinite-canvas` MCP tools. Do not send the user's task into the web panel's Codex chat.

## Notes

- The web page stores the current canvas in the browser, so the target canvas page must stay open and connected while Codex operates it.
- If Codex started the bridge, read the Local URL and token from the terminal output. If needed, also check `~/.infinite-canvas/canvas-agent.json`.
- If tool confirmation is enabled in the web panel, the user may need to approve write operations such as `canvas_apply_ops`.

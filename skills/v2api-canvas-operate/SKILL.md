---
name: v2api-canvas-operate
description: Operate image.v2api.top Infinite Canvas from Codex through the infinite-canvas MCP tools. Use when the user asks Codex to read, create, edit, arrange, generate images/videos/audio/text, or otherwise manipulate the V2API canvas.
---

# V2API Canvas Operate

## Preconditions

The local bridge must be running and the target `image.v2api.top` canvas page must be connected through `Agent` -> `本机`.

If a tool call says `当前没有已连接画布`, ask the user to connect the web canvas with `v2api-canvas-open`.

## Workflow

1. Read the canvas before making changes:

```text
canvas_get_state
```

Use real node ids from the returned state. Do not invent ids for existing nodes.

2. For direct text or planning content, prefer:

```text
canvas_create_text_node
canvas_create_text_nodes
```

3. For image/video/audio/text generation workflows, prefer the dedicated tools:

```text
canvas_create_generation_flow
canvas_generate_image
canvas_generate_video
canvas_generate_audio
canvas_generate_text
```

Use the user's selected nodes as references only when `canvas_get_selection` shows real selected nodes.

4. For precise multi-step edits, use `canvas_apply_ops` with the smallest needed `ops` list.

Supported operation types include:

```text
add_node
update_node
delete_node
delete_connections
connect_nodes
set_viewport
select_nodes
run_generation
```

5. For promotional scene building, create a clear canvas structure:

- brief / strategy text node
- prompt node
- generation config node
- output placeholder or generation run
- connections between input, config, and output nodes when useful

Keep node titles in Chinese unless the user asks otherwise.

## Guardrails

- Do not simulate browser clicks for canvas edits when MCP tools can do the job.
- Do not ask the user to copy JSON into the canvas.
- Do not overwrite or delete existing nodes unless the user explicitly asks.
- For video generation, use the model/config already available in the user's V2API canvas settings unless the user names a model.

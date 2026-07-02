---
title: TTAPI 视频渠道兼容改造方案
description: 面向 NewAPI / v2api 内部改造的 TTAPI Grok 视频渠道接入方案
---

# TTAPI 视频渠道兼容改造方案

本文档用于评估和改造 NewAPI / v2api 内部视频渠道，使其能够正确接入 TTAPI Grok 视频生成能力。本文档为内部实现方案，不面向终端 API 用户展示。

## 1. 改造目标

目标是在不改变 v2api 对外接口的前提下，新增 TTAPI 视频渠道适配能力：

- 支持通过 v2api 统一接口调用 TTAPI Grok 视频模型。
- 支持明确传递视频时长，例如 `15s`。
- 支持明确传递清晰度，例如 `720p`。
- 支持文生视频和图生视频。
- 对用户隐藏 TTAPI、NewAPI、上游任务轮询等内部细节。

对外接口仍然保持 v2api 风格，例如：

```json
{
  "model": "grok-imagine-video",
  "prompt": "cinematic product video, no text, smooth camera movement",
  "duration": 15,
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "image_url": "https://example.com/input.png"
}
```

内部适配器负责转换为 TTAPI 所需格式。

## 2. 为什么不能只靠模型映射

NewAPI 的模型映射通常只能解决模型名称转换，例如：

```json
{
  "v2api-grok-video": "grok-imagine-video"
}
```

但 TTAPI 视频生成不是标准 OpenAI Chat Completions 协议，单纯模型映射无法解决以下问题：

- 请求路径不同：TTAPI 使用 Grok 专用生成接口，不是 `/v1/chat/completions`。
- 鉴权方式不同：TTAPI 使用 `TT-API-KEY` 请求头，不是 `Authorization: Bearer`。
- 参数名称不同：TTAPI 使用 `video_length`、`resolution_name`、`refer_images` 等字段。
- 返回结构不同：TTAPI 先返回 `job_id`，需要轮询任务结果。
- 成功结果不同：最终视频地址在任务查询结果中，不是 OpenAI 标准响应结构。

因此，如果只在 NewAPI 后台填写自定义 URL 和模型映射，大概率只能解决路由问题，不能保证 `15s`、`720p`、图生视频图片输入和任务轮询正确工作。

## 3. 推荐架构

```text
用户 / 画布
  -> v2api 视频生成接口
  -> NewAPI / v2api 路由层
  -> TTAPI 视频适配器
  -> TTAPI 生成任务接口
  -> TTAPI 任务查询接口
  -> 标准化视频结果
  -> 返回给用户
```

核心原则：

- 用户侧只认 v2api 模型和参数。
- 渠道侧才处理 TTAPI 专用协议。
- 适配器内部完成请求体转换、任务轮询、错误归一化和用量记录。

## 4. TTAPI 请求转换

### 4.1 入参映射

| v2api 字段 | TTAPI 字段 | 说明 |
| --- | --- | --- |
| `model` | `model` | 可通过内部模型映射转换 |
| `prompt` | `prompt` | 原样传递，必要时追加内部安全提示 |
| `duration` | `video_length` | 建议转换为字符串，例如 `"15"` |
| `resolution` | `resolution_name` | 例如 `"720p"` |
| `aspect_ratio` | `aspect_ratio` | 例如 `"16:9"`、`"9:16"`、`"1:1"` |
| `image_url` | `refer_images[0]` | 图生视频输入图 |
| `image_urls` | `refer_images` | 多参考图，按 TTAPI 模型支持限制 |

### 4.2 TTAPI 生成请求示例

```http
POST /grok/generations HTTP/1.1
Host: api.ttapi.io
Content-Type: application/json
TT-API-KEY: YOUR_TTAPI_KEY
```

```json
{
  "model": "grok-imagine-video",
  "prompt": "cinematic product video, no text, smooth camera movement",
  "video_length": "15",
  "resolution_name": "720p",
  "aspect_ratio": "16:9",
  "refer_images": []
}
```

图生视频示例：

```json
{
  "model": "grok-imagine-video-1.5",
  "prompt": "cinematic camera movement, no text, keep the original subject",
  "video_length": "15",
  "resolution_name": "720p",
  "aspect_ratio": "16:9",
  "refer_images": [
    "https://example.com/input.png"
  ]
}
```

### 4.3 任务查询

TTAPI 生成接口返回任务 ID 后，需要轮询查询接口：

```http
GET /grok/fetch?jobId=JOB_ID HTTP/1.1
Host: api.ttapi.io
TT-API-KEY: YOUR_TTAPI_KEY
```

适配器需要将上游任务状态转换为 v2api 内部统一状态：

| TTAPI 状态 | v2api 内部状态 | 处理方式 |
| --- | --- | --- |
| 排队 / 处理中 | `processing` | 继续轮询 |
| 成功 | `succeeded` | 提取视频 URL |
| 失败 | `failed` | 返回标准错误 |
| 未知状态 | `processing` 或 `failed` | 按超时策略处理 |

轮询建议：

- 初始等待：`3-5` 秒。
- 轮询间隔：`3-5` 秒。
- 最大等待：`180-300` 秒。
- 超时后返回任务处理中或超时错误，具体取决于当前 v2api 是否支持异步任务查询。

## 5. 模型建议

第一阶段建议只接入成本和能力相对明确的 Grok 视频模型：

| 对外模型名 | TTAPI 模型名 | 输入方式 | 默认配置 |
| --- | --- | --- | --- |
| `grok-imagine-video` | `grok-imagine-video` | 文生视频 / 图生视频 | `15s`、`720p`、`16:9` |
| `grok-imagine-video-1.5` | `grok-imagine-video-1.5` | 图生视频 | `15s`、`720p`、`16:9` |
| `grok-imagine-video-1.5-fast` | `grok-imagine-video-1.5-fast` | 按 TTAPI 支持能力配置 | `15s`、`720p`、`16:9` |

注意事项：

- 如果模型要求必须传图，适配器应在请求上游前直接校验 `image_url` 或 `image_urls`。
- 如果模型不支持某个时长或清晰度，应在内部模型配置中限制，而不是依赖上游报错。
- 当前业务重点是 `15s`、`720p`，不要为了未验证规格一次性开放过多组合。

## 6. NewAPI 改造点

### 6.1 渠道类型

推荐新增专用渠道类型，例如：

```text
TTAPI Grok Video
```

不要复用普通 OpenAI 自定义渠道，除非 NewAPI 已经支持完整的请求体转换、鉴权头转换、任务轮询和响应转换。

渠道配置建议：

```json
{
  "type": "ttapi_grok_video",
  "base_url": "https://api.ttapi.io",
  "api_key": "TTAPI_KEY",
  "models": [
    "grok-imagine-video",
    "grok-imagine-video-1.5",
    "grok-imagine-video-1.5-fast"
  ],
  "model_mapping": {
    "grok-imagine-video": "grok-imagine-video",
    "grok-imagine-video-1.5": "grok-imagine-video-1.5",
    "grok-imagine-video-1.5-fast": "grok-imagine-video-1.5-fast"
  }
}
```

### 6.2 请求适配器

需要新增或扩展视频任务适配器，职责包括：

- 读取 v2api / OpenAI 兼容请求中的 `model`、`prompt`、`duration`、`resolution`、`aspect_ratio`、图片输入。
- 将 `duration` 转成 TTAPI `video_length`。
- 将 `resolution` 转成 TTAPI `resolution_name`。
- 将单图或多图输入转成 TTAPI `refer_images`。
- 使用 `TT-API-KEY` 请求头调用 TTAPI。
- 创建任务后轮询 `fetch` 接口。
- 成功后把 TTAPI 视频 URL 转成 v2api 标准响应。
- 失败时保留上游错误摘要，但不要把内部密钥、完整请求头暴露给用户。

### 6.3 响应标准化

如果对外走同步视频接口，成功响应可以标准化为：

```json
{
  "id": "video_xxx",
  "object": "video.generation",
  "created": 1782980000,
  "model": "grok-imagine-video",
  "data": [
    {
      "url": "https://example.com/result.mp4",
      "duration": 15,
      "resolution": "720p"
    }
  ]
}
```

如果对外走 Chat Completions 兼容接口，可以把视频 URL 放在文本内容中，或按现有 v2api 的视频返回格式封装。建议长期使用专用视频接口，避免让视频任务继续伪装成聊天接口。

### 6.4 计费和用量

建议按内部模型配置维护成本，而不是依赖 TTAPI 实时价格：

```json
{
  "model": "grok-imagine-video",
  "resolution": "720p",
  "duration": 15,
  "upstream_cost_usd": 0.075,
  "sell_price_cny": 1.8
}
```

业务侧可以按以下方式估算：

```text
单次毛利 = 售价 - 上游成本 - 支付手续费 - 失败重试摊销 - 服务器成本摊销
```

对于 `15s`、`720p`，如果上游成本约 `$0.075`，按汇率和手续费保守估算可按 `0.55-0.60` 元人民币作为单次成本基准。

## 7. 错误处理

适配器应优先在本地拦截明确错误：

| 场景 | 建议错误 |
| --- | --- |
| 缺少 `prompt` | `prompt is required` |
| 图生模型缺少图片 | `image_url is required for this model` |
| 不支持的 `duration` | `unsupported duration for this model` |
| 不支持的 `resolution` | `unsupported resolution for this model` |
| TTAPI 鉴权失败 | `upstream authentication failed` |
| TTAPI 余额不足 | `upstream quota is insufficient` |
| 任务超时 | `video generation timed out` |
| 上游返回失败 | `upstream video generation failed` |

日志中可以记录上游错误码和任务 ID，但不要记录完整 API Key。

## 8. 验收标准

改造完成后至少验证以下用例：

- `grok-imagine-video` 文生视频，`15s`、`720p`，实际视频时长接近 `15s`。
- `grok-imagine-video` 图生视频，`15s`、`720p`，实际视频时长接近 `15s`。
- `grok-imagine-video-1.5` 缺少图片时，本地直接返回参数错误。
- `grok-imagine-video-1.5` 图生视频，`15s`、`720p`，实际视频时长接近 `15s`。
- 传入不支持的时长时，本地直接返回参数错误。
- 上游任务失败时，对外返回标准错误，不泄露上游密钥或内部请求头。
- 任务轮询超时时，返回明确超时错误或可查询的任务状态。

重点验收项是实际 MP4 时长。不要只检查返回 URL 是否存在。

## 9. 最小实现顺序

建议按以下顺序改造：

1. 新增 TTAPI Grok 视频渠道类型和渠道配置。
2. 实现生成请求转换：`duration -> video_length`、`resolution -> resolution_name`、`image_url -> refer_images`。
3. 实现 `TT-API-KEY` 鉴权头。
4. 实现任务创建和轮询。
5. 实现成功结果标准化。
6. 实现参数校验和错误归一化。
7. 接入计费配置。
8. 用真实 key 验证 `15s`、`720p` 的实际视频时长。

如果时间有限，第一版只支持 `grok-imagine-video`、`15s`、`720p`、`16:9`，先打通稳定链路，再扩展更多模型和规格。

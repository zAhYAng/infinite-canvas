---
title: v2api 视频生成接口文档
description: 面向外部开发者的视频生成 API 对接说明
---

# v2api 视频生成接口文档

本文档用于说明如何通过 v2api 调用视频生成能力，包含文生视频、图生视频和首尾帧视频三种常见请求方式。

## 1. 基础信息

### 1.1 接口地址

```http
POST https://v2api.top/v1/chat/completions
```

### 1.2 请求头

```http
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### 1.3 通用说明

- `YOUR_API_KEY` 请替换为实际 API Key。
- `model` 请填写账号已开通的视频模型名称，例如 `grok-imagine-video`。
- 视频生成通常耗时较长，客户端超时时间建议设置为 `180` 秒或更高。
- 生产环境建议在服务端调用 v2api，不要在浏览器前端、移动端包体或公开仓库中暴露 API Key。

## 2. 文生视频

文生视频适用于只通过文字提示词生成视频的场景。

### 2.1 请求示例

```ts
const response = await fetch("https://v2api.top/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "grok-imagine-video",
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "生成一个雨夜城市街头的电影感视频，霓虹灯反射在湿润路面上，镜头缓慢向前推进。\n\n视频时长：12 秒。请按该时长生成视频。",
          },
        ],
      },
    ],
    prompt: "生成一个雨夜城市街头的电影感视频，霓虹灯反射在湿润路面上，镜头缓慢向前推进。\n\n视频时长：12 秒。请按该时长生成视频。",
    duration: 12,
    seconds: 12,
    aspect_ratio: "16:9",
    size: "1280x720",
    resolution: "720p",
    resolution_name: "720p",
    generation_type: "文生视频",
    video_config: {
      seconds: 12,
      duration: 12,
      video_length: 12,
      size: "1280x720",
      aspect_ratio: "16:9",
      resolution: "720p",
      resolution_name: "720p",
    },
    metadata: {
      video_config: {
        seconds: 12,
        duration: 12,
        video_length: 12,
        size: "1280x720",
        aspect_ratio: "16:9",
        resolution: "720p",
        resolution_name: "720p",
      },
    },
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const data = await response.json();
console.log(data);
```

## 3. 图生视频

图生视频适用于提供一张或多张参考图生成视频的场景。

参考图片建议使用公网可访问的 HTTPS 图片地址，也可以使用 base64 data URL。

### 3.1 请求示例

```ts
const imageUrl = "https://example.com/reference-image.png";

const response = await fetch("https://v2api.top/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "grok-imagine-video",
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: imageUrl,
            },
          },
          {
            type: "text",
            text: "根据参考图生成一个自然运镜的视频，主体保持一致，背景有柔和光影变化，不要添加文字，不要出现字幕。\n\n视频时长：12 秒。请按该时长生成视频。",
          },
        ],
      },
    ],
    prompt: "根据参考图生成一个自然运镜的视频，主体保持一致，背景有柔和光影变化，不要添加文字，不要出现字幕。\n\n视频时长：12 秒。请按该时长生成视频。",
    duration: 12,
    seconds: 12,
    aspect_ratio: "16:9",
    size: "1280x720",
    resolution: "720p",
    resolution_name: "720p",
    generation_type: "图生视频",
    image_count: 1,
    image_reference: [
      {
        type: "image_url",
        image_url: {
          url: imageUrl,
        },
      },
    ],
    reference_images: [imageUrl],
    images: [imageUrl],
    input_reference: imageUrl,
    first_frame_url: imageUrl,
    video_config: {
      seconds: 12,
      duration: 12,
      video_length: 12,
      size: "1280x720",
      aspect_ratio: "16:9",
      resolution: "720p",
      resolution_name: "720p",
    },
    metadata: {
      image_count: 1,
      video_config: {
        seconds: 12,
        duration: 12,
        video_length: 12,
        size: "1280x720",
        aspect_ratio: "16:9",
        resolution: "720p",
        resolution_name: "720p",
      },
    },
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const data = await response.json();
console.log(data);
```

## 4. 首尾帧视频

首尾帧视频适用于指定首帧图和尾帧图，并生成中间过渡视频的场景。

### 4.1 请求示例

```ts
const firstFrameUrl = "https://example.com/first-frame.png";
const lastFrameUrl = "https://example.com/last-frame.png";

const response = await fetch("https://v2api.top/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "grok-imagine-video",
    stream: false,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: firstFrameUrl,
            },
          },
          {
            type: "image_url",
            image_url: {
              url: lastFrameUrl,
            },
          },
          {
            type: "text",
            text: "根据首帧和尾帧生成一个平滑过渡的视频，主体自然运动，镜头稳定，不要添加文字，不要出现字幕。\n\n视频时长：12 秒。请按该时长生成视频。",
          },
        ],
      },
    ],
    prompt: "根据首帧和尾帧生成一个平滑过渡的视频，主体自然运动，镜头稳定，不要添加文字，不要出现字幕。\n\n视频时长：12 秒。请按该时长生成视频。",
    duration: 12,
    seconds: 12,
    aspect_ratio: "16:9",
    size: "1280x720",
    resolution: "720p",
    resolution_name: "720p",
    generation_type: "首尾帧视频",
    image_count: 2,
    image_reference: [
      {
        type: "image_url",
        image_url: {
          url: firstFrameUrl,
        },
      },
      {
        type: "image_url",
        image_url: {
          url: lastFrameUrl,
        },
      },
    ],
    reference_images: [firstFrameUrl, lastFrameUrl],
    images: [firstFrameUrl, lastFrameUrl],
    input_reference: firstFrameUrl,
    first_frame_url: firstFrameUrl,
    last_frame_url: lastFrameUrl,
    video_config: {
      seconds: 12,
      duration: 12,
      video_length: 12,
      size: "1280x720",
      aspect_ratio: "16:9",
      resolution: "720p",
      resolution_name: "720p",
    },
    metadata: {
      image_count: 2,
      video_config: {
        seconds: 12,
        duration: 12,
        video_length: 12,
        size: "1280x720",
        aspect_ratio: "16:9",
        resolution: "720p",
        resolution_name: "720p",
      },
    },
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const data = await response.json();
console.log(data);
```

## 5. 请求字段说明

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 视频模型名称，例如 `grok-imagine-video` |
| `stream` | boolean | 否 | 是否流式返回，视频生成建议传 `false` |
| `messages` | array | 是 | OpenAI Chat Completions 兼容消息 |
| `messages[].content` | string 或 array | 是 | 文本提示词；图生视频时可包含 `image_url` |
| `prompt` | string | 推荐 | 视频生成提示词 |
| `duration` | number | 推荐 | 视频时长，单位秒 |
| `seconds` | number | 推荐 | 视频时长，单位秒 |
| `aspect_ratio` | string | 否 | 视频比例，例如 `16:9`、`9:16`、`1:1` |
| `size` | string | 否 | 视频尺寸，例如 `1280x720`、`720x1280` |
| `resolution` | string | 否 | 清晰度，例如 `720p`、`1080p` |
| `resolution_name` | string | 否 | 清晰度名称，建议与 `resolution` 保持一致 |
| `generation_type` | string | 否 | 生成类型，例如 `文生视频`、`图生视频`、`首尾帧视频` |
| `image_reference` | array | 图生视频推荐 | 图片参考，格式同 `messages[].content` 中的 `image_url` |
| `reference_images` | string[] | 图生视频推荐 | 参考图 URL 列表 |
| `images` | string[] | 图生视频推荐 | 参考图 URL 列表 |
| `input_reference` | string | 图生视频推荐 | 主参考图 URL |
| `first_frame_url` | string | 首尾帧推荐 | 首帧图 URL |
| `last_frame_url` | string | 首尾帧推荐 | 尾帧图 URL |
| `video_config` | object | 推荐 | 视频参数配置 |
| `metadata.video_config` | object | 否 | 视频参数配置副本，用于兼容不同模型实现 |

## 6. 时长说明

不同视频模型支持的时长可能不同。建议优先使用模型支持的标准时长。

| 目标时长 | 推荐传参 |
| --- | --- |
| 6 秒 | `seconds: 6`, `duration: 6` |
| 10 秒 | `seconds: 10`, `duration: 10` |
| 12 秒 | `seconds: 12`, `duration: 12` |
| 15 秒 | `seconds: 15`, `duration: 15` |
| 16 秒 | `seconds: 16`, `duration: 16` |
| 20 秒 | `seconds: 20`, `duration: 20` |

如果模型不支持指定时长，实际返回视频时长可能会按模型支持范围自动调整。

## 7. 返回结果

接口返回 OpenAI Chat Completions 兼容结构。视频结果通常位于：

```text
choices[0].message.content
```

### 7.1 返回视频 URL

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "https://example.com/generated-video.mp4"
      },
      "finish_reason": "stop"
    }
  ]
}
```

### 7.2 返回 HTML 片段

部分模型可能会返回 HTML 片段：

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "<video src=\"https://example.com/generated-video.mp4\"></video>"
      },
      "finish_reason": "stop"
    }
  ]
}
```

## 8. 视频 URL 提取示例

```ts
function extractVideoUrl(content: string) {
  const videoSrc = content.match(/<video\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  if (videoSrc) return videoSrc;

  const src = content.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  if (src) return src;

  return content.match(/https?:\/\/[^\s"'<>`]+/i)?.[0] || "";
}

const content = data.choices?.[0]?.message?.content || "";
const videoUrl = extractVideoUrl(content);

console.log(videoUrl);
```

## 9. 错误返回

请求失败时可能返回 OpenAI 兼容错误结构：

```json
{
  "error": {
    "message": "错误信息"
  }
}
```

也可能返回业务错误结构：

```json
{
  "code": 500,
  "msg": "错误信息"
}
```

建议对接方同时兼容：

```text
error.message
msg
```

## 10. 接入建议

- 文生视频至少传 `model`、`messages`、`prompt`、`seconds`、`duration`。
- 图生视频建议同时传 `messages[].content.image_url`、`image_reference`、`reference_images`、`images`、`input_reference`。
- 首尾帧视频建议明确传 `first_frame_url` 和 `last_frame_url`。
- 提示词中建议明确描述画面内容、镜头运动、风格、时长，并写明“不要添加文字，不要出现字幕”。
- 视频生成耗时较长，客户端请求超时建议设置为 `180` 秒或更高。
- 生产环境建议由服务端调用 v2api，再将生成结果返回给前端。

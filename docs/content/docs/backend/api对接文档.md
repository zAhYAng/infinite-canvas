---
title: v2api 图像与视频生成 API 文档
description: 面向开发者的 v2api 图像生成、视频生成接口说明
---

# v2api 图像与视频生成 API 文档

本文档面向需要通过 API 接入 v2api 图像生成与视频生成能力的开发者。

## 1. 基础信息

### 1.1 服务地址

```text
Base URL: https://v2api.top/v1
```

### 1.2 鉴权方式

所有请求都需要在 Header 中携带 API Key：

```text
Authorization: Bearer YOUR_API_KEY
```

### 1.3 请求格式

```text
Content-Type: application/json
```

### 1.4 通用说明

- `YOUR_API_KEY` 需要替换为你的实际 API Key。
- `model` 需要填写你的账号已开通的模型名称。
- 图片和视频生成通常耗时较长，客户端超时时间建议设置为 `120` 秒或更高。
- 生产环境请不要把 API Key 暴露在浏览器前端、移动端包体或公开仓库中。

## 2. 图片生成接口

### 2.1 接口信息

```text
POST /images/generations
```

完整地址：

```text
https://v2api.top/v1/images/generations
```

### 2.2 请求参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 图片生成模型名称，例如 `gpt-image-2` |
| `prompt` | string | 是 | 图片生成提示词 |
| `size` | string | 否 | 图片尺寸，例如 `1024x1024`、`1536x1024`、`1024x1536` |
| `n` | number | 否 | 生成数量，默认 `1` |
| `response_format` | string | 否 | 返回格式，常见值为 `url` 或 `b64_json`，具体以模型支持为准 |

### 2.3 请求示例

```bash
curl https://v2api.top/v1/images/generations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一张高端智能手表产品海报，白色背景，柔和棚拍光，极简商业摄影风格",
    "size": "1024x1024",
    "n": 1
  }'
```

### 2.4 返回示例

返回 URL：

```json
{
  "created": 1782920000,
  "data": [
    {
      "url": "https://example.com/generated-image.png"
    }
  ]
}
```

返回 Base64：

```json
{
  "created": 1782920000,
  "data": [
    {
      "b64_json": "BASE64_IMAGE_DATA"
    }
  ]
}
```

### 2.5 结果读取

常见图片结果位置：

```text
data[0].url
data[0].b64_json
```

接入时建议同时兼容 `url` 和 `b64_json` 两种返回方式。

## 3. 视频生成接口

v2api 视频生成根据模型能力不同，可能使用两种调用方式：

- 文本式视频生成：`POST /chat/completions`
- 任务式视频生成：`POST /videos`

如果你不确定当前模型支持哪种方式，优先使用 `POST /chat/completions`。

## 4. 文本式视频生成

### 4.1 接口信息

```text
POST /chat/completions
```

完整地址：

```text
https://v2api.top/v1/chat/completions
```

### 4.2 适用模型

常见视频模型示例：

```text
grok-imagine-video
firefly-veo
```

实际可用模型以你的账号权限为准。

### 4.3 请求参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 视频生成模型名称 |
| `messages` | array | 是 | 消息列表，视频描述写在用户消息中 |

### 4.4 请求示例：生成 12 秒视频

```bash
curl https://v2api.top/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-imagine-video",
    "messages": [
      {
        "role": "user",
        "content": "生成一个雨夜城市街头的电影感视频，霓虹灯反射在湿润路面上，镜头缓慢向前推进。\n\n视频时长：12 秒。请按该时长生成视频。"
      }
    ]
  }'
```

### 4.5 时长说明

对于文本式视频生成，建议把时长明确写入 `messages[0].content`：

```text
视频时长：12 秒。请按该时长生成视频。
```

不要只依赖额外的顶层字段表达时长，因为不同模型对扩展字段的支持不完全一致。

### 4.6 返回示例

视频模型通常会在 `choices[0].message.content` 中返回视频链接或 HTML 片段。

直接返回视频地址：

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "https://example.com/generated-video.mp4"
      }
    }
  ]
}
```

返回 HTML 片段：

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "<video src=\"https://example.com/generated-video.mp4\"></video>"
      }
    }
  ]
}
```

### 4.7 结果读取

常见视频结果位置：

```text
choices[0].message.content
```

接入方需要从返回文本中解析：

- 第一个 `http://` 或 `https://` 视频地址
- 或 `<video>` 标签中的 `src` 地址

## 5. 任务式视频生成

部分视频模型支持任务式接口。该方式通常先创建任务，再轮询任务状态，最后下载视频内容。

### 5.1 创建视频任务

```text
POST /videos
```

完整地址：

```text
https://v2api.top/v1/videos
```

### 5.2 请求参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `model` | string | 是 | 视频生成模型名称 |
| `prompt` | string | 是 | 视频生成提示词 |
| `seconds` | number | 否 | 视频秒数，例如 `6`、`10`、`12` |
| `size` | string | 否 | 视频尺寸，例如 `1280x720`、`720x1280` |
| `resolution_name` | string | 否 | 清晰度，例如 `480p`、`720p` |

### 5.3 创建任务示例

```bash
curl https://v2api.top/v1/videos \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -F "model=sora-2" \
  -F "prompt=一只白色机器人在海边散步，夕阳，电影感，镜头缓慢横移" \
  -F "seconds=12" \
  -F "size=1280x720" \
  -F "resolution_name=720p"
```

### 5.4 创建任务返回示例

```json
{
  "id": "video_task_id",
  "status": "queued"
}
```

保存返回的 `id`，用于后续查询任务状态。

### 5.5 查询任务状态

```text
GET /videos/{task_id}
```

示例：

```bash
curl https://v2api.top/v1/videos/video_task_id \
  -H "Authorization: Bearer YOUR_API_KEY"
```

返回示例：

```json
{
  "id": "video_task_id",
  "status": "completed"
}
```

常见状态：

| 状态 | 说明 |
| --- | --- |
| `queued` | 排队中 |
| `in_progress` | 生成中 |
| `completed` | 已完成 |
| `failed` | 生成失败 |
| `cancelled` | 已取消 |

### 5.6 下载视频结果

```text
GET /videos/{task_id}/content
```

示例：

```bash
curl https://v2api.top/v1/videos/video_task_id/content \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -o result.mp4
```

## 6. JavaScript 示例

### 6.1 图片生成

```ts
const response = await fetch("https://v2api.top/v1/images/generations", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "gpt-image-2",
    prompt: "一张未来感跑车海报，夜晚城市道路，商业摄影",
    size: "1024x1024",
    n: 1,
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const data = await response.json();
console.log(data.data?.[0]?.url || data.data?.[0]?.b64_json);
```

### 6.2 视频生成

```ts
const response = await fetch("https://v2api.top/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "grok-imagine-video",
    messages: [
      {
        role: "user",
        content:
          "生成一个雨夜城市街头的电影感视频，霓虹灯反射在湿润路面上。\n\n视频时长：12 秒。请按该时长生成视频。",
      },
    ],
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

const data = await response.json();
const content = data.choices?.[0]?.message?.content || "";
console.log(content);
```

## 7. Python 示例

### 7.1 图片生成

```python
import requests

response = requests.post(
    "https://v2api.top/v1/images/generations",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json",
    },
    json={
        "model": "gpt-image-2",
        "prompt": "一张未来感跑车海报，夜晚城市道路，商业摄影",
        "size": "1024x1024",
        "n": 1,
    },
    timeout=120,
)

response.raise_for_status()
data = response.json()
print(data["data"][0].get("url") or data["data"][0].get("b64_json"))
```

### 7.2 视频生成

```python
import requests

response = requests.post(
    "https://v2api.top/v1/chat/completions",
    headers={
        "Authorization": "Bearer YOUR_API_KEY",
        "Content-Type": "application/json",
    },
    json={
        "model": "grok-imagine-video",
        "messages": [
            {
                "role": "user",
                "content": "生成一个雨夜城市街头的电影感视频，霓虹灯反射在湿润路面上。\n\n视频时长：12 秒。请按该时长生成视频。",
            }
        ],
    },
    timeout=180,
)

response.raise_for_status()
data = response.json()
print(data["choices"][0]["message"]["content"])
```

## 8. 错误码说明

| HTTP 状态码 | 说明 | 处理建议 |
| --- | --- | --- |
| `400` | 请求参数错误 | 检查 JSON 格式、必填参数和模型参数 |
| `401` | 鉴权失败 | 检查 API Key 是否正确 |
| `403` | 无权限 | 检查账号权限、模型权限或额度 |
| `404` | 接口不存在 | 检查 Base URL 和接口路径 |
| `429` | 请求过快或额度不足 | 降低并发，稍后重试，检查账户额度 |
| `500` | 服务内部错误 | 稍后重试，或联系服务提供方 |
| `502` | 上游服务异常 | 稍后重试，或切换模型 |
| `504` | 请求超时 | 增加客户端超时时间，或降低视频复杂度 |

错误返回格式可能因模型和渠道不同略有差异，接入时建议优先读取：

```text
error.message
msg
```

## 9. 接入建议

- 图片生成建议同时兼容 `url` 和 `b64_json`。
- 视频生成建议优先使用文本式视频生成接口。
- 视频提示词中请明确写出画面内容、镜头运动、风格和时长。
- 视频生成耗时较长，客户端请求超时建议设置为 `180` 秒。
- 生产环境建议在服务端调用 v2api，再把结果返回给前端。
- 请妥善保管 API Key，不要在公开页面或客户端代码中暴露。


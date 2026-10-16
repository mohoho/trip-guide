---
name: trip-guide-content
description: >-
  Produces 程导览 (trip-guide) published attraction packages (catalog.json and
  {id}.json) with spots, slides, narration, coordinates, and optional
  assets. Use when generating or editing 程导览 导览内容, 发布包, PublishedAttraction,
  catalog, or when an external AI should output content for tour-hub-web/public/spots.
---

# 程导览内容生产

为「程导览」应用（`tour-hub-web`，包名 `trip-guide`）生产可直接投放的导览 JSON。应用读取：

```
tour-hub-web/public/spots/catalog.json
tour-hub-web/public/spots/{id}.json
```

运行时类型在 `tour-hub-web/src/lib/tourPackage.ts`。

## 工作流

1. 向用户确认景点名称、城市、节点数量（默认 4–6）
2. 生成 `PublishedAttraction`（`schemaVersion: 1`）
3. 写入 `tour-hub-web/public/spots/{id}.json`
4. 更新 `catalog.json`：按 `id` upsert 目录项（封面用可直接展示的 URL 或 data URL）
5. 坐标未知时：写合理 `searchHint` 式地名到节点名/副标题，并把 `lng/lat` 标为待校准占位（景区中心附近小偏移）；提醒用户在 `/publish/:id` 地图阶段微调

## 文件约定

| 文件 | 类型 |
|---|---|
| `catalog.json` | `AttractionCatalog` |
| `{id}.json` | `PublishedAttraction`（每个景点一个文件） |

## PublishedAttraction（必填）

```json
{
  "schemaVersion": 1,
  "id": "yuyuan",
  "name": "豫园",
  "description": "一句话简介",
  "start": { "lng": 121.49185, "lat": 31.22732 },
  "zoom": 17.5,
  "coverImage": "/spots/yuyuan/san-sui-tang.jpg",
  "publishedAt": 1710000000000,
  "spots": [],
  "assets": {}
}
```

### Spot

- `id`：kebab-case，稳定唯一
- `name` / `poetic`
- `lng` / `lat`：WGS84 近似即可，发布页可再拖
- `triggerRadiusMeters`：默认 `38`
- `image`：`assets/...` 键、data URL、https、或站点相对路径如 `/spots/{id}/xxx.jpg`
- `imageCredit`
- `slides[]`：至少 1 页；`title`、`bullets`（2–5 条）、`narration`（80–150 字口语）

### assets（推荐）

```json
"assets": {
  "assets/yuyuan/san-sui-tang.jpg": "data:image/jpeg;base64,..."
}
```

节点 `image` / `coverImage` 写对应键。目录项 `coverImage` 应解析为可直接给 `<img src>` 的值（data URL 或 https 或已有静态路径）。

### catalog.json

```json
{
  "schemaVersion": 1,
  "updatedAt": 1710000000000,
  "items": [
    {
      "id": "yuyuan",
      "name": "豫园",
      "description": "…",
      "coverImage": "/spots/yuyuan/san-sui-tang.jpg",
      "publishedAt": 1710000000000
    }
  ]
}
```

## 内容准则

- 中文；史实谨慎，不确定处用「相传」「据说」
- 导览顺序：入口 → 主景 → 收束
- 不要编造精确开放时间/门票价格
- 演示期不要用 AI 乱造假实景图；无图时用 `/spots/map-intro.jpg` 占位并注明需人工上传

## 校验清单

- [ ] `schemaVersion === 1`
- [ ] `spots.length >= 1`
- [ ] 每个 spot 有 `image` 与至少一页 slide
- [ ] `start` / `zoom` 合法
- [ ] catalog 中存在对应 `id`
- [ ] JSON 可被 `JSON.parse`，无尾逗号

## 示例

最小节点：

```json
{
  "id": "san-sui-tang",
  "name": "三穗堂",
  "poetic": "一麦三穗 · 迎客之始",
  "lng": 121.49185,
  "lat": 31.22732,
  "triggerRadiusMeters": 38,
  "image": "/spots/map-intro.jpg",
  "imageCredit": "",
  "slides": [
    {
      "title": "三穗堂",
      "bullets": ["豫园正门大厅", "取意一麦三穗"],
      "narration": "欢迎来到豫园。我们现在所在的位置是三穗堂，正门大厅，寓意丰收与吉祥。"
    }
  ]
}
```

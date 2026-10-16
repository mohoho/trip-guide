# 程导览 设计文档

> 品牌「程导览」· 工程名 `trip-guide` · 前后台共用 `public/spots`

## 仓库

```
trip-guide/                               # 仓库根即应用（包名 trip-guide）
├── public/spots/                         # 唯一已发布数据源（catalog + 各景点文件）
├── src/lib/tourPackage.ts
├── docs/
└── README.md
```

## 数据

| 用途 | 来源 |
|---|---|
| 前台列表 / 导览 | `public/spots/catalog.json` + `{id}.json` |
| 发布后台列表 | **同一 catalog**；另附尚未发布的本地草稿 |
| 编辑中草稿 | `localStorage`（`trip-guide:drafts:v1`） |
| 点「发布」 | 写入本应用 `public/spots/` |

## 发布流程

1. **确定范围**（`/publish/:id`）：名称、城市；高德检索景区与周边地点 → 勾选候选；「相对位置」画布看主景点与已选地点的方位
2. **地点与内容**（`/publish/:id`，地图选点工作台）：用勾选结果生成节点 →「按名称定位」用高德刷新坐标 → 拖标记校准 → 拖绿标定游客起点；全部节点写过文案后才可发布
3. **内容创作**（`/publish/:id/content`，独立页、不挂地图）：「AI 生成讲解」按节点逐个写文案、并顺带写好景点简介 → 逐条改文案 / 传图 → 发布；点「调整地点」退回第 2 步重新拖坐标

**坐标在第 2 步定、文案与简介在第 3 步写**，两边互不覆盖（重跑 AI 不动坐标，重定位不动文案）。详见 `docs/note/01-发布编辑器-地图选点与内容创作.md`。

## 路由

`/` 前台 · `/tour/:id` 导览 · `/publish` 后台 · `/publish/:id` 编辑器（阶段一 / 二）· `/publish/:id/content` 内容创作

## 本地

```bash
npm install && npm run dev
```

环境变量：`VITE_AMAP_KEY`、`VITE_AMAP_SECURITY_CODE`、`VITE_DEEPSEEK_*`

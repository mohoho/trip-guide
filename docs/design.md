# 程导览 设计文档

> 品牌「程导览」· 工程名 `trip-guide` · 前后台共用 `public/spots`

## 仓库

```
trip-guide/
├── tour-hub-web/                        # 统一应用（包名 trip-guide）
│   ├── public/spots/                    # 唯一已发布数据源（catalog + 各景点文件）
│   └── src/lib/tourPackage.ts
├── .cursor/skills/trip-guide-content/   # 外部 AI 生产导览包
├── docs/screenshots/                    # README 展示截图
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

1. **确定范围**：名称、城市、简介；高德检索景区与周边地点  
2. **地点与内容**：把高德地点喂给 AI → 生成讲解节点 → 再定位到地图；同一屏改文案/传图/拖标记后发布  

## 路由

`/` 前台 · `/tour/:id` 导览 · `/publish` 后台 · `/publish/:id` 编辑器

## 本地

```bash
cd tour-hub-web && npm install && npm run dev
```

环境变量：`VITE_AMAP_KEY`、`VITE_AMAP_SECURITY_CODE`、`VITE_DEEPSEEK_*`

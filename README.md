# 程导览 · trip-guide

景点实地导览：前台高德地图漫游 + 发布后台（定范围 → AI 结合高德地点生成内容 → 发布）。

![首页](docs/screenshots/home.png)

## 功能一览

| 场景 | 说明 |
|---|---|
| 前台选景点 | 浏览已发布景点，进入导览 |
| 实地导览 | 高德地图、步行路线、节点讲解、可选 AI 问答 |
| 发布后台 | 确定旅游范围 → AI+高德生成节点 → 改文案/传图/拖标记 → 一键写入 `public/spots` |

![发布后台](docs/screenshots/publish.png)

![导览页](docs/screenshots/tour.png)

![编辑器](docs/screenshots/editor.png)

## 快速开始

```bash
cd tour-hub-web
cp .env.example .env   # 填入高德 Key / DeepSeek
npm install
npm run dev
```

打开 http://localhost:5173

- `/` 前台  
- `/tour/:id` 导览  
- `/publish` 发布后台  

## 环境变量

见 `tour-hub-web/.env.example`：

- `VITE_AMAP_KEY` / `VITE_AMAP_SECURITY_CODE` — 高德 JS API  
- `VITE_DEEPSEEK_*` — 导览内容生成（可选；未配置时用本地 mock）

## 数据与契约

已发布内容存放在：

```
tour-hub-web/public/spots/catalog.json
tour-hub-web/public/spots/{id}.json
```

外部 AI 生产内容请遵循：`.cursor/skills/trip-guide-content/SKILL.md`  
设计说明：`docs/design.md`  
高德检索说明：`docs/amap-search.md`

## 仓库结构

```
trip-guide/
├── tour-hub-web/          # 统一应用（包名 trip-guide）
├── docs/                  # 设计文档与截图
├── .cursor/skills/        # 内容生产 Skill
└── README.md
```

## License

Private / 内部使用。

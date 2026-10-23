# CentOS + Docker 部署（1Panel 上跑静态站）

> **2026-10-23 更新**：以下是早期纯静态部署记录。当前 Docker 已改为 Node 一体服务，支持在线发布、上传图片和回收站，端口映射为 `8080:3001`，持久化卷为 `publish-data`，生产环境须设置 `PUBLISH_ADMIN_TOKEN`。请以仓库根目录 [README](../../README.md) 的当前部署步骤为准。早期关于“AI key 不出本机”的描述不准确：所有 `VITE_*` 配置都会进入前端产物。

> 状态：**文件已就绪，服务器上尚未跑过**（2026-10-18）。本机没有 Docker，镜像没在本地构建验证，第一次 `build` 就是验证。
> 起因：用户「我打算用 centos 可以帮我制作成一个 docker 进行部署吗」，并已在 1Panel（`http://49.235.29.49:8090`）里登录
> 涉及：新增 `Dockerfile`、`docker-compose.yml`、`nginx.conf`、`.dockerignore`
> 关联：后端方案见 [doc-06](file:///D:/Users/qmruan/Desktop/item/tour-hub/docs/note/06-%E8%85%BE%E8%AE%AF%E4%BA%91%E9%83%A8%E7%BD%B2%E4%B8%8E%E5%8F%91%E5%B8%83%E5%90%8E%E7%AB%AF.md)

## 1. 一句话

镜像是「**Nginx + 本地构建好的 `dist`**」——服务器上不装 Node、不放源码、不碰密钥，构建只做一次 `COPY`。宿主 80 已经被 1Panel 的 OpenResty 占着，所以容器走 **8080**。

## 2. 为什么构建放在本地

- `VITE_*` 是**构建期内联**的（[aiConfig.ts](file:///D:/Users/qmruan/Desktop/item/tour-hub/src/lib/aiConfig.ts)、[main.tsx](file:///D:/Users/qmruan/Desktop/item/tour-hub/src/main.tsx#L6)），本地构建意味着 **AI key 与高德 key 不出本机**，也不必在服务器上配 Node 环境变量。
- `dist` 在 `.gitignore` 里、服务器上也没有 `.env` —— 反过来在服务器构建还得专门传密钥，更麻烦。
- 代价：`.dockerignore` 会把 `src`/`public` 挡在构建上下文外，所以 **`COPY dist/` 找不到 `dist` 就会直接失败**，也就是构建前必须先在本机跑 `npm run build`。

## 3. 服务器现状（2026-10-18 从 1Panel 读到）

| 项 | 值 |
|---|---|
| 面板 | 1Panel v2.0.15 社区版，`http://49.235.29.49:8090`（开了安全入口，入口路径由 `1pctl user-info` 给） |
| 已跑容器 | `1Panel-redis-20K7`（redis:8.4.0，宿主 6379）、`1Panel-openresty-M0yu`（1panel/openresty 1.27.1.2-5-1-focal） |
| 网站 | 1 个反向代理站，域名 `49.235.29.49`，HTTP，**占着 80** |
| 结论 | 容器不能抢 80/443；`docker compose` 由 1Panel v2 自带，无需另装 |

仓库 remote 有三个：`github`（`github.com/mohoho/trip-guide`）与两个内网 `git.dev.sh.ctripcorp.com` 的。**内网那两个服务器够不着**，所以「服务器上 git clone」这条只在用 github remote 时成立。

## 4. 步骤

1. **本地构建**：`npm run build` → 产物 `dist/`（`.env` 必须已就位，否则 key 是空的）。
2. **传四样到服务器同一目录**（建议 `/opt/trip-guide`）：`dist/`、`Dockerfile`、`nginx.conf`、`docker-compose.yml`、`.dockerignore`。
   - 用 1Panel 的「文件」上传，或 `scp`。
3. **在服务器那个目录下构建并起容器**：
   ```bash
   cd /opt/trip-guide
   docker compose up -d --build
   ```
4. **本机浏览器验证** `http://49.235.29.49:8080/`：首页应出现景点卡片（当前是「红山动物园」「豫园」两条）。
5. **高德侧放行**：高德开放平台 → 应用管理 → 该 key 的「Web端(JS API)」域名白名单里加上 `49.235.29.49`（之后上域名就加域名），否则地图空白。
6. **要域名 + HTTPS**：1Panel → 网站 → 创建网站 → **反向代理** → 目标 `http://127.0.0.1:8080`，证书用 1Panel 的免费 Let's Encrypt 签发。这样对外是 443，容器仍只在 8080 上，不抢 OpenResty 的位。

## 5. 待拍板

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| 1 | 宿主端口 | **① 8080** / ② 其他（换个没占用的） | **①** |
| 2 | 景点数据挂不挂出来 | ① **不挂**：数据烘进镜像，更新数据=重新 build / ② 挂 `/opt/trip-guide/spots`：加景点只需传文件，但要先手动把 `public/spots` 拷上去 | **①**（先用①跑通，内容迭代频繁了再换②） |
| 3 | 发布端后端要不要一起进 compose | ① **这轮不做**，前台能看就行 / ② 加一个 Node 服务进同一 compose（即 [doc-06](file:///D:/Users/qmruan/Desktop/item/tour-hub/docs/note/06-%E8%85%BE%E8%AE%AF%E4%BA%91%E9%83%A8%E7%BD%B2%E4%B8%8E%E5%8F%91%E5%B8%83%E5%90%8E%E7%AB%AF.md) 的 B 方案，写本地磁盘最省事） | **①**（路演只要前台） |
| 4 | 源码怎么上服务器 | ① **只传那四样**（dist + 三个配置）/ ② 服务器 clone github remote（需仓库公开且服务器能连 GitHub）/ ③ 传源码在服务器构建（要配 build args 传密钥） | **①** |
| 5 | 现在就上域名吗 | ① **先 IP:8080 验证**，再配域名 / ② 直接上域名 + HTTPS | **①** |

## 6. 坑

- **拉不动基础镜像**：腾讯云到 Docker Hub 常超时。`Dockerfile` 里注释了国内源写法（`FROM docker.m.daocloud.io/library/nginx:alpine`），或在 1Panel 里配镜像加速。
- **别把容器映射到 80**：和 1Panel 的 OpenResty 直接冲突，网站会全挂。要对外就走「1Panel 网站反代 → 127.0.0.1:8080」。
- **密钥会进 JS bundle**：`VITE_DEEPSEEK_API_KEY`、`VITE_AMAP_*` 内联在 `dist/assets/*.js` 里，公网谁都能扒出来。这是 [doc-06](file:///D:/Users/qmruan/Desktop/item/tour-hub/docs/note/06-%E8%85%BE%E8%AE%AF%E4%BA%91%E9%83%A8%E7%BD%B2%E4%B8%8E%E5%8F%91%E5%B8%83%E5%90%8E%E7%AB%AF.md) D3 那条，这轮没解——要解就得把 AI 调用收到服务端代理里。
- **HTTP 下高德部分能力受限**：先用 `IP:8080` 是 http，定位一类能力可能不可用；上 HTTPS 后正常。
- **发布端在线上不可用**：静态站没有 `/__trip_guide/*`，管理页里点「发布」会回落成下载两个 JSON 文件、点「删除」直接报错（[doc-06](file:///D:/Users/qmruan/Desktop/item/tour-hub/docs/note/06-%E8%85%BE%E8%AE%AF%E4%BA%91%E9%83%A8%E7%BD%B2%E4%B8%8E%E5%8F%91%E5%B8%83%E5%90%8E%E7%AB%AF.md)）。所以**内容在本地发布好、再重新 build**。
- **更新数据的两个口径**：只改景点内容 → 拍第 2 条②挂卷后传文件；改了代码 → 必须重新 `npm run build` + `docker compose up -d --build`。

## 7. 验证清单（待回填）

- `docker compose up -d --build` 成功；`docker ps` 里 `trip-guide-web` 是 `Up`
- `http://49.235.29.49:8080/` 出首页，两条景点卡片，banner 轮播正常
- 进 `/tour/yuyuan`（打卡）与 `/tour/attr-mvbsg4kw`（故事）：地图出图、路线能算、走动能播讲解
- 两页问答：「问 AI」/「问线索」给真实回答（若 401/无响应，看是不是 key 没进构建）
- 响应头核对：`/spots/catalog.json` 带 `Cache-Control: no-cache`，`/assets/index-*.js` 带 `max-age=31536000`
- 刷新带路径的地址（如 `/tour/yuyuan`）不白屏
- `docker compose logs web` 无异常；1Panel 容器页能看到新容器

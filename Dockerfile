# 静态站点镜像：只把本地构建好的 dist 装进 Nginx。
#
# 构建刻意放在本地（`npm run build`），镜像里只做 COPY：
#   1. VITE_* 是构建期内联的，本地构建意味着密钥不出本机、也不必在服务器上配 Node；
#   2. 服务器上无需装 Node/依赖，构建只花打包 dist 的时间。
# 所以这个 Dockerfile **必须在本地先跑过 `npm run build`**，否则 `COPY dist/` 会失败。
#
# 拉不动 nginx:alpine 时（腾讯云到 Docker Hub 时常超时）换成国内镜像源再 build：
#   FROM docker.m.daocloud.io/library/nginx:alpine
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/ /usr/share/nginx/html/

EXPOSE 80

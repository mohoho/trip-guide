# PublishEditorPage · 高德检索使用说明

> 范围：`tour-hub-web/src/pages/PublishEditorPage.tsx` 及其高德依赖
> 依据：高德地图 JS API v2.0 官方文档（查阅于 2026-10-15）+ 本项目源码

## 1. 总览：这个页面用了高德的三块能力

| 位置 | 能力 | 高德插件 | 代码 |
|---|---|---|---|
| 阶段一「检索范围」 | POI 关键字搜索 + **周边搜索** | `AMap.PlaceSearch`（`search` / `searchNearBy`） | `src/lib/amapLocate.ts` → `resolveAttractionScope()` |
| 阶段二「AI 生成并定位」 | POI 关键字搜索（逐节点） | `AMap.PlaceSearch` | `src/lib/amapLocate.ts` → `locateAttractionOnMap()` |
| 「城市 / 区域」下拉 | 行政区查询 | `AMap.DistrictSearch` | `src/lib/amapDistrict.ts` → `loadCityDistricts()` |

（编辑地图本身用 `AMap.Map` / `AMap.Marker`，导览页用 `AMap.Walking`，不在本文范围。）

## 2. 前置条件：key 与安全密钥

官方要求：

- 需要申请 **web 平台（JS API）的 key + 安全密钥**
- **2021-12-02 之后申请的 key，必须配合安全密钥一起使用**
- 两种配置方式：
  - **明文**：`window._AMapSecurityConfig = { securityJsCode: "..." }` —— 官方明确「不建议在生产环境使用」
  - **代理转发**：`window._AMapSecurityConfig = { serviceHost: "你的域名/_AMapService" }` + Nginx/Node 代理带上 `jscode` —— 官方「强烈建议使用（安全）」

本项目的做法是**明文**，写在 `src/main.tsx`，且在 JS API 加载之前执行：

```ts
window._AMapSecurityConfig = {
  securityJsCode: import.meta.env.VITE_AMAP_SECURITY_CODE || '',
}
```

环境变量：`VITE_AMAP_KEY`、`VITE_AMAP_SECURITY_CODE`（模板见 `tour-hub-web/.env.example`）。

> ⚠️ `securityJsCode` 会打进前端产物，**仅适合开发 / 演示**。要上线请改走代理 `serviceHost`。

## 3. 加载方式

用 `@amap/amap-jsapi-loader` 按需加载，只装用到的插件：

```ts
AMapLoader.load({ key, version: '2.0', plugins: ['AMap.PlaceSearch'] })
```

- 同一页面内是**单例**：`amapLocate.ts` 用 `placeSearchPromise` 缓存实例，`amapDistrict.ts` 用 `districtsPromise`，避免重复加载与重复构造。

## 4. 阶段一：确定范围（`resolveAttractionScope`）

触发：阶段一点「检索景区 / 重新检索」；或阶段二发现 `amapContext` 为空时自动补检索一次。

流程：

1. 名称必填，否则抛「请先填写景点名称」
2. 按 `名称` 搜索（`searchList`）；结果为空 → 隔 120ms 用 `名称 + 景区` 再搜一次
3. 仍为空 → 抛「高德未找到「X」，请调整名称或城市后再试」
4. 取 `poiList.pois[0]` 作为主景区 POI
5. `resolvedCity = 城市 || poi.cityname || poi.pname`
6. **周边扫描**：以主景区坐标为圆心，隔 150ms 调 `searchNearBy('景点', [lng, lat], 800, cb)`；再按 `type` 滤掉餐饮 / 购物 / 停车场等噪声，按 `distance` 由近到远
7. 隔 150ms 再按名称搜一轮，取同名景区下的子景点，追加进候选
8. 候选仍少于 3 条时，隔 120ms 用 `名称 + 景点` 再补一轮
9. 三路候选统一去重、封顶 12 条（`NEARBY_LIMIT`）
10. 产物写回草稿（同时把候选存进草稿；**只在阶段一**「高德范围」下方以「附近候选地点」列表呈现，勾选后一键生成节点）：
   - `start` = 主景区坐标
   - `zoom` = `17`（阶段二定位后会改写为 `17.5`）
   - `city` = 解析出的城市
   - `amapContext` = 给 AI 的文本（`buildAmapContextText()`）

`amapContext` 长这样（阶段二原样喂给 DeepSeek）：

```
主景区：豫园
行政区：上海市黄浦区
类型：风景名胜;公园广场;公园
地址：上海市黄浦区安仁街 218 号
坐标：121.49185, 31.22732
周边/相关地点（来自高德检索，可作导览节点参考）：
1. 三穗堂 · 类型:... · 地址:... · 121.49185,31.22732
...
```

## 5. PlaceSearch 参数对照（官方 vs 本项目）

官方教程《搜索地点（JS API 2.0）》原表（最后更新 2024-07-12）：

| 参数 | 说明 | 取值范围 | 官方默认 |
|---|---|---|---|
| `pageSize` | 单页显示结果条数 | 0 - 100 | 20 |
| `pageIndex` | 页码 | >= 1 | 1 |
| `city` | 兴趣点城市 | 城市名（中文 / 全拼）、citycode、adcode | `'全国'` |
| `citylimit` | 是否强制限制在设置的城市内搜索 | `true` / `false` | `false` |
| `map` | 结果渲染到的地图实例 | AMap.Map | - |
| `panel` | 结果列表的 HTML 容器 | String / HTMLElement / `false` | - |
| `autoFitView` | 搜索后是否自动调整视野 | `true` / `false` | - |
| `search(keyword, cb)` | 关键字搜索，支持中文、拼音 | Function | - |

本项目实际取值（`amapLocate.ts`）：

```ts
new AMap.PlaceSearch({
  pageSize: 8,
  pageIndex: 1,
  citylimit: false,
  extensions: 'all',
})
```

逐条对应：

- `pageSize: 8` —— 只用**第一页 8 条**；本项目在这 8 条里再挑候选（「上限 10」其实达不到，单次搜索最多给 7 条备选）
- `citylimit: false` —— **不强制**限制城市。城市填错时仍能搜到结果；代价是可能命中外地同名景点
- **不传 `map` / `panel` / `autoFitView`** —— 完全不用官方的结果面板，直接在 `search()` 回调里取数据自己渲染
- `extensions: 'all'` —— 该属性**不在上面那份教程表格里**（教程只列本章用到的属性），完整定义见参考手册；对应地代码会读 `type / address / tel / pname / cityname / adname` 等更详细的字段
- 城市是**每次搜索前**动态设置的：`ps.setCity(city)`，不是在构造时固定

另外，`AMap.PlaceSearch` 还有两个可用方法（官方《输入提示与 POI 搜索》教程）：

| 方法 | 说明 | 参数 |
|---|---|---|
| `searchNearBy(keyword, center, radius, callback)` | 按中心点 + 半径做**周边查询** | `radius` 取值 **0-50000**（米）；周边结果会额外返回 `distance`（米） |
| `searchInBounds(keyword, bounds, callback)` | 按**矩形范围**查询 | `bounds`：范围坐标 |

## 6. 回调契约

`search(keyword, (status, result) => ...)`：

- 只有 `status === 'complete'` 算成功；**其它值（含 `no_data` / `error`）本项目一律当「无结果」**处理并返回 `[]`
- 成功时读取 `result.poiList.pois[]`，本项目只取：`name / type / address / tel / pname / cityname / adname / location`
- `location` 同时兼容对象 `{ lng, lat }` 与字符串 `"lng,lat"` 两种形态

## 7. 阶段二：定位节点（`locateAttractionOnMap`）

对每个节点依次：

1. 优先用 `spot.searchHint`（AI 生成、形如「上海 豫园 三穗堂」）；没有则退化成 `${景点名} ${节点名}`
2. 搜不到 → 隔 80ms 用 `${景点名} ${节点名}` 再搜一次
3. 两次都失败 → **环形兜底**：在主景区坐标周围 0.00035°（约 39m）圆周上均匀放点，避免失败节点全部叠在一起
4. 返回 `locatedCount`，编辑器据此提示「已定位 N 个节点」或「坐标需在地图上拖动校准」

## 8. 城市下拉：DistrictSearch

`CityRegionSelect` 组件 → `loadCityDistricts()`：

```ts
new AMap.DistrictSearch({ level: 'country', subdistrict: 2, extensions: 'base' })
ds.search('中国', cb)   // 取 result.districtList[0].districtList 作为省级列表
```

官方教程《行政区查询（JS API 2.0）》原表（最后更新 2024-07-15）：

| 参数 | 说明 | 取值 | 官方默认 |
|---|---|---|---|
| `level` | 关键字对应的行政区级别或商圈 | `country` / `province` / `city` / `district` / `biz_area` | - |
| `subdistrict` | 返回下级行政区的级数 | 0 / 1 / 2 / 3 | 1 |
| `extensions` | 是否返回行政区边界坐标点 | `base`（不返回边界）/ `all`（返回完整边界） | `base` |
| `search()` | 关键词查询方法 | Function | - |

本项目：

- `subdistrict: 2` → 一次拿到「国家 → 省 → 市」两级
- `extensions: 'base'` → **不要边界坐标**（只画下拉，不画行政边界），正好是官方默认值
- `status` 取值同官方约定：`complete` 成功 / `no_data` 无结果 / `error` 出错
- 结果缓存在 `sessionStorage`（键 `trip-guide:amap-districts:v1`），一个会话只拉一次
- 直辖市 / 特别行政区在省下没有「市」级，`citiesOfProvince()` 做了特判；`matchProvinceCity()` 负责把已有的 `city` 字符串反推回下拉选中项
- **兜底**：DistrictSearch 加载失败时，组件退化成手动输入框（提示「可改为手动输入」）

## 9. 限流

- 所有搜索**串行**执行，节点之间 `await sleep(80~150ms)`，避免瞬间打爆配额
- 没有并发池、没有重试退避（只有上面说的「换个关键词再搜一次」）
- 节点多时会比较慢：每个节点至少 1 次请求

## 10. 错误码对照（官方《错误码描述》，最后更新 2023-04-17）

检索 / 定位常遇到的：

| info | 含义 | 排查 |
|---|---|---|
| `OK` | 请求正常 | - |
| `SERVICE_NOT_AVAILABLE` | 服务不可用 | 没权限使用该服务 / 接口路径拼写错误 |
| `INVALID_USER_KEY` | key 不正确或过期 | 检查 key |
| `INVALID_USER_SCODE` | **安全码未通过验证** | 检查安全密钥与 key 是否匹配（本项目最容易踩） |
| `INVALID_USER_DOMAIN` | 绑定域名无效 | 控制台重新设置域名 |
| `USERKEY_PLAT_NOMATCH` | key 与绑定平台不符 | 例如拿 JS API 的 key 去调 Web 服务接口 |
| `INSUFFICIENT_PRIVILEGES` | 权限不足 | 未申请该服务 |
| `INVALID_PARAMS` | 请求参数非法 | 参数值超出取值范围 |
| `MISSING_REQUIRED_PARAMS` | 缺少必填参数 | - |
| `ENGINE_RESPONSE_DATA_ERROR` | 服务响应失败 | 3 开头错误码先查参数，再提工单 |

路径规划类（导览页 `AMap.Walking` 会遇到）：`OUT_OF_SERVICE`（规划点不在中国陆地范围）、`NO_ROADS_NEARBY`（附近搜不到路）、`ROUTE_FAIL`（道路连通关系导致）、`OVER_DIRECTION_RANGE`（起终点距离过长）。

## 11. 常见问题

**「高德地图加载失败，请检查 Key / 安全密钥 / 网络」**
→ 大概率是 `INVALID_USER_SCODE`：`.env` 的 `VITE_AMAP_SECURITY_CODE` 没填或填错；或 key 是 2021-12-02 之后申请的却没配安全密钥。

**搜不到景点 / 搜到外地同名景点**
→ 城市没选对，而本项目 `citylimit: false`（不强制限制城市）。

**节点坐标不准**
→ 阶段二直接在编辑地图上拖标记校准；或改写该节点的 `searchHint`（AI 生成，可手改）后重新定位。

## 12. 已知限制 / 可改进

- `pageSize: 8` 固定且不分页；同名 POI 多时可能选错主景区（现在直接取第 0 条）
- `citylimit: false` → 没填城市时容易匹配到外地
- 没有区分 `status`：`no_data` 与 `error` 都被当成空结果，用户看不到真实原因
- 限流只靠 `sleep`，没有并发控制 / 重试 / 退避
- 周边扫描的关键词写死为 `'景点'`，噪声过滤是**基于 `type` 文案的黑名单**（`NOISE_TYPE_KEYWORDS`）→ 可能漏掉或带进个别 POI。更精确的做法是用官方《POI 分类编码和城市编码表》里的**分类编码**配合 `setType()`
- 「检索范围」现在多花 1 次请求（周边扫描），配额消耗相应上升
- `extensions` 未在教程页文档化，建议以参考手册为准

## 附：参考来源

- 搜索地点（入门教程）：https://lbs.amap.com/api/javascript-api-v2/tutorails/search-poi （2024-07-12）
- 行政区查询（进阶教程）：https://lbs.amap.com/api/javascript-api-v2/guide/services/district-search （2024-07-15）
- 安全密钥：https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode
- 错误码描述：https://lbs.amap.com/api/javascript-api-v2/guide/abc/errorcode （2023-04-17）
- 参考手册（完整属性/方法）：https://lbs.amap.com/api/javascript-api-v2/documentation
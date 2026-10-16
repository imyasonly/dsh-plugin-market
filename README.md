# @baitongserver/dsh-plugin-market

在 **DeepSeek Harness（DSH）** 中浏览、搜索并安装**百通插件市场的 DSH 插件**与**百通技能库技能** —— 侧栏一个「百通插件广场」面板，或直接对 Agent 说话。

- 兼容 DSH **web 与桌面端（GUI）**，装完即用
- 支持私有化部署，改配置即可，无需重新编译（见[配置](#配置)）

源码：[github.com/imyasonly/dsh-plugin-market](https://github.com/imyasonly/dsh-plugin-market) ·
遇到问题请提 [issue](https://github.com/imyasonly/dsh-plugin-market/issues)

## 目录

- [功能](#功能)
- [环境要求](#环境要求)
- [安装](#安装)
- [使用](#使用)
- [配置](#配置)
- [数据与网络](#数据与网络)
- [故障排查](#故障排查)
- [安全](#安全)
- [本地开发](#本地开发)
- [许可证](#许可证)

---

## 功能

**侧栏「百通插件广场」面板**

- 插件 / 技能双分类页，全部 / 已安装切换、类目筛选、排序
- 插件卡片：详情直达 GitHub、一键安装、实时进度（准备中 → 下载 → 完成）
- 已安装视图：本机只读预览已安装插件与技能（来源 spec、版本、体积、更新时间），可卸载

**Agent 工具**

| 工具 | 作用 |
| --- | --- |
| `baitong_plugin_search` | 搜索百通插件市场的 DSH 插件 |
| `baitong_plugin_install` | 安装指定插件（`owner` + `name`） |
| `baitong_skill_search` | 搜索百通技能库（公共 + 团队） |
| `baitong_skill_install` | 安装指定技能 |
| `baitong_skill_list` | 列出本机已装技能 |
| `baitong_skill_uninstall` | 卸载指定技能 |

**其他**

- 安装完成后可**一键重启 DSH**（桌面端走应用级重启，web 端走进程重启）
- 界面跟随 Harness 的中英文语言设置

---

## 环境要求

- DeepSeek Harness（web 或桌面端）
- Node.js ≥ 22（由 DSH 提供）

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-tools`、`react` 等均由 DSH 提供，**无需自行安装**。

---

## 安装

**Web（CLI）**

```sh
dsh plugin --profile web add @baitongserver/dsh-plugin-market
dsh web
```

**桌面端（GUI）**

```sh
dsh plugin --profile desktop add @baitongserver/dsh-plugin-market
```

装完**需要重启 DSH** 才生效。web 端重启进程并强制刷新浏览器；桌面端可点安装完成横幅上的「立即重启」，或从系统托盘完全退出后重新打开。

**几条容易踩的坑**

- ⚠️ **必须带 `@baitongserver/` scope**。npm 上无前缀名的 `dsh-plugin-market` 是**另一个项目**（`veloce-ailab`），不是本插件。
- `dsh web` 请绑定 `127.0.0.1`，不要监听 `0.0.0.0`。
- 本地开发安装见[本地开发](#本地开发)。

**npm 与 `github:` 两种源都支持**

- **npm（推荐）**：装的是预构建产物，无需任何额外配置。
- **`github:` 源**：安装时会在本机现场构建（`prepare` 脚本），所以目标 profile 要先允许依赖的构建脚本：

  ```yaml
  # ~/.dsh/profiles/<profile>/pnpm-workspace.yaml
  dangerouslyAllowAllBuilds: true
  ```

  放行后重新执行 add 即可。用本插件安装**其他**插件时若遇到同类拦截，会自动写入这一项并重试，无需手动配置。

---

## 使用

直接对 Agent 说即可，例如：

- 找个能处理 PDF 的 skill
- 百通插件里搜一下浏览器自动化的
- 我装了哪些技能
- 把刚才那个卸载掉
- 装一下第一个插件

搜索完成后，对话中会出现可点击卡片；点开详情后再安装。**插件卡片也可以在对话流里直接点「安装」**，进度就地显示，装完按横幅提示「立即重启」。

侧栏底部的**「百通插件广场」**会在聊天区打开独立面板（可切换 插件 / 技能），面板盖在会话列上，关掉后直接回到对话。

> Agent 已被约束为只调用本插件的工具，不会打印 `dsh plugin` / `npm` / `curl` 命令。

---

## 配置

设置页中本插件的配置项 id 为 **`baitong-plugin-market`**（路径：设置 → 插件 → 插件配置）：

| 项 | 说明 |
| --- | --- |
| `apiBase` | 百通 API 根地址（不含 `/api`），用于指向私有化部署 |
| `skillsDir` | 技能安装目录，默认 `$DSH_HOME/skills` |
| `timeoutMs` | 上游请求超时（毫秒），默认 `20000` |
| `maxResults` | 搜索结果上限，默认 `12` |
| `userAgent` | 请求 UA |

保存后立即生效。配置写入 `$DSH_HOME/baitong-market.json`，不会进入 git。

### apiBase 覆盖链（高 → 低）

| 优先级 | 来源 | 适用场景 |
| --- | --- | --- |
| 1 | 环境变量 `BAITONG_API_BASE` | CLI 启动，最高 |
| 2 | 设置页保存 → `$DSH_HOME/baitong-market.json` | GUI，⚠️ 会覆盖下面几项 |
| 3 | `~/.dsh/profiles/<profile>/cordis.patch.yml` | **GUI 启动唯一入口**（自动加载 + 支持热重载） |
| 4 | 仓库内 `cordis.patch.local.yml` + `--patch` | 本地联调，不随包发布 |
| 5 | 默认值 `https://s.1100111.cn/baitong_ai` | 无需配置 |

### 私有化部署示例

GUI 启动无法传 `--patch`，配置写在 profile 层（改这层支持热重载，不必重启）：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- id: baitong-plugin-market
  name: "@baitongserver/dsh-plugin-market"
  config:
    apiBase: https://your-private-host/baitong_ai
```

> patch 的非 insert 项**必须带 `id`**，否则报 `patch: id is required for non-insert patches`。

### 临时换地址（不改文件）

```sh
BAITONG_API_BASE=https://your-private-host/baitong_ai dsh web
```

地址可写裸 `host:port`（自动补 `http://`），尾部斜杠自动去除。

### 确认当前生效地址

不确定连的是哪个地址时，直接查诊断接口（返回里的 `apiBase` 就是实际生效值）：

```sh
curl -X POST http://127.0.0.1:<port>/baitong-market -d '{"method":"pluginInstallStatus"}'
```

---

## 数据与网络

| 用途 | 请求 |
| --- | --- |
| 插件目录 / 类目 | `GET {apiBase}/api/bt/dsh/plugins`、`/categories` |
| 插件安装计划 | `GET {apiBase}/api/bt/dsh/plugins/{owner}/{name}/install-plan` |
| 技能搜索 / 详情 | `GET {apiBase}/api/v1/search`、`/api/v1/skills/{slug}` |
| 技能安装包 | `GET {apiBase}/api/v1/download?slug=`（302 → COS 预签名） |
| 本机面板 | `/baitong-market`（安装进度轮询、图标代理、同源重启） |

- 上游请求有超时（默认 20s），超时与网络失败会给出可读的错误原因
- 网络走**使用者自己的系统配置**，插件不内置任何代理
- 自定义 `apiBase` 应只指向你信任的服务

---

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 点安装后要等一会儿才动 | 正常。服务端要先拉安装计划并做依赖冲突预检，期间显示「正在准备安装…」。**不要重复点击** |
| 提示「已有安装任务在进行中」 | 已有安装任务在跑，看进度条即可；重复点击不会加快 |
| 点「立即重启」没反应 / 提示无法自动重启 | 桌面端从**系统托盘**完全退出 DSH 后重开（只关窗口不够，托盘常驻） |
| 安装失败：`fetch failed` | 网络问题。查诊断接口的 `net.proxy`（进程实际看到的代理环境）与 `apiBase` |
| 装完了但没生效 | 插件需要重启 DSH 才加载 |
| 找不到广场入口 | 点侧栏底部「百通插件广场」；重启 DSH 并强制刷新浏览器 |
| 私有化部署连不上 | 用上面的诊断接口确认 `apiBase` 生效值，再逐层核对覆盖链 |
| 面板停在加载中 | 确认面板是最新构建产物，然后重启 DSH 并强制刷新 |

---

## 安全

- **install-plan 校验链**：拒绝带 `--force` 的安装计划、只接受 `web` profile 的计划、要求 pinned GitHub 规格、`headSha` 与所选插件一致
- **名称白名单**：profile 名与插件包名均按正则校验（`/^[a-z0-9][a-z0-9._-]{0,63}$/i`），防路径穿越
- **loader id 冲突预检**：安装前检查目标包 `cordis.patch.yml` 的 loader id 是否与已装插件冲突，避免装完起不来
- **技能包安全**：zip 解压拒绝路径穿越（zip-slip），必须含 `SKILL.md`；插件不执行技能包内的代码
- 安装第三方插件等于把第三方代码装进你的 profile，**请只安装信任来源**

---

## 本地开发

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm build       # tsc + esbuild 编译 client.js → lib/
dsh plugin --profile web add <本仓库绝对路径>
```

带本仓库配置层启动（联调用）：

```sh
dsh web --patch ./cordis.patch.local.yml
```

只 dump 不启动即可验证 patch 是否命中：

```sh
dsh --profile desktop --dump-config | grep -A4 baitong
# 命中后输出带 "# == @baitongserver/dsh-plugin-market, patched by <patch 文件>" 注释行
```

### 自检套件

改动后跑一遍，全绿共 **263 项**：

```sh
node logs/_verify/verify-all.mjs            # 一次跑完下面 5 套，并核对本文档里的项数是否与实际一致
node logs/_verify/publish-check.mjs          # 84 项 发包前置 + 产物形态 + 隐私 + 文档红线 + 包名/主体/仓库一致性
node logs/_verify/install-ux-check.mjs       # 35 项 进度条展示时机 + 收尾守卫
node logs/_verify/install-fallback-check.mjs # 39 项 网络失败可读化 + 降级分支
node logs/_verify/restart-check.mjs          # 45 项 重启三条路径（真跑）
node logs/_verify/card-check.mjs             # 60 项 卡片结构 + 图标兜底 + 空态居中 + 概述富文本净化
```

### 发布

```sh
pnpm build                            # prepublishOnly 也会自动跑，先跑一次能提前暴露编译错
node logs/_verify/publish-check.mjs   # 发包前置自检
npm pack --dry-run                    # 人工确认白名单内容
npm publish --registry https://registry.npmjs.org/
```

发包要点：

- **scoped 包必须 `access: public`**。`@baitongserver/*` 默认按 `restricted` 处理，
  `npm publish` 会被 registry 拒；已固定在 `package.json` 的 `publishConfig.access`。
- 本机默认 registry 是 npmmirror，发布要显式 `--registry`。
- `lib/` 已在 `.gitignore`（构建产物），但发包走 `files` 白名单，与 `.gitignore` 无关；
  `prepublishOnly` 会在发布时重新构建，**不依赖仓库里的 lib**。
- `files` 白名单只有 4 项：`lib/`、`cordis.patch.yml`、`README.md`、`LICENSE`。
  本机私有化配置 `cordis.patch.local.yml` 不在其中，不会随包泄漏。

### 目录

| 文件 | 作用 |
| --- | --- |
| `src/host.ts` | Cordis 入口：工具注册、systemPrompt、settings、webServer |
| `src/plugin-market.ts` | 百通插件 API + install-plan 校验链 + 冲突预检 |
| `src/skill-market.ts` | 百通技能 API（CLI 兼容接口）+ zip 安装/卸载 + lockfile |
| `src/dsh-cli.ts` | spawn `dsh plugin add` + pnpm ndjson 进度 + allowBuilds 重试 |
| `src/ndjson.ts` | pnpm ndjson 进度解析 |
| `src/unzip.ts` | zip 解压（中央目录定位，zip-slip 防护） |
| `src/restart.ts` | 一键重启 DSH（桌面端 Electron / web 进程） |
| `src/local-api.ts` | 本机 `/baitong-market` HTTP |
| `src/config-store.ts` | 默认值、覆盖链与 `baitong-market.json` overlay |
| `src/client.js` | 广场面板 UI（React/JSX，**由 esbuild 编译**，见下） |

### 客户端构建约定

DSH 浏览器侧通过 `window.__ModuleLoader__.load({ id, factory })` 加载插件面板，
React 由 factory 的 `require('react')` 从客户端模块表注入。因此：

- **不能**写裸 ESM `import 'react'` —— 服务端会试图解析 node_modules，报
  `client-modules: could not load ... via __ModuleLoader.__load`
- **不能**用 `createRoot` 手动挂载 —— DSH 没有 `#xxx-root` 这类 DOM 容器，
  面板必须通过 `slots.inject('sidebar.footer.action', …)` 注册
- JSX 必须编译（浏览器不解析）：`scripts/build-client.mjs` 用 esbuild
  classic runtime（`React.createElement`）转译，`bundle: false` 保留 `require()`
- `react-dom` 也在客户端模块表内（`require('react-dom')`），无需进 package.json 依赖
- 面板样式用 `ctx.effect(() => ensureCss(), 'baitong-market-style')` 注入，跟随
  DSH 主题变量 `--dsw-alias-*`

改完 `src/client.js` 必须 `pnpm build`（`link:` 安装下只重启不重新编译不会生效）。

---

## 许可证

[MIT](./LICENSE) © Yansen

「百通」「DeepSeek」「DeepSeek Harness」等名称归其各自所有者，本项目与它们没有从属或背书关系。
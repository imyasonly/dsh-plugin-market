# 开发与发布

> 面向本仓库开发者。面向使用者的安装与配置说明见 [README.md](./README.md)。
>
> 本文件**不随 npm 包发布**（不在 `package.json` 的 `files` 白名单内），但会随仓库公开。

## 目录

- [本地开发](#本地开发)
- [源码结构](#源码结构)
- [客户端构建约定](#客户端构建约定)
- [自检套件](#自检套件)
- [发布](#发布)

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

🔴 **`link:` 安装方式下，只重启不会生效** —— DSH 直接读仓库里的 `lib/*.js`，
改了 `src/` 必须 `pnpm build`，再重启。

---

## 源码结构

| 文件 | 作用 |
| --- | --- |
| `src/host.ts` | Cordis 入口：工具注册、systemPrompt、settings、webServer |
| `src/plugin-market.ts` | 百通插件 API + install-plan 校验链 + 冲突预检 |
| `src/skill-market.ts` | 百通技能 API（CLI 兼容接口）+ zip 安装/卸载 + lockfile |
| `src/dsh-cli.ts` | spawn `dsh plugin add` + pnpm ndjson 进度 + allowBuilds 重试 |
| `src/registry.ts` | 安装源挑选：读本机 `.npmrc` 实际生效的 registry、探测某源是否有目标版本、镜像未同步时换源 |
| `src/ndjson.ts` | pnpm ndjson 进度解析 |
| `src/unzip.ts` | zip 解压（中央目录定位，zip-slip 防护） |
| `src/restart.ts` | 一键重启 DSH（桌面端 Electron / web 进程） |
| `src/local-api.ts` | 本机 `/baitong-market` HTTP |
| `src/config-store.ts` | 默认值、覆盖链与 `baitong-market.json` overlay |
| `src/client.js` | 广场面板 UI（React/JSX，**由 esbuild 编译**，见下） |

---

## 客户端构建约定

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

## 自检套件

改动后跑一遍，全绿共 **443 项**：

```sh
node logs/_verify/verify-all.mjs            # 一次跑完下面 11 套，并核对本文档里的项数是否与实际一致
node logs/_verify/publish-check.mjs          # 100 项 发包前置 + 产物形态 + 隐私 + 文档红线 + 包名/主体/仓库一致性 + peer/运行时匹配 + dependencies 守卫 + 文档锚点/互链
node logs/_verify/install-ux-check.mjs       # 35 项 进度条展示时机 + 收尾守卫
node logs/_verify/install-fallback-check.mjs # 39 项 网络失败可读化 + 降级分支
node logs/_verify/restart-check.mjs          # 45 项 重启三条路径（真跑）
node logs/_verify/card-check.mjs             # 69 项 卡片结构 + 图标兜底/归一化 + 空态居中 + 概述富文本净化
node logs/_verify/reset-check.mjs            # 41 项 重置只重置本插件（隔离边界）+ 镜像源/更新策略真的回落默认值 + 重置后再保存不复活 + 清宿主残留错误与日志文件
node logs/_verify/platform-check.mjs         # 24 项 Windows/macOS/Linux 子进程 PATH（不写死盘符/家目录、HOME 被 Git Bash 污染时不串味）+ npm 探测（nvm/nvm-windows/fnm/Homebrew）
node logs/_verify/toast-check.mjs            # 19 项 提示条单一出口 + AutoToast 计时确定性 + 关面板不残留
node logs/_verify/install-error-check.mjs    # 23 项 安装报错已读表在模块级（关面板重开不复活）+ 主页轮询不回填 + 新一轮失败仍提示
node logs/_verify/settings-desc-check.mjs    # 18 项 设置分区说明单一渲染点（诊断页不再重复一行）+ 诊断页字段集合（不含接口地址）
node logs/_verify/registry-fallback-check.mjs # 30 项 安装源挑选 + 镜像同步延迟自动换官方源（web/桌面/市场/自定义四条入口）+ 回退顺序回归 + 重置文案声明"日志会被清空"
```

全部为离线静态 + 行为级断言，可直接跑；临时产物一律放 `logs/_verify/_tmp/`。

---

## 发布

```sh
pnpm build                            # prepare 也会自动跑，先跑一次能提前暴露编译错
node logs/_verify/publish-check.mjs   # 发包前置自检
npm pack --dry-run                    # 人工确认白名单内容
npm publish --registry https://registry.npmjs.org/
node logs/_verify/npm-install-check.mjs   # 🔴 必须：装 registry 上的真包、复算 DSH 兼容性判定、核对产物能力标记（10 项）
```

发包要点：

- **发完必须跑 `npm-install-check.mjs`**（它不在 `verify-all` 里，因为要联网）。
  `npm publish` 返回成功 **≠** 用户装得到：staged publishing 会让 `latest` 滞后数分钟，
  期间 `npm i` 装到的是**上一版**；而 `link:` / 本地开发根本测不出 peer 版本错配
  （本地能向上找到宿主那份，线上不能）。该脚本会轮询到的真包装进干净目录，
  对**装到的 manifest** 复算 DSH 的 preflight 判定。
- **scoped 包必须 `access: public`**。`@baitongserver/*` 默认按 `restricted` 处理，
  `npm publish` 会被 registry 拒；已固定在 `package.json` 的 `publishConfig.access`。
- 本机默认 registry 是 npmmirror，发布要显式 `--registry`。
- `lib/` 已在 `.gitignore`（构建产物），但发包走 `files` 白名单，与 `.gitignore` 无关；
  `prepare` 会在发布时重新构建，**不依赖仓库里的 lib**（必须是 `prepare` 而非 `prepublishOnly`：
  后者只在 `npm publish` 跑，会让 `github:` 源装出没有 `lib/` 的空壳）。
- `files` 白名单只有 4 项：`lib/`、`cordis.patch.yml`、`README.md`、`LICENSE`。
  本机私有化配置 `cordis.patch.local.yml` 不在其中，不会随包泄漏。

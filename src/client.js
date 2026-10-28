/**
 * 百通插件广场 · Web 客户端面板。
 * 注入 DSH Web 的独立面板（侧栏底部入口），
 * 内含「插件 / 技能」两个分类页，通过本机 /baitong-market HTTP 轮询数据与安装进度。
 *
 * ⚠️ 契约（dsh client-modules）：浏览器侧只接受
 *   window.__ModuleLoader__.load({ id, factory }) 形态，React/react-dom 由客户端模块表
 *   经 factory 的 require 提供；裸 ESM `import 'react'` 会让服务端解析 node_modules 而失败
 *   （报 client-modules: could not load）。
 *   本文件含 JSX，构建时由 esbuild 编译为 React.createElement 调用（scripts/build-client.mjs）。
 */
/* eslint-disable react-hooks/rules-of-hooks */
window.__ModuleLoader__.load({
  // ⚠️ 必须与 package.json 的 name 和 cordis.patch.yml 的 name 完全一致，
  // 否则 DSH 按 patch 里的 name 去 node_modules 找包、找不到就加载失败
  id: '@baitongserver/dsh-plugin-market',
  factory: (require) => {
    const React = require('react');

    // 面板通过 portal 挂到 document.body：脱离侧栏容器的 overflow 裁剪
    const fallbackPortal = (node) => node;
    let createPortal = fallbackPortal;
    try {
      const rd = require('react-dom');
      if (rd && typeof rd.createPortal === 'function') createPortal = rd.createPortal;
    } catch {
      /* 取不到 react-dom 时降级为内联渲染 */
    }

    const { useState, useEffect, useCallback, useRef } = React;

/* ============================ 国际化（跟随 Harness 中英文） ============================ */

/**
 * 以**中文原串作为 key** 的词表：现有 `t('安装')` 这类调用无需改成资源键，
 * 英文缺失时自动回落到中文，不会出现空文案。
 */
const EN = {
  '百通插件广场': 'Baitong Plugin Plaza',
  '已是最新版本': 'Up to date',
  '有新版本 {v}': 'New version {v} available',
  '插件': 'Plugins',
  '技能': 'Skills',
  '全部': 'All',
  '已安装': 'Installed',
  '安装': 'Install',
  '安装中…': 'Installing…',
  '仅展示': 'View only',
  '卸载': 'Uninstall',
  '卸载中…': 'Uninstalling…',
  '卸载失败': 'Uninstall failed',
  '详情': 'Details',
  '在 GitHub 打开': 'Open on GitHub',
  '技能详情': 'Skill details',
  '插件说明': 'Plugin documentation',
  '关闭': 'Close',
  '搜索插件': 'Search plugins',
  '搜索技能': 'Search skills',
  '最多 Star': 'Most stars',
  '最近更新': 'Recently updated',
  '安装最多': 'Most installed',
  '加载中…': 'Loading…',
  '加载失败：': 'Load failed: ',
  '加载失败，请稍后重试': 'Failed to load. Please try again.',
  '安装失败：': 'Install failed: ',
  '安装被拒绝：': 'Install rejected: ',
  '重启失败：': 'Restart failed: ',
  '升级中…': 'Upgrading…',
  '升级失败：': 'Upgrade failed: ',
  '正在准备升级…': 'Preparing upgrade…',
  '确认升级到 v{v}？': 'Upgrade to v{v}?',
  '点击升级到 v{v}': 'Click to upgrade to v{v}',
  '等待安装结果超时': 'Timed out waiting for the install result',
  '读取失败': 'Read failed',
  '未知原因': 'unknown reason',
  '未知': 'Unknown',
  '响应解析失败': 'Failed to parse response',
  '未分类': 'Uncategorized',
  '暂无简介': 'No description yet',
  '暂无描述': 'No description yet',
  '暂无概述': 'No overview available',
  '暂无插件': 'No plugins',
  '暂无技能': 'No skills',
  '还没有已安装的插件': 'No plugins installed yet',
  '还没有已安装的技能': 'No skills installed yet',
  '没有匹配「{q}」的已安装项': 'No installed item matches "{q}"',
  '安装次数': 'Installs',
  '下载次数': 'Downloads',
  '用户数': 'Users',
  '评分': 'Rating',
  '当前版本': 'Current version',
  '下载': 'Downloads',
  '概述': 'Overview',
  '版本信息': 'Version',
  '远端最新': 'Latest (remote)',
  '本地已装': 'Installed locally',
  '安装时间': 'Installed at',
  '包体积': 'Package size',
  '标签': 'Tags',
  '（无版本记录）': '(no version record)',
  '未安装': 'Not installed',
  '说明：百通技能接口未提供版本历史，这里只能展示当前版本与本地安装记录。':
    'Note: the Baitong skill API does not expose version history, so only the current version and the local install record are shown.',
  '正在读取技能详情…': 'Loading skill details…',
  '详情读取失败：': 'Failed to load details: ',
  '正在读取插件说明…': 'Loading plugin documentation…',
  '插件说明读取失败。': 'Failed to load plugin documentation.',
  '该插件没有附带说明文档（README）。': 'This plugin ships no README.',
  '（说明文档超过 64KB，此处仅显示前一部分）':
    '(Documentation exceeds 64KB; only the beginning is shown.)',
  '确认卸载 {name}？': 'Uninstall {name}?',
  '{n} 个文件': '{n} files',
  '拉取依赖中': 'Resolving dependencies',
  '正在准备安装…': 'Preparing install…',
  '正在校验安装计划与依赖冲突': 'Verifying install plan and dependency conflicts',
  '正在安装 {target}': 'Installing {target}',
  '操作完成，重启 DSH 后生效': 'Done. Restart DSH to take effect.',
  '立即重启': 'Restart now',
  '正在重启…': 'Restarting…',
  '稍后': 'Later',
  '无法自动重启，请从系统托盘右键 DSH 图标选择「退出」，再重新打开': 'Auto-restart unavailable. Please quit DSH from the system tray (right-click the tray icon → Quit), then open it again.',
  '无法自动重启，请在运行 dsh web 的终端按 Ctrl+C 停止，再重新执行 dsh web，然后刷新本页': 'Auto-restart unavailable. Press Ctrl+C in the terminal running dsh web, start it again with dsh web, then refresh this page.',
  '升级完成，需要重启 DSH 后生效': 'Upgrade complete. Restart DSH to take effect.',
  '正在重启，稍候请刷新本页': 'Restarting — please refresh this page in a moment.',
  '请先打开一个会话': 'Open a session first',
  '面板渲染失败': 'Panel render failed',
  '面板渲染失败：': 'Panel render failed: ',
  '百通技能与插件': 'Baitong Skills & Plugins',
  '接口地址': 'API base',
  '技能目录': 'Skills directory',
  '已安装技能 {n} 个，其中 {m} 个可更新': '{n} skills installed, {m} updatable',
  '全部更新': 'Update all',
  '刷新': 'Refresh',
  '更新': 'Update',
  '更新中…': 'Updating…',
  '更新失败：': 'Update failed: ',
  '启用': 'Enable',
  '插件平台已发布 {v}（{repo}）': 'Platform release {v} ({repo})',
  '从插件平台最新版本更新（{repo}）': 'Update to the latest platform release ({repo})',
  '从 npm 最新版本更新': 'Update to the latest npm release',
  '来自插件平台': 'From the plugin platform',
  '从插件平台最新版本更新': 'Update to the latest platform release',
  '启用中…': 'Enabling…',
  '启用失败': 'Enable failed',
  '未启用': 'Disabled',
  '已安装但未启用，DSH 不会加载它': 'Installed but not enabled; DSH will not load it',
  '启用后 DSH 才会加载这个插件': 'DSH loads this plugin only after it is enabled',
  '已是最新': 'Up to date',
  '已是最新版本：': 'Already up to date: ',
  '搜索': 'Search',
  '{n} 条': '{n} results',
  '{n} 个': '{n} items',
  '已装技能': 'Installed skills',
  '已卸载': 'Uninstalled',
  '完成': 'Done',
  '安装完成，重启 dsh 后生效': 'Installed. Restart dsh to take effect.',
  '失败详情已记录，可把该文件发给开发者排查：': 'Failure details were logged. Send this file to the developer for diagnosis: ',
  '可更新': 'Updatable',
  '当前 {a} → 最新 {b}': '{a} → {b}',
  '在文件夹中显示': 'Reveal in folder',
  '文件夹': 'Folder',
  '无法识别的安装目标': 'Unrecognized install target',
  '自定义安装': 'Custom install',
  '手动安装市场目录之外的插件：npm 包名、GitHub 仓库或本地路径。装完的条目会出现在「已安装」列表。': 'Install plugins outside the market catalog: an npm package name, a GitHub repo, or a local path. Installed entries show up under Installed.',
  '请求超时（毫秒）': 'Request timeout (ms)',
  '搜索结果上限': 'Max search results',
  '保存': 'Save',
  '已保存': 'Saved',
  '收起': 'Collapse',
  '展开': 'Expand',
  '加载更多': 'Load more',
  '正在加载…': 'Loading…',
  '宇宙有没有边界人类尚未得知，我的边界被你探索到啦~': 'Whether the universe has an edge, humankind has yet to know — but you have explored mine~',
  '医疗': 'Medical',
  '设置': 'Settings',
  '连通性探测': 'Connectivity probes',
  'npm registry（依赖安装通道）': 'npm registry (dependency channel)',
  'GitHub（git 源与预检通道）': 'GitHub (git sources & pre-checks)',
  '百通目录站（数据源）': 'Baitong catalog (data source)',
  '探测中…': 'Probing…',
  '重测': 'Re-probe',
  '全部重测': 'Re-probe all',
  '可用': 'Reachable',
  '不可达': 'Unreachable',
  '工具链版本': 'Toolchain versions',
  '类别': 'Category',
  '级别': 'Level',
  '关键词': 'Keyword',
  '全部类别': 'All categories',
  '全部级别': 'All levels',
  '导出日志': 'Export logs',
  '安装日志查看器': 'Install log viewer',
  '更多日志': 'More logs',
  '接口地址、技能目录与请求参数': 'API base, skills directory, and request parameters',
  '启动检查更新与 npm 镜像源': 'Update checks on start and npm registry',
  '安装源与更新策略：检查固定官方源优先，安装按这里配置的源（缺版本时自动回退官方源）': 'Install source and update policy: checks prefer the official registry, installs use the source configured here (falling back to the official registry when a version is missing)',
  '医药': 'Pharma',
  '大健康': 'Wellness',
  '常规': 'General',
  '诊断': 'Diagnostics',
  '操作日志': 'Operation logs',
  '重置': 'Reset',
  '常规设置：接口地址、npm 镜像源与启动检查更新': 'General: API base, npm registry, and update checks on start',
  '环境快照：版本、运行时与 CLI 入口，排查安装问题用': 'Environment snapshot: version, runtime, CLI entry — for diagnosing install issues',
  '最近 20 次安装 / 更新 / 卸载记录': 'Last 20 install / update / uninstall operations',
  '删除本地覆盖配置，恢复为插件默认值': 'Remove local config overrides and restore plugin defaults',
  '仅重置本插件（百通插件广场）的设置：更新策略、镜像源等恢复默认值，不影响 DSH 其他插件': 'Reset only this plugin\'s (Baitong Plugin Plaza) settings — update policy, registry mirror, etc. restored to defaults. Other DSH plugins are not affected.',
  '配置': 'Config',
  '数据源与运行参数': 'Data source and runtime parameters',
  '确认继续？': 'Continue?',
  '已安装插件与技能的版本检查、一键更新，以及更新策略': 'Version checks and one-click updates for installed plugins and skills, plus update policy',
  '插件更新': 'Plugin updates',
  '技能更新': 'Skill updates',
  '暂无可更新的插件': 'No plugins with updates',
  '显示配置菜单': 'Show config menu',
  '隐藏配置菜单': 'Hide config menu',
  '配置菜单已显示（再次连点标题三次可重新显示）': 'Config menu is now visible (triple-click the title again to re-show)',
  '日志文件': 'Log file',
  '已复制': 'Copied',
  '系统日志': 'System log',
  '打开日志查看器': 'Open log viewer',
  '清空日志': 'Clear log',
  '确认清空所有日志？此操作不可撤销': 'Clear all logs? This cannot be undone.',
  '已清空': 'Cleared',
  '警告': 'Warning',
  '调试': 'Debug',
  '清空筛选': 'Clear filters',
  '最近 {n} 次操作记录': 'Last {n} operations',
  'npm 镜像源': 'npm registry',
  '安装源': 'Install source',
  '实际生效的安装源（设置留空时来自本机 npm 配置）': 'Effective install source (from local npm config when the setting is empty)',
  '检查更新固定官方源优先（镜像同步滞后时会漏掉刚发布的新版）；安装走这里的源，目标版本在该源缺失时自动换到官方源，不再报 ERR_PNPM_NO_MATCHING_VERSION。': 'Update checks always prefer the official registry (a lagging mirror would hide freshly published versions). Installs use the source set here and switch to the official registry when the target version is missing there, instead of failing with ERR_PNPM_NO_MATCHING_VERSION.',
  '实际生效的安装源': 'Effective install source',
  '（跟随本机 npm）': ' (following local npm)',
  '自动（跟随本机 npm，缺版本时回退官方源）': 'Automatic (follow local npm, fall back to the official registry when a version is missing)',
  '启动时检查更新': 'Check for updates on start',
  '未配置（跟随本机 npm）': 'Not set (follow local npm)',
  'npm 官方源': 'npm official',
  'npmmirror（淘宝）': 'npmmirror (Taobao)',
  '腾讯云镜像': 'Tencent mirror',
  '清华 TUNA 镜像': 'Tsinghua TUNA mirror',
  '确认重置？本地覆盖配置（接口地址、技能目录等）将被删除': 'Reset confirmed? Local config overrides (API base, skills dir, …) will be deleted',
  '删除本地覆盖配置，恢复为插件默认值；操作日志与残留的安装报错也会一并清空': 'Delete local config overrides and restore plugin defaults; the operation log and any leftover install error will also be cleared',
  '操作日志会被清空，无法恢复。': 'The operation log will be cleared and cannot be recovered.',
  '已重置': 'Reset done',
  'CLI 入口': 'CLI entry',
  '（仅 PATH，未找到内置入口）': '(PATH only — bundled entry not found)',
  '插件版本': 'Plugin version',
  '运行环境': 'Runtime',
  '平台': 'Platform',
  '代理环境': 'Proxy env',
  '复制诊断信息': 'Copy diagnostics',
  '诊断信息已复制': 'Diagnostics copied',
  '暂无操作记录': 'No operations yet',
  '成功': 'OK',
  '失败': 'Failed',
  '复制': 'Copy',
  '示例：@scope/pkg、npm install pkg、dsh plugin --profile web add pkg': 'e.g. @scope/pkg, npm install pkg, dsh plugin --profile web add pkg',
  '（预检已跳过）': ' (precheck skipped)',
};

function interpolate(template, params) {
  if (!params) return template;
  return String(template).replace(/\{(\w+)\}/g, (m, name) =>
    name in params ? String(params[name]) : m,
  );
}

/** 语言探测：优先 DSH 文档语言，其次浏览器语言，默认中文 */
function browserLang() {
  const lang =
    (typeof document !== 'undefined' && document.documentElement.lang) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'zh';
  return /^en\b/i.test(String(lang)) ? 'en' : 'zh';
}

/** 模块级兜底翻译（slot 尚未注入 t 时使用） */
function lookup(key, params) {
  const text = browserLang() === 'en' ? EN[key] || key : key;
  return interpolate(text, params);
}

const I18nCtx = React.createContext(null);

function I18nProvider({ t, children }) {
  const fn = typeof t === 'function' ? t : lookup;
  return <I18nCtx.Provider value={fn}>{children}</I18nCtx.Provider>;
}

/** 组件内取翻译函数：优先用 slot 注入的 t（跟随 Harness），否则回落到模块级探测 */
function useTr() {
  return React.useContext(I18nCtx) || lookup;
}

/**
 * 报错自动收起：报错是「这一次点击」的反馈，不是常驻状态。
 *
 * 主页头部（VersionBadge）、广场面板（MarketPanel）、已安装视图与对话流卡片里的
 * 报错原来只有「下一次操作」才会被覆盖，表现就是一直挂在页面上不走。设置页的
 * 浮层（AutoToast）一直是 3s 自动消失的，这里让其余报错也统一成同一种行为，
 * 只是停留时间给得更长 —— 报错文案通常更长，还可能带日志文件路径要抄。
 *
 * @param {string} message 当前报错；为空时不排定计时
 * @param {(next: string) => void} clear 报错的 setter（如 setErr / setError）
 * @param {number} [ms] 停留时长
 */
const ERROR_AUTO_CLEAR_MS = 8000;

/**
 * 🔴 安装报错的「已读」记录必须放在**模块级**，不能放在组件 state 里（2026-10-20 修）。
 *
 * 用户报障：「安装失败：…已恢复旧版插件」这条，几秒后消失，
 *   但右上角关闭面板、再从侧边栏点开，它又出现了，位置就在分类胶囊与卡片之间。
 *
 * 根因是两个"常驻"叠加：
 *   1. 宿主侧 progress.error 会一直保留到下一次安装开工才清（local-api.ts 的
 *      beginProgress 才置 null），所以 pluginInstallStatus 每次都把它带回来；
 *   2. 前端用组件 state 记"这条已经读过了"，而**面板关闭时组件被卸载**，
 *      state 随之销毁 —— 重新挂载时 dismissed 为空，旧报错又被当成新错误渲染。
 *
 * 修法：已读记录存到模块作用域，跨挂载存活；键是错误文本本身，
 * 于是"同一段文本只提示一次"，文本变了（新一轮失败）才会重新提示。
 * 用 Map 而不是单个字符串：避免 A→B→A 时把 A 又当成新的。
 */
const dismissedInstallErrors = new Map();
/** 已读记录上限：安装报错文本可能很长，防止长会话里无限增长 */
const DISMISSED_MAX = 20;
function markInstallErrorRead(text) {
  if (!text) return;
  dismissedInstallErrors.delete(text);
  dismissedInstallErrors.set(text, Date.now());
  while (dismissedInstallErrors.size > DISMISSED_MAX) {
    dismissedInstallErrors.delete(dismissedInstallErrors.keys().next().value);
  }
}
function isInstallErrorRead(text) {
  return !!text && dismissedInstallErrors.has(text);
}

function useAutoClearError(message, clear, ms = ERROR_AUTO_CLEAR_MS) {
  useEffect(() => {
    if (!message) return undefined;
    // 🔴 与 InstallProgress 同一套已读表（2026-10-20 修）：
    //    这些报错组件在面板关闭时会被卸载，组件 state 里的"已自动清除"随之丢失；
    //    重新打开面板时宿主又会把同一条 progress.error 送回来，于是报错复活。
    //    这里在清除的同时记到模块级，保证"同一条文本只打扰用户一次"。
    if (isInstallErrorRead(message)) {
      clear('');
      return undefined;
    }
    const id = setTimeout(() => {
      markInstallErrorRead(message);
      clear('');
    }, ms);
    return () => clearTimeout(id);
  }, [message, clear, ms]);
}

/**
 * 手动重启指引：**web 与桌面端重启方式完全不同**，不能共用一句话。
 *
 * runtime 由宿主给出（pluginInstallStatus / pluginRestart 的 `runtime`，即 detectRuntime）：
 *   - desktop：应用级重启，只能从系统托盘退出后重新打开；
 *   - web：进程由命令行 `dsh web` 拉起，需在终端 Ctrl+C 后重新执行，并刷新本页。
 *
 * 拿不到 runtime 时按 web 处理：web 的指引在任何环境都不会误导，
 * 而"系统托盘"那句在 web 端是错的。
 */
function manualRestartHint(t, runtime) {
  return runtime === 'desktop'
    ? t('无法自动重启，请从系统托盘右键 DSH 图标选择「退出」，再重新打开')
    : t('无法自动重启，请在运行 dsh web 的终端按 Ctrl+C 停止，再重新执行 dsh web，然后刷新本页');
}

/** 注册给 DSH 的词表（zh 需自带全部键，否则框架侧取不到值） */
const LOCALE_MESSAGES = {
  zh: Object.fromEntries(Object.keys(EN).map((k) => [k, k])),
  en: EN,
};

/** 本机 API 调用（POST JSON，[ok, data] 形态） */
async function api(method, body = {}) {
  const res = await fetch('/baitong-market', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, ...body }),
  });
  const json = await res.json().catch(() => ({ ok: false, error: '响应解析失败' }));
  return [json.ok ? null : json.error || 'request failed', json.ok ? json : null];
}

/** 图标代理 */
function iconUrl(url) {
  if (!url) return '';
  return `/baitong-market/icon?url=${encodeURIComponent(url)}`;
}

/**
 * 🔴 图标加载失败必须兜底成「首字 + 蓝底」，不能露出浏览器那张破图标识。
 *
 * 事故（2026-10-16）：图标 URL 存在但加载失败（404 / 网络不可达 / 代理超时）时，
 * `<img>` 会渲染成浏览器自带的"图片损坏"图标 —— 界面上就是一个破图符号，
 * 比没有图标更难看。
 *
 * 为什么用 state 而不是 `onError` 直接换渲染：
 *   - `onError` 里 setState 需要 hooks，函数组件内可行，但本组件要复用于4 处卡片，
 *     每处各写一遍 state 必然漏改 ⇒ 抽成本组件统一收口。
 *   - 加载失败是**终态**，一旦失败不再重试，避免反复请求同一个坏 URL。
 *   - 首字取「显示名优先」：插件卡片上方标题就是 displayName，取它的首字才不割裂。
 */
/**
 * 插件类卡片的通用图标：蓝底 + 白色拼图块。
 *
 * 背景（2026-10-16）：已安装插件清单读的是本机 profile 里的 package.json，
 * 那里**没有图标字段** —— 图标 URL 只存在于市场目录接口，所以已装卡片永远拿不到 logo；
 * 市场卡片遇到图标 404 时同样没有图。以前两者都降级成「首字母」，一屏字母既不像图标、
 * 也看不出条目类型。插件类卡片统一改成拼图图标后，一眼可辨「这是一个插件」。
 *
 * 背景色刻意沿用 .btm-logo-fallback（#3b82f6）不变，只把里面的首字换成图标。
 */
function PluginGlyph() {
  return (
    <span className="btm-logo-fallback btm-logo-glyph" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 5h5a2.5 2.5 0 0 1 5 0h6v5a2.5 2.5 0 0 0 0 5v6H4z" />
      </svg>
    </span>
  );
}

function Logo({ url, name, fallback = 'P', glyph = false }) {
  const [failed, setFailed] = useState(false);
  // url 变化（换数据/筛选）时重置，允许新 URL 再试一次
  useEffect(() => { setFailed(false); }, [url]);
  const initial = String(name || fallback).trim().slice(0, 1).toUpperCase();
  if (!url || failed) {
    // 插件（glyph）用统一拼图图标；技能仍用首字，避免和插件混淆
    return glyph ? <PluginGlyph /> : <span className="btm-logo-fallback">{initial}</span>;
  }
  return (
    <img
      src={iconUrl(url)}
      alt={String(name || '')}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * 面板头部的版本徽标：`v当前版本` + 喇叭图标；线上有更新时喇叭亮起（琥珀色 + 红点 + 文案）。
 *
 * 数据由宿主提供（前端既读不到包内文件，也不该直连 npm）：`pluginMeta` 返回
 * `{ current, latest, hasUpdate, error }`。宿主侧有一次外网请求（registry，带缓存），
 * **失败只是不亮提醒**（error 字段），不能影响面板本身。
 *
 * 检查时机（2026-10-16 修）：以前只有「徽标挂载」这一个时机，而宿主成功结果缓存 1 小时，
 * 于是**点 X 关掉面板再进来照样看到旧结论**，发了新版也不提示。现在三个时机：
 *   1. 打开面板（本组件挂载）→ `open`，宿主侧 60s 软过期，重开面板就能发现新版；
 *   2. 面板一直开着 → 每 5 分钟静默复查一次，长时间挂着也能收到提醒；
 *   3. 切回本页（visibilitychange）/ 点升级前后 → 复查，升级那两次是**硬刷新**。
 *
 * 🔴 这里是"自己升级自己"的唯一入口（2026-10-16 修）：以前徽标只是个装饰，
 * 用户看到"有新版本 0.1.6"却升不动 —— profile 里 spec 是 `^0.1.1`，pnpm 认为
 * lockfile 里的 0.1.1 已满足范围，卸载重装也照样装回 0.1.1。现在点一下走
 * `pluginSelfUpgrade`，宿主用**显式版本号** `pkg@0.1.7` 强制重新解析。
 *
 * 为什么本组件自带轮询而不是复用 MarketPanel 的 restartHint：
 * 它挂在面板头部（PlazaPage），跟列表状态树无关，也拿不到后者的 setState —— 独立自洽更省事。
 */
function VersionBadge() {
  const tr = useTr();
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [restartBusy, setRestartBusy] = useState(false);
  const [needRestart, setNeedRestart] = useState(false);
  // 运行环境与"能否自动重启"：false 时直接摆手动步骤，不给点了没用的按钮
  const [runtime, setRuntime] = useState('');
  const [canAuto, setCanAuto] = useState(null);
  const [manual, setManual] = useState(false);
  const aliveRef = useRef(true);
  // 报错不常驻：8s 自动收起，新的报错重新计时
  useAutoClearError(err, setErr);

  /**
   * @param mode 'open'  打开面板/定时复查：宿主侧 60s 软过期，发了新版重开面板就能看到；
   *             'force' 升级前后的硬刷新：必须拿到当下的 latest，不能拿缓存当升级目标。
   */
  const refreshMeta = useCallback(async (mode) => {
    const body = mode === 'force' ? { check: true } : mode === 'open' ? { open: true } : {};
    const [e, data] = await api('pluginMeta', body);
    if (aliveRef.current && !e && data && data.current) setMeta(data);
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // ① 打开面板：用户主动查看 → 立刻查一次（宿主侧仍有 60s 下限，狂开关面板不会连打）
    refreshMeta('open');
    return () => { aliveRef.current = false; };
  }, [refreshMeta]);

  useEffect(() => {
    // ② 面板一直开着：每 5 分钟静默复查，别让"有新版本"要求用户先关再开
    const id = setInterval(() => { if (aliveRef.current) refreshMeta('open'); }, 5 * 60 * 1000);
    // ③ 从别的窗口/标签切回本页：顺手复查一次（同样受宿主 60s 下限保护）
    const onVisible = () => { if (!document.hidden && aliveRef.current) refreshMeta('open'); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshMeta]);

  /** 轮询安装状态直到终态；上限与宿主安装超时（15min）对齐，避免无限转圈 */
  const waitInstall = useCallback(async () => {
    for (let i = 0; i < 900; i += 1) {
      await new Promise((r) => setTimeout(r, 1200));
      if (!aliveRef.current) return;
      const [e, d] = await api('pluginInstallStatus');
      if (!aliveRef.current) return;
      if (e) { setErr(tr('升级失败：') + e); return; }
      if (!d) return;
      if (d.active) {
        setNote(d.lastLine || d.phase || tr('升级中…'));
        continue;
      }
      if (d.error) {
        // 日志文件路径随状态一起给：远程排查时用户直接把文件发回来
        setErr(tr('升级失败：') + d.error + (d.logPath ? ' ' + tr('失败详情已记录，可把该文件发给开发者排查：') + d.logPath : ''));
        return;
      }
      // 升级只落了磁盘：**必须重启 DSH 才生效**，所以这里同时给出平台相关的手动步骤
      if (d.runtime) setRuntime(d.runtime);
      if (typeof d.canAutoRestart === 'boolean') setCanAuto(d.canAutoRestart);
      setNote(tr('升级完成，需要重启 DSH 后生效'));
      setNeedRestart(true);
      await refreshMeta('force');
      return;
    }
    setErr(tr('升级失败：') + tr('等待安装结果超时'));
  }, [tr, refreshMeta]);

  const upgrade = async () => {
    if (busy) return;
    if (!window.confirm(tr('确认升级到 v{v}？', { v: meta.latest }))) return;
    setBusy(true);
    setErr('');
    setNote(tr('正在准备升级…'));
    setNeedRestart(false);
    setManual(false);
    const [e, data] = await api('pluginSelfUpgrade');
    if (!aliveRef.current) return;
    if (e) { setBusy(false); setNote(''); setErr(tr('升级失败：') + e); return; }
    if (data && data.ok === false) {
      setBusy(false);
      setNote('');
      if (data.alreadyLatest) { await refreshMeta('force'); return; }
      // link 安装（本地源码开发）不算失败，是宿主在提示"该走重新构建"，原样透出原因
      setErr(String(data.error || tr('未知原因')));
      return;
    }
    if (data && data.from) setNote(tr('升级中…'));
    await waitInstall();
    if (aliveRef.current) setBusy(false);
  };

  const restart = async () => {
    setRestartBusy(true);
    setErr('');
    // 桌面端走 Electron 应用级重启；拿不到 Electron API 时后端返回 manual，
    // 这里如实换成"手动步骤"常驻显示，不做"假装重启"
    const [e, data] = await api('pluginRestart');
    if (!aliveRef.current) return;
    setRestartBusy(false);
    if (e) { setErr(tr('重启失败：') + e); return; }
    if (data && data.runtime) setRuntime(data.runtime);
    if (data && data.manual) { setManual(true); return; }
    // 已受理：web 端进程会重建，页面要刷新才能连上新进程
    setNote(tr('正在重启，稍候请刷新本页'));
  };

  if (!meta) return null;
  const tip = meta.hasUpdate ? tr('点击升级到 v{v}', { v: meta.latest }) : tr('已是最新版本');
  return (
    <span className="btm-ver-wrap">
      <span
        className={'btm-ver' + (meta.hasUpdate ? ' is-update' : '') + (meta.hasUpdate && !busy ? ' is-clickable' : '')}
        title={tip}
        role={meta.hasUpdate ? 'button' : undefined}
        tabIndex={meta.hasUpdate ? 0 : undefined}
        onClick={meta.hasUpdate && !busy ? upgrade : undefined}
        onKeyDown={
          meta.hasUpdate && !busy
            ? (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); upgrade(); } }
            : undefined
        }
      >
        <span className="btm-ver-text">{`v${meta.current}`}</span>
        <span className="btm-bell" role="img" aria-label={tip}>
          <svg
            viewBox="0 0 16 16"
            width="13"
            height="13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3.9 6.7a4.1 4.1 0 0 1 8.2 0v2.8l1.1 1.9H2.8l1.1-1.9z" />
            <path d="M6.6 13.1a1.4 1.4 0 0 0 2.8 0" />
          </svg>
          {meta.hasUpdate ? <i className="btm-bell-dot" /> : null}
        </span>
        {meta.hasUpdate ? (
          <span className="btm-ver-hint">{busy ? tr('升级中…') : tr('有新版本 {v}', { v: meta.latest })}</span>
        ) : null}
      </span>
      {note ? <span className="btm-ver-note">{note}</span> : null}
      {err ? <span className="btm-ver-err" title={err}>{err}</span> : null}
      {needRestart && (canAuto === false || manual) ? (
        // 明确不能自动重启（如桌面端拿不到 Electron API）：直接给手动步骤
        <span className="btm-ver-manual">{manualRestartHint(tr, runtime)}</span>
      ) : needRestart ? (
        <button className="btm-ver-restart" onClick={restart} disabled={restartBusy}>
          {restartBusy ? tr('正在重启…') : tr('立即重启')}
        </button>
      ) : null}
    </span>
  );
}

function categoryLabel(key, categories) {
  if (!key) return '未分类';
  const hit = (categories || []).find((c) => c.key === key);
  return hit ? hit.displayName : key;
}

function fmtCount(n) {
  if (!n || n <= 0) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}w`;
  return String(n);
}

/** 版本号归一化：接口返回的版本可能自带 v 前缀，避免渲染成「vv1.0.0」 */
function fmtVer(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  return /^v\d/i.test(v) ? v : `v${v}`;
}

/** 插件详情地址：优先用后端给的 repositoryUrl，否则按 owner/name 拼 GitHub 链接 */
function pluginDetailHref(plugin) {
  const repo = String((plugin && plugin.repositoryUrl) || '').trim();
  if (/^https:\/\/github\.com\//i.test(repo)) return repo;
  const owner = encodeURIComponent(String((plugin && plugin.owner) || '').trim());
  const name = encodeURIComponent(String((plugin && plugin.name) || '').trim());
  if (!owner || !name) return '';
  return `https://github.com/${owner}/${name}`;
}

/* ============================ 插件卡片 ============================ */

function PluginCard({ plugin, categories, installing, onInstall }) {
  const tr = useTr();
  const installed = !!plugin.installed;
  const href = pluginDetailHref(plugin);
  return (
    <div className={'btm-card' + (installed ? ' is-installed' : '')}>
      <div className="btm-card-head">
        <div className="btm-card-logo">
          <Logo url={plugin.avatarUrl} name={plugin.displayName || plugin.name} fallback="P" glyph />
        </div>
        <div className="btm-card-title">
          <div className="btm-card-name">{plugin.displayName || plugin.name}</div>
          <div className="btm-card-fullname">{plugin.fullName}</div>
        </div>
      </div>
      <div className="btm-card-desc">{plugin.description || tr('暂无简介')}</div>
      <div className="btm-card-foot">
        <span className="btm-card-cat">{categoryLabel(plugin.categoryKey, categories)}</span>
        <span className="btm-card-stats">
          <span title="GitHub Stars">★ {fmtCount(plugin.stars)}</span>
          {plugin.installs ? <span title={tr('安装次数')}>⬇ {fmtCount(plugin.installs)}</span> : null}
        </span>
      </div>
      <div className="btm-card-actions">
        {href ? (
          <a className="btm-card-details" href={href} target="_blank" rel="noreferrer" title={tr('在 GitHub 打开')}>
            {tr('详情')} ↗
          </a>
        ) : (
          <span className="btm-card-details" />
        )}
        {installed ? (
          <button type="button" className="btm-btn done" disabled>
            {tr('已安装')}
          </button>
        ) : (
          <button
            type="button"
            className="btm-btn primary"
            disabled={installing || plugin.installability !== 'verified'}
            onClick={() => onInstall(plugin)}
          >
            {installing ? tr('安装中…') : plugin.installability === 'verified' ? tr('安装') : tr('仅展示')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================ 技能卡片 ============================ */

function SkillCard({ skill, onInstall, onDetail, installedSlugsSet = new Set() }) {
  const tr = useTr();
  const installed = installedSlugsSet.has(skill.slug);
  return (
    <div className={'btm-card' + (installed ? ' is-installed' : '')}>
      <div className="btm-card-head">
        <div className="btm-card-logo">
          <Logo url={skill.logo} name={skill.name || skill.slug} fallback="S" />
        </div>
        <div className="btm-card-title">
          <div className="btm-card-name">{skill.name}</div>
          <div className="btm-card-fullname">{skill.slug}{skill.version ? ` · ${fmtVer(skill.version)}` : ''}</div>
        </div>
      </div>
      <div className="btm-card-desc">{skill.summary || tr('暂无简介')}</div>
      <div className="btm-card-foot">
        <span className="btm-card-cat">{skill.category || tr('技能')}</span>
        <span className="btm-card-stats">
          {skill.downloadCount ? <span title={tr('用户数')}>⬇ {fmtCount(skill.downloadCount)}</span> : null}
          {skill.rating ? <span title={tr('评分')}>★ {Number(skill.rating).toFixed(1)}</span> : null}
        </span>
      </div>
      <div className="btm-card-actions">
        <button type="button" className="btm-card-details" onClick={() => onDetail && onDetail(skill)}>
          {tr('详情')}
        </button>
        {installed ? (
          <button type="button" className="btm-btn done" disabled>
            {tr('已安装')}
          </button>
        ) : (
          <button type="button" className="btm-btn primary" onClick={() => onInstall(skill)}>
            {tr('安装')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ============================ 安装进度条（插件） ============================ */

function InstallProgress({ status, pending }) {
  const tr = useTr();
  // 宿主侧 progress.error 会一直保留到下一次安装开工（beginProgress 才清），
  // 所以「安装失败」不能直接照着 status.error 渲染 —— 否则它会跨刷新常驻，
  // 用户看到的就是"报错永远不消失"。这里按错误文本记一次已读，超时后隐藏；
  // 文本变了（新一轮失败）重新计时，不是新的错误不受影响。
  const errText = status && !status.active && status.error ? String(status.error) : '';
  // 本挂载周期内是否已经把它收起来了（模块级已读表决定"要不要显示"，这里只管"何时收起"）
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!errText) {
      setHidden(false);
      return undefined;
    }
    // 已经读过的旧错误：直接不显示，也不启动计时
    if (isInstallErrorRead(errText)) {
      setHidden(true);
      return undefined;
    }
    setHidden(false);
    const id = setTimeout(() => {
      markInstallErrorRead(errText); // 记到模块级：卸载/重挂载后仍然有效
      setHidden(true);
    }, ERROR_AUTO_CLEAR_MS);
    return () => clearTimeout(id);
  }, [errText]);
  if (!status || !status.active) {
    if (errText && !hidden && !isInstallErrorRead(errText)) {
      return <div className="btm-progress-error">{tr('安装失败：')}{errText}</div>;
    }
    if (!pending) return null;
    // 安装请求已受理、服务端还在做开工前检查（拉安装计划 / 依赖冲突预检，可能数秒）——
    // 必须立即给反馈，否则用户以为"点了没反应"会重复点击
    return (
      <div className="btm-progress">
        <div className="btm-progress-line">{tr('正在准备安装…')}</div>
        <div className="btm-progress-bar">
          <div className="btm-progress-fill btm-indeterminate" />
        </div>
        <div className="btm-progress-sub">{tr('正在校验安装计划与依赖冲突')}</div>
      </div>
    );
  }
  const pct = status.total ? Math.round((status.done / status.total) * 100) : null;
  return (
    <div className="btm-progress">
      <div className="btm-progress-line">
        {tr('正在安装 {target}', { target: status.target })} … {status.currentPackage ? `(${status.currentPackage})` : ''} {pct != null ? `${pct}%` : ''}
      </div>
      <div className="btm-progress-bar">
        <div className="btm-progress-fill" style={{ width: pct != null ? `${pct}%` : '30%' }} />
      </div>
      <div className="btm-progress-sub">
        {status.phase || status.lastLine || tr('拉取依赖中')} · {status.seconds}s
      </div>
    </div>
  );
}

/* ============================ 样式（跟随 DSH 主题变量） ============================ */

const CSS = `
.btm-entry{width:100%}
.btm-entry.rail{display:flex;justify-content:center}
.btm-entry-btn{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:calc(100% + 4px);height:42px;margin:4px -2px;padding:0 10px 0 8px;border:0;border-radius:12px;background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:14px;line-height:22px;cursor:pointer;overflow:hidden}
.btm-entry.rail .btm-entry-btn{width:36px;height:36px;margin:8px 0 10px;padding:0;justify-content:center;border-radius:50%;gap:0}
.btm-entry-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.btm-entry-btn svg{flex:none;width:16px;height:16px}
.btm-entry.rail .btm-entry-btn svg{width:18px;height:18px}
.btm-entry-btn[aria-expanded="true"]{background:var(--dsw-specific-sidebar-nav-item-active,#ebeef2)}
.btm-entry-btn span{white-space:nowrap;overflow:hidden}
.btm-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;max-width:min(420px,86vw);padding:9px 15px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-layer-1,#f5f6f8);color:var(--dsw-alias-label-secondary,#4b5058);font:inherit;font-size:13px;line-height:20px;box-shadow:var(--dsw-shadow-lv2,0 6px 20px rgb(20 24 32 / 12%))}
.btm-page{position:fixed;z-index:40;box-sizing:border-box;display:flex;flex-direction:column;min-height:0;overflow:hidden;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#17191c)}
.btm-brand{display:inline-flex;align-items:center;flex:none;margin-right:2px;border-radius:6px;overflow:hidden}
.btm-brand img{display:block;width:22px;height:22px;object-fit:cover;border-radius:6px}
.btm-brand:hover{box-shadow:0 0 0 2px var(--dsw-alias-border-l1,#cfd2d8)}
.btm-top{display:flex;align-items:center;gap:16px;flex:none;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-base,#fff)}
.btm-top-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#17191c)}
.btm-close{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:18px;line-height:1;cursor:pointer}
.btm-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.btm-ver{display:inline-flex;align-items:center;gap:5px;font-size:11px;line-height:1;color:var(--dsw-alias-label-secondary,#6b7280);border:1px solid var(--dsw-alias-border-l2,#e5e7eb);border-radius:999px;padding:3px 8px;background:var(--dsw-alias-bg-layer-3,#f9fafb);cursor:default}
.btm-ver.is-update{color:#b45309;border-color:#fcd34d;background:#fef3c7}
.btm-ver.is-clickable{cursor:pointer}
.btm-ver.is-clickable:hover{background:#fde68a;border-color:#fbbf24}
.btm-ver-wrap{display:inline-flex;align-items:center;gap:6px;min-width:0}
.btm-ver-note{font-size:11px;color:var(--dsw-alias-state-success-primary,#047857);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-ver-err{font-size:11px;color:var(--dsw-alias-state-error-primary,#b91c1c);min-width:0;max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-ver-restart{appearance:none;font:inherit;font-size:11px;line-height:1;padding:4px 9px;border-radius:999px;border:1px solid var(--dsw-alias-state-success-primary,#047857);background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857);cursor:pointer}
.btm-ver-restart:disabled{opacity:.6;cursor:default}
/* 手动重启步骤：文字较长，允许换行，不用 ellipsis 把指令裁掉 */
.btm-ver-manual{font-size:11px;line-height:15px;color:var(--dsw-alias-state-warning-primary,#b45309);min-width:0;max-width:460px}
.btm-banner-manual{font-size:11px;line-height:15px;color:var(--dsw-alias-state-warning-primary,#b45309);min-width:0}
.btm-tv-manual{font-size:11px;line-height:15px;color:var(--dsw-alias-state-warning-primary,#b45309);min-width:0;text-align:right}
.btm-ver-text{font-variant-numeric:tabular-nums}
.btm-bell{position:relative;display:inline-flex;align-items:center}
.btm-bell svg{display:block}
.btm-bell-dot{position:absolute;top:-2px;right:-2px;width:5px;height:5px;border-radius:50%;background:#ef4444}
.btm-ver-hint{font-weight:600}
.btm-body{flex:1;min-height:0;overflow:auto;padding:18px 20px 32px}
.btm-scope{display:block;margin-bottom:10px}
.btm-seg{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f5f6f8)}
.btm-seg button{appearance:none;border:0;background:transparent;height:28px;padding:0 14px;border-radius:7px;font:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary,#7b8088);cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:background .15s,color .15s,box-shadow .15s}
.btm-seg button:hover{color:var(--dsw-alias-label-secondary,#4b5058)}
.btm-seg button.on{background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,#17191c);box-shadow:var(--dsw-shadow-lv1,0 1px 3px rgb(20 24 32 / 10%))}
.btm-count{padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-tertiary,#7b8088);font-size:11px;font-variant-numeric:tabular-nums}
.btm-status{margin:6px 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-card-meta{display:flex;flex-wrap:wrap;flex:none;gap:8px;align-items:center;margin-top:8px;font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8088);font-variant-numeric:tabular-nums}
.btm-card-profile{padding:1px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-panel{display:flex;flex-direction:column;flex:1;min-height:0;color:var(--dsw-alias-label-primary,inherit);font:inherit}
.btm-toolbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}
/* 自定义安装输入行：与工具栏同排布，视觉上从属它 */
.btm-custom-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 8px;padding:8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);border:1px dashed var(--dsw-alias-border-l2,#e2e4e8)}
/* 自定义安装：独立区块（标题 + 说明 + 输入），不做成工具栏里的小按钮 */
.btm-custom{display:flex;flex-direction:column;gap:8px;margin:0 0 10px;padding:12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f8f9fa);border:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-custom-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.btm-custom-desc{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-custom-hint{margin:0;font-size:10px;line-height:16px;color:var(--dsw-alias-label-tertiary,#9aa0a6)}
/* 设置页配置表单 */
.btm-set-form{display:flex;flex-direction:column;gap:8px;margin:10px 0}
.btm-set-form label{display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-input{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-layer-3,#fff);color:inherit;font:inherit;font-size:12px}
/* 设置布局：左侧图标导航 + 右侧内容（对齐 dsh-plugin） */
.btm-set-body{display:flex;gap:14px;align-items:flex-start;margin-top:12px}
.btm-set-side{display:flex;flex-direction:column;gap:2px;flex:none;width:128px}
.btm-set-side-btn{display:flex;align-items:center;gap:8px;appearance:none;font:inherit;font-size:12px;padding:7px 10px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5058);cursor:pointer;text-align:left}
.btm-set-side-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.btm-set-side-btn.on{background:var(--dsw-alias-state-business-tertiary,#eef2ff);color:var(--dsw-alias-state-business-primary,#4d6bfe);font-weight:600}
.btm-set-side-ic{display:inline-flex;width:16px;height:16px;flex:none;color:currentColor}
.btm-set-side-ic svg{width:16px;height:16px;display:block}
.btm-set-content{flex:1;min-width:0}
.btm-set-pagetitle{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.btm-set-pagedesc{margin:2px 0 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#7b8088)}
@media (max-width:560px){.btm-set-body{flex-direction:column}.btm-set-side{flex-direction:row;flex-wrap:wrap;width:auto}}
/* 分区内容容器 */
.btm-set-page{display:flex;flex-direction:column;gap:8px;margin-top:6px}
/* 开关行：label + checkbox 同行 */
.btm-set-toggle{flex-direction:row!important;align-items:center;gap:8px!important}
.btm-set-toggle input{width:auto}
/* 日志失败徽标（红） */
.btm-badge.is-failed{background:var(--dsw-alias-state-error-tertiary,#fef2f2);color:var(--dsw-alias-state-error-primary,#b91c1c)}
/* 连通性探测区 */
.btm-probe{display:flex;flex-direction:column;gap:6px;margin-top:12px;padding:10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f8f9fa);border:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-probe-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:600}
.btm-probe-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.btm-probe-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);font-size:11px;min-width:0}
.btm-probe-dot{width:8px;height:8px;border-radius:50%;flex:none;background:#c7ccd4}
.btm-probe-row.ok .btm-probe-dot{background:var(--dsw-alias-state-success-primary,#279c62)}
.btm-probe-row.fail .btm-probe-dot{background:var(--dsw-alias-state-error-primary,#dc2626)}
.btm-probe-row.running .btm-probe-dot{background:#f5b642;animation:btm-pulse 1s infinite}
@keyframes btm-pulse{50%{opacity:.35}}
.btm-probe-name{flex:none;font-weight:600}
.btm-probe-addr{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#9aa0a6)}
.btm-probe-ms{flex:none;color:var(--dsw-alias-label-tertiary,#7b8088)}
/* 日志筛选行 */
.btm-logbar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px}
.btm-logbar-sel{width:auto;flex:none;min-width:88px}
.btm-logbar-q{flex:1;min-width:100px;width:auto}
/* 筛选 chip 组（对齐 dsh-plugin 的 chip 式双轴筛选） */
.btm-chips{display:flex;flex-wrap:wrap;gap:4px;margin:0 0 4px}
.btm-chip{appearance:none;font:inherit;font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:transparent;color:var(--dsw-alias-label-secondary,#4b5058);cursor:pointer}
.btm-chip:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.btm-chip.on{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:var(--dsw-alias-state-business-primary,#4d6bfe);color:#fff}
.btm-chip.on.lv-error{background:var(--dsw-alias-state-error-primary,#dc2626);border-color:var(--dsw-alias-state-error-primary,#dc2626)}
.btm-chip.on.lv-warn{background:var(--dsw-alias-state-warning-primary,#b45309);border-color:var(--dsw-alias-state-warning-primary,#b45309)}
.btm-chip.on.lv-success{background:var(--dsw-alias-state-success-primary,#047857);border-color:var(--dsw-alias-state-success-primary,#047857)}
/* 日志状态行 */
.btm-logmeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:4px 0 8px;font-size:11px}
.btm-logmeta-count{flex:none;font-weight:600;color:var(--dsw-alias-label-secondary,#4b5058)}
.btm-logmeta-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left;font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary,#9aa0a6)}
/* 日志行：固定列宽网格，扫读对齐（对齐 dsh-plugin 的查看器密度） */
.btm-loglist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px;max-height:46vh;overflow:auto}
/* 日志行（对齐 dsh-plugin 的 .entry）：flex 单行，固定项 flex:none、消息项 flex:1。
   🔴 不能用 grid + 固定列宽：面板窄时列宽总和超过容器会横向溢出，文本被挤成竖排。 */
.btm-logrow{display:flex;align-items:baseline;gap:8px;padding:5px 8px;border-radius:6px;min-width:0;font-size:11px;line-height:16px;background:var(--dsw-alias-bg-layer-2,#f8f9fa)}
.btm-log-event{flex:none;font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#9aa0a6);white-space:nowrap}
/* 查看器里的高版列表（弹窗内滚动更长） */
.btm-loglist-tall{max-height:52vh}
.btm-logrow:hover{background:var(--dsw-alias-interactive-bg-hover,#eef1f5)}
.btm-logrow.error{background:var(--dsw-alias-state-error-tertiary,#fef2f2)}
.btm-logrow.warn{background:var(--dsw-alias-state-warning-tertiary,#fffbeb)}
.btm-log-time{flex:none;font-family:ui-monospace,Consolas,monospace;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#7b8088);white-space:nowrap}
.btm-log-cat{flex:none;color:var(--dsw-alias-label-tertiary,#7b8088);white-space:nowrap}
.btm-log-msg{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#4b5058);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* 日志级别徽标 */
.btm-log-lv{flex:none;padding:1px 6px;border-radius:999px;font-size:10px;background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#4b5058)}
.btm-log-lv.success{background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
.btm-log-lv.error{background:var(--dsw-alias-state-error-tertiary,#fef2f2);color:var(--dsw-alias-state-error-primary,#b91c1c)}
.btm-log-lv.warn{background:var(--dsw-alias-state-warning-tertiary,#fffbeb);color:var(--dsw-alias-state-warning-primary,#b45309)}
/* 日志查看器弹层：宽版 + 等宽字体滚动区 */
.btm-logviewer{width:min(860px,92vw)}
.btm-logpre{margin:0;padding:12px;font:11px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-all;background:var(--dsw-alias-bg-layer-2,#f8f9fa);border-radius:8px;max-height:60vh;overflow:auto}
/* 已安装卡片：按钮行绝不换行（换行会让卡片高低不齐）——按钮改紧凑尺寸，4 个一行放得下 */
.btm-installed .btm-card-actions{flex-wrap:nowrap}
.btm-installed .btm-card-actions .btm-btn{min-height:26px;padding:0 9px;font-size:11px}
.btm-installed .btm-card-actions .btm-btn.btm-btn-icon{min-height:26px;width:26px}
.btm-installed .btm-card-actions .btm-card-details{flex:1 1 auto}
.btm-tabs{display:flex;gap:4px}
.btm-tab{padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-2,#f8fafc);color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:12px;cursor:pointer}
.btm-tab.active{color:var(--dsw-alias-state-success-primary,#047857);border-color:var(--dsw-alias-state-success-primary,#047857);background:var(--dsw-alias-state-success-tertiary,#ecfdf5)}
.btm-search{flex:1;min-width:120px;padding:5px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px}
.btm-select{padding:5px 6px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:12px}
.btm-cats{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px;max-height:56px;overflow:auto}
.btm-cat{padding:3px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#e5e7eb);background:transparent;color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:11px;cursor:pointer}
.btm-cat.active{color:#fff;background:var(--dsw-alias-accent,#475569);border-color:transparent}
.btm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));grid-auto-rows:min-content;align-items:start;gap:8px;flex:1;min-height:0;overflow:auto;padding-right:2px}
/* ---------- 卡片 ---------- */
.btm-card{display:flex;flex-direction:column;align-self:start;contain:content;min-width:0;min-height:184px;padding:14px;border-radius:10px;text-align:left;color:inherit;font:inherit;background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e4e8);overflow:hidden}
.btm-card:hover{border-color:var(--dsw-alias-border-l1,#cfd2d8);box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgb(20 24 32 / 8%))}
.btm-card.is-installed{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#279c62) 45%,var(--dsw-alias-border-l2,#e2e4e8))}
.btm-card-head{display:flex;gap:10px;align-items:center;min-width:0;flex:none}
.btm-card-logo{width:36px;height:36px;flex:none;overflow:hidden;border-radius:9px;background:linear-gradient(135deg,#c7d2fe,#fbcfe8);border:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.btm-card-logo img{width:100%;height:100%;display:block;object-fit:cover}
/* 图标缺失/加载失败时的兜底：蓝底白字首字，明确传达"这是个占位"而不是坏图 */
.btm-logo-fallback{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:14px;font-weight:700;color:#fff;background:#3b82f6;text-transform:uppercase}
/* 插件类卡片兜底：同一个蓝底，内容换成拼图图标（背景色不变） */
.btm-logo-glyph svg{display:block}
.btm-card-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;overflow:hidden}
.btm-card-name{font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-card-fullname{font-size:11px;line-height:16px;flex:none;color:var(--dsw-alias-label-tertiary,#7b8088);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-badge{align-self:center;flex:none;padding:1px 7px;border-radius:999px;font-size:10px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
/* 可更新徽标：琥珀色系，与已安装（绿）区分 */
.btm-badge.is-update{background:var(--dsw-alias-state-warning-tertiary,#fffbeb);color:var(--dsw-alias-state-warning-primary,#b45309)}
.btm-badge.is-off{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-secondary,#4b5058)}
.btm-card-desc{flex:none;margin:10px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-card-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none;margin-top:auto;padding-top:12px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-card-cat{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-card-stats{display:flex;gap:10px;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8088);font-variant-numeric:tabular-nums}
.btm-card-stats>span{flex:none;white-space:nowrap}
/* 操作区独立成行 + 上分割线：详情在左（文字链接，非按钮），安装/状态在右 */
.btm-card-actions{display:flex;align-items:center;gap:8px;flex:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-card-details{flex:1 1 64px;min-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5058);font:inherit;font-size:12px;font-weight:500;line-height:18px;text-align:left;text-decoration:none;cursor:pointer}
.btm-card-details:hover{color:var(--dsw-alias-state-business-primary,#4d6bfe);text-decoration:underline}
.btm-btn{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-accent,#475569);background:var(--dsw-alias-accent,#475569);color:#fff;font:inherit;font-size:12px;cursor:pointer}
.btm-btn:hover{filter:brightness(1.08)}
.btm-btn:disabled{opacity:.55;cursor:not-allowed;filter:none}
.btm-btn.primary{background:var(--dsw-alias-state-business-primary,#4d6bfe);border-color:var(--dsw-alias-state-business-primary,#4d6bfe)}
.btm-btn.danger{background:transparent;color:var(--dsw-alias-state-error-primary,#dc2626);border-color:var(--dsw-alias-state-error-primary,#dc2626)}
.btm-btn.danger:hover{background:var(--dsw-alias-state-error-tertiary,#fef2f2);filter:none}
.btm-btn.ghost{background:transparent;color:var(--dsw-alias-label-secondary,#4b5058);border-color:var(--dsw-alias-border-l1,#cfd2d8)}
.btm-btn.ghost:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6);filter:none}
/* 已安装：位置不动，靠文案 + 成功色表达状态 */
.btm-btn.done{background:transparent;border-color:transparent;color:var(--dsw-alias-state-success-primary,#047857);cursor:default;opacity:1}
/* 方形图标按钮（文件夹定位等）：与文字按钮同高，只占一个图标位 */
.btm-btn.btm-btn-icon{min-height:30px;width:30px;padding:0}
/* 无框纯图标按钮（文件夹定位）：彩色图形自表达，尺寸锁 26 与紧凑按钮同高 */
.btm-btn-icononly{appearance:none;display:inline-flex;align-items:center;justify-content:center;width:26px;min-height:26px;padding:0;border:0;background:transparent;cursor:pointer;border-radius:6px;flex:none}
.btm-btn-icononly:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
.btm-btn-icononly svg{display:block}
.btm-btn.done:hover{filter:none}
.btm-spec{flex:none;margin:6px 0 0;font-size:10px;line-height:14px;color:var(--dsw-alias-label-caption,#6b7280);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-installed{display:flex;flex-direction:column;flex:1;min-height:0}
/* ---------- 详情弹层（README / 技能详情共用） ---------- */
.btm-sheet-mask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:32px 20px;box-sizing:border-box;background:var(--dsw-alias-bg-mask-3,rgba(15,23,42,.42))}
.btm-sheet{display:flex;flex-direction:column;width:min(760px,100%);max-height:min(84vh,780px);overflow:hidden;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,#e2e4e8);box-shadow:0 18px 50px rgba(15,23,42,.26)}
.btm-sheet-top{display:flex;align-items:flex-start;gap:14px;flex:none;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-sheet-title{flex:1;min-width:0}
.btm-sheet-title h3{margin:0;font-size:15px;font-weight:600;line-height:22px;color:var(--dsw-alias-label-primary,#17191c);word-break:break-word}
.btm-sheet-title p{margin:3px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#7b8088);word-break:break-all}
.btm-sheet-meta{flex:none;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:9px 18px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8088);font-variant-numeric:tabular-nums}
.btm-sheet-body{flex:1;min-height:0;overflow:auto;padding:16px 18px 22px}
.btm-sheet-foot{flex:none;display:flex;justify-content:flex-end;gap:8px;padding:11px 18px;border-top:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-chip{padding:2px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#4b5058)}
.btm-sheet-h{margin:16px 0 8px;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#17191c)}
.btm-sheet-body>*:first-child{margin-top:0}
.btm-kv{margin:0;padding:0;list-style:none}
.btm-kv li{display:flex;gap:12px;align-items:baseline;padding:5px 0;font-size:12px;line-height:18px;border-bottom:1px dashed var(--dsw-alias-border-l2,#e2e4e8)}
.btm-kv li:last-child{border-bottom:0}
.btm-kv span{flex:none;width:84px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-kv b{font-weight:500;color:var(--dsw-alias-label-primary,#17191c);word-break:break-all}
.btm-taglist{display:flex;flex-wrap:wrap;gap:6px}
/* ---------- Markdown 渲染排版 ---------- */
.btm-md{font-size:13px;line-height:21px;color:var(--dsw-alias-label-secondary,#4b5058);word-break:break-word}
.btm-md>*:first-child{margin-top:0}
.btm-md h1,.btm-md h2,.btm-md h3,.btm-md h4{margin:18px 0 8px;font-weight:600;line-height:1.35;color:var(--dsw-alias-label-primary,#17191c)}
.btm-md h1{font-size:19px;padding-bottom:6px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-md h2{font-size:16px;padding-bottom:5px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-md h3{font-size:14px}
.btm-md h4{font-size:13px}
.btm-md p{margin:9px 0}
.btm-md ul,.btm-md ol{margin:9px 0;padding-left:22px}
.btm-md li{margin:4px 0}
.btm-md li>ul,.btm-md li>ol{margin:4px 0}
.btm-md a{color:var(--dsw-alias-state-business-primary,#4d6bfe);text-decoration:none}
.btm-md a:hover{text-decoration:underline}
.btm-md code{padding:1px 5px;border-radius:5px;background:var(--dsw-alias-bg-layer-1,#f5f6f8);border:1px solid var(--dsw-alias-border-l2,#e2e4e8);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
.btm-md pre{margin:11px 0;padding:11px 13px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,#f5f6f8);border:1px solid var(--dsw-alias-border-l2,#e2e4e8);overflow:auto}
.btm-md pre code{padding:0;border:0;background:none;font-size:12px;line-height:19px;white-space:pre}
.btm-md blockquote{margin:11px 0;padding:6px 13px;border-left:3px solid var(--dsw-alias-border-l1,#cfd2d8);color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-md hr{margin:16px 0;border:0;border-top:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-md table{width:100%;margin:11px 0;border-collapse:collapse;font-size:12px}
.btm-md th,.btm-md td{padding:6px 9px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);text-align:left}
.btm-md th{background:var(--dsw-alias-bg-layer-1,#f5f6f8);font-weight:600}
.btm-md img{max-width:100%;height:auto}
/* ---------- 设置页 ---------- */
.btm-settings{display:flex;flex-direction:column;gap:10px}
.btm-set-head{display:flex;flex-direction:column;gap:2px}
.btm-set-title{cursor:pointer;-webkit-user-select:none;user-select:none}
/* 设置页提示浮层：固定卡片右下，3 秒自动消失 */
.btm-toastbox{position:fixed;right:28px;bottom:28px;z-index:9999;width:fit-content;max-width:min(420px,80vw);padding:9px 14px;border-radius:10px;font-size:12px;line-height:18px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857);border:1px solid color-mix(in srgb,var(--dsw-alias-state-success-primary,#047857) 25%,transparent);box-shadow:var(--dsw-shadow-lv1,0 2px 8px rgb(20 24 32 / 8%));animation:btm-toast-in .18s ease-out}
.btm-toastbox.is-error{background:var(--dsw-alias-state-error-tertiary,#fef2f2);color:var(--dsw-alias-state-error-primary,#b91c1c);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#b91c1c) 25%,transparent)}
@keyframes btm-toast-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.btm-set-title{margin:0;font-size:13px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,#17191c)}
.btm-set-desc{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-set-kv li{font-size:11px}
.btm-set-actions{display:flex;gap:8px}
.btm-set-list{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.btm-set-list li{display:flex;align-items:center;gap:12px;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-layer-2,#f8fafc)}
.btm-set-name{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.btm-set-name b{font-size:12px;font-weight:500;line-height:18px;color:var(--dsw-alias-label-primary,#17191c);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-set-name span{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-set-ver{flex:none;display:inline-flex;align-items:center;gap:6px;font-size:11px;font-variant-numeric:tabular-nums}
.btm-ver-old{color:var(--dsw-alias-label-tertiary,#7b8088);text-decoration:line-through}
.btm-ver-arrow{color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-ver-new{color:var(--dsw-alias-state-success-primary,#047857);font-weight:600}
.btm-ver-cur{color:var(--dsw-alias-label-secondary,#4b5058)}
/* ---------- 对话流工具卡片 ---------- */
.btm-tv{display:flex;flex-direction:column;gap:9px;font:inherit}
.btm-tv-head{display:flex;align-items:baseline;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5058)}
.btm-tv-head b{color:var(--dsw-alias-label-primary,#17191c)}
.btm-tv-count{color:var(--dsw-alias-label-tertiary,#7b8088);font-size:11px;font-variant-numeric:tabular-nums}
.btm-tv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(232px,1fr));grid-auto-rows:min-content;align-items:start;gap:8px}
.btm-tv-progress{display:flex;flex-direction:column;gap:4px;flex:none;margin-top:8px}
.btm-tv-done{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 11px;border-radius:10px;font-size:12px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
.btm-tv-simple{flex-direction:row;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary,#4b5058)}
/* 🔴 空态要真正居中：.btm-grid 是 display:grid，空态作为 grid item 会被塞进
   单元格里，text-align:center 只管文字、不管盒子位置 ⇒ 文字靠左。
   正确做法是让它跨满整行（grid-column:1/-1）再自身文字居中。 */
.btm-empty{grid-column:1/-1;padding:40px 0;text-align:center;font-size:12px;color:var(--dsw-alias-label-caption,#6b7280)}
/* 加载更多按钮行 + 尽头提示 */
.btm-more{display:flex;justify-content:center;padding:14px 0 6px}
.btm-end{padding:18px 0 26px;text-align:center;font-size:12px;color:var(--dsw-alias-label-tertiary,#9aa0a6)}
.btm-loading,.btm-error{padding:12px 0;text-align:center;font-size:12px;color:var(--dsw-alias-label-caption,#6b7280)}
.btm-error{color:var(--dsw-alias-state-danger-primary,#b91c1c)}
.btm-banner{display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:8px;border-radius:10px;font-size:12px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
.btm-progress{display:flex;flex-direction:column;gap:4px;padding:8px 10px;margin-top:8px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,#f8fafc);border:1px solid var(--dsw-alias-border-l2,#e5e7eb)}
.btm-progress-line{display:flex;align-items:center;justify-content:space-between;font-size:12px}
.btm-progress-sub{font-size:11px;color:var(--dsw-alias-label-caption,#6b7280)}
.btm-progress-error{font-size:11px;color:var(--dsw-alias-state-danger-primary,#b91c1c)}
.btm-progress-bar{height:5px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-border-l2,#e5e7eb)}
.btm-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-accent,#475569);transition:width .2s}
.btm-progress-fill.btm-indeterminate{width:34%;animation:btm-indet 1.15s ease-in-out infinite}
@keyframes btm-indet{0%{margin-left:-35%}100%{margin-left:100%}}
`;

/** 注入面板样式（幂等；effect 重跑不重复插入） */
function ensureCss() {
  const id = 'baitong-market-style';
  if (!document.getElementById(id)) {
    const el = document.createElement('style');
    el.id = id;
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  return () => {};
}

/** 渲染兜底：面板内部抛错时显示错误文本，而不是整棵树崩成白屏 */
class PanelErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[baitong-market] ' + lookup('面板渲染失败'), error, info);
  }

  render() {
    if (this.state.error) {
      const msg = (this.state.error && this.state.error.message) || String(this.state.error);
      return (
        <div className="btm-panel">
          <div className="btm-error">
            {lookup('面板渲染失败：')}
            {msg}
          </div>
          <pre className="btm-progress-error">{String((this.state.error && this.state.error.stack) || '')}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================ 主面板 ============================ */

/**
 * 「已安装」独立视图：直接读本机已装清单（跨 profile 合并），
 * 不复用市场搜索结果——已装的插件可能已下架/改名，市场里搜不到。
 */
function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(raw) {
  if (!raw) return '';
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

/* ============================ Markdown 渲染 ============================ */

function escapeHtml(raw) {
  return String(raw)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 行内标记：反引号 code、双星号 bold、单星号 italic、[text](url) 链接。
 * 必须在转义之后调用。
 */
function markdownInline(text) {
  return text
    .replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
}

/**
 * 极简 Markdown → HTML。
 * 只覆盖 README 常见语法（标题/列表/代码块/引用/分割线/表格/行内标记），
 * 先整体转义再生成标签，杜绝 README 里的 HTML 注入。
 */
/**
 * 🔴 概述字段可能是 **HTML**（后端富文本里全是 `<p><img src=...></p>`），
 * 也可能是 Markdown。原来统一走 escapeHtml + Markdown 渲染，
 * 于是 HTML 标签被转义成 `&lt;p&gt;...` 纯文本 —— **图片当然不显示**。
 *
 * 安全权衡：内容来自后端接口，直接 `dangerouslySetInnerHTML` 放行任意 HTML
 * 等于把 XSS 面交给上游。所以走**白名单净化**：
 *   - 放行：img / p / br / 基础排版（b i em strong u s code pre h1-h6 ul ol li blockquote hr table系 a）
 *   - 剥掉：script / style / iframe / object / embed / form 等可执行或可导航元素
 *   - 剥掉：所有 on* 事件属性、style 里的表达式（url(javascript:)…）、
 *     以及 href/src 里的 javascript: 协议
 *   - 图片强制走本机图标代理，否则 COS 直连在离线/内网环境必然裂图
 */
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/;
/** Markdown 路径下直接丢弃的"纯装饰容器"标签：align/style 本来就不放行，留着只会和渲染器生成的 <p> 互相嵌套 */
const MARKDOWN_DROP_TAGS = new Set(['div', 'p', 'span', 'figure', 'figcaption']);
const ALLOWED_HTML_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'dd', 'del', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img',
  'li', 'ol', 'p', 'pre', 's', 'span', 'strong', 'sub', 'sup', 'table', 'tbody',
  'td', 'th', 'thead', 'tr', 'u', 'ul',
]);
/**
 * 可执行 / 可导航 / 可嵌入外部文档的元素，一律整段丢弃（含内容）。
 *
 * 🔴 写法陷阱（实测踩过）：用 `<\/\1\s*>` 匹配闭合标签是**错的** ——
 * `<script>x</script>` 里的 `</` 之后紧跟 `script`，能匹配上；但正则的
 * `[\s\S]*?` 惰性 + 可选的闭合分支（`>）`）会在遇到**内容里的第一个 `>`** 就提前收尾，
 * 于是 `<script>alert(2)</script>` 只删掉了 `<script>`，**内容 `alert(2)` 泄漏成裸文本**
 * （同理 `<script>if(a<b){...}</script>` 会从 `a<b` 处开始泄漏）。
 *
 * 正解：闭合标签写成 `<\/script` 这类**字面量**形式逐标签匹配，
 * 并且把"未闭合"作为兜底（`[\\s\\S]*$` 吞到结尾），宁可多删不可漏删。
 */
const DANGEROUS_BLOCKS = [
  /<script\b[\s\S]*?(?:<\/script\s*>|$)/gi,
  /<style\b[\s\S]*?(?:<\/style\s*>|$)/gi,
  /<iframe\b[\s\S]*?(?:<\/iframe\s*>|$)/gi,
  /<object\b[\s\S]*?(?:<\/object\s*>|$)/gi,
  /<embed\b[\s\S]*?(?:<\/embed\s*>|$)/gi,
  /<form\b[\s\S]*?(?:<\/form\s*>|$)/gi,
  /<link\b[^>]*>/gi,
  /<meta\b[^>]*>/gi,
  /<base\b[^>]*>/gi,
];

/** 属性值转义（白名单净化在"已剔除危险标签"的前提下使用） */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 危险 URL 协议：javascript: / vbscript: / data:（data: 只放行图片） */
function safeUrl(raw, allowDataImage) {
  const url = String(raw || '').trim();
  if (/^\s*(javascript|vbscript|file)\s*:/i.test(url)) return '';
  if (/^\s*data\s*:/i.test(url)) return allowDataImage && /^data:image\//i.test(url) ? url : '';
  return url;
}

/**
 * 把文本里的 HTML 标签按白名单抠成占位符（`\u0000N\u0000`），返回 { text, slots }。
 *
 * 为什么拆成共用函数：两条渲染路径必须用**同一套**放行规则，否则迟早跑偏 ——
 *   - 整篇 HTML（后端富文本概述）→ sanitizeHtml：非白名单标签直接删掉；
 *   - Markdown 里混 HTML（README 十有八九带 `<div align="center"><img …>`）→
 *     renderMarkdownSafe：Markdown 交给渲染器，HTML 标签走同一套白名单保留。
 *
 * @param keepUnknown true：非白名单标签原样留着（Markdown 路径用，转义后当纯文本显示，
 *                    避免把 `<profile>` 这类代码示例整段删掉）；false：直接删掉标签（HTML 净化路径用）
 */
function extractAllowedHtml(raw, keepUnknown = false) {
  const slots = [];
  const withSlots = String(raw || '').replace(
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (match, tagRaw, attrRaw) => {
      const tag = tagRaw.toLowerCase();
      if (!ALLOWED_HTML_TAGS.has(tag)) return keepUnknown ? match : ''; // 非白名单：Markdown 路径原样留着当文本，HTML 路径直接删掉
      // Markdown 路径：装饰性容器整对丢掉，只留里面的内容（图片/换行等仍在）
      if (keepUnknown && MARKDOWN_DROP_TAGS.has(tag)) return '';
      // 🔴 闭合标签也必须走占位符，不能直接返回 `</p>` ——
      //    直接返回的话，第③步的 escapeHtml 会把它转义成 `&lt;/p&gt;`，
      //    产出就是"标签开了没关"（实测踩过）。
      if (match.startsWith('</')) {
        slots.push(`</${tag}>`);
        return `\u0000${slots.length - 1}\u0000`;
      }
      const attrs = [];
      const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+)/g;
      let m;
      while ((m = attrRe.exec(attrRaw)) !== null) {
        const name = m[1].toLowerCase();
        const value = m[2].replace(/^["']|["']$/g, '');
        if (name.startsWith('on')) continue;             // 事件处理器一律剥掉
        if (tag === 'img') {
          if (name === 'src') {
            const url = safeUrl(value, true);
            // 只保留能代理到的绝对地址：https / data:image / 站内 `/` 开头。
            // README 里的相对路径（icon.svg、docs/x.png）是包内文件，代理过去必然 404 ⇒ 直接丢图，不露破图
            const proxyable = !!url && (/^https:\/\//i.test(url) || /^data:image\//i.test(url) || url.startsWith('/'));
            if (!proxyable) return '';
            attrs.push(`src="${escapeAttr(iconUrl(url))}"`); // 走本机图标代理：离线/内网环境下直连必然裂图
          } else if (name === 'alt') attrs.push(`alt="${escapeAttr(value)}"`);
          else if (name === 'width' || name === 'height') {
            const n = Number(value);
            if (Number.isFinite(n) && n > 0 && n <= 4096) attrs.push(`${name}="${Math.floor(n)}"`);
          }
          continue;
        }
        if (name === 'href') {
          const url = safeUrl(value, false);
          if (!url) continue;
          attrs.push(`href="${escapeAttr(url)}"`, 'target="_blank"', 'rel="noreferrer noopener"');
          continue;
        }
        // 其余只放行 title / colspan / rowspan / start 这类展示性属性
        if (['title', 'colspan', 'rowspan', 'start'].includes(name)) {
          attrs.push(`${name}="${escapeAttr(value)}"`);
        }
      }
      slots.push(`<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`);
      return `\u0000${slots.length - 1}\u0000`;
    },
  );
  return { text: withSlots, slots };
}

/** 把占位符换回真实标签（`\u0000N\u0000` → slots[N]） */
function restoreSlots(html, slots) {
  return String(html).replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)] ?? '');
}

/** 白名单净化 HTML：只留展示性标签与安全属性，其余标签改为文本、危险元素整段删除。 */
function sanitizeHtml(raw) {
  // ① 先整段删除危险元素及其内容（必须在标签处理之前，否则会留下碎片）
  const withoutBlocks = DANGEROUS_BLOCKS.reduce((acc, re) => acc.replace(re, ''), String(raw || ''));
  // ② 标签先抠成占位符，剩余文本再统一转义。
  //    🔴 顺序陷阱：不能「先拼标签、最后统一转义」—— 那样会把刚生成的合法标签一起转义掉
  //    （实测 `<img src=...>` → `&lt;img...&gt;`，图片又不显示了）。
  const { text, slots } = extractAllowedHtml(withoutBlocks);
  // ③ 转义剩余文本（标签已抠成占位符，不会被误伤）
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // ④ 放回标签
  return restoreSlots(escaped, slots);
}

/**
 * 块级 Markdown 特征：命中任意一条就按 Markdown 渲染（见 renderRichText）。
 * 用块级语法而不是"有没有尖括号"判定，是因为 README 几乎都含 HTML 标签。
 */
function looksLikeMarkdown(raw) {
  return (
    /^#{1,6}[ \t]+\S/m.test(raw) ||        // # 标题
    /^[ \t]*```/m.test(raw) ||             // ``` 代码围栏
    /^[ \t]*[-*+][ \t]+\S/m.test(raw) ||   // - 无序列表
    /^[ \t]*\d+[.)][ \t]+\S/m.test(raw) || // 1. 有序列表
    /^[ \t]*\|.*\|[ \t]*$/m.test(raw) ||   // | 表格 |
    /\[[^\]]+\]\([^)\s]+\)/.test(raw)      // [文字](链接)
  );
}

/**
 * Markdown 渲染：先把白名单 HTML 标签抠成占位符，渲染完再放回。
 * README 常见写法是"Markdown 正文 + 少量 HTML（居中容器/徽章/图片）"，这样两边都不丢。
 */
function renderMarkdownSafe(raw) {
  const { text, slots } = extractAllowedHtml(raw, true);
  return restoreSlots(renderMarkdown(text), slots);
}

/**
 * 富文本渲染总入口：**先判断这份内容该按 Markdown 还是 HTML 渲染**。
 *
 * 🔴 旧实现只看"是否含 HTML 标签"：README.md 几乎都带 `<img>` / `<div align>` / `<br>`，
 * 于是整篇被当成 HTML 净化，`#` 标题、`-` 列表、`|` 表格、``` 代码块**全被转义成纯文本**
 * —— 用户看到的就是"格式渲染失败"。现在按块级 Markdown 特征判定：
 *
 *   - 有 Markdown 块语法 ⇒ Markdown 渲染（HTML 标签按白名单保留）；
 *   - 否则含 HTML 标签 ⇒ 白名单净化（后端富文本概述走这条）；
 *   - 都没有 ⇒ 按 Markdown 渲染（段落/换行）。
 */
function renderRichText(source) {
  const raw = String(source == null ? '' : source);
  if (!raw.trim()) return '';
  if (looksLikeMarkdown(raw)) return renderMarkdownSafe(raw);
  return HTML_TAG_RE.test(raw) ? sanitizeHtml(raw) : renderMarkdown(raw);
}

function renderMarkdown(source) {
  const lines = escapeHtml(source).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let idx = 0;
  let listType = null; // 'ul' | 'ol'
  let inTable = false;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const closeTable = () => {
    if (inTable) {
      out.push('</tbody></table>');
      inTable = false;
    }
  };
  const cells = (row) =>
    row
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => markdownInline(c.trim()));

  while (idx < lines.length) {
    const line = lines[idx];

    // 代码块：```lang ... ```
    const fence = /^\s*```(\w*)\s*$/.exec(line);
    if (fence) {
      closeList();
      closeTable();
      const buf = [];
      idx += 1;
      while (idx < lines.length && !/^\s*```\s*$/.test(lines[idx])) {
        buf.push(lines[idx]);
        idx += 1;
      }
      idx += 1;
      out.push(`<pre><code>${buf.join('\n')}</code></pre>`);
      continue;
    }

    // 分割线
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      closeList();
      closeTable();
      out.push('<hr>');
      idx += 1;
      continue;
    }

    // 标题
    const head = /^(#{1,4})\s+(.*)$/.exec(line);
    if (head) {
      closeList();
      closeTable();
      const level = head[1].length;
      out.push(`<h${level}>${markdownInline(head[2].trim())}</h${level}>`);
      idx += 1;
      continue;
    }

    // 表格：| a | b |  +  | --- | --- |
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      idx + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[idx + 1])
    ) {
      closeList();
      closeTable();
      const header = cells(line.trim());
      idx += 2;
      out.push(`<table><thead><tr>${header.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>`);
      inTable = true;
      while (idx < lines.length && /^\s*\|.*\|\s*$/.test(lines[idx])) {
        const row = cells(lines[idx].trim());
        out.push(`<tr>${row.map((c) => `<td>${c}</td>`).join('')}</tr>`);
        idx += 1;
      }
      closeTable();
      continue;
    }

    // 引用（注意：正文已整体转义，行首的 > 此时是 &gt;）
    const QUOTE_RE = /^\s*(?:&gt;|>)\s?(.*)$/;
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      closeList();
      closeTable();
      const buf = [];
      while (idx < lines.length) {
        const q = QUOTE_RE.exec(lines[idx]);
        if (!q) break;
        buf.push(q[1]);
        idx += 1;
      }
      out.push(`<blockquote>${buf.map((b) => markdownInline(b)).join('<br>')}</blockquote>`);
      continue;
    }

    // 有序 / 无序列表
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      closeTable();
      const want = ul ? 'ul' : 'ol';
      if (listType !== want) {
        closeList();
        out.push(`<${want}>`);
        listType = want;
      }
      out.push(`<li>${markdownInline((ul || ol)[1].trim())}</li>`);
      idx += 1;
      continue;
    }

    // 空行
    if (!line.trim()) {
      closeList();
      closeTable();
      idx += 1;
      continue;
    }

    // 普通段落（连续行合并，单个换行转 <br>）
    closeList();
    closeTable();
    const buf = [];
    while (
      idx < lines.length &&
      lines[idx].trim() &&
      !/^\s*```/.test(lines[idx]) &&
      !/^(#{1,4})\s/.test(lines[idx]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[idx]) &&
      !/^\s*(?:&gt;|>)\s?/.test(lines[idx]) &&
      !/^\s*[-*+]\s+/.test(lines[idx]) &&
      !/^\s*\d+[.)]\s+/.test(lines[idx]) &&
      !/^\s*\|.*\|\s*$/.test(lines[idx])
    ) {
      buf.push(lines[idx]);
      idx += 1;
    }
    out.push(`<p>${buf.map((b) => markdownInline(b.trim())).join('<br>')}</p>`);
  }

  closeList();
  closeTable();
  return out.join('\n');
}

/* ============================ 详情弹层 ============================ */

/**
 * 通用详情弹层：标题 + 元信息行 + 可滚动正文 + 底部操作区。
 * 插件 README 与技能详情共用，避免各自实现一套排版。
 */
function DetailSheet({ title, subtitle, meta, onClose, actions, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return createPortal(
    <div className="btm-sheet-mask" onClick={onClose}>
      <div className="btm-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="btm-sheet-top">
          <div className="btm-sheet-title">
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="btm-close" onClick={onClose} aria-label="关闭" title="关闭">
            ×
          </button>
        </div>
        {meta ? <div className="btm-sheet-meta">{meta}</div> : null}
        <div className="btm-sheet-body">{children}</div>
        {actions ? <div className="btm-sheet-foot">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * 技能详情弹层：概述 + 版本信息 + 标签。
 * ⚠️ 百通技能接口**不提供版本历史**（只有当前版本的 download_url），
 * 所以这里展示「远端当前版本 + 本地安装记录」两组事实，并明确标注能力边界，
 * 不伪造历史版本列表。
 */
function SkillDetailSheet({ slug, fallbackName, onClose }) {
  const tr = useTr();
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });

  useEffect(() => {
    let live = true;
    api('skillDetail', { slug }).then(([err, res]) => {
      if (!live) return;
      if (err || !res || res.ok === false) {
        setState({ status: 'error', data: null, error: err || (res && res.error) || tr('读取失败') });
        return;
      }
      setState({ status: 'ready', data: res, error: '' });
    });
    return () => {
      live = false;
    };
  }, [slug]);

  const d = state.data;
  const meta = d
    ? [
        d.version ? <span className="btm-chip" key="v">{`${tr('当前版本')} ${d.version}`}</span> : null,
        d.category ? <span key="c">{d.category}</span> : null,
        d.rating ? <span key="r">{`${tr('评分')} ${d.rating}`}</span> : null,
        d.downloadCount ? <span key="d">{`${tr('下载')} ${d.downloadCount}`}</span> : null,
        d.installed ? <span key="i" className="btm-chip">{tr('已安装')}</span> : null,
      ].filter(Boolean)
    : null;

  let body;
  if (state.status === 'loading') body = <p className="btm-status">{tr('正在读取技能详情…')}</p>;
  else if (state.status === 'error')
    body = (
      <p className="btm-status">
        {tr('详情读取失败：')}
        {state.error}
      </p>
    );
  else
    body = (
      <>
        <h4 className="btm-sheet-h">{tr('概述')}</h4>
        <div className="btm-md" dangerouslySetInnerHTML={{ __html: renderRichText(d.description || d.summary || tr('暂无概述')) }} />

        <h4 className="btm-sheet-h">{tr('版本信息')}</h4>
        <ul className="btm-kv">
          <li>
            <span>{tr('远端最新')}</span>
            <b>{d.version || tr('未知')}</b>
          </li>
          <li>
            <span>{tr('本地已装')}</span>
            <b>{d.local && d.local.version ? d.local.version : localVersionText(d)}</b>
          </li>
          {d.local && d.local.installedAt ? (
            <li>
              <span>{tr('安装时间')}</span>
              <b>{formatTime(d.local.installedAt)}</b>
            </li>
          ) : null}
          {d.size ? (
            <li>
              <span>{tr('包体积')}</span>
              <b>{formatBytes(d.size)}</b>
            </li>
          ) : null}
        </ul>
        <p className="btm-status">{tr('说明：百通技能接口未提供版本历史，这里只能展示当前版本与本地安装记录。')}</p>

        {d.tags ? (
          <>
            <h4 className="btm-sheet-h">{tr('标签')}</h4>
            <div className="btm-taglist">
              {String(d.tags)
                .split(/[,，]/)
                .map((tag) => tag.trim())
                .filter(Boolean)
                .map((tag) => (
                  <span className="btm-chip" key={tag}>
                    {tag}
                  </span>
                ))}
            </div>
          </>
        ) : null}
      </>
    );

  return (
    <DetailSheet title={(d && d.name) || fallbackName || slug} subtitle={slug} meta={meta} onClose={onClose}>
      {body}
    </DetailSheet>
  );
}

function localVersionText(d) {
  return d.installed ? '（无版本记录）' : '未安装';
}

/** 已安装插件的「插件说明」弹层：README 走 Markdown 渲染，读不到时给出兜底提示。 */
function PluginDetail({ item, onClose }) {
  const tr = useTr();
  const [state, setState] = useState({ status: 'loading', text: '', truncated: false });
  useEffect(() => {
    let live = true;
    api('pluginReadme', { pkg: item.pkg, profile: item.profile }).then(([err, data]) => {
      if (!live) return;
      if (err || !data || data.ok === false) {
        setState({ status: 'error', text: '', truncated: false });
        return;
      }
      setState({
        status: data.readme ? 'ready' : 'empty',
        text: String(data.readme || ''),
        truncated: !!data.truncated,
      });
    });
    return () => {
      live = false;
    };
  }, [item.pkg, item.profile]);

  const meta = [
    item.version ? <span className="btm-chip" key="v">{fmtVer(item.version)}</span> : null,
    (item.profiles || []).length ? <span key="p">{item.profiles.join(' · ')}</span> : null,
    item.spec ? <span key="s">{item.spec}</span> : null,
  ].filter(Boolean);

  let body;
  if (state.status === 'loading') body = <p className="btm-status">{tr('正在读取插件说明…')}</p>;
  else if (state.status === 'error') body = <p className="btm-status">{tr('插件说明读取失败。')}</p>;
  else if (state.status === 'empty') body = <p className="btm-status">{tr('该插件没有附带说明文档（README）。')}</p>;
  else
    body = (
      <>
        <div className="btm-md" dangerouslySetInnerHTML={{ __html: renderRichText(state.text) }} />
        {state.truncated ? <p className="btm-status">{tr('（说明文档超过 64KB，此处仅显示前一部分）')}</p> : null}
      </>
    );

  return (
    <DetailSheet
      title={item.name || item.pkg}
      subtitle={item.pkg}
      meta={meta.length ? meta : null}
      onClose={onClose}
      actions={
        <button type="button" className="btm-btn" onClick={onClose}>
          {tr('关闭')}
        </button>
      }
    >
      {body}
    </DetailSheet>
  );
}

/**
 * 「已安装」独立视图：直接读本机已装清单（跨 profile 按包名合并），
 * 不复用市场搜索结果 —— 已装的插件可能已下架/改名，市场里搜不到。
 * 插件卡片展开可看 README；两者都支持卸载。
 */
function InstalledView({ kind, keyword = '', installStatus, onChanged, onNeedRestart }) {
  const tr = useTr();
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [detail, setDetail] = useState(null); // 当前打开详情的条目
  const [busyKey, setBusyKey] = useState(null); // 卸载/更新中
  const [uninstallErr, setUninstallErr] = useState('');
  useAutoClearError(uninstallErr, setUninstallErr);
  const [latestMap, setLatestMap] = useState(() => new Map()); // pkg -> { latest, hasUpdate }
  const wasActiveRef = useRef(false);
  // 回调放 ref：父组件传的是内联箭头函数，写进 useCallback 依赖会让 load 每渲染都变 → 无限循环
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    const [err, data] = kind === 'skills' ? await api('skillList') : await api('installedPlugins');
    if (err) {
      setState({ status: 'error', items: [] });
      return;
    }
    // 插件：同时拉线上 latest 表，驱动「可更新」标签（失败静默，标签不亮即可）
    if (kind !== 'skills') {
      api('pluginLatestVersions').then(([, vd]) => {
        if (vd && vd.items) setLatestMap(new Map(vd.items.map((x) => [x.pkg, x])));
      });
    }
    const items =
      kind === 'skills'
        ? (data?.items || []).map((it) => ({
            key: it.slug,
            name: it.name || it.slug,
            version: it.version || '',
            description: '',
            extra: it.slug,
            files: it.files,
            bytes: it.bytes,
            updateTime: it.updateTime,
          }))
        : (data?.items || []).map((it) => ({
            key: it.pkg,
            pkg: it.pkg,
            profile: (it.profiles && it.profiles[0]) || it.profile || '',
            profiles: it.profiles || [],
            name: it.name || it.pkg,
            version: it.version || '',
            description: it.description || '',
            spec: it.spec || '',
            // 装了但没进 dsh.profile.bundles ⇒ DSH 不会加载它，需要一键启用
            enabled: it.enabled !== false,
            extra: it.pkg,
          }));
    setState({ status: 'ready', items });
    if (onChangedRef.current) onChangedRef.current(items.length);
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  // 卸载是异步的：轮询状态从 active 回落时重新拉清单
  useEffect(() => {
    const active = !!(installStatus && installStatus.active);
    if (wasActiveRef.current && !active) {
      setBusyKey(null);
      load();
    }
    wasActiveRef.current = active;
  }, [installStatus, load]);

  // 直接复用版本检查已取得的精确目标版本，避免点击后重复查询 registry。
  const updatePlugin = async (item) => {
    setUninstallErr('');
    setBusyKey(item.key);
    const meta = latestMap.get(item.pkg) || {};
    // 平台渠道（GitHub 源插件）：把 repo + 平台 pinned sha 一起带回，后端渲染 github:owner/repo#sha
    // registry 渠道：只带 version，后端渲染 pkg@version
    const payload = meta.hubRepo
      ? { pkg: item.pkg, profile: item.profile, targetRepo: meta.hubRepo, targetSha: meta.hubSha|| '' , targetVersion: meta.latest || '' }
      : { pkg: item.pkg, profile: item.profile, targetVersion: meta.latest || '' };
    const [err] = await api('pluginUpdate', payload);
    if (err) {
      setBusyKey(null);
      setUninstallErr(err);
      return;
    }
    // 异步任务交给轮询收尾；结束后 load() 会重拉 latest 表
    if (onNeedRestart) onNeedRestart();
  };

  /**
   * 启用已安装但未生效的插件。
   * 桌面端由宿主 pluginManager 写 dsh.profile.bundles 并尝试热加载；其余 profile 写文件，
   * 重启后生效。成功后重拉清单，让卡片上的「未启用」徽标消失。
   */
  const enablePlugin = async (item) => {
    setUninstallErr('');
    setBusyKey(item.key);
    const [err, data] = await api('pluginEnable', { pkg: item.pkg, profile: item.profile });
    setBusyKey(null);
    if (err || (data && data.ok === false)) {
      setUninstallErr(err || data.error || tr('启用失败'));
      return;
    }
    await load();
    if (data && data.restartRequired && onNeedRestart) onNeedRestart();
  };

  // 在系统文件管理器中定位插件目录（explorer /select, / Finder -R / xdg-open）
  const revealPlugin = async (item) => {
    const [err] = await api('pluginReveal', { pkg: item.pkg, profile: item.profile });
    if (err) setUninstallErr(err);
  };

  const uninstall = async (item) => {
    if (!window.confirm(tr('确认卸载 {name}？', { name: item.name }))) return;
    setUninstallErr('');
    setBusyKey(item.key);
    if (kind === 'skills') {
      const [err] = await api('skillUninstall', { slug: item.key });
      setBusyKey(null);
      if (err) {
        setUninstallErr(err);
        return;
      }
      await load();
      if (onNeedRestart) onNeedRestart();
      return;
    }
    const [err, data] = await api('pluginUninstall', { pkg: item.pkg, profile: item.profile });
    if (err || (data && data.ok === false)) {
      setBusyKey(null);
      setUninstallErr(err || data.error || tr('卸载失败'));
      return;
    }
    // 异步任务已开始，交给轮询收尾
    if (onNeedRestart) onNeedRestart();
  };

  const kw = String(keyword || '').trim().toLowerCase();
  const items = kw
    ? state.items.filter((it) =>
        [it.name, it.extra, it.description].some((v) => String(v || '').toLowerCase().includes(kw)),
      )
    : state.items;

  if (state.status === 'loading') return <p className="btm-status">{tr('加载中…')}</p>;
  if (state.status === 'error') return <p className="btm-status">{tr('加载失败，请稍后重试')}</p>;
  if (!state.items.length)
    return <p className="btm-status">{kind === 'skills' ? tr('还没有已安装的技能') : tr('还没有已安装的插件')}</p>;

  return (
    <div className="btm-installed">
      {uninstallErr ? <div className="btm-error">{uninstallErr}</div> : null}
      {!items.length ? <p className="btm-status">{tr('没有匹配「{q}」的已安装项', { q: keyword })}</p> : null}
      <div className="btm-grid">
        {items.map((it) => (
          <div className="btm-card" key={it.key}>
            <div className="btm-card-head">
              <div className="btm-card-logo">
                {kind === 'skills' ? (
                  <span className="btm-logo-fallback">{String(it.name || '?').slice(0, 1)}</span>
                ) : (
                  <PluginGlyph />
                )}
              </div>
              <div className="btm-card-title">
                <span className="btm-card-name">{it.name}</span>
                <span className="btm-card-fullname">{it.extra}</span>
              </div>
            </div>
            <p className="btm-card-desc">{it.description || (kind === 'skills' ? '' : tr('暂无描述'))}</p>

            {/* 缓存/体积等 Meta 行 */}
            <div className="btm-card-meta">
              {it.version ? <span className="btm-card-profile">{fmtVer(it.version)}</span> : null}
              {/* 「可更新」放 meta 行与版本号并排：头部整行留给标题，避免名称被徽标挤没 */}
              {kind !== 'skills' && latestMap.get(it.pkg) && latestMap.get(it.pkg).hasUpdate ? (() => {
                const lm = latestMap.get(it.pkg);
                return (
                  <span
                    className="btm-badge is-update"
                    title={lm.hubRepo
                      ? tr('插件平台已发布 {v}（{repo}）', { v: lm.latest, repo: lm.hubRepo })
                      : tr('当前 {a} → 最新 {b}', { a: it.version, b: lm.latest })}
                  >
                    {tr('可更新')}
                  </span>
                );
              })() : null}
              {kind !== 'skills' && it.enabled === false ? (
                <span className="btm-badge is-off" title={tr('已安装但未启用，DSH 不会加载它')}>
                  {tr('未启用')}
                </span>
              ) : null}
              {kind === 'skills' ? (
                <>
                  {it.files != null ? <span>{tr('{n} 个文件', { n: it.files })}</span> : null}
                  {it.bytes != null ? <span>{formatBytes(it.bytes)}</span> : null}
                  {it.updateTime ? <span>{formatTime(it.updateTime)}</span> : null}
                </>
              ) : (
                it.profiles && it.profiles.length ? <span>{it.profiles.join(' · ')}</span> : null
              )}
            </div>

            {/* 插件：来源 spec（可追溯装的是哪个源） */}
            {kind !== 'skills' && it.spec ? <p className="btm-spec">{it.spec}</p> : null}

            <div className="btm-card-foot">
              <span className="btm-card-cat">{kind === 'skills' ? tr('技能') : tr('插件')}</span>
            </div>
            <div className="btm-card-actions">
              <button type="button" className="btm-card-details" onClick={() => setDetail(it)}>
                {kind === 'skills' ? tr('技能详情') : tr('插件说明')}
              </button>
              {kind !== 'skills' ? (
                <button
                  type="button"
                  className="btm-btn-icononly"
                  onClick={() => revealPlugin(it)}
                  title={tr('在文件夹中显示')}
                  aria-label={tr('在文件夹中显示')}
                >
                  <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l1.8 2h9A1.5 1.5 0 0 1 21 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" fill="#f5b642" />
                    <path d="M3 9.2h18v1.3H3z" fill="#e09b2d" />
                  </svg>
                </button>
              ) : null}
              {kind !== 'skills' && it.enabled === false ? (
                <button
                  type="button"
                  className="btm-btn primary"
                  disabled={busyKey === it.key || !!(installStatus && installStatus.active)}
                  onClick={() => enablePlugin(it)}
                  title={tr('启用后 DSH 才会加载这个插件')}
                >
                  {busyKey === it.key ? tr('启用中…') : tr('启用')}
                </button>
              ) : null}
              {kind !== 'skills' && latestMap.get(it.pkg) && latestMap.get(it.pkg).hasUpdate ? (
                <button
                  type="button"
                  className="btm-btn primary"
                  disabled={busyKey === it.key || !!(installStatus && installStatus.active)}
                  onClick={() => updatePlugin(it)}
                  title={latestMap.get(it.pkg).hubRepo
                    ? tr('从插件平台最新版本更新（{repo}）', { repo: latestMap.get(it.pkg).hubRepo })
                    : tr('从 npm 最新版本更新')}
                >
                  {busyKey === it.key ? tr('更新中…') : tr('更新')}
                </button>
              ) : null}
              <button
                type="button"
                className="btm-btn danger"
                disabled={busyKey === it.key || !!(installStatus && installStatus.active)}
                onClick={() => uninstall(it)}
              >
                {busyKey === it.key ? tr('卸载中…') : tr('卸载')}
              </button>
            </div>
          </div>
        ))}
      </div>
      {detail ? (
        kind === 'skills' ? (
          <SkillDetailSheet
            slug={detail.key}
            fallbackName={detail.name}
            localVersion={detail.version}
            onClose={() => setDetail(null)}
          />
        ) : (
          <PluginDetail item={detail} onClose={() => setDetail(null)} />
        )
      ) : null}
    </div>
  );
}

/** 已安装分段控件（全部 / 已安装 N） */
function ScopeSeg({ scope, onChange, count }) {
  const tr = useTr();
  return (
    <div className="btm-scope">
      <div className="btm-seg" role="tablist">
        <button type="button" role="tab" className={scope === 'all' ? 'on' : ''} aria-selected={scope === 'all'} onClick={() => onChange('all')}>
          {tr('全部')}
        </button>
        <button type="button" role="tab" className={scope === 'installed' ? 'on' : ''} aria-selected={scope === 'installed'} onClick={() => onChange('installed')}>
          {tr('已安装')}
          {count != null ? <span className="btm-count">{count}</span> : null}
        </button>
      </div>
    </div>
  );
}

function MarketPanel({ ctx }) {
  const [tab, setTab] = useState('plugins'); // plugins | skills
  const [keyword, setKeyword] = useState('');
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [sort, setSort] = useState('stars');
  const [scope, setScope] = useState('all'); // all | installed
  const [skillCategory, setSkillCategory] = useState(''); // 技能分类（服务端 categoryId，'' = 全部）
  const [skillCats, setSkillCats] = useState([]); // 服务端分类 Tab（skillSearch 响应带出）
  // 分页：插件 page / 技能 offset；hasMore 由响应判断；end 仅在「点了加载更多但没有新数据」时置位
  const [pluginPage, setPluginPage] = useState(1);
  const [pluginHasMore, setPluginHasMore] = useState(true);
  const [pluginEnd, setPluginEnd] = useState(false);
  const [skillOffset, setSkillOffset] = useState(0);
  const [skillHasMore, setSkillHasMore] = useState(true);
  const [skillEnd, setSkillEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [skillDetail, setSkillDetail] = useState(null); // 技能详情弹层
  const [plugins, setPlugins] = useState([]);
  const [skills, setSkills] = useState([]);
  const [installedSlugs, setInstalledSlugs] = useState(() => new Set()); // 已安装技能 slug 集合
  // 计数按 tab 分开：插件/技能数量不同，共用一个 state 会让两个 tab 显示同一个数
  const [installedPluginCount, setInstalledPluginCount] = useState(null);
  const [installedSkillCount, setInstalledSkillCount] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [installing, setInstalling] = useState(null);
  useAutoClearError(error, setError);
  const [customOpen, setCustomOpen] = useState(false); // 自定义安装输入框
  const [customTarget, setCustomTarget] = useState('');
  const [status, setStatus] = useState(null);
  const [restartHint, setRestartHint] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const pollRef = useRef(null);
  const lastBootRef = useRef(null); // 必须在下方 effect 之前声明，否则 TDZ
  const wasActiveRef = useRef(false); // 上一轮轮询时的安装活跃态（检测安装结束）
  const installingRef = useRef(null); // 轮询 effect 闭包里读最新 installing（state 会过期）
  const errorAtClickRef = useRef(null); // 点击安装那一刻的旧错误值（用于识别"这是残留不是本次结果"）
  installingRef.current = installing;

  const locale = ctx?.injects?.find?.((i) => i?.locale)?.locale;
  const t = useTr(); // 跟随 Harness 中英文（详见 i18n 区）

  /**
   * @param page 1 = 首屏（替换列表并重置尽头提示）；>1 = 加载更多（追加）
   */
  const loadPlugins = useCallback(async (page = 1) => {
    if (page === 1) { setLoading(true); setPluginEnd(false); } else { setLoadingMore(true); }
    setError('');
    const [err, data] = await api('plugins', {
      q: keyword,
      category: activeCategory || undefined,
      sort,
      page,
      pageSize: 24,
    });
    if (err) setError(t('加载失败：') + err);
    else {
      const fresh = data.items || [];
      // 插件接口不返回 hasMore：page*pageSize < total 即还有下一页
      let more = page * 24 < (Number(data.total) || 0);
      if (page === 1) {
        setPlugins(fresh);
      } else if (!fresh.length) {
        // 点了加载更多但一无所获：这就是边界（首屏不足不进这个分支）
        setPluginEnd(true);
        more = false;
      } else {
        setPlugins((prev) => [...prev, ...fresh]);
        // 本次加载的就是最后一批（之后没有更多）：立即提示，而不是等一次注定落空的点击
        if (!more) setPluginEnd(true);
      }
      setPluginHasMore(more);
    }
    setPluginPage(page);
    setLoading(false);
    setLoadingMore(false);
  }, [keyword, activeCategory, sort]);

  /** @param offset 0 = 首屏（替换 + 重置提示）；>0 = 加载更多（追加） */
  const loadSkills = useCallback(async (offset = 0) => {
    if (offset === 0) { setLoading(true); setSkillEnd(false); } else { setLoadingMore(true); }
    setError('');
    // 关键词搜索走「全库」，不再叠加分类：否则搜「患者流」时点着「医药」分类会得到空结果，
    // 用户会以为技能不存在。分类只在空关键词（浏览）时生效，与门户搜索的直觉一致。
    const [err, data] = await api('skillSearch', {
      query: keyword,
      limit: 24,
      offset,
      categoryId: keyword.trim() ? undefined : (skillCategory || undefined),
    });
    if (data && Array.isArray(data.categories)) setSkillCats(data.categories);
    if (err) setError(t('加载失败：') + err);
    else {
      const fresh = data.items || [];
      let more = !!data.hasMore;
      if (offset === 0) {
        setSkills(fresh);
      } else if (!fresh.length) {
        // 点了加载更多但一无所获：这就是边界（首屏不足不进这个分支）
        setSkillEnd(true);
        more = false;
      } else {
        setSkills((prev) => [...prev, ...fresh]);
        // 本次就是最后一批：立即提示，不让用户再点一次空按钮
        if (!more) setSkillEnd(true);
      }
      setSkillHasMore(more);
    }
    setSkillOffset(offset);
    setLoading(false);
    setLoadingMore(false);
  }, [keyword, skillCategory]);

  useEffect(() => {
    if (tab === 'plugins') loadPlugins();
    else loadSkills();
  }, [tab, loadPlugins, loadSkills]);

  // 已安装数量：两个 tab 各自独立取（插件走 installedPlugins，技能走 skillList）
  useEffect(() => {
    let live = true;
    api('installedPlugins').then(([err, data]) => {
      if (live && !err && data) setInstalledPluginCount((data.items || []).length);
    });
    return () => {
      live = false;
    };
  }, [scope]);

  useEffect(() => {
    let live = true;
    api('skillList').then(([err, data]) => {
      if (live && !err && data) setInstalledSkillCount((data.items || []).length);
    });
    return () => {
      live = false;
    };
  }, [scope]);


  useEffect(() => {
    api('pluginCategories').then(([, data]) => {
      if (data?.items) setCategories(data.items);
    });
  }, []);

  // 安装进度轮询（有活动安装时 1s 一次，否则 5s 兜底探测）
  useEffect(() => {
    const tick = async () => {
      const [, data] = await api('pluginInstallStatus');
      if (data) {
        setStatus(data);
        if (lastBootRef.current === null) {
          lastBootRef.current = data.boot;
        } else if (data.boot !== lastBootRef.current) {
          lastBootRef.current = data.boot;
          setRestartHint(false);
        }
        // 安装结束（active true→false）：有错误则展示，否则刷新列表让「已安装」生效
        if (wasActiveRef.current && !data.active) {
          setInstalling(null);
          if (data.error) {
            // 同样只在"没读过"时展示：这条路径也可能在重挂载后重复命中
            if (!isInstallErrorRead(data.error)) {
              setError(t('安装失败：') + data.error + (data.logPath ? ' ' + t('失败详情已记录，可把该文件发给开发者排查：') + data.logPath : ''));
            }
          } else {
            setRestartHint(true);
            loadPlugins();
          }
        } else if (!data.active && data.error && installingRef.current && data.error !== errorAtClickRef.current) {
          // 尚未开工就失败（如拉安装计划 / 预检出错）：同样要收尾，
          // 否则按钮会一直卡在禁用态、进度条永远停在"准备中"。
          // 比对"点击时的旧错误"是为了排除残留：只有全新错误才算本次失败。
          setInstalling(null);
          // 🔴 已读过的旧错误不再回填（2026-10-20 修）：
          //    宿主 progress.error 会保留到下一次安装开工，轮询每次都会把它带回来；
          //    面板重挂载后 installingRef 又有值，于是同一条报错反复出现在
          //    「分类胶囊与卡片网格之间」——这正是用户反复反馈的那条。
          if (!isInstallErrorRead(data.error)) {
            setError(t('安装失败：') + data.error + (data.logPath ? ' ' + t('失败详情已记录，可把该文件发给开发者排查：') + data.logPath : ''));
          }
        }
        wasActiveRef.current = !!data.active;
      }
    };
    lastBootRef.current = null;
    wasActiveRef.current = false;
    tick();
    pollRef.current = setInterval(tick, status?.active ? 1000 : 5000);
    return () => clearInterval(pollRef.current);
  }, [status?.active]);

  const installPlugin = async (plugin) => {
    setInstalling(plugin.fullName);
    setError('');
    // 记下点击时的旧错误：请求飞行期间若有轮询命中，不要把上一轮的残留错误当本次结果
    errorAtClickRef.current = (status && status.error) || null;
    // 安装已改为服务端异步执行（dsh plugin add 可能耗时数分钟），这里只负责触发；
    // 进度与失败原因经 pluginInstallStatus 轮询展示，不再同步等响应。
    const [err, data] = await api('pluginInstall', { owner: plugin.owner, name: plugin.name });
    if (err) {
      // 服务端已有任务（重复点击）：不是失败 —— 保持"安装中"，让轮询接手展示进度
      if (/已有安装任务/.test(err)) return;
      setInstalling(null);
      setError(t('安装失败：') + err);
      return;
    }
    if (data && data.ok === false) {
      setInstalling(null);
      setError(t('安装被拒绝：') + String(data.error || '未知原因'));
      return;
    }
    // 请求只是"已受理"：服务端还要拉安装计划 + 预检才真正开工（可能数秒）。
    // 这期间保持 installing（按钮禁用 + 进度条显示"正在准备安装"），
    // 清空一律交给轮询的收尾分支 —— 否则按钮提前恢复会让用户重复点击。
  };

  // 自定义安装：裸包名 / npm|pnpm 命令 / 完整 dsh 命令（宿主端 parseCustomTarget 校验）
  const customInstall = async () => {
    const raw = String(customTarget || '').trim();
    if (!raw) return;
    setInstalling(raw);
    setError('');
    errorAtClickRef.current = (status && status.error) || null;
    const [err, data] = await api('pluginCustomInstall', { target: raw });
    if (err) {
      if (/已有安装任务/.test(err)) return;
      setInstalling(null);
      setError(t('安装失败：') + err);
      return;
    }
    if (data && data.ok === false) {
      setInstalling(null);
      setError(t('无法识别的安装目标') + '：' + String(data.error || ''));
      return;
    }
    setCustomOpen(false);
    setCustomTarget('');
    // 受理后进度交给轮询；结束时 loadPlugins() 让卡片就位
  };

  const installSkill = async (skill) => {
    setInstalling(skill.slug);
    setError('');
    const [err] = await api('skillInstall', { slug: skill.slug });
    setInstalling(null);
    if (err) setError(t('安装失败：') + err);
    else {
      setRestartHint(true);
      await loadSkills(); // 重新拉 skillList，「已安装」徽章即时生效
    }
  };

  const restart = async () => {
    setError('');
    setRestartBusy(true);
    // 桌面端走 Electron 应用级重启；拿不到 Electron API 时后端返回 manual，
    // 这里如实告诉用户怎么手动重启，不做"假装重启"
    const [err, data] = await api('pluginRestart');
    setRestartBusy(false);
    if (err) setError(t('重启失败：') + err);
    else if (data && data.manual) setError(manualRestartHint(t, data.runtime));
  };

  // 技能分类已走服务端（categoryId 查询），不再客户端过滤；skills 即全部可见项

  return (
    <div className="btm-panel">
      {/* 第一行：类型切换 + 搜索 + 排序（搜索两种范围下都在，已安装时按关键词本地过滤） */}
      <div className="btm-toolbar">
        <div className="btm-tabs">
          <button className={tab === 'plugins' ? 'btm-tab active' : 'btm-tab'} onClick={() => setTab('plugins')}>
            插件
          </button>
          <button className={tab === 'skills' ? 'btm-tab active' : 'btm-tab'} onClick={() => setTab('skills')}>
            技能
          </button>
        </div>
        <input
          className="btm-search"
          placeholder={tab === 'plugins' ? t('搜索插件') : t('搜索技能')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (tab === 'plugins' ? loadPlugins() : loadSkills())}
        />
        {tab === 'plugins' && scope === 'all' && (
          <select className="btm-select" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="stars">{t('最多 Star')}</option>
            <option value="updated">{t('最近更新')}</option>
            <option value="installs">{t('安装最多')}</option>
          </select>
        )}
      </div>
      {/* 自定义安装：独立区块（带标题与说明），而不是挤在搜索/排序那一行的小按钮 */}
      {tab === 'plugins' && scope === 'all' ? (
        <div className="btm-custom">
          <div className="btm-custom-title">
            <span>{t('自定义安装')}</span>
            <button
              type="button"
              className="btm-btn ghost"
              style={{ marginLeft: 'auto' }}
              onClick={() => setCustomOpen(!customOpen)}
            >
              {customOpen ? t('收起') : t('展开')}
            </button>
          </div>
          <p className="btm-custom-desc">
            {t('手动安装市场目录之外的插件：npm 包名、GitHub 仓库或本地路径。装完的条目会出现在「已安装」列表。')}
          </p>
          {customOpen ? (
            <>
              <div className="btm-custom-row">
                <input
                  className="btm-search"
                  style={{ flex: '1 1 auto', minWidth: '160px' }}
                  placeholder={t('示例：@scope/pkg、npm install pkg、dsh plugin --profile web add pkg')}
                  value={customTarget}
                  onChange={(e) => setCustomTarget(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') customInstall(); }}
                />
                <button type="button" className="btm-btn primary" disabled={!!installing} onClick={customInstall}>
                  {installing ? t('安装中…') : t('安装')}
                </button>
              </div>
              <p className="btm-custom-hint">
                {t('示例：@scope/pkg、npm install pkg、dsh plugin --profile web add pkg')}
              </p>
            </>
          ) : null}
        </div>
      ) : null}

      {/* 第二行：范围切换独立成行 —— 切到已安装时不会因搜索框/排序消失而左移 */}
      <ScopeSeg
        scope={scope}
        onChange={setScope}
        count={tab === 'skills' ? installedSkillCount : installedPluginCount}
      />

      {/* 类目胶囊（插件页·全部视图） */}
      {tab === 'plugins' && scope === 'all' && categories.length > 0 && (
        <div className="btm-cats">
          <button className={activeCategory === '' ? 'btm-cat active' : 'btm-cat'} onClick={() => setActiveCategory('')}>
            {t('全部')}
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              className={activeCategory === c.key ? 'btm-cat active' : 'btm-cat'}
              onClick={() => setActiveCategory(c.key)}
            >
              {c.displayName}
            </button>
          ))}
        </div>
      )}

      {/* 类目胶囊（技能页·全部视图）：服务端分类（categoryId 查询），点击切换即重新加载第一页 */}
      {tab === 'skills' && scope === 'all' && skillCats.length > 0 && (
        <div className="btm-cats">
          <button className={skillCategory === '' ? 'btm-cat active' : 'btm-cat'} onClick={() => setSkillCategory('')}>
            {t('全部')}
          </button>
          {skillCats.map((c) => (
            <button
              key={c.id}
              className={skillCategory === c.id ? 'btm-cat active' : 'btm-cat'}
              onClick={() => setSkillCategory(c.id)}
            >
              {t(c.name)}
            </button>
          ))}
        </div>
      )}

      {/* 重启横幅（安装/卸载完成后提示） */}
      {restartHint && (
        <div className="btm-banner">
          <span>{t('操作完成，重启 DSH 后生效')}</span>
          {status && status.canAutoRestart === false ? (
            // 装完也**必须重启才生效**；宿主明确说不能自动重启时直接给手动步骤
            <span className="btm-banner-manual">{manualRestartHint(t, status.runtime)}</span>
          ) : (
            <button className="btm-btn primary" disabled={restartBusy} onClick={restart}>
              {restartBusy ? t('正在重启…') : t('立即重启')}
            </button>
          )}
          <button className="btm-btn" onClick={() => setRestartHint(false)}>
            {t('稍后')}
          </button>
        </div>
      )}

      {/* 安装进度 */}
      <InstallProgress status={status} pending={!!installing} />

      {/* 错误提示 */}
      {error && <div className="btm-error">{error}</div>}

      {/* 卡片网格：已安装走独立视图（读本机清单，不依赖市场搜索结果） */}
      {scope === 'installed' ? (
        <InstalledView
          kind={tab === 'skills' ? 'skills' : 'plugins'}
          keyword={keyword}
          installStatus={status}
          onChanged={(n) => (tab === 'skills' ? setInstalledSkillCount(n) : setInstalledPluginCount(n))}
          onNeedRestart={() => setRestartHint(true)}
        />
      ) : loading ? (
        <div className="btm-loading">{t('加载中…')}</div>
      ) : tab === 'plugins' ? (
        <>
        <div className="btm-grid">
          {plugins.map((p) => (
            <PluginCard
              key={p.fullName}
              plugin={p}
              categories={categories}
              installing={installing === p.fullName}
              onInstall={installPlugin}
            />
          ))}
          {!plugins.length && <div className="btm-empty">{t('暂无插件')}</div>}
        </div>
        {/* 加载更多：只有点了却没加载到新数据时才出现"边界"提示（首屏不足不显示） */}
        {pluginHasMore && !loading ? (
          <div className="btm-more">
            <button type="button" className="btm-btn ghost" disabled={loadingMore} onClick={() => loadPlugins(pluginPage + 1)}>
              {loadingMore ? t('正在加载…') : t('加载更多')}
            </button>
          </div>
        ) : null}
        {pluginEnd ? <div className="btm-end">{t('宇宙有没有边界人类尚未得知，我的边界被你探索到啦~')}</div> : null}
        </>
      ) : (
        <>
        <div className="btm-grid">
          {skills.map((s) => (
            <SkillCard
              key={s.slug}
              skill={s}
              onInstall={installSkill}
              onDetail={setSkillDetail}
              installedSlugsSet={installedSlugs}
            />
          ))}
          {!skills.length && <div className="btm-empty">{t('暂无技能')}</div>}
        </div>
        {skillHasMore && !loading ? (
          <div className="btm-more">
            <button type="button" className="btm-btn ghost" disabled={loadingMore} onClick={() => loadSkills(skillOffset + 24)}>
              {loadingMore ? t('正在加载…') : t('加载更多')}
            </button>
          </div>
        ) : null}
        {skillEnd ? <div className="btm-end">{t('宇宙有没有边界人类尚未得知，我的边界被你探索到啦~')}</div> : null}
        </>
      )}

      {skillDetail ? (
        <SkillDetailSheet
          slug={skillDetail.slug}
          fallbackName={skillDetail.name}
          onClose={() => setSkillDetail(null)}
        />
      ) : null}
    </div>
  );
}

/* ============================ 对话流工具卡片（tool.call.toolview） ============================ */

/** 从 tool 的 props 里递归捞出工具输出载荷（含 items 的对象优先） */
function pickPayload(props) {
  const found = [];
  const visit = (node, depth) => {
    if (!node || depth > 6) return;
    if (typeof node === 'string') {
      const t = node.trim();
      if ((t.startsWith('{') || t.startsWith('[')) && t.length > 8) {
        try {
          visit(JSON.parse(t), depth + 1);
        } catch {
          /* 非 JSON 文本忽略 */
        }
      }
      return;
    }
    if (typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((x) => visit(x, depth + 1));
      return;
    }
    if (Array.isArray(node.items)) found.push(node);
    for (const key of ['block', 'meta', 'result', 'resultView', 'view', 'data', 'value', 'payload', 'content', 'message']) {
      if (node[key] != null) visit(node[key], depth + 1);
    }
  };
  visit(props, 0);
  return found.find((x) => Array.isArray(x.items) && x.items.length) || found[0] || null;
}

function contentText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(contentText).join('\n');
  if (typeof node === 'object') {
    if (typeof node.text === 'string') return node.text;
    if (node.content) return contentText(node.content);
  }
  return '';
}

/** 从 tool 调用块里解析原始入参（argsRaw 是 JSON 字符串） */
function parseToolArgs(props) {
  const block = props && props.block;
  const raw = (block && 'kind' in block ? block.call && block.call.argsRaw : block && block.argsRaw) || '';
  if (!raw || typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** 安装进行中时轮询本机安装状态（1s 一次），结束后停表 */
function useInstallProgress(active) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!active) return undefined;
    let live = true;
    const tick = async () => {
      const [, data] = await api('pluginInstallStatus');
      if (live && data) setStatus(data);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active]);
  return status;
}

/** 对话流里的技能搜索结果：卡片含名称/分类/下载量/简介，可一键安装或看详情 */
function SkillSearchToolView(props) {
  const tr = useTr();
  const payload = pickPayload(props);
  const args = parseToolArgs(props);
  const items = (payload && Array.isArray(payload.items) && payload.items) || [];
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');
  useAutoClearError(err, setErr);

  const install = async (skill) => {
    setBusy(skill.slug);
    setErr('');
    const [e] = await api('skillInstall', { slug: skill.slug });
    setBusy('');
    if (e) {
      setErr(tr('安装失败：') + e);
      return;
    }
    setDone((prev) => new Set(prev).add(skill.slug));
  };

  if (!items.length) return null;
  return (
    <div className="btm-tv">
      {payload && payload.query ? (
        <div className="btm-tv-head">
          <span>
            {tr('搜索')} <b>{String(payload.query)}</b>
          </span>
          <span className="btm-tv-count">{tr('{n} 条', { n: items.length })}</span>
        </div>
      ) : null}
      {err ? <div className="btm-error">{err}</div> : null}
      <div className="btm-tv-grid">
        {items.map((s) => (
          <SkillCard
            key={s.slug}
            skill={s}
            installedSlugsSet={done}
            onInstall={install}
            onDetail={setDetail}
          />
        ))}
      </div>
      {busy ? <p className="btm-status">{tr('安装中…')}</p> : null}
      {detail ? (
        <SkillDetailSheet slug={detail.slug} fallbackName={detail.name} onClose={() => setDetail(null)} />
      ) : null}
    </div>
  );
}

/**
 * 对话流里的插件搜索结果：卡片可一键直装。
 * 安装是异步任务（started），进度由 pluginInstallStatus 轮询就地展示，
 * 装完提示并可一键重启。
 */
function PluginSearchToolView(props) {
  const tr = useTr();
  const payload = pickPayload(props);
  const items = (payload && Array.isArray(payload.items) && payload.items) || [];
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(() => new Set());
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  useAutoClearError(err, setErr);
  const [restartBusy, setRestartBusy] = useState(false);
  const busyRef = useRef('');
  const wasActiveRef = useRef(false);
  const probeWarnRef = useRef('');
  const errorAtClickRef = useRef(null);
  const progress = useInstallProgress(!!busy);

  busyRef.current = busy;

  // 轮询从 active 回落 = 安装任务结束
  useEffect(() => {
    const active = !!(progress && progress.active);
    if (wasActiveRef.current && !active && busyRef.current) {
      const target = busyRef.current;
      setDone((prev) => new Set(prev).add(target));
      setBusy('');
      if (progress && progress.error) setErr(tr('安装失败：') + progress.error);
      else {
        const warn = probeWarnRef.current;
        probeWarnRef.current = '';
        setNote(tr('安装完成，重启 dsh 后生效') + (warn ? tr('（预检已跳过）') : ''));
      }
    } else if (!active && busyRef.current && progress && progress.error && progress.error !== errorAtClickRef.current) {
      // 尚未开工就失败（拉安装计划 / 预检出错）：同样要收尾，否则按钮一直卡在禁用态。
      // 比对"点击时的旧错误"是为了排除残留：只有全新错误才算本次失败。
      setBusy('');
      // 🔴 已读过的旧错误不再回填（2026-10-20 修）：
      //    宿主 progress.error 会保留到下一次安装开工，面板重挂载时它还在，
      //    不拦就会「关掉再打开又冒出同一条报错」。
      if (!isInstallErrorRead(progress.error)) setErr(tr('安装失败：') + progress.error);
    }
    wasActiveRef.current = active;
  }, [progress, tr]);

  const install = async (plugin) => {
    setBusy(plugin.fullName);
    setErr('');
    setNote('');
    // 记下点击时的旧错误：请求飞行期间若有轮询命中，不要把上一轮的残留错误当本次结果
    errorAtClickRef.current = (progress && progress.error) || null;
    const [e, data] = await api('pluginInstall', { owner: plugin.owner, name: plugin.name });
    if (e || (data && data.ok === false)) {
      const msg = String(e || (data && data.error) || '');
      // 服务端已有任务（重复点击）：不是失败 —— 保持"安装中"，让轮询接手展示进度
      if (!/已有安装任务/.test(msg)) {
        setBusy('');
        setErr(tr('安装失败：') + msg);
      }
    } else if (data && data.warning) {
      // 预检（拉 GitHub raw）网络不可达时不再阻塞安装 —— 只记下告警，
      // 等安装结束再一并提示（note 一设置就会显示"立即重启"，不能提前）
      probeWarnRef.current = data.warning;
    }
  };

  const restart = async () => {
    setErr('');
    setRestartBusy(true);
    const [e, data] = await api('pluginRestart');
    setRestartBusy(false);
    if (e) setErr(tr('重启失败：') + e);
    else if (data && data.manual) setErr(manualRestartHint(tr, data.runtime));
  };

  if (!items.length) return null;
  const pct = progress && progress.active && progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : null;

  return (
    <div className="btm-tv">
      {payload && payload.query ? (
        <div className="btm-tv-head">
          <span>
            {tr('搜索')} <b>{String(payload.query)}</b>
          </span>
          <span className="btm-tv-count">{tr('{n} 条', { n: items.length })}</span>
        </div>
      ) : null}
      {err ? <div className="btm-error">{err}</div> : null}
      <div className="btm-tv-grid">
        {items.map((p) => {
          const isDone = done.has(p.fullName);
          const isBusy = busy === p.fullName;
          return (
            <div className={'btm-card' + (isDone || p.installed ? ' is-installed' : '')} key={p.fullName}>
              <div className="btm-card-head">
                <div className="btm-card-logo">
                  <Logo url={p.avatarUrl} name={p.displayName || p.name} fallback="P" glyph />
                </div>
                <div className="btm-card-title">
                  <div className="btm-card-name">{p.displayName || p.name}</div>
                  <div className="btm-card-fullname">{p.fullName}</div>
                </div>
              </div>
              <div className="btm-card-desc">{p.description || tr('暂无简介')}</div>
              {isBusy ? (
                <div className="btm-tv-progress">
                  <div className="btm-progress-bar">
                    <div className="btm-progress-fill" style={{ width: pct != null ? `${pct}%` : '30%' }} />
                  </div>
                  <span className="btm-progress-sub">
                    {(progress && (progress.phase || progress.lastLine)) || (progress && progress.active ? tr('拉取依赖中') : tr('正在准备安装…'))}
                  </span>
                </div>
              ) : null}
              <div className="btm-card-foot">
                <span className="btm-card-cat">{tr('插件')}</span>
                <span className="btm-card-stats">
                  <span>★ {fmtCount(p.stars)}</span>
                  {p.installs ? <span>⬇ {fmtCount(p.installs)}</span> : null}
                </span>
              </div>
              <div className="btm-card-actions">
                {pluginDetailHref(p) ? (
                  <a className="btm-card-details" href={pluginDetailHref(p)} target="_blank" rel="noreferrer" title={tr('在 GitHub 打开')}>
                    {tr('详情')} ↗
                  </a>
                ) : (
                  <span className="btm-card-details" />
                )}
                {isDone || p.installed ? (
                  <button type="button" className="btm-btn done" disabled>
                    {tr('已安装')}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btm-btn primary"
                    disabled={isBusy || !!busy || p.installability !== 'verified'}
                    onClick={() => install(p)}
                  >
                    {isBusy ? tr('安装中…') : p.installability === 'verified' ? tr('安装') : tr('仅展示')}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {note ? (
        <div className="btm-tv-done">
          <span>{note}</span>
          {progress && progress.canAutoRestart === false ? (
            <span className="btm-tv-manual">{manualRestartHint(tr, progress.runtime)}</span>
          ) : (
            <button type="button" className="btm-btn primary" disabled={restartBusy} onClick={restart}>
              {restartBusy ? tr('正在重启…') : tr('立即重启')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** 对话流里「已装技能」：与广场一致的 Meta 卡片（文件数 / 体积 / 更新时间） */
function InstalledSkillsToolView(props) {
  const tr = useTr();
  const payload = pickPayload(props);
  const items = (payload && Array.isArray(payload.items) && payload.items) || [];
  const [detail, setDetail] = useState(null);
  if (!items.length) return null;
  return (
    <div className="btm-tv">
      <div className="btm-tv-head">
        <span>{tr('已装技能')}</span>
        <span className="btm-tv-count">{tr('{n} 个', { n: items.length })}</span>
      </div>
      <div className="btm-tv-grid">
        {items.map((it) => (
          <div className="btm-card" key={it.slug}>
            <div className="btm-card-head">
              <div className="btm-card-logo">
                <span className="btm-logo-fallback">{String(it.name || it.slug || '?').slice(0, 1)}</span>
              </div>
              <div className="btm-card-title">
                <span className="btm-card-name">{it.name || it.slug}</span>
                <span className="btm-card-fullname">{it.slug}</span>
              </div>
              <span className="btm-badge">{tr('已安装')}</span>
            </div>
            <div className="btm-card-meta">
              {it.version ? <span className="btm-card-profile">{fmtVer(it.version)}</span> : null}
              {it.files != null ? <span>{tr('{n} 个文件', { n: it.files })}</span> : null}
              {it.bytes != null ? <span>{formatBytes(it.bytes)}</span> : null}
              {it.updateTime ? <span>{formatTime(it.updateTime)}</span> : null}
            </div>
            <div className="btm-card-foot">
              <span className="btm-card-cat">{tr('技能')}</span>
            </div>
            <div className="btm-card-actions">
              <button type="button" className="btm-card-details" onClick={() => setDetail(it)}>
                {tr('技能详情')}
              </button>
            </div>
          </div>
        ))}
      </div>
      {detail ? (
        <SkillDetailSheet
          slug={detail.slug}
          fallbackName={detail.name}
          localVersion={detail.version}
          onClose={() => setDetail(null)}
        />
      ) : null}
    </div>
  );
}

/** 安装/卸载结果类工具的轻量展示（无卡片网格可画时） */
function SimpleToolView(props) {
  const tr = useTr();
  const payload = pickPayload(props) || {};
  const slug = payload.slug || payload.fullName || '';
  const removed = payload.removed === true;
  const installed = payload.installed === true || (!removed && !!payload.version);
  if (!slug) return null;
  return (
    <div className="btm-tv btm-tv-simple">
      <span className="btm-badge installed">{removed ? tr('已卸载') : installed ? tr('已安装') : tr('完成')}</span>
      <b>{payload.name || slug}</b>
      {payload.version ? <span className="btm-chip">{fmtVer(payload.version)}</span> : null}
    </div>
  );
}

/* ============================ 设置页：已安装技能 + 一键更新 ============================ */

/**
 * 自动消失的浮动提示（设置页用）。
 *
 * 为什么不用原来的 <p className="btm-status">：它挂在卡片流末尾，位置跟着内容跑、
 * 弹在分区底部，用户填完表单得往下找；而且不消失，像常驻错误。
 * 这里固定浮在卡片右下，3 秒自动收起 —— 反馈与"是否还在"解耦。
 *
 * 🔴 定时器必须挂在 **seq** 上，不能挂在 text 上（2026-10-20 修）：
 *   外层写的是 <AutoToast key={noteSeq} text={note} onDone={...} />。
 *   若 effect 依赖 [text, onDone]：
 *     - onDone 是内联箭头函数，每次父组件渲染都是新引用 → effect 反复重建；
 *     - 更糟的是"连续两次相同文案"（例如连点两次刷新都失败）时 text 不变，
 *       但 key 变了会重新挂载，而 effect 依赖没变 —— 计时起点不确定，
 *       表现为"有时 3 秒消失，有时一直挂着"。
 *    改为以 seq 作为唯一计时依据，每次 flash 都得到一段完整、确定的 3 秒。
 */
function AutoToast({ text, seq, onDone, kind }) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone; // 回调走 ref，避免引用变化重启动计时
  useEffect(() => {
    if (!text) return undefined;
    const id = setTimeout(() => doneRef.current && doneRef.current(), 3000);
    return () => clearTimeout(id);
  }, [text, seq]); // 只在"新的一条提示"时重新计时
  if (!text) return null;
  return (
    <div className={'btm-toastbox' + (kind === 'error' ? ' is-error' : '')} role="status">
      {text}
    </div>
  );
}

/* ============================ 系统日志常量（对齐 dsh-plugin 的 LogsModal） ============================ */

/** 类别筛选/徽章文案（值 → i18n key），与宿主 oplog 的 LogCategory 一一对应 */
const CAT_TEXT = {
  install: '安装',
  uninstall: '卸载',
  update: '更新',
  diagnostics: '诊断',
  settings: '设置',
  system: '系统',
};
const CAT_FILTERS = [
  ['all', '全部类别'],
  ['install', '安装'],
  ['uninstall', '卸载'],
  ['update', '更新'],
  ['diagnostics', '诊断'],
  ['settings', '设置'],
  ['system', '系统'],
];

/** 级别文案与筛选顺序：错误优先暴露（排查时最常先看它） */
const LEVEL_TEXT = { debug: '调试', info: '信息', success: '成功', warn: '警告', error: '错误' };
const LEVEL_FILTERS = [
  ['all', '全部级别'],
  ['error', '错误'],
  ['warn', '警告'],
  ['success', '成功'],
  ['info', '信息'],
  ['debug', '调试'],
];

/** 精确到秒的时间（每条都带秒，排查时序问题必需；与 dsh-plugin fmtLogTime 同格式） */
function formatLogTime(at) {
  const d = new Date(Number(at) || 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* 设置导航图标（16px 线性，与 dsh-plugin 的设置分区视觉对齐） */
const iconSvg = (paths) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {paths.map((d, i) => <path key={i} d={d} />)}
  </svg>
);
const SetGearIcon = () => iconSvg(['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z']);
const SetUpIcon = () => iconSvg(['M21 12a9 9 0 1 1-2.64-6.36', 'M21 3v6h-6']);
const SetDiagIcon = () => iconSvg(['M3 12h4l2-7 4 14 2-7h6']);
const SetLogIcon = () => iconSvg(['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01']);
const SetRstIcon = () => iconSvg(['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5']);

/**
 * 注册到 DSH 设置页（settings.plugin.item）。
 * 展示配置摘要与已安装技能清单，支持单个/全部更新到远端当前版本。
 * ⚠️ 远端没有版本历史接口，「更新」= 用远端当前版本覆盖安装。
 */
function SettingsCard(props) {
  const tr = useTr();
  // 左侧导航分区：更新（插件+技能更新中心）/ 配置 / 诊断 / 操作日志 / 重置
  const [section, setSection] = useState('updates');
  const [state, setState] = useState({ status: 'loading', items: [], updatable: 0, error: '' });
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState(null); // 可编辑配置：apiBase / skillsDir / timeoutMs / maxResults
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [diag, setDiag] = useState(null);
  const [logs, setLogs] = useState(null);
  // 插件更新中心：已安装插件 + 线上 latest（updates 分区专用）
  const [pluginsUpd, setPluginsUpd] = useState(null); // null = 未加载
  const [pluginBusy, setPluginBusy] = useState('');
  // 连通性探测（流式 NDJSON 渲染）：key -> {status, ms, status code, display}
  const [probes, setProbes] = useState({});
  const [probing, setProbing] = useState(false);
  // 日志筛选与查看器
  const [logCat, setLogCat] = useState('all');
  const [logLevel, setLogLevel] = useState('all');
  const [logQuery, setLogQuery] = useState('');
  const [logOffset, setLogOffset] = useState(0);
  const [logViewer, setLogViewer] = useState(null); // 安装日志全文弹窗 { id, text }
  const [logsModal, setLogsModal] = useState(false); // 系统日志查看器（弹窗）
  const [logMore, setLogMore] = useState(false);
  // 「配置」菜单默认隐藏：在标题上 1.5 秒内连点 3 次显示；配置页内的开关可再次隐藏
  const [showConfig, setShowConfig] = useState(false);
  const tapRef = useRef({ count: 0, at: 0 });
  // 提示条：note 为文本，noteSeq 变化时强制重挂（连续两次相同文案也能重新计时）
  const [noteSeq, setNoteSeq] = useState(0);
  const [noteKind, setNoteKind] = useState('info');
  const flash = useCallback((text, kind) => {
    setNote(text);
    setNoteKind(kind || 'info');
    setNoteSeq((n) => n + 1);
  }, []);

  const load = useCallback(async () => {
    const [err, data] = await api('skillUpdates');
    if (err || !data || data.ok === false) {
      setState({ status: 'error', items: [], updatable: 0, error: err || (data && data.error) || '' });
      return;
    }
    setState({ status: 'ready', items: data.items || [], updatable: Number(data.updatable) || 0, error: '' });
  }, []);

  useEffect(() => {
    load();
    api('config').then(([err, data]) => {
      if (!err && data) {
        setCfg(data);
        setForm({
          apiBase: String(data.apiBase || ''),
          skillsDir: String(data.skillsDir || ''),
          timeoutMs: Number(data.timeoutMs) || 20000,
          maxResults: Number(data.maxResults) || 12,
          npmRegistry: String(data.npmRegistry || ''),
          checkUpdatesOnStart: data.checkUpdatesOnStart !== false,
        });
      }
    });
    /**
     * 🔴 卸载时清掉未消费的提示（2026-10-20 修）。
     * 用户报障：报错 3 秒后消失 → 右上角关闭面板 → 再点侧边栏，同一条报错又出现。
     * 根因：note 是组件 state，面板关闭时组件被卸载，但 state 里的旧值随实例一起
     * 销毁前已经渲染过；重新打开时若恰好复用了实例（或上游做了缓存），旧文案会被
     * 重新投影出来。这里在卸载时主动清空，保证"关掉即结束"，不留跨次残留。
     * 同理清掉 state.error 的瞬时快照之外的提示类状态。
     */
    return () => {
      setNote('');
      setNoteSeq((n) => n + 1);
    };
  }, [load]);

  /** 插件更新列表：已安装清单 × 线上 latest */
  const loadPluginsUpd = useCallback(async () => {
    const [, installed] = await api('installedPlugins');
    const [, latest] = await api('pluginLatestVersions');
    if (!installed) return;
    const latestMap = new Map(((latest && latest.items) || []).map((x) => [x.pkg, x]));
    setPluginsUpd(
      (installed.items || []).map((it) => {
        const l = latestMap.get(it.pkg);
        return {
          pkg: it.pkg,
          profile: (it.profiles && it.profiles[0]) || it.profile || '',
          name: it.name || it.pkg,
          current: it.version || '',
          latest: (l && l.latest) || '',
          hasUpdate: !!(l && l.hasUpdate),
          // 平台渠道（GitHub 源）更新目标；registry 源没有这两个字段
          hubRepo: (l && l.hubRepo) || '',
          hubSha: (l && l.hubSha) || '',
          via: (l && l.via) || 'none',
        };
      }),
    );
  }, []);

  // 诊断 / 日志 / 插件更新按需拉（进对应分区才请求）
  useEffect(() => {
    if (section === 'diagnostics' && !diag) api('pluginDiagnostics').then(([, d]) => setDiag(d));
    if (section === 'logs') loadLogs();
    if (section === 'updates' && pluginsUpd === null) loadPluginsUpd();
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 更新单个插件：触发后轮询 pluginInstallStatus 直到结束，再刷新列表 */
  const updatePluginOne = async (item) => {
    if (pluginBusy) return;
    setPluginBusy(item.pkg);
    setNote('');
    // GitHub 源走平台 pinned sha，registry 源走版本号（后端据 spec 自行判定）
    const payload = item.hubRepo
      ? { pkg: item.pkg, profile: item.profile, targetRepo: item.hubRepo, targetSha: item.hubSha || '', targetVersion: item.latest || '' }
      : { pkg: item.pkg, profile: item.profile, targetVersion: item.latest }; 
    const [err] = await api('pluginUpdate', payload);
    if (err) {
      setPluginBusy('');
      flash(tr('更新失败：') + err, 'error');
      return;
    }
    // 轮询安装状态收尾（服务端异步执行 pnpm）
    for (let i = 0; i < 600; i += 1) {
      await new Promise((r) => setTimeout(r, 1500));
      const [, st] = await api('pluginInstallStatus');
      if (!st || !st.active) {
        if (st && st.error) flash(tr('更新失败：') + st.error, 'error');
        else flash(tr('更新完成，重启 DSH 后生效') + '：' + item.pkg);
        break;
      }
    }
    setPluginBusy('');
    loadPluginsUpd();
  };

  /** 连通性探测：流式读 NDJSON，逐行更新状态；only 缺省 = 全量 */
  const runProbes = useCallback(async (only) => {
    if (probing) return;
    setProbing(true);
    setProbes((prev) => {
      const next = { ...prev };
      for (const k of ['npm', 'github', 'catalog']) {
        if (!only || only === k) next[k] = { ...next[k], status: 'running', ms: null, code: null };
      }
      return next;
    });
    try {
      const res = await fetch('/baitong-market/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(only ? { key: only } : {}),
      });
      const reader = res.body && res.body.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf('\n');
        while (nl !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) {
            try {
              const ev = JSON.parse(line);
              setProbes((prev) => ({
                ...prev,
                [ev.key]: { status: ev.type, ms: ev.ms ?? null, code: ev.status ?? null, display: ev.display || '' },
              }));
            } catch { /* 半截行 */ }
          }
          nl = buf.indexOf('\n');
        }
      }
    } catch {
      /* 探测请求失败：行状态停在 running，用户可重试 */
    } finally {
      setProbing(false);
    }
  }, [probing]);

  /**
   * 结构化日志：带筛选分页。
   * @param offset 0 = 重查第一页（替换）；>0 = 加载更多（追加）——对齐 dsh-plugin 的 offsetRef 累积
   */
  const loadLogs = useCallback(async (offset = 0, append = false) => {
    const [, d] = await api('pluginLogs', {
      offset,
      limit: 50,
      category: logCat,
      level: logLevel,
      query: logQuery || undefined,
    });
    if (d) {
      if (append) {
        setLogs((prev) => ({
          ...d,
          entries: [...((prev && prev.entries) || []), ...(d.entries || [])],
        }));
      } else {
        setLogs(d);
      }
      setLogOffset(offset);
    }
  }, [logCat, logLevel, logQuery]);

  /** 清空日志（对齐 dsh-plugin clear-log） */
  const clearLogs = async () => {
    if (!window.confirm(tr('确认清空所有日志？此操作不可撤销'))) return;
    const [err] = await api('pluginLogClear');
    if (err) {
      flash(tr('清空失败：') + err, 'error');
      return;
    }
    flash(tr('已清空'));
    loadLogs(0);
  };

  // 进诊断页自动跑一轮探测
  useEffect(() => {
    if (section === 'diagnostics' && !Object.keys(probes).length) runProbes();
  }, [section]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 复制当前筛选的日志到剪贴板 */
  const copyLogs = async () => {
    if (!logs || !logs.entries) return;
    const text = logs.entries
      .map((e) => `[${formatTime(e.at)}] [${e.level}] [${e.category}] [${e.event}] ${e.message}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      flash(tr('已复制'));
    } catch {
      /* 剪贴板不可用：静默 */
    }
  };

  /** 在系统文件管理器中定位日志文件 */
  const revealLogFile = async () => {
    const [, d] = await api('pluginLogReveal');
    if (d && d.ok === false) flash(d.error || '', 'error');
  };

  /** 安装日志查看器：取单条 processLog 全文 */
  const openLogViewer = async (id) => {
    const [, d] = await api('pluginLogRead', { id });
    if (d && d.ok !== false) setLogViewer({ id, text: String(d.text || '') });
  };

  /** 导出当前筛选的日志为 .log 文件 */
  const exportLogs = () => {
    if (!logs || !logs.entries) return;
    const text = logs.entries
      .map((e) => `[${formatTime(e.at)}] [${e.level}] [${e.category}] [${e.event}] ${e.message}`)
      .join('\n');
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'baitong-market.log';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const updateOne = async (slug) => {
    setBusy(slug);
    setNote('');
    const [err, data] = await api('skillUpdate', { slug });
    setBusy('');
    if (err || !data || data.ok === false) {
      flash(tr('更新失败：') + (err || (data && data.error) || ''), 'error');
      return;
    }
    flash(
      data.updated
        ? `${slug}: ${data.previousVersion || '—'} → ${data.version}`
        : tr('已是最新版本：') + slug,
    );
    await load();
  };

  const updateAll = async () => {
    const targets = state.items.filter((it) => it.updatable);
    if (!targets.length) return;
    for (const it of targets) {
      // 串行执行，避免并发写同一个 skillsDir
      // eslint-disable-next-line no-await-in-loop
      await updateOne(it.slug);
    }
  };

  const resetCfg = async () => {
    if (!window.confirm(
      tr('仅重置本插件（百通插件广场）的设置：更新策略、镜像源等恢复默认值，不影响 DSH 其他插件')
      + ' '
      + tr('操作日志会被清空，无法恢复。')
      + ' '
      + tr('确认继续？'),
    )) return;
    setSaving(true);
    const [err, data] = await api('pluginResetConfig');
    setSaving(false);
    if (err || !data || data.ok === false) {
      flash(tr('重置失败：') + (err || (data && data.error) || ''), 'error');
      return;
    }
    setCfg(data);
    setForm({
      apiBase: String(data.apiBase || ''),
      skillsDir: String(data.skillsDir || ''),
      timeoutMs: Number(data.timeoutMs) || 20000,
      maxResults: Number(data.maxResults) || 12,
      npmRegistry: String(data.npmRegistry || ''),
      checkUpdatesOnStart: data.checkUpdatesOnStart !== false,
    });
    /**
     * 🔴 重置成功后清掉前端残留（2026-10-20）：
     *    - note / noteSeq：避免上一条提示跨重置残留；
     *    - 诊断与日志缓存：日志文件已被后端删除，界面上的旧列表必须作废，
     *      否则用户点进「操作日志」看到的还是重置前的条目（与磁盘不符）。
     */
    setNote('');
    setDiag(null);
    setLogs(null);
    setLogOffset(0);
    flash(tr('已重置'));
    setShowConfig(false);
    setSection('updates');
  };

  /**
   * 标题连点触发：1.5 秒内累计 3 次即显示「配置」分区。
   * 为什么用标题而不是别的元素：标题在任何分区都可见、可点，且用户不容易误触；
   * 计数窗口过期即归零，避免「隔很久凑够三次」也算触发。
   */
  const onTitleTap = () => {
    const now = Date.now();
    const t = tapRef.current;
    t.count = now - t.at > 1500 ? 1 : t.count + 1;
    t.at = now;
    if (t.count >= 3) {
      t.count = 0;
      setShowConfig(true);
      setSection('config');
      flash(tr('配置菜单已显示（再次连点标题三次可重新显示）'));
    }
  };

  const copyDiag = async () => {
    if (!diag) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(diag, null, 2));
      flash(tr('诊断信息已复制'));
    } catch {
      /* 剪贴板不可用：静默 */
    }
  };

  const saveCfg = async () => {
    if (!form) return;
    setSaving(true);
    setNote('');
    const [err, data] = await api('config', { save: true, ...form });
    setSaving(false);
    if (err || !data || data.ok === false) {
      flash(tr('保存失败：') + (err || (data && data.error) || ''), 'error');
      return;
    }
    setCfg(data);
    flash(tr('已保存'));
  };

  const SECTIONS = [
    { key: 'updates', label: tr('更新'), desc: tr('已安装插件与技能的版本检查、一键更新，以及更新策略'), icon: <SetUpIcon /> },
    { key: 'config', label: tr('配置'), desc: tr('数据源与运行参数'), icon: <SetGearIcon /> },
    { key: 'diagnostics', label: tr('诊断'), desc: tr('环境快照：版本、运行时与 CLI 入口，排查安装问题用'), icon: <SetDiagIcon /> },
    { key: 'logs', label: tr('操作日志'), desc: tr('最近 20 次安装 / 更新 / 卸载记录'), icon: <SetLogIcon /> },
    { key: 'reset', label: tr('重置'), desc: tr('仅重置本插件（百通插件广场）的设置：更新策略、镜像源等恢复默认值，不影响 DSH 其他插件'), icon: <SetRstIcon /> },
    // 注意：重置分区的内容区另有补充说明（含"日志会被清空"），
    // 与这里的导航摘要不重复 —— 摘要讲范围，补充说明讲副作用。
  ];
  // 未显示时把「配置」从导航里摘掉；activeSection 用未过滤列表兜底，避免 section 停在隐藏项时崩溃
  const visibleSections = SECTIONS.filter((s) => s.key !== 'config' || showConfig);
  const activeSection = visibleSections.find((s) => s.key === section) ?? visibleSections[0];

  return (
    <div className="btm-settings">
      <div className="btm-set-head">
        {/* 标题即隐藏开关：连点 3 次显示「配置」菜单（见 onTitleTap） */}
        <h4 className="btm-set-title" onClick={onTitleTap} title={tr('显示配置菜单')}>
          {tr('百通技能与插件')}
        </h4>
        <span className="btm-set-desc">
          {tr('已安装技能 {n} 个，其中 {m} 个可更新', {
            n: state.items.length,
            m: state.updatable,
          })}
        </span>
      </div>

      {/* 左侧图标导航 + 右侧内容（对齐 dsh-plugin 的设置布局） */}
      <div className="btm-set-body">
        <nav className="btm-set-side" role="tablist" aria-label={tr('设置')}>
          {visibleSections.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={section === s.key}
              className={'btm-set-side-btn' + (section === s.key ? ' on' : '')}
              onClick={() => setSection(s.key)}
            >
              <span className="btm-set-side-ic">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
        <div className="btm-set-content">
          <div className="btm-set-pagetitle">{activeSection.label}</div>
          <div className="btm-set-pagedesc">{activeSection.desc}</div>

      {section === 'updates' ? (
        <>
      {/* 更新策略：镜像源 + 启动检查（写 overlay，保存即生效） */}
      {form ? (
        <div className="btm-set-form">
          <label>
            <span>{tr('安装源')}</span>
            <select
              className="btm-input"
              value={form.npmRegistry}
              onChange={(e) => setForm({ ...form, npmRegistry: e.target.value })}
            >
              <option value="">{tr('自动（跟随本机 npm，缺版本时回退官方源）')}</option>
              <option value="https://registry.npmjs.org">{tr('npm 官方源')}</option>
              <option value="https://registry.npmmirror.com">{tr('npmmirror（淘宝）')}</option>
              <option value="https://mirrors.cloud.tencent.com/npm/">{tr('腾讯云镜像')}</option>
              <option value="https://mirrors.tuna.tsinghua.edu.cn/npm/">{tr('清华 TUNA 镜像')}</option>
            </select>
          </label>
          <p className="btm-status">{tr('检查更新固定官方源优先（镜像同步滞后时会漏掉刚发布的新版）；安装走这里的源，目标版本在该源缺失时自动换到官方源，不再报 ERR_PNPM_NO_MATCHING_VERSION。')}</p>
          <label className="btm-set-toggle">
            <span>{tr('启动时检查更新')}</span>
            <input
              type="checkbox"
              checked={form.checkUpdatesOnStart}
              onChange={(e) => setForm({ ...form, checkUpdatesOnStart: e.target.checked })}
            />
          </label>
          <button type="button" className="btm-btn primary" disabled={saving} onClick={saveCfg}>
            {saving ? tr('保存中…') : tr('保存')}
          </button>
        </div>
      ) : null}

      {/* 插件更新：current → latest + 更新按钮 */}
      <div className="btm-probe">
        <div className="btm-probe-head">
          <span>{tr('插件更新')}</span>
          <button type="button" className="btm-btn ghost" disabled={!!pluginBusy} onClick={loadPluginsUpd}>
            {tr('刷新')}
          </button>
        </div>
        {pluginsUpd === null ? (
          <p className="btm-status">{tr('加载中…')}</p>
        ) : pluginsUpd.some((it) => it.hasUpdate) ? (
          <ul className="btm-set-list">
            {pluginsUpd.filter((it) => it.hasUpdate).map((it) => (
              <li key={it.pkg}>
                <div className="btm-set-name">
                  <b>{it.name}</b>
                  <span>{it.pkg}</span>
                </div>
                <div className="btm-set-ver">
                  <span className="btm-ver-old">{it.current || '—'}</span>
                  <span className="btm-ver-arrow">→</span>
                  <span className="btm-ver-new">{it.latest}</span>
                  {it.hubRepo ? <span className="btm-ver-src" title={tr('来自插件平台')}>{it.hubRepo}</span> : null}
                </div>
                <button
                  type="button"
                  className="btm-btn primary"
                  disabled={!!pluginBusy}
                  onClick={() => updatePluginOne(it)}
                >
                  {pluginBusy === it.pkg ? tr('更新中…') : tr('更新')}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="btm-status">{tr('暂无可更新的插件')}</p>
        )}
      </div>

      {/* 技能更新 */}
      <div className="btm-probe">
        <div className="btm-probe-head">
          <span>{tr('技能更新')}</span>
          <div className="btm-set-actions" style={{ margin: 0 }}>
            <button
              type="button"
              className="btm-btn primary"
              disabled={!state.updatable || !!busy}
              onClick={updateAll}
            >
              {tr('全部更新')}
            </button>
            <button type="button" className="btm-btn ghost" disabled={!!busy} onClick={load}>
              {tr('刷新')}
            </button>
          </div>
        </div>

      {/* 🔴 note 只由底部 AutoToast 渲染（2026-10-20 修）：
          这里原先还有一份 <p className="btm-status">{note}</p>，于是同一句话同时出现在
          卡片流和浮层里；浮层 3 秒收起后，常驻那份还在，看起来像"报错不消失"。
          提示的唯一出口是 AutoToast，删除此处的重复渲染。 */}
      {state.status === 'loading' ? <p className="btm-status">{tr('加载中…')}</p> : null}
      {state.status === 'error' ? (
        <p className="btm-status">
          {tr('加载失败：')}
          {state.error}
        </p>
      ) : null}
      {state.status === 'ready' && !state.items.length ? (
        <p className="btm-status">{tr('还没有已安装的技能')}</p>
      ) : null}

        {state.items.length ? (
          <ul className="btm-set-list">
            {state.items.map((it) => (
              <li key={it.slug}>
                <div className="btm-set-name">
                  <b>{it.name}</b>
                  <span>{it.slug}</span>
                </div>
                <div className="btm-set-ver">
                  {it.updatable ? (
                    <>
                      <span className="btm-ver-old">{it.localVersion || '—'}</span>
                      <span className="btm-ver-arrow">→</span>
                      <span className="btm-ver-new">{it.remoteVersion}</span>
                    </>
                  ) : (
                    <span className="btm-ver-cur">{it.localVersion || it.remoteVersion || '—'}</span>
                  )}
                </div>
                <button
                  type="button"
                  className={it.updatable ? 'btm-btn primary' : 'btm-btn ghost'}
                  disabled={!it.updatable || !!busy}
                  onClick={() => updateOne(it.slug)}
                >
                  {busy === it.slug ? tr('更新中…') : it.updatable ? tr('更新') : tr('已是最新')}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>{/* /.btm-probe 技能更新 */}
        </>
      ) : null}

      {/* 配置：数据源与运行参数（原「常规」的有效字段归位于此） */}
      {section === 'config' ? (
        <div className="btm-set-page">
          {/* 隐藏开关：关掉后配置从导航消失，需再次连点标题三次重新显示 */}
          <div className="btm-custom">
            <div className="btm-custom-title">
              <span>{tr('配置菜单')}</span>
            </div>
            <label className="btm-set-toggle">
              <span>{tr('显示配置菜单')}</span>
              <input
                type="checkbox"
                checked={showConfig}
                onChange={(e) => {
                  setShowConfig(e.target.checked);
                  if (!e.target.checked) setSection('updates');
                }}
              />
            </label>
          </div>
          {form ? (
            <div className="btm-set-form">
              <label>
                <span>{tr('接口地址')}</span>
                <input
                  className="btm-input"
                  value={form.apiBase}
                  onChange={(e) => setForm({ ...form, apiBase: e.target.value })}
                  spellCheck={false}
                />
              </label>
              <label>
                <span>{tr('技能目录')}</span>
                <input
                  className="btm-input"
                  value={form.skillsDir}
                  onChange={(e) => setForm({ ...form, skillsDir: e.target.value })}
                  spellCheck={false}
                />
              </label>
              <label>
                <span>{tr('请求超时（毫秒）')}</span>
                <input
                  className="btm-input"
                  type="number"
                  min="1000"
                  max="120000"
                  value={form.timeoutMs}
                  onChange={(e) => setForm({ ...form, timeoutMs: Number(e.target.value) || 0 })}
                />
              </label>
              <label>
                <span>{tr('搜索结果上限')}</span>
                <input
                  className="btm-input"
                  type="number"
                  min="1"
                  max="80"
                  value={form.maxResults}
                  onChange={(e) => setForm({ ...form, maxResults: Number(e.target.value) || 0 })}
                />
              </label>
              <button type="button" className="btm-btn primary" disabled={saving} onClick={saveCfg}>
                {saving ? tr('保存中…') : tr('保存')}
              </button>
            </div>
          ) : (
            <p className="btm-status">{tr('加载中…')}</p>
          )}
        </div>
      ) : null}

      {/* 诊断：环境快照（排查"别人电脑装不上"） */}
      {section === 'diagnostics' ? (
        <div className="btm-set-page">
          {/* 🔴 这里不再重复渲染 desc（2026-10-20 修）：
              分区说明已由内容区页眉 .btm-set-pagedesc 统一渲染
              （见 activeSection.desc），此处再写一遍会在诊断页出现两行相同文案。 */}
          {diag ? (
            <>
              <ul className="btm-kv btm-set-kv">
                <li><span>{tr('插件版本')}</span><b>{diag.version || '—'}</b></li>
                <li><span>{tr('运行环境')}</span><b>{diag.runtime}{diag.canAutoRestart ? '' : '（手动重启）'}</b></li>
                <li><span>Node</span><b>{diag.node}</b></li>
                <li><span>{tr('平台')}</span><b>{diag.platform}</b></li>
                <li>
                  <span>{tr('CLI 入口')}</span>
                  <b title={diag.cliEntry || undefined}>
                    {diag.cliEntry || tr('（仅 PATH，未找到内置入口）')}
                  </b>
                </li>
                <li><span>profile</span><b>{diag.profile}</b></li>
                {/* 接口地址不在此展示（2026-10-20 按用户要求）：它属于可改配置，
                    在「配置」分区已经能看到；诊断页只留环境事实。
                    注意 diag.apiBase 仍然由后端返回，「复制诊断信息」里也仍然带着它——
                    排查时更需要完整快照，只是不再占用诊断页的一行。 */}
                {diag.npmRegistry ? <li><span>{tr('npm 镜像源')}</span><b>{diag.npmRegistry}</b></li> : null}
                {diag.effectiveRegistry ? <li><span>{tr('实际生效的安装源')}</span><b>{diag.effectiveRegistry}</b></li> : null}
                {diag.proxy && Object.keys(diag.proxy).length ? (
                  <li><span>{tr('代理环境')}</span><b>{JSON.stringify(diag.proxy)}</b></li>
                ) : null}
                <li>
                  <span>{tr('工具链版本')}</span>
                  <b>
                    dsh {diag.dshVersion || '?'} · pnpm {diag.pnpmVersion || '?'} · npm {diag.npmVersion || '?'} · git {diag.gitVersion || '?'}
                  </b>
                </li>
              </ul>

              {/* 连通性探测：流式逐行，行按钮可单测 */}
              <div className="btm-probe">
                <div className="btm-probe-head">
                  <span>{tr('连通性探测')}</span>
                  <button type="button" className="btm-btn ghost" disabled={probing} onClick={() => runProbes()}>
                    {tr('全部重测')}
                  </button>
                </div>
                <ul className="btm-probe-list">
                  {[['npm', tr('npm registry（依赖安装通道）')], ['github', tr('GitHub（git 源与预检通道）')], ['catalog', tr('百通目录站（数据源）')]].map(([key, name]) => {
                    const p = probes[key] || { status: 'idle' };
                    return (
                      <li key={key} className={'btm-probe-row ' + (p.status || '')}>
                        <span className="btm-probe-dot" aria-hidden="true" />
                        <span className="btm-probe-name">{name}</span>
                        <span className="btm-probe-addr" title={p.display}>{p.display || '—'}</span>
                        <span className="btm-probe-ms">
                          {p.status === 'running' ? tr('探测中…') : p.status === 'ok' ? tr('可用') + ' ' + (p.code || '') + ' ' + (p.ms != null ? p.ms + 'ms' : '') : p.status === 'fail' ? tr('不可达') : ''}
                        </span>
                        <button type="button" className="btm-btn ghost btm-btn-icon" disabled={probing} onClick={() => runProbes(key)} title={tr('重测')}>
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
                          </svg>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <button type="button" className="btm-btn ghost" onClick={copyDiag}>
                {tr('复制诊断信息')}
              </button>
            </>
          ) : (
            <p className="btm-status">{tr('加载中…')}</p>
          )}
        </div>
      ) : null}

      {/* 操作日志：最近 20 次安装/更新/卸载 */}
      {section === 'logs' ? (
        <div className="btm-set-page">
          {/* 概览行：条数 + 路径 + 打开查看器 / 导出 / 定位 / 清空（对齐 dsh-plugin 的 logs 卡片） */}
          {logs ? (
            <div className="btm-logmeta">
              <span className="btm-logmeta-count">{tr('{n} 条', { n: String(Number(logs.total) || 0) })}</span>
              <span className="btm-logmeta-path" title={logs.path}>{logs.path || ''}</span>
            </div>
          ) : null}
          <div className="btm-logbar">
            <button type="button" className="btm-btn primary" onClick={() => setLogsModal(true)}>
              {tr('打开日志查看器')}
            </button>
            <button type="button" className="btm-btn ghost" onClick={exportLogs}>{tr('导出日志')}</button>
            <button type="button" className="btm-btn ghost" onClick={revealLogFile}>{tr('在文件夹中显示')}</button>
            <button type="button" className="btm-btn danger" onClick={clearLogs}>{tr('清空日志')}</button>
          </div>

          {/* 预览：最近 12 条（完整列表在查看器里翻页，对齐 dsh-plugin 的 PREVIEW = 12） */}
          {logs ? (
            logs.entries && logs.entries.length ? (
              <ul className="btm-loglist">
                {logs.entries.slice(0, 12).map((e, i) => (
                  <li key={'p' + i} className={'btm-logrow ' + e.level}>
                    <span className={'btm-log-lv ' + e.level}>{tr(LEVEL_TEXT[e.level] || e.level)}</span>
                    <span className="btm-log-time">{formatLogTime(e.at)}</span>
                    <span className="btm-log-cat">{tr(CAT_TEXT[e.category] || e.category)}</span>
                    <span className="btm-log-event" title={e.event}>{e.event}</span>
                    <span className="btm-log-msg" title={e.message}>{e.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="btm-status">{tr('暂无操作记录')}</p>
            )
          ) : (
            <p className="btm-status">{tr('加载中…')}</p>
          )}

          {/* 安装过程日志目录（点开看完整 pnpm 输出） */}
          {logs && logs.ops && logs.ops.length ? (
            <div className="btm-probe">
              <div className="btm-probe-head"><span>{tr('安装日志查看器')}</span></div>
              <ul className="btm-set-list">
                {logs.ops.map((it) => (
                  <li key={it.id}>
                    <div className="btm-set-name">
                      <b>{formatTime(it.time)}</b>
                      <span>{it.summary || it.id}</span>
                    </div>
                    <span className={it.failed ? 'btm-badge is-failed' : 'btm-badge'}>
                      {it.failed ? tr('失败') : tr('成功')}
                    </span>
                    <button type="button" className="btm-btn ghost" onClick={() => openLogViewer(it.id)}>
                      {tr('查看')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {logs && logs.path ? <p className="btm-custom-hint">{logs.path}</p> : null}
        </div>
      ) : null}

      {/* 系统日志查看器（对齐 dsh-plugin LogsModal：chip 双轴筛选 + 累积分页 + 清空/导出/定位） */}
      {logsModal ? (
        <div className="btm-sheet-mask" onClick={() => setLogsModal(false)}>
          <div className="btm-sheet btm-logviewer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="btm-sheet-top">
              <div className="btm-sheet-title">
                <h3>{tr('系统日志')}</h3>
                <p>{logs ? tr('{n} 条', { n: String(Number(logs.total) || 0) }) : ''}</p>
              </div>
              <button type="button" className="btm-close" onClick={() => setLogsModal(false)} aria-label={tr('关闭')}>×</button>
            </div>
            <div className="btm-sheet-body">
              {/* 类别 chip 行 */}
              <div className="btm-chips" role="group" aria-label={tr('类别')}>
                {CAT_FILTERS.map(([v, k]) => (
                  <button
                    key={v}
                    type="button"
                    className={'btm-chip' + (logCat === v ? ' on' : '')}
                    onClick={() => setLogCat(v)}
                  >
                    {tr(k)}
                  </button>
                ))}
              </div>
              {/* 级别 chip 行 */}
              <div className="btm-chips" role="group" aria-label={tr('级别')}>
                {LEVEL_FILTERS.map(([v, k]) => (
                  <button
                    key={v}
                    type="button"
                    className={'btm-chip lv-' + v + (logLevel === v ? ' on' : '')}
                    onClick={() => setLogLevel(v)}
                  >
                    {tr(k)}
                  </button>
                ))}
              </div>
              {/* 搜索 + 动作 */}
              <div className="btm-logbar" style={{ marginTop: 8 }}>
                <input
                  className="btm-input btm-logbar-q"
                  placeholder={tr('关键词')}
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadLogs(0); }}
                  spellCheck={false}
                />
                <button type="button" className="btm-btn ghost" onClick={() => loadLogs(0)}>{tr('刷新')}</button>
                <button type="button" className="btm-btn ghost" onClick={exportLogs}>{tr('导出日志')}</button>
                <button type="button" className="btm-btn ghost" onClick={revealLogFile}>{tr('在文件夹中显示')}</button>
                <button type="button" className="btm-btn danger" onClick={clearLogs}>{tr('清空日志')}</button>
              </div>
              {/* 日志列表（累积） */}
              {logs ? (
                logs.entries && logs.entries.length ? (
                  <>
                    <ul className="btm-loglist btm-loglist-tall">
                      {logs.entries.map((e, i) => (
                        <li key={'m' + i} className={'btm-logrow ' + e.level}>
                          <span className={'btm-log-lv ' + e.level}>{tr(LEVEL_TEXT[e.level] || e.level)}</span>
                          <span className="btm-log-time">{formatLogTime(e.at)}</span>
                          <span className="btm-log-cat">{tr(CAT_TEXT[e.category] || e.category)}</span>
                          <span className="btm-log-event" title={e.event}>{e.event}</span>
                          <span className="btm-log-msg" title={e.message}>{e.message}</span>
                        </li>
                      ))}
                    </ul>
                    {logOffset + 50 < (Number(logs.total) || 0) ? (
                      <div className="btm-more">
                        <button type="button" className="btm-btn ghost" onClick={() => loadLogs(logOffset + 50, true)}>
                          {tr('加载更多')}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="btm-status">{tr('暂无操作记录')}</p>
                )
              ) : (
                <p className="btm-status">{tr('加载中…')}</p>
              )}
              {logs && logs.path ? <p className="btm-custom-hint">{logs.path}</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* 安装日志查看器弹层 */}
      {logViewer ? (
        <div className="btm-sheet-mask" onClick={() => setLogViewer(null)}>
          <div className="btm-sheet btm-logviewer" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="btm-sheet-top">
              <div className="btm-sheet-title">
                <h3>{tr('安装日志查看器')}</h3>
                <p>{logViewer.id}</p>
              </div>
              <button type="button" className="btm-close" onClick={() => setLogViewer(null)} aria-label={tr('关闭')}>×</button>
            </div>
            <div className="btm-sheet-body">
              <div className="btm-logbar">
                <button
                  type="button"
                  className="btm-btn ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(logViewer.text);
                      flash(tr('已复制'));
                    } catch { /* 剪贴板不可用 */ }
                  }}
                >
                  {tr('复制')}
                </button>
                <span className="btm-custom-hint" style={{ margin: 0 }}>
                  {tr('{n} 条', { n: String(logViewer.text).split('\n').length })}
                </span>
              </div>
              <pre className="btm-logpre">{logViewer.text}</pre>
            </div>
          </div>
        </div>
      ) : null}

      {/* 重置：删除本地覆盖配置 */}
      {section === 'reset' ? (
        <div className="btm-set-page">
          <p className="btm-custom-desc">
            {tr('删除本地覆盖配置，恢复为插件默认值；操作日志与残留的安装报错也会一并清空')}
          </p>
          <button type="button" className="btm-btn danger" disabled={saving} onClick={resetCfg}>
            {saving ? tr('重置中…') : tr('重置')}
          </button>
        </div>
      ) : null}

        </div>{/* /.btm-set-content */}
      </div>{/* /.btm-set-body */}

      {/* 提示浮层：3 秒自动消失，不占据卡片流空间 */}
      <AutoToast key={noteSeq} seq={noteSeq} text={note} kind={noteKind} onDone={() => setNote('')} />
    </div>
  );
}

/* ============================ 入口：注册到 DSH Web 侧栏 ============================ */

const inject = ['slots', 'sessions'];

/** 侧栏底部入口：点击以「遮罩 + 居中抽屉」形态打开广场面板 */
/**
 * DSH 会话区域根节点。DSH 用 [data-phase] 标记当前会话面板，
 * 页面按它的 rect 精确贴合，而不是盖一层遮罩。
 */
function conversationRoot() {
  return typeof document === 'undefined' ? null : document.querySelector('[data-phase]');
}

function conversationBox() {
  const el = conversationRoot();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r || !r.width || !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/** 打开期间持续跟踪会话框尺寸（侧栏折叠 / 窗口缩放 / 会话切换都会变） */
function useConversationBox(active) {
  const [box, setBox] = useState(null);
  const layout = React.useLayoutEffect || useEffect;
  layout(() => {
    if (!active) {
      setBox(null);
      return undefined;
    }
    const update = () => setBox(conversationBox());
    update();
    const root = conversationRoot();
    const ro = root && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    if (root && ro) ro.observe(root);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [active]);
  return box;
}

/** 侧栏入口图标：四宫格 */
function PlazaIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.75" y="1.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.75" y="1.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.75" y="8.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="8.75" y="8.75" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

/** 无会话时的底部提示，3s 自动消失 */
function Toast({ text, onDone }) {
  useEffect(() => {
    if (!text) return undefined;
    const id = setTimeout(onDone, 3000);
    return () => clearTimeout(id);
  }, [text, onDone]);
  if (!text) return null;
  return <div className="btm-toast">{text}</div>;
}

/** 广场页面：整体替换右侧会话区域，不做居中弹窗 */
function PlazaPage({ onClose, box, ctx }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="btm-page"
      role="dialog"
      aria-modal="false"
      aria-label={lookup('百通插件广场')}
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
    >
      <div className="btm-top">
        <div className="btm-tabs" role="tablist">
          {/* 百通 logo：点击跳转门户；图片由宿主 /baitong-market/logo 提供（不进 client bundle） */}
          <a
            className="btm-brand"
            href="https://s.1100111.cn"
            target="_blank"
            rel="noreferrer noopener"
            title="百通 · s.1100111.cn"
          >
            {/* 品牌图，非插件头像：不走 Logo 组件的首字兜底（那套是给插件图标用的） */}
        <img src="/baitong-market/logo" alt="百通" />
          </a>
          <span className="btm-top-title">{lookup('百通插件广场')}</span>
        </div>
        <VersionBadge />
        <button type="button" className="btm-close" onClick={onClose} aria-label="关闭" title="关闭">
          ×
        </button>
      </div>
      <div className="btm-body">
        <PanelErrorBoundary>
          <MarketPanel ctx={ctx} />
        </PanelErrorBoundary>
      </div>
    </div>
  );
}

/** 侧栏入口：无会话则提示先开会话，有会话则用整页替换会话区域 */
function PlazaEntry(props) {
  const { wide, sessions } = props;
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState('');
  const close = useCallback(() => setOpen(false), []);
  const box = useConversationBox(open);

  // 会话区消失（新建/关闭会话）时自动收起
  useEffect(() => {
    if (!open) return;
    if (conversationRoot()) return;
    setOpen(false);
    setHint(lookup('请先打开一个会话'));
  }, [open, box]);

  // 切换会话时收起，避免页面上一步会话的上下文
  useEffect(() => {
    if (!open) return undefined;
    const list = sessions && sessions.list;
    if (!list || typeof list.subscribe !== 'function') return undefined;
    let last = sessionListCurrent(sessions);
    return list.subscribe(() => {
      const now = sessionListCurrent(sessions);
      if (now === last) return;
      last = now;
      close();
    });
  }, [open, sessions, close]);

  const panel = open && box && typeof document !== 'undefined'
    ? createPortal(<PlazaPage onClose={close} box={box} ctx={props} />, document.body)
    : null;

  return (
    <div className={wide ? 'btm-entry' : 'btm-entry rail'}>
      <button
        type="button"
        className="btm-entry-btn"
        aria-label={lookup('百通插件广场')}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close();
            setHint('');
            return;
          }
          if (!conversationBox()) {
            setHint(lookup('请先打开一个会话'));
            return;
          }
          setOpen(true);
          setHint('');
        }}
      >
        <PlazaIcon />
        {wide ? <span>百通插件广场</span> : null}
      </button>
      {hint ? <Toast text={hint} onDone={() => setHint('')} /> : null}
      {panel}
    </div>
  );
}

function sessionListCurrent(sessions) {
  try {
    return sessions && sessions.list && typeof sessions.list.getSnapshot === 'function'
      ? sessions.list.getSnapshot().current
      : undefined;
  } catch {
    return undefined;
  }
}

function apply(ctx) {
  const slots = ctx.slots;
  const sessions = ctx.sessions;
  if (!slots || typeof slots.register !== 'function') return;
  ctx.effect(() => ensureCss(), 'baitong-market-style');
  // 词表注册给 DSH：界面文案跟随 Harness 的中英文切换
  ctx.inject(['locale'], (c) => {
    if (!c.locale || typeof c.locale.register !== 'function') return;
    c.effect(() => {
      try {
        return c.locale.register('baitong-market', LOCALE_MESSAGES);
      } catch {
        return () => {};
      }
    }, 'baitong-market-locale');
  });
  // rc.6 list slots 要求 id，rc.7+ keyed slots 要求 key：两个都给，跨版本兼容。
  const options = {
    name: 'sidebar.footer.action',
    id: 'baitong-market',
    key: 'baitong-market',
    order: 8,
    label: () => lookup('百通插件广场'),
    locale: 'baitong-market',
  };
  slots.inject('sidebar.footer.action', () =>
    slots.register(options, (actionProps) => (
      <I18nProvider t={actionProps && actionProps.t}>
        <PlazaEntry {...actionProps} sessions={sessions} />
      </I18nProvider>
    )),
  );

  // 设置页：**一级 section**（settings.section，list 插槽）。
  // 🔴 层级修正（2026-10-19）：settings.plugins.tab 是「内置插件」区里的一个标签页
  //（用户实测：出现在 设置-内置插件 下面，不是要的效果）；与「内置插件」**同级**的
  // 侧边栏入口是 settings.section —— occupants 正是 general/models/plugins/agent-presets。
  // 注册自己的 section：label 走 thunk 每次投影重读，跟随 Harness 中英文。
  slots.inject('settings.section', () =>
    slots.register(
      {
        name: 'settings.section',
        id: 'baitong-plugin-market',
        key: 'baitong-plugin-market', // rc.6 list 用 id，rc.7+ keyed 用 key：都给，跨版本兼容
        order: 40,
        label: () => lookup('百通插件广场'),
        locale: 'baitong-market',
      },
      (sectionProps) => (
        <I18nProvider t={sectionProps && sectionProps.t}>
          <SettingsCard {...sectionProps} />
        </I18nProvider>
      ),
    ),
  );

  // 对话流工具卡片：slot 的 key 必须与 **工具名** 一致（不是 presentationMeta.kind）
  const toolviews = [
    ['baitong_skill_search', SkillSearchToolView],
    ['baitong_plugin_search', PluginSearchToolView],
    ['baitong_skill_list', InstalledSkillsToolView],
    ['baitong_skill_install', SimpleToolView],
    ['baitong_skill_uninstall', SimpleToolView],
    ['baitong_plugin_install', SimpleToolView],
  ];
  for (const [key, View] of toolviews) {
    slots.inject('tool.call.toolview', () =>
      slots.register(
        { name: 'tool.call.toolview', id: key, key, locale: 'baitong-market' },
        (viewProps) => (
          // 把 slot 注入的 t 铺到 React context，卡片子组件才能跟随 Harness 语言
          <I18nProvider t={viewProps && viewProps.t}>
            <View {...viewProps} />
          </I18nProvider>
        ),
      ),
    );
  }
}

return { inject, apply };
  },
});

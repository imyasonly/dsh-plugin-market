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
  '已是最新': 'Up to date',
  '已是最新版本：': 'Already up to date: ',
  '搜索': 'Search',
  '{n} 条': '{n} results',
  '{n} 个': '{n} items',
  '已装技能': 'Installed skills',
  '已卸载': 'Uninstalled',
  '完成': 'Done',
  '安装完成，重启 dsh 后生效': 'Installed. Restart dsh to take effect.',
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
function Logo({ url, name, fallback = 'P' }) {
  const [failed, setFailed] = useState(false);
  // url 变化（换数据/筛选）时重置，允许新 URL 再试一次
  useEffect(() => { setFailed(false); }, [url]);
  const initial = String(name || fallback).trim().slice(0, 1).toUpperCase();
  if (!url || failed) {
    return <span className="btm-logo-fallback">{initial}</span>;
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
          <Logo url={plugin.avatarUrl} name={plugin.displayName || plugin.name} fallback="P" />
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
          {skill.downloadCount ? <span title={tr('下载次数')}>⬇ {fmtCount(skill.downloadCount)}</span> : null}
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
  if (!status || !status.active) {
    if (status && status.error) {
      return <div className="btm-progress-error">{tr('安装失败：')}{status.error}</div>;
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
.btm-top{display:flex;align-items:center;gap:16px;flex:none;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l2,#e2e4e8);background:var(--dsw-alias-bg-base,#fff)}
.btm-top-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#17191c)}
.btm-close{margin-left:auto;width:32px;height:32px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-secondary,#4b5563);font:inherit;font-size:18px;line-height:1;cursor:pointer}
.btm-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f3f4f6)}
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
.btm-card-title{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1 1 auto;overflow:hidden}
.btm-card-name{font-size:14px;font-weight:600;line-height:20px;color:var(--dsw-alias-label-primary,inherit);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-card-fullname{font-size:11px;line-height:16px;flex:none;color:var(--dsw-alias-label-tertiary,#7b8088);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.btm-badge{align-self:center;flex:none;padding:1px 7px;border-radius:999px;font-size:10px;background:var(--dsw-alias-state-success-tertiary,#ecfdf5);color:var(--dsw-alias-state-success-primary,#047857)}
.btm-card-desc{flex:none;margin:10px 0 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-card-foot{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex:none;margin-top:auto;padding-top:12px;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-card-cat{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8088)}
.btm-card-stats{display:flex;gap:10px;flex:none;font-size:11px;color:var(--dsw-alias-label-tertiary,#7b8088);font-variant-numeric:tabular-nums}
.btm-card-stats>span{flex:none;white-space:nowrap}
/* 操作区独立成行 + 上分割线：详情在左（文字链接，非按钮），安装/状态在右 */
.btm-card-actions{display:flex;align-items:center;gap:8px;flex:none;margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#e2e4e8)}
.btm-card-details{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#4b5058);font:inherit;font-size:12px;font-weight:500;line-height:18px;text-align:left;text-decoration:none;cursor:pointer}
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

/** 行内标记：`code` **bold** *italic* [text](url) —— 必须在转义之后调用 */
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

/** 白名单净化 HTML：只留展示性标签与安全属性，其余标签改为文本、危险元素整段删除。 */
function sanitizeHtml(raw) {
  const src = String(raw || '');
  // ① 先整段删除危险元素及其内容（必须在标签处理之前，否则会留下碎片）
  const withoutBlocks = DANGEROUS_BLOCKS.reduce((acc, re) => acc.replace(re, ''), src);
  // ② 逐个标签处理。
  //    🔴 顺序陷阱：不能「先拼标签、最后统一 escapeHtml」—— 那样会把刚生成的
  //    合法标签一起转义掉（实测 `<img src=...>` → `&lt;img...&gt;`，图片又不显示了）。
  //    正确做法是**先把标签抠出来替换成占位符，剩余文本转义，再把标签放回去**。
  const slots = [];
  const withSlots = withoutBlocks.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g,
    (match, tagRaw, attrRaw) => {
      const tag = tagRaw.toLowerCase();
      if (!ALLOWED_HTML_TAGS.has(tag)) return ''; // 不在白名单 → 抹掉标签本身
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
            // 走本机图标代理：离线/内网环境下 COS 直连必然裂图
            if (!url) return '';
            attrs.push(`src="${escapeAttr(iconUrl(url))}"`);
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
  // ③ 转义剩余文本（标签已抠成占位符，不会被误伤）
  const escaped = withSlots.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // ④ 放回标签
  return escaped.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

/**
 * 概述渲染总入口：按内容形态分派。
 * 后端给HTML（常见于富文本概述，图片就是这么丢的）→ 白名单净化；
 * 给 Markdown → 原有渲染（先转义再解析，安全模型不变）。
 */
function renderRichText(source) {
  const raw = String(source == null ? '' : source);
  if (!raw.trim()) return '';
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
  const [busyKey, setBusyKey] = useState(null); // 卸载中
  const [uninstallErr, setUninstallErr] = useState('');
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
                <span className="btm-logo-fallback">{String(it.name || '?').slice(0, 1)}</span>
              </div>
              <div className="btm-card-title">
                <span className="btm-card-name">{it.name}</span>
                <span className="btm-card-fullname">{it.extra}</span>
              </div>
              <span className="btm-badge">{tr('已安装')}</span>
            </div>
            <p className="btm-card-desc">{it.description || (kind === 'skills' ? '' : tr('暂无描述'))}</p>

            {/* 缓存/体积等 Meta 行 */}
            <div className="btm-card-meta">
              {it.version ? <span className="btm-card-profile">{fmtVer(it.version)}</span> : null}
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
  const [skillCategory, setSkillCategory] = useState(''); // 技能分类（客户端过滤）
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

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    setError('');
    const [err, data] = await api('plugins', {
      q: keyword,
      category: activeCategory || undefined,
      sort,
      page: 1,
      pageSize: 48,
    });
    if (err) setError(t('加载失败：') + err);
    else setPlugins(data.items || []);
    setLoading(false);
  }, [keyword, activeCategory, sort]);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError('');
    const [err, data] = await api('skillSearch', { query: keyword, limit: 48, offset: 0 });
    const [, listData] = await api('skillList');
    const installedSet = new Set((listData?.items || []).map((it) => it.slug));
    setInstalledSlugs(installedSet);
    setInstalledSkillCount((listData?.items || []).length);
    if (err) setError(t('加载失败：') + err);
    else
      setSkills(data.items || []);
    setLoading(false);
  }, [keyword]);

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
          if (data.error) setError(t('安装失败：') + data.error);
          else {
            setRestartHint(true);
            loadPlugins();
          }
        } else if (!data.active && data.error && installingRef.current && data.error !== errorAtClickRef.current) {
          // 尚未开工就失败（如拉安装计划 / 预检出错）：同样要收尾，
          // 否则按钮会一直卡在禁用态、进度条永远停在"准备中"。
          // 比对"点击时的旧错误"是为了排除残留：只有全新错误才算本次失败。
          setInstalling(null);
          setError(t('安装失败：') + data.error);
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
    else if (data && data.manual) setError(t('无法自动重启，请从系统托盘右键 DSH 图标选择「退出」，再重新打开'));
  };

  // 技能分类：从已加载数据里取真实 category（接口不提供分类列表，也不支持按分类查询）
  const skillCats = [...new Set(skills.map((s) => String(s.category || '').trim()).filter(Boolean))].sort();
  const visibleSkills = skillCategory ? skills.filter((s) => String(s.category || '').trim() === skillCategory) : skills;

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

      {/* 类目胶囊（技能页·全部视图）：百通搜索接口忽略 category 参数，这里按返回数据里的真实分类客户端过滤 */}
      {tab === 'skills' && scope === 'all' && skillCats.length > 1 && (
        <div className="btm-cats">
          <button className={skillCategory === '' ? 'btm-cat active' : 'btm-cat'} onClick={() => setSkillCategory('')}>
            {t('全部')}
          </button>
          {skillCats.map((c) => (
            <button
              key={c}
              className={skillCategory === c ? 'btm-cat active' : 'btm-cat'}
              onClick={() => setSkillCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* 重启横幅（安装/卸载完成后提示） */}
      {restartHint && (
        <div className="btm-banner">
          <span>{t('操作完成，重启 DSH 后生效')}</span>
          <button className="btm-btn primary" disabled={restartBusy} onClick={restart}>
            {restartBusy ? t('正在重启…') : t('立即重启')}
          </button>
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
      ) : (
        <div className="btm-grid">
          {visibleSkills.map((s) => (
            <SkillCard
              key={s.slug}
              skill={s}
              onInstall={installSkill}
              onDetail={setSkillDetail}
              installedSlugsSet={installedSlugs}
            />
          ))}
          {!visibleSkills.length && <div className="btm-empty">{t('暂无技能')}</div>}
        </div>
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
      setErr(tr('安装失败：') + progress.error);
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
    else if (data && data.manual) setErr(tr('无法自动重启，请从系统托盘右键 DSH 图标选择「退出」，再重新打开'));
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
                  <Logo url={p.avatarUrl} name={p.displayName || p.name} fallback="P" />
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
          <button type="button" className="btm-btn primary" disabled={restartBusy} onClick={restart}>
            {restartBusy ? tr('正在重启…') : tr('立即重启')}
          </button>
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
 * 注册到 DSH 设置页（settings.plugin.item）。
 * 展示配置摘要与已安装技能清单，支持单个/全部更新到远端当前版本。
 * ⚠️ 远端没有版本历史接口，「更新」= 用远端当前版本覆盖安装。
 */
function SettingsCard(props) {
  const tr = useTr();
  const [state, setState] = useState({ status: 'loading', items: [], updatable: 0, error: '' });
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

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
      if (!err && data) setCfg(data);
    });
  }, [load]);

  const updateOne = async (slug) => {
    setBusy(slug);
    setNote('');
    const [err, data] = await api('skillUpdate', { slug });
    setBusy('');
    if (err || !data || data.ok === false) {
      setNote(tr('更新失败：') + (err || (data && data.error) || ''));
      return;
    }
    setNote(
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

  const cfgRows = cfg
    ? [
        [tr('接口地址'), cfg.apiBase],
        [tr('技能目录'), cfg.skillsDir],
      ]
    : [];

  return (
    <div className="btm-settings">
      <div className="btm-set-head">
        <h4 className="btm-set-title">{tr('百通技能与插件')}</h4>
        <span className="btm-set-desc">
          {tr('已安装技能 {n} 个，其中 {m} 个可更新', {
            n: state.items.length,
            m: state.updatable,
          })}
        </span>
      </div>

      {cfgRows.length ? (
        <ul className="btm-kv btm-set-kv">
          {cfgRows.map(([k, v]) => (
            <li key={k}>
              <span>{k}</span>
              <b>{v || '—'}</b>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="btm-set-actions">
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

      {note ? <p className="btm-status">{note}</p> : null}
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
          <span className="btm-top-title">{lookup('百通插件广场')}</span>
        </div>
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

  // 设置页卡片：已安装技能清单 + 单个/全部更新
  slots.inject('settings.plugin.item', () =>
    slots.register(
      {
        name: 'settings.plugin.item',
        id: 'baitong-market',
        key: 'baitong-market',
        locale: 'baitong-market',
      },
      (cardProps) => <SettingsCard {...cardProps} />,
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

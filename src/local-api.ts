/**
 * 本机 HTTP 服务：/baitong-market（广场面板轮询）与 /baitong-market/icon（图标代理）。
 * method 分发：按 method 分派到各端点；新增技能面板所需端点。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchBytes, fetchJson, proxyEnvSnapshot } from './http.js';
import { getBaitongSkillDetail, installBaitongSkill, installedSlugs, listInstalledSkills, readSkillLockEntry, searchBaitongSkills, uninstallBaitongSkill, SKILL_CATEGORY_TABS } from './skill-market.js';
import { PatchProbeUnavailableError, fetchInstallPlan, fetchLatestVersions, fetchPlatformVersions, findPatchIdConflict, githubShaFromSpec, installBaitongPlugin, isPluginInstallBusy, isRegistrySpec, isSafePkgName, listPluginCategories, listPlugins, parsePluginRef, readInstalledPluginMeta, readProfileDependencies, readProfileDependenciesOf, readInstalledPluginReadme, resolveInstallSource, uninstallBaitongPlugin, withPluginInstallLock, type PlatformVersionInfo } from './plugin-market.js';
import { BOOT_ID, addDshPlugin, bundledDshEntry, currentProfile, enableInstalledPlugin, isSafeProfile, profileDir, progress, publicInstallStatus, readProfileBundles, summarizePnpmFailure, writeMinimumReleaseAgeExclude } from './dsh-cli.js';
import { assignConfig, dshHome, publicConfig, sanitizePatch, withDefaults, writeOverlay } from './config-store.js';
import { appendLog, clearLogs, logFilePath, readLogs, removeLogFile, CATEGORIES, LEVELS, type LogCategory, type LogLevel } from './oplog.js';
import { canAutoRestart, detectRuntime, isRestartPending, markRestartPending, restartDesktopApp, scheduleRestart, servingPort, trustedRestartRequest } from './restart.js';
import type { BaitongConfig } from './config-store.js';
/**
 * 自定义安装目标解析（对齐 dsh-plugin-hub 的口径）：
 *   - 裸包名（含 @scope/pkg）直接用；
 *   - `npm install|i <pkgs>` / `pnpm add|i|install <pkgs>` 取包列表（只取第一个，DSH 是单插件安装）；
 *   - 完整 `dsh plugin --profile <p> add <target>` 提取 target。
 * 每个包名按 npm 语法校验并拒绝 `-` 开头的 token（npm 会把 --xxx 当参数，防注入任意 CLI 参数）。
 */
const CUSTOM_PKG_RE = /^(?:@[a-z0-9._-]+\/[a-z0-9._-]+|[a-z0-9][a-z0-9._-]*)$/i;
const NPM_INSTALL_CMD_RE = /^(?:npm\s+(?:install|i)|pnpm\s+(?:add|i|install))\s+(.+)$/i;
const DSH_PLUGIN_CMD_RE = /^dsh\s+plugin\s+--profile(?:\s+|=)\S+\s+add\s+(.+)$/i;

/** 命令行工具版本探测（对齐 dsh-plugin）：500ms 超时，win32 需 shell 解析 .cmd shim；失败返回 null */
function toolVersion(cmd: string, args: string[]): string | null {
  try {
    const r = spawnSync(cmd, args, { timeout: 500, encoding: 'utf8', shell: process.platform === 'win32' });
    if (r.error || r.status !== 0) return null;
    const first = String(r.stdout || '').trim().split(/\r?\n/)[0] || '';
    const m = /\d+\.\d+[0-9A-Za-z.\-+]*/.exec(first);
    return m ? m[0] : null;
  } catch {
    return null;
  }
}

/** dsh 不在 PATH 时：从 bundledDshEntry 的 bin.js 所在包读版本 */
function dshVersionFromEntry(entry: { file: string; args: string[] } | null): string | null {
  const binJs = entry?.args?.[0];
  if (!binJs) return null;
  try {
    const pkg = JSON.parse(readFileSync(join(dirname(dirname(binJs)), 'package.json'), 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

export function parseCustomTarget(raw: string): string | null {
  const input = String(raw || '').trim();
  if (!input || input.length > 500) return null;
  const dshMatch = DSH_PLUGIN_CMD_RE.exec(input);
  if (dshMatch) return validateSinglePkg(dshMatch[1].trim());
  const npmMatch = NPM_INSTALL_CMD_RE.exec(input);
  if (npmMatch) {
    const pkgs = npmMatch[1].trim().split(/\s+/).filter(Boolean);
    if (pkgs.length === 0 || pkgs.some((p) => p.startsWith('-') || !CUSTOM_PKG_RE.test(p))) return null;
    return validateSinglePkg(pkgs[0]);
  }
  return validateSinglePkg(input);
}

function validateSinglePkg(target: string): string | null {
  if (!target || target.startsWith('-')) return null;
  // 允许 npm 精确版本/tag：pkg@1.2.3 / pkg@latest
  const at = target.lastIndexOf('@');
  const base = at > 0 ? target.slice(0, at) : target;
  const tag = at > 0 ? target.slice(at + 1) : '';
  if (!CUSTOM_PKG_RE.test(base)) return null;
  if (tag && !/^[\w.+=-]+$/.test(tag)) return null;
  return target;
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, cfg: BaitongConfig): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const method = String(body.method || url.searchParams.get('method') || 'plugins');

    // ===== 技能面板 =====
    if (method === 'skillSearch') {
      const query = String(body.query || url.searchParams.get('query') || '').trim();
      const explicit = Number(body.limit);
      const limit = Number.isFinite(explicit) && explicit > 0 ? Math.min(Math.max(explicit, 1), 80) : cfg.maxResults;
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
      // 服务端分类（技能页 Tab）：categoryId 入参，白名单校验防任意值透传
      const rawCat = String(body.categoryId ?? url.searchParams.get('categoryId') ?? '').trim();
      const categoryId = SKILL_CATEGORY_TABS.some((c) => c.id === rawCat) ? rawCat : undefined;
      const installed = await installedSlugs(cfg.skillsDir);
      const result = await searchBaitongSkills(query, { cfg, limit, offset, installed, categoryId });
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (method === 'skillInstall') {
      const slug = String(body.slug || url.searchParams.get('slug') || '').trim();
      if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
      const result = await installBaitongSkill(slug, cfg);
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (method === 'skillList') {
      const items = await listInstalledSkills(cfg.skillsDir);
      return sendJson(res, 200, { ok: true, skillsDir: cfg.skillsDir, items });
    }
    if (method === 'skillUninstall') {
      const slug = String(body.slug || url.searchParams.get('slug') || '').trim();
      if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
      const result = await uninstallBaitongSkill(slug, cfg.skillsDir);
      return sendJson(res, 200, { ok: true, ...result });
    }

    // ===== 插件面板 =====
    if (method === 'plugins' || method === 'pluginSearch') {
      const result = await listPlugins(cfg, {
        q: body.q ?? body.query ?? url.searchParams.get('q'),
        scope: body.scope ?? url.searchParams.get('scope') ?? 'all',
        category: body.category ?? url.searchParams.get('category'),
        sort: body.sort ?? url.searchParams.get('sort'),
        page: body.page ?? url.searchParams.get('page'),
        pageSize: body.pageSize ?? body.limit ?? url.searchParams.get('page_size'),
      });
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (method === 'skillDetail') {
      const slug = String(body.slug ?? url.searchParams.get('slug') ?? '').trim();
      if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
      try {
        const installed = await installedSlugs(cfg.skillsDir);
        const detail = await getBaitongSkillDetail(slug, cfg, installed);
        return sendJson(res, 200, { ok: true, ...detail });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (method === 'skillUpdate') {
      // 「更新到最新」：远端版本与本地记录不一致时覆盖安装（远端即最新）
      const slug = String(body.slug ?? url.searchParams.get('slug') ?? '').trim();
      if (!slug) return sendJson(res, 400, { ok: false, error: '缺少 slug' });
      try {
        const local = readSkillLockEntry(cfg.skillsDir, slug);
        const localVersion = String(local?.version || '');
        const result = await installBaitongSkill(slug, cfg, null);
        return sendJson(res, 200, {
          ok: true,
          slug,
          previousVersion: localVersion,
          version: String(result.version || ''),
          updated: String(result.version || '') !== localVersion,
        });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (method === 'skillUpdates') {
      // 设置页「已安装技能 + 一键更新」的数据源：
      // 本地清单 + 一次远端列表（limit=100），逐条对比版本 → updatable
      try {
        const local = await listInstalledSkills(cfg.skillsDir);
        const remote = await searchBaitongSkills('', { cfg, limit: 100, offset: 0, installed: new Set() });
        const remoteMap = new Map(
          ((remote.items as Record<string, unknown>[]) || []).map((it) => [String(it.slug), it]),
        );
        const items = local.map((it) => {
          const slug = String(it.slug);
          const hit = remoteMap.get(slug);
          const localVersion = String(it.version || readSkillLockEntry(cfg.skillsDir, slug)?.version || '');
          const remoteVersion = hit ? String(hit.version || '') : '';
          return {
            slug,
            name: String(hit?.name || it.name || slug),
            localVersion,
            remoteVersion,
            // 只有远端确实给了版本、且与本地不同才算「可更新」
            updatable: !!remoteVersion && remoteVersion !== localVersion,
            files: it.files,
            bytes: it.bytes,
            updateTime: it.updateTime,
            summary: String(hit?.summary || ''),
          };
        });
        return sendJson(res, 200, {
          ok: true,
          items,
          updatable: items.filter((it) => it.updatable).length,
        });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (method === 'pluginCategories') {
      const result = await listPluginCategories(cfg);
      return sendJson(res, 200, { ok: true, ...result });
    }
    if (method === 'installedPlugins') {
      // 已安装清单：跨 profile 按包名合并 + 读 package.json 元信息（同包双 profile 只列一张卡片）
      // enabled：包在 dependencies 里还不够，必须同时出现在 dsh.profile.bundles 才会被加载。
      // 旧版本安装路径漏了这一步，面板要能把「装了但没启用」显示出来并给一键启用。
      const deps = readProfileDependencies();
      const items = deps.map((d) => {
        const bundles = new Map(d.profiles.map((p) => [p, readProfileBundles(p)]));
        const enabled = d.profiles.some((p) => bundles.get(p)?.includes(d.pkg));
        return {
          spec: d.spec,
          enabled,
          ...(readInstalledPluginMeta(d.pkg, d.profiles) ?? {
            pkg: d.pkg,
            profile: d.profiles[0] ?? '',
            profiles: d.profiles,
            dsh: false,
          }),
        };
      });
      return sendJson(res, 200, { ok: true, items, total: items.length });
    }
    if (method === 'pluginInstallPlan') {
      const ref = parsePluginRef(body.owner ?? url.searchParams.get('owner'), body.name ?? url.searchParams.get('name'));
      const plan = await fetchInstallPlan(cfg, ref.owner, ref.name);
      const source = resolveInstallSource(plan, ref);
      return sendJson(res, 200, { ok: true, source });
    }
    if (method === 'pluginInstall') {
      // 异步执行：安装 pnpm install 可能耗时数分钟，同步 await 会拖垮 webServer 请求
      // （客户端表现为 fetch failed）。立即返回 started，进度与错误经 pluginInstallStatus 轮询。
      const profile = currentProfile();
      if (isPluginInstallBusy() || progress.active) {
        return sendJson(res, 409, { ok: false, error: '已有安装任务在进行中', profile });
      }
      try {
        parsePluginRef(body.owner ?? url.searchParams.get('owner'), body.name ?? url.searchParams.get('name'));
      } catch (err) {
        return sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      // 新任务受理：先清掉上一轮的残留错误/进度行，否则前端会把旧错误当成本次结果
      progress.error = null;
      progress.lastLine = '';
      // 先同步做 install-plan 拉取与校验（快，失败可立即反馈），再异步跑 dsh plugin add
      let source: string;
      let warning: string | null = null;
      try {
        const ref = parsePluginRef(body.owner ?? url.searchParams.get('owner'), body.name ?? url.searchParams.get('name'));
        const plan = await fetchInstallPlan(cfg, ref.owner, ref.name);
        source = resolveInstallSource(plan, ref);
        try {
          const conflict = await findPatchIdConflict(source, cfg);
          if (conflict) {
            return sendJson(res, 200, {
              ok: false,
              error: `插件加载 id「${conflict.id}」与已安装的 ${conflict.holder} 冲突，继续安装会让 DSH 无法启动，已拒绝。请先卸载 ${conflict.holder}。`,
            });
          }
        } catch (err) {
          // 预检要拉 GitHub raw 上的 cordis.patch.yml（Node fetch 直连）—— 网络不可达时
          // 拿不到远端文件，但这是"防呆"检查，不该把安装整个堵死：
          // 降级为告警继续走 pnpm/git（它们有自己的代理与网络路径）。
          if (!(err instanceof PatchProbeUnavailableError)) throw err;
          warning = `加载 id 冲突预检未完成（${err.detail}），已跳过该检查继续安装`;
        }
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err), profile });
      }
      appendLog('info', 'install', 'install.start', `开始安装 ${String(source)}（${profile}）${warning ? '（预检已跳过）' : ''}`);
      void (async () => {
        try {
          const result = await withPluginInstallLock(() => installBaitongPlugin({
            owner: body.owner ?? url.searchParams.get('owner'),
            name: body.name ?? url.searchParams.get('name'),
          }, cfg, profile));
          progress.error = null;
          progress.lastLine = `安装完成：${String(result.fullName)}（${profile} profile），重启 dsh ${profile} 后生效`;
          appendLog('success', 'install', 'install.done', `安装 ${String(result.fullName)} → ${String(result.source)}（${profile}）`);
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (progress.error === null) progress.error = text.slice(0, 800);
          appendLog('error', 'install', 'install.fail', `安装失败（${profile}）：${text.slice(0, 300)}`);
        }
      })();
      return sendJson(res, 200, { ok: true, started: true, source, profile, warning });
    }
    if (method === 'pluginSelfUpgrade') {
      // 自己升级自己：面板头部"有新版本"气泡点一下就走这里。
      // 🔴 关键：source 必须带**显式版本号**（`pkg@0.1.7`）。只写包名时 pnpm 会认为
      // lockfile 里 `^0.1.1` 的解（0.1.1）已经满足 spec，直接复用、不升级 —— 这正是
      // "装完还是旧版"的根因。
      const profile = currentProfile();
      if (isPluginInstallBusy() || progress.active) {
        return sendJson(res, 409, { ok: false, error: '已有安装任务在进行中', profile });
      }
      // link 安装（本地源码开发）不能自我升级：pnpm add 会把它换成注册表版本，
      // 覆盖掉开发者的 link。这条路径要求"改代码 + 重新构建 + 重启"。
      let spec = '';
      try {
        spec = readProfileDependenciesOf(profile)[SELF_PKG] ?? '';
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err), profile });
      }
      if (/^link:/i.test(spec)) {
        return sendJson(res, 200, {
          ok: false,
          error: `${profile} profile 是 link 安装（${spec}），源码即最新版：请重新构建（npm run build）后重启 DSH，不要走自我升级。`,
          profile,
          link: true,
        });
      }

      // 目标版本必须现拉，不能吃一小时缓存（否则刚发的版本身上的实例看不到）
      const snap = await pluginVersionSnapshot(cfg, { force: true });
      if (!snap.latest) {
        return sendJson(res, 200, { ok: false, error: `获取线上版本失败：${snap.error ?? '未知错误'}`, profile });
      }
      if (!SELF_VERSION_RE.test(snap.latest)) {
        return sendJson(res, 200, { ok: false, error: `线上版本号非法：${snap.latest}`, profile });
      }
      if (!snap.current || compareVersions(snap.latest, snap.current) <= 0) {
        return sendJson(res, 200, { ok: false, alreadyLatest: true, error: `已是最新版本 ${snap.current || snap.latest}`, profile });
      }

      const source = `${SELF_PKG}@${snap.latest}`;
      // 自我升级的目标永远是「刚发布」的版本，必然落在 pnpm 供应链冷却期（默认 24h）内。
      // 提前把该版本写进 profile 的 minimumReleaseAgeExclude，避免第一次点击就失败重试。
      try {
        if (profile !== 'desktop') writeMinimumReleaseAgeExclude(profileDir(profile), source);
      } catch {
        /* 写不进去就走 addDshPlugin 内部的重试兜底 */
      }
      progress.error = null;
      progress.lastLine = '';
      void (async () => {
        try {
          await withPluginInstallLock(() => addDshPlugin(source, profile));
          progress.error = null;
          progress.lastLine = `升级完成：${snap.current} → ${snap.latest}（${profile} profile），重启 DSH 后生效`;
          // 升级成功后缓存里的 current 还停在旧值，清掉让下次 pluginMeta 重新读
          versionCache = null;
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          // message 里已由 summarizePnpmFailure 提炼；再兜底一次，绝不把 NDJSON 原文塞进面板
          if (progress.error === null) progress.error = summarizePnpmFailure(text).slice(0, 800) || text.slice(0, 800);
        }
      })();
      return sendJson(res, 200, { ok: true, started: true, source, profile, from: snap.current, to: snap.latest });
    }
    // ===== 已安装插件的「可更新」标签：两条渠道并行 =====
    // 渠道一：npm registry latest（registry 源插件）
    // 渠道二：插件平台版本（GitHub 源插件 —— 平台按 Release 收录，未必发到 npm，只查 npm 会永远"已是最新"）
    if (method === 'pluginLatestVersions') {
      const deps = readProfileDependencies();
      const registryDeps = deps.filter((d) => isRegistrySpec(d.spec));
      const platformDeps = deps.filter((d) => d.repo);
      let latest: Record<string, string> = {};
      let platform: Record<string, PlatformVersionInfo> = {};
      let localShaByPkg: Record<string, string> = {};
      try {
        const [registryOut, platformOut] = await Promise.all([
          fetchLatestVersions(registryDeps.map((d) => d.pkg), cfg).catch(() => ({}) as Record<string, string>),
          fetchPlatformVersions(platformDeps.map((d) => d.repo as string), cfg).catch(() => ({}) as Record<string, PlatformVersionInfo>),
        ]);
        latest = registryOut;
        platform = platformOut;
        for (const dep of platformDeps) {
          const pinned = platform[dep.repo as string];
          if (pinned) localShaByPkg[dep.pkg] = githubShaFromSpec(dep.spec);
        }
      } catch {
        /* 全部失败：返回空表，前端不显示更新标签 */
      }
      const items = deps.map((d) => {
        const installed = readInstalledPluginMeta(d.pkg, d.profiles);
        const current = installed?.version ?? '';
        const registryLatest = latest[d.pkg] ?? '';
        const pinned = platform[d.repo as string];
        // 平台渠道优先：GitHub 源安装的就是 github:owner/repo#sha，平台的 pinned_sha 才是权威
        const latestV = pinned?.latest || registryLatest;
        const localSha = localShaByPkg[d.pkg] ?? '';
        // 版本号相同不代表最新：平台是按 commit sha 推进的，sha 不同同样要更新
        const hubSha = pinned?.sha ?? '';
        const hasUpdate = pinned
          ? compareVersions(latestV, current) > 0 || (!!hubSha && !!localSha && hubSha !== localSha)
          : !!(current && latestV && compareVersions(latestV, current) > 0);
        return {
          pkg: d.pkg,
          current,
          latest: latestV,
          hasUpdate,
          // 平台渠道的更新目标：GitHub 源插件按 repo@pinnedSha 更新
          hubRepo: pinned ? d.repo : undefined,
          hubSha: pinned ? hubSha : undefined,
          via: pinned ? 'platform' : registryLatest ? 'registry' : 'none',
        };
      });
      return sendJson(res, 200, { ok: true, items });
    }
    // ===== 更新单个已安装插件（dsh-plugin 的经验：pnpm add pkg 无版本 = 幂等空转，必须 @latest） =====
    if (method === 'pluginUpdate') {
      const pkg = String(body.pkg ?? url.searchParams.get('pkg') ?? '').trim();
      const profile = String(body.profile ?? url.searchParams.get('profile') ?? '').trim() || currentProfile();
      if (!pkg) return sendJson(res, 400, { ok: false, error: '缺少 pkg' });
      const deps = readProfileDependenciesOf(profile);
      if (!(pkg in deps)) {
        return sendJson(res, 200, { ok: false, error: `${profile} profile 未安装 ${pkg}`, profile });
      }
      const dep = deps[pkg];
      if (isPluginInstallBusy() || progress.active) {
        return sendJson(res, 409, { ok: false, error: '已有安装任务在进行中', profile });
      }
      // 更新按钮只会在 pluginLatestVersions 已确认有新版时出现；客户端把同一快照里的
      // 精确目标带回来，避免点击后重复查询。registry 源用版本号，GitHub 源用平台 pinned sha。
      let source: string;
      const targetVersion = String(body.targetVersion ?? url.searchParams.get('targetVersion') ?? '').trim();
      if (isRegistrySpec(dep)) {
        if (!SELF_VERSION_RE.test(targetVersion)) {
          return sendJson(res, 400, { ok: false, error: '更新目标版本无效，请刷新更新列表后重试', profile });
        }
        source = `${pkg}@${targetVersion}`;
      } else if (/^github:/i.test(dep.trim())) {
        // 平台当前 pinned 的 commit 就是它推荐的更新目标（install-plan 同样用它）
        const targetSha = String(body.targetSha ?? url.searchParams.get('targetSha') ?? '').trim();
        if (!/^[0-9a-f]{7,40}$/i.test(targetSha)) {
          return sendJson(res, 400, { ok: false, error: '更新目标 commit 无效，请刷新更新列表后重试', profile });
        }
        const installedDep = readProfileDependencies().find((item) => item.pkg === pkg);
        const repo = String((body.targetRepo ?? url.searchParams.get('targetRepo') ?? '') as string).trim() || installedDep?.repo || '';
        if (!repo || repo !== (installedDep?.repo ?? '')) {
          return sendJson(res, 200, { ok: false, error: '更新目标仓库与本插件安装来源不一致，已拒绝', profile });
        }
        source = `github:${repo}#${targetSha}`;
      } else {
        return sendJson(res, 200, { ok: false, error: `该插件来自 ${dep}，非 registry 非 github 源不支持自动更新`, profile });
      }
      progress.error = null;
      progress.lastLine = '';
      appendLog('info', 'update', 'update.start', `开始更新 ${pkg} → ${source}（${profile}）`);
      void (async () => {
        try {
          await withPluginInstallLock(() => addDshPlugin(source, profile));
          progress.error = null;
          progress.lastLine = `更新完成：${pkg}（${profile} profile），重启 DSH 后生效`;
          appendLog('success', 'update', 'update.done', `更新 ${pkg} → ${targetVersion}（${profile}）`);
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (progress.error === null) progress.error = summarizePnpmFailure(text).slice(0, 800) || text.slice(0, 800);
          appendLog('error', 'update', 'update.fail', `更新失败 ${pkg}（${profile}）：${text.slice(0, 300)}`);
        }
      })();
      return sendJson(res, 200, { ok: true, started: true, source, profile });
    }
    // ===== 自定义安装：裸包名 / npm|pnpm 命令 / 完整 dsh 命令 =====
    if (method === 'pluginCustomInstall') {
      const raw = String(body.target ?? url.searchParams.get('target') ?? '').trim();
      const profile = String(body.profile ?? url.searchParams.get('profile') ?? '').trim() || currentProfile();
      if (!raw) return sendJson(res, 400, { ok: false, error: '缺少安装目标' });
      if (isPluginInstallBusy() || progress.active) {
        return sendJson(res, 409, { ok: false, error: '已有安装任务在进行中', profile });
      }
      const source = parseCustomTarget(raw);
      if (!source) {
        return sendJson(res, 200, { ok: false, error: '无法识别的安装目标（支持裸包名 / npm|pnpm install 命令 / dsh plugin 命令）', profile });
      }
      progress.error = null;
      progress.lastLine = '';
      appendLog('info', 'install', 'install.custom.start', `开始自定义安装 ${source}（${profile}）`);
      void (async () => {
        try {
          await withPluginInstallLock(() => addDshPlugin(source, profile));
          progress.error = null;
          progress.lastLine = `安装完成：${source}（${profile} profile），重启 DSH 后生效`;
          appendLog('success', 'install', 'install.custom.done', `自定义安装 ${source}（${profile}）`);
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (progress.error === null) progress.error = summarizePnpmFailure(text).slice(0, 800) || text.slice(0, 800);
          appendLog('error', 'install', 'install.custom.fail', `自定义安装失败 ${source}（${profile}）：${text.slice(0, 300)}`);
        }
      })();
      return sendJson(res, 200, { ok: true, started: true, source, profile });
    }
    // ===== 在系统文件管理器中定位已安装插件目录 =====
    if (method === 'pluginReveal') {
      const pkg = String(body.pkg ?? url.searchParams.get('pkg') ?? '').trim();
      const profile = String(body.profile ?? url.searchParams.get('profile') ?? '').trim() || currentProfile();
      if (!pkg) return sendJson(res, 400, { ok: false, error: '缺少 pkg' });
      if (!(pkg in readProfileDependenciesOf(profile))) {
        return sendJson(res, 200, { ok: false, error: `${profile} profile 未安装 ${pkg}` });
      }
      const dir = join(profileDir(profile), 'node_modules', ...pkg.split('/'));
      if (!existsSync(dir)) {
        return sendJson(res, 200, { ok: false, error: `插件目录不存在：${dir}` });
      }
      // macOS Finder -R 定位选中；Windows explorer /select,；Linux 退化为打开目录
      const bin = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
      const args = process.platform === 'darwin' ? ['-R', dir] : process.platform === 'win32' ? ['/select,', dir] : [dir];
      try {
        const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return sendJson(res, 200, { ok: true, path: dir });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (method === 'pluginReadme') {
      // 已安装插件的 README 只读预览（本地读，不联网）
      const pkg = String(body.pkg ?? url.searchParams.get('pkg') ?? '').trim();
      const profile = String(body.profile ?? url.searchParams.get('profile') ?? '').trim();
      if (!pkg) return sendJson(res, 400, { ok: false, error: '缺少 pkg' });
      try {
        const result = readInstalledPluginReadme(pkg, profile);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (method === 'pluginUninstall') {
      // 与安装同款异步化：pnpm remove 也可能耗时，同步 await 会拖垮 webServer
      const pkg = String(body.pkg ?? url.searchParams.get('pkg') ?? '').trim();
      const profile = String(body.profile ?? url.searchParams.get('profile') ?? '').trim() || currentProfile();
      if (!pkg) return sendJson(res, 400, { ok: false, error: '缺少 pkg' });
      if (isPluginInstallBusy() || progress.active) {
        return sendJson(res, 409, { ok: false, error: '已有安装任务在进行中', profile });
      }
      try {
        // 归属校验同步做，失败立即反馈（不进入异步队列）
        const deps = readProfileDependenciesOf(profile);
        if (!(pkg in deps)) {
          return sendJson(res, 200, { ok: false, error: `${profile} profile 未安装 ${pkg}，无法卸载`, profile });
        }
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err), profile });
      }
      appendLog('info', 'uninstall', 'uninstall.start', `开始卸载 ${pkg}（${profile}）`);
      void (async () => {
        try {
          const result = await withPluginInstallLock(() => uninstallBaitongPlugin(pkg, profile));
          progress.error = null;
          progress.lastLine = `已卸载：${String(result.pkg)}（${profile} profile），重启 dsh ${profile} 后生效`;
          appendLog('success', 'uninstall', 'uninstall.done', `卸载 ${pkg}（${profile}）${result.fallback ? '（清理残留）' : ''}`);
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (progress.error === null) progress.error = text.slice(0, 800);
          appendLog('error', 'uninstall', 'uninstall.fail', `卸载失败 ${pkg}（${profile}）：${text.slice(0, 300)}`);
        }
      })();
      return sendJson(res, 200, { ok: true, started: true, pkg, profile });
    }
    // ===== 启用已安装但未选中的插件（DSH「立即启用」的等价物） =====
    // 桌面端由宿主 pluginManager 负责（会写 dsh.profile.bundles 并尝试热加载）；
    // 非桌面 profile 直接改 profile 的 bundles 列表，重启后生效。
    if (method === 'pluginEnable') {
      const pkg = String(body.pkg ?? url.searchParams.get('pkg') ?? '').trim();
      const profile = String(body.profile ?? url.searchParams.get('profile') ?? '').trim() || currentProfile();
      if (!isSafePkgName(pkg)) return sendJson(res, 400, { ok: false, error: '无效插件包名' });
      if (!isSafeProfile(profile)) return sendJson(res, 400, { ok: false, error: '非法 profile 名' });
      try {
        const result = await enableInstalledPlugin(pkg, profile);
        appendLog('success', 'install', 'install.enable', `启用 ${pkg}（${profile}）`);
        return sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        const text = err instanceof Error ? err.message : String(err);
        appendLog('error', 'install', 'install.enable.fail', `启用 ${pkg}（${profile}）失败：${text.slice(0, 300)}`);
        return sendJson(res, 200, { ok: false, error: text });
      }
    }
    if (method === 'pluginInstallStatus') {
      return sendJson(res, 200, {
        ok: true,
        ...publicInstallStatus(),
        busy: isPluginInstallBusy() || progress.active,
        restart: true,
        boot: BOOT_ID,
        runtime: detectRuntime(),
        // 能不能自动重启：false 时前端直接展示「手动重启步骤」，不摆一个点了没用的按钮
        canAutoRestart: canAutoRestart(),
        // 实际生效的百通 API 根地址：装机后不用翻配置就能确认连的是生产还是私有化地址
        apiBase: cfg.apiBase,
        // 网络环境快照：排查 "fetch failed" 用（DSH 进程实际看到的代理变量 + 运行时版本）
        net: {
          node: process.version,
          electron: process.versions.electron ?? null,
          proxy: proxyEnvSnapshot(),
        },
      });
    }
    if (method === 'pluginRestart') {
      if (!trustedRestartRequest(req)) {
        return sendJson(res, 403, { ok: false, error: 'restart is limited to same-origin requests' });
      }
      if (isPluginInstallBusy() || progress.active) {
        return sendJson(res, 409, { ok: false, error: 'cannot restart while a plugin operation is running' });
      }
      if (isRestartPending()) {
        return sendJson(res, 409, { ok: false, error: 'restart already scheduled' });
      }
      const runtime = detectRuntime();
      if (runtime === 'desktop') {
        // 桌面端（Electron）：`dsh web` 与 GUI 无关，必须走应用级 relaunch；
        // 拿不到 Electron API 时不做任何进程操作，把"怎么重启"交回用户（manual）
        const desktop = restartDesktopApp();
        if (desktop.manual) {
          return sendJson(res, 200, { ok: true, runtime, via: 'manual', manual: true });
        }
        markRestartPending();
        return sendJson(res, 202, { ok: true, runtime, via: desktop.via, manual: false });
      }
      const result = scheduleRestart(servingPort(req));
      markRestartPending();
      return sendJson(res, 202, { ok: true, runtime, pid: result.pid, helperPid: result.helperPid, via: result.via, manual: false });
    }

    // ===== 诊断：环境快照（含 dsh/pnpm/npm/git 版本），排查"别人电脑装不上"用 =====
    if (method === 'pluginDiagnostics') {
      const entry = bundledDshEntry();
      appendLog('info', 'diagnostics', 'diagnostics.view', '查看诊断信息');
      return sendJson(res, 200, {
        ok: true,
        version: currentPluginVersion(),
        runtime: detectRuntime(),
        canAutoRestart: canAutoRestart(),
        node: process.version,
        electron: process.versions.electron ?? null,
        platform: process.platform + ' ' + process.arch,
        cliEntry: entry ? entry.file : null, // null = 只能靠 PATH（未启用注册的机器在此暴露）
        dshHome: dshHome(),
        profile: currentProfile(),
        apiBase: cfg.apiBase,
        npmRegistry: cfg.npmRegistry,
        proxy: proxyEnvSnapshot(),
        dshVersion: toolVersion('dsh', ['--version']) ?? dshVersionFromEntry(entry),
        pnpmVersion: toolVersion('pnpm', ['--version']),
        npmVersion: toolVersion('npm', ['--version']),
        gitVersion: toolVersion('git', ['--version']),
      });
    }
    // ===== 结构化操作日志：level×category 过滤 + 关键词 + 分页；另带安装目录预览 =====
    if (method === 'pluginLogs') {
      // body 优先（面板走 POST），GET 走 searchParams：两端点口径一致，便于命令行排查
      const q = (k: string) => String(body[k] ?? url.searchParams.get(k) ?? '');
      const result = readLogs({
        offset: Math.max(0, Math.floor(Number(q('offset')) || 0)),
        limit: Math.min(Math.max(Number(q('limit')) || 50, 1), 200),
        category: (CATEGORIES as string[]).includes(q('category')) ? (q('category') as LogCategory) : 'all',
        level: (LEVELS as string[]).includes(q('level')) ? (q('level') as LogLevel) : 'all',
        query: q('query').trim() || undefined,
      });
      const dir = join(profileDir(currentProfile()), '.plugin-manager', 'logs');
      const ops: Record<string, unknown>[] = [];
      try {
        for (const op of readdirSync(dir)
          .filter((n) => n.startsWith('operation-'))
          .map((n) => ({ name: n, stat: statSync(join(dir, n)) }))
          .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
          .slice(0, 10)) {
          const logFile = join(dir, op.name, 'install.log');
          let summary = '';
          let failed = false;
          try {
            const text = readFileSync(logFile, 'utf8');
            const m = /# FAILED: ([^\n]+)/.exec(text);
            failed = !!m;
            summary = m ? m[1].slice(0, 200) : (text.split('\n').find((l) => l.startsWith('# ')) || '').slice(0, 200);
          } catch { /* 无 install.log */ }
          ops.push({ id: op.name, time: new Date(op.stat.mtimeMs).toISOString(), failed, summary });
        }
      } catch { /* 目录不存在 */ }
      return sendJson(res, 200, { ok: true, ...result, path: logFilePath(), ops });
    }
    // ===== 单条安装日志全文（查看器弹窗用） =====
    if (method === 'pluginLogRead') {
      const id = String(body.id ?? url.searchParams.get('id') ?? '').trim();
      if (!/^operation-[A-Za-z0-9-]{1,64}$/.test(id)) return sendJson(res, 400, { ok: false, error: '非法日志 id' });
      const file = join(profileDir(currentProfile()), '.plugin-manager', 'logs', id, 'install.log');
      try {
        const text = readFileSync(file, 'utf8');
        return sendJson(res, 200, { ok: true, id, text: text.slice(-64 * 1024) });
      } catch {
        return sendJson(res, 200, { ok: false, error: '日志不存在或已清理' });
      }
    }
    // ===== 清空日志（截断 + 记一条"已清空"）=====
    if (method === 'pluginLogClear') {
      const ok = clearLogs();
      if (ok) appendLog('info', 'system', 'system.clear', '日志已由用户清空');
      return sendJson(res, 200, ok ? { ok: true } : { ok: false, error: '清空失败' });
    }
    // ===== 在文件管理器中定位日志文件 =====
    if (method === 'pluginLogReveal') {
      const file = logFilePath();
      // 🔴 先确认存在：explorer /select, 对不存在的路径不会报错，而是打开「我的文档」——
      // 用户看到窗口打开却定位不到，会以为功能坏了。这里显式告知。
      if (!existsSync(file)) {
        return sendJson(res, 200, { ok: false, error: '日志文件还不存在（尚无操作记录）', path: file });
      }
      try {
        const bin = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
        const args = process.platform === 'darwin' ? ['-R', file] : process.platform === 'win32' ? ['/select,', file] : [file];
        const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
        child.unref();
        return sendJson(res, 200, { ok: true, path: file });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // ===== 重置配置：删 overlay，回包内默认值 =====
    // 🔴 只删本插件自己的 overlay 文件（$DSH_HOME/baitong-market.json），
    //    不碰 profile 的 cordis.patch.yml、不碰 node_modules、不碰其他插件——这是「仅重置本插件」的边界。
    if (method === 'pluginResetConfig') {
      // 与其他写操作口径一致：只接受同源请求（面板走 POST）
      if (!trustedRestartRequest(req)) {
        return sendJson(res, 403, { ok: false, error: 'reset is limited to same-origin requests' });
      }
      try {
        rmSync(join(dshHome(), 'baitong-market.json'), { force: true });
        // 重置后的生效值 = 默认值（其中 apiBase 会优先吃 BAITONG_API_BASE 环境变量）
        // 必须走 assignConfig 全量覆盖，否则 npmRegistry / checkUpdatesOnStart 会残留旧值，
        // 表现为「界面说已重置、实际还在用旧镜像源」，且下一次保存会把旧值写回文件。
        assignConfig(cfg, { ...withDefaults({}) });
        /**
         * 🔴 必须同时清掉宿主侧残留的安装错误（2026-10-20）：
         * progress.error 只在"下一次安装开工"时被清（见本文件各处的 beginProgress）。
         * 用户点完重置后，pluginInstallStatus 仍把旧错误送回来，
         * 前端据此又渲染出「安装失败：…」——看起来就像重置没生效。
         * 重置是一次明确的状态复位，这条也必须复位。
         */
        progress.error = null;
        progress.lastLine = '';
        // 日志文件也一并删除（用户明确要求：重置要把日志清掉，而不是留一份旧记录）
        const logRemoved = removeLogFile();
        appendLog('warn', 'settings', 'settings.reset', '重置全部设置为默认值（仅本插件，不影响 DSH 及其他插件）'
          + (logRemoved ? '，已删除历史日志' : ''));
        return sendJson(res, 200, { ok: true, ...publicConfig(cfg) });
      } catch (err) {
        return sendJson(res, 200, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // ===== 配置 =====
    if (method === 'config') {
      if (body.save) {
        assignConfig(cfg, sanitizePatch(body));
        writeOverlay(cfg);
        appendLog('info', 'settings', 'settings.update', '保存设置：' + JSON.stringify(sanitizePatch(body)));
      }
      return sendJson(res, 200, { ok: true, ...publicConfig(cfg) });
    }

    // ===== 版本自检（面板头部版本号 + 更新提醒） =====
    if (method === 'pluginMeta') {
      // 三种触发时机（全部经由这里）：
      //   check=true  点升级前后的**硬刷新** —— 必须拿到当下的 latest，不能拿缓存当升级目标；
      //   open=true   用户打开面板 / 面板定时复查 —— 走 60s 软过期，发了新版重开面板即可看到；
      //   都不传       后台自查 —— 沿用 1 小时成功缓存 / 5 分钟失败缓存。
      // checkUpdatesOnStart=false 时 open 模式改为 skip（不联网，吃缓存）；
      // check=true（点升级前后）不受影响——那是用户显式动作
      const opts =
        body.check === true
          ? { force: true }
          : body.open === true
            ? cfg.checkUpdatesOnStart === false
              ? { skip: true }
              : { maxAgeMs: VERSION_TTL_OPEN }
            : {};
      return sendJson(res, 200, { ok: true, ...(await pluginVersionSnapshot(cfg, opts)) });
    }

    sendJson(res, 400, { ok: false, error: 'unknown method' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/* ==================== 版本自检：面板头部的版本号 + 更新提醒 ==================== */

/** 本插件自己的版本号：读包内 package.json（`lib/` 就在包根下一层，link 与 npm 安装都成立） */
const PKG_URL = new URL('../package.json', import.meta.url);
/** 自我升级用的包名（必须与 package.json 的 name 一致，readProfileDependenciesOf 按它查 spec） */
const SELF_PKG = '@baitongserver/dsh-plugin-market';
/** 拼进 pnpm 目标串的版本号白名单：防 `@1.2.3 && rm -rf` 这类注入（TARGET_RE 也允许 & | 等字符） */
const SELF_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** 本插件自己就是 npm 包，所以"线上最新版"直接问 registry；主源 + 镜像兜底，先成功者为准 */
const VERSION_SOURCES = [
  'https://registry.npmjs.org/@baitongserver/dsh-plugin-market/latest',
  'https://registry.npmmirror.com/@baitongserver/dsh-plugin-market/latest',
];

/**
 * 版本比较（只服务本插件自己的版本号，形如 `0.1.6` 或 `0.2.0-rc.1`）。
 *
 * 为什么不引 semver：本包保持**零 dependencies**（宿主提供 peer，不额外装东西），
 * 而这里只需要"谁新"这一个判断。规则照 semver：数字段逐位比；都相同则无预发布标识的一方更新；
 * 预发布段里数字标识 < 字母标识，纯数字段按数值比（避免 `rc.10 < rc.9` 这种字典序错误）。
 *
 * @returns >0 表示 a 更新，<0 表示 b 更新，0 表示相等
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core = '', pre = ''] = String(v || '').trim().replace(/^v/i, '').split('-', 2);
    return { core: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre: pre ? pre.split('.') : [] };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.core.length, y.core.length); i += 1) {
    const d = (x.core[i] || 0) - (y.core[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  if (x.pre.length === 0 && y.pre.length === 0) return 0;
  if (x.pre.length === 0) return 1;
  if (y.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1;
    if (pn) return -1;
    if (qn) return 1;
    return p > q ? 1 : -1;
  }
  return 0;
}

/** 本插件版本号；读不到（异常/裁剪过的包）返回空串，前端据此不渲染徽标 */
export function currentPluginVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(PKG_URL, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '';
  } catch {
    return '';
  }
}

export interface VersionSnapshot {
  current: string;
  latest: string;
  hasUpdate: boolean;
  source: string;
  checkedAt: number;
  error: string | null;
}

let versionCache: { at: number; value: VersionSnapshot } | null = null;
/** 命中缓存省一次外网请求；失败只缓存 5 分钟，别把一次网络抖动记成一小时 */
const VERSION_TTL_OK = 60 * 60 * 1000;
const VERSION_TTL_FAIL = 5 * 60 * 1000;
/**
 * **用户打开面板**时的软过期（2026-10-16 修）。
 *
 * 事故：成功结果缓存 1 小时 + 徽标只在挂载时查一次 ⇒ 发了新版后「点 X 关掉面板再进来」
 * 依然命中缓存，用户根本看不到更新提醒（只能等满 1 小时）。
 * 打开面板是明确的「现在就查一次」信号，所以给它一个很短的窗口：
 * 60s 内反复开关面板仍然吃缓存（不把 registry 打成筛子），超过就真查一次。
 */
const VERSION_TTL_OPEN = 60 * 1000;

/**
 * 面板头部用：当前版本 + 线上 latest + 是否有更新。
 * 🔴 网络失败**不影响面板**：返回 `error` 字段，前端只是不亮喇叭（不报错、不阻塞）。
 *
 * @param force    跳过缓存重新拉（点击"升级"前必须拿到**当下**的 latest，不能拿一小时前的缓存当目标版本）
 * @param maxAgeMs 自定义成功缓存的软过期（打开面板传 VERSION_TTL_OPEN）；不传 = 原来的 1 小时
 */
export async function pluginVersionSnapshot(
  cfg: BaitongConfig,
  opts: { force?: boolean; maxAgeMs?: number; skip?: boolean } = {},
): Promise<VersionSnapshot> {
  const now = Date.now();
  // skip（checkUpdatesOnStart=false 时的 open 模式）：不联网，有缓存吃缓存、没缓存只报 current
  if (opts.skip) {
    if (versionCache) return versionCache.value;
    return { current: currentPluginVersion(), latest: '', hasUpdate: false, source: '', checkedAt: now, error: null };
  }
  const maxAge = opts.force ? 0 : (opts.maxAgeMs ?? VERSION_TTL_OK);
  if (versionCache) {
    // 失败结果自己的 5 分钟上限仍然生效（但不会超过本次请求允许的软过期）
    const ttl = versionCache.value.error ? Math.min(VERSION_TTL_FAIL, maxAge) : maxAge;
    if (now - versionCache.at < ttl) return versionCache.value;
  }
  const current = currentPluginVersion();
  for (const url of VERSION_SOURCES) {
    try {
      const json = await fetchJson<{ version?: unknown }>(url, {
        timeoutMs: Math.min(cfg.timeoutMs, 8000),
        userAgent: cfg.userAgent,
      });
      const latest = typeof json?.version === 'string' ? json.version : '';
      if (!latest) continue;
      const value: VersionSnapshot = {
        current,
        latest,
        // 只有"线上确实更新"才亮提醒；本地比线上新（自测/预发布）不该提示
        hasUpdate: !!current && compareVersions(latest, current) > 0,
        source: new URL(url).host,
        checkedAt: now,
        error: null,
      };
      versionCache = { at: now, value };
      return value;
    } catch {
      /* 换下一个源 */
    }
  }
  const value: VersionSnapshot = { current, latest: '', hasUpdate: false, source: '', checkedAt: now, error: '版本检查失败' };
  versionCache = { at: now, value };
  return value;
}

/**
 * 图标地址归一化 —— 后端 logo 字段实测有两种形态（2026-10-16 生产数据，技能 100 条）：
 *   - 28 条 `https://btai-….cos.ap-beijing.myqcloud.com/…`（COS 外链，直接用）
 *   - 72 条 `/baitong_ai/static/skill-icons/icon-02.png`（**站内绝对路径，压根不是 http 开头**）
 * 第二种按 apiBase 补全后是可达的（实测 `https://s.1100111.cn/baitong_ai/static/skill-icons/icon-02.png`
 * → 200 + image/png 21KB），早期实现一律 `400 bad url` 会让**大多数**技能图标退化成首字，
 * 所以这里补全成绝对地址再交给代理。
 *
 * 🔴 姿态不变：仍然**只代理 https**（非 https 一律返回 null ⇒ 400 ⇒ 前端首字兜底）。
 * 这条是安全选择而非能力限制 —— 私有化部署若把 apiBase 配成 `http://`，图标会退化到首字，
 * 需要放开的话要连同这里一起改，别只改调用点。
 *
 * @param raw 后端原始 logo/avatarUrl 值，可能是空串、外链、站内绝对路径或相对路径
 * @param apiBase 当前生效的 API 根地址（含自建/私有化覆盖）
 * @returns 可代理的绝对 https 地址；无法归一化时 null
 */
export function resolveIconTarget(raw: string, apiBase: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  if (/^https:\/\//i.test(value)) return value;
  // 自带 scheme 的非 https（http: / data: / file: / javascript: …）一律拒绝
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  try {
    const base = `${String(apiBase || '').replace(/\/+$/, '')}/`;
    const resolved = new URL(value, base);
    return resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}

/**
 * 插件自带 logo：面板头部「百通插件广场」左侧的标识。
 *
 * 为什么不塞进 client.js 的 data URI：图片 28KB，base64 后 ~37KB 会让客户端 bundle
 * 从 115KB 涨到 150KB+，且每次换图都要重编 JS。走固定路径的本机端点，浏览器还能缓存。
 *
 * 文件名写死、无用户输入，不存在路径穿越面。
 */
const LOGO_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'baitong-logo.jpg');
let logoCache: Buffer | null = null;

export function handleLogo(_req: IncomingMessage, res: ServerResponse): void {
  try {
    if (logoCache === null) logoCache = readFileSync(LOGO_PATH);
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': String(logoCache.length),
      'cache-control': 'public, max-age=86400',
    });
    res.end(logoCache);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('logo not found');
  }
}

/** 图标代理：外链头像经本机转发（避免 DSH 前端直连外站；仅 https） */
export async function handleIcon(req: IncomingMessage, res: ServerResponse, cfg: BaitongConfig): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const target = resolveIconTarget(url.searchParams.get('url') || '', cfg.apiBase);
    if (target === null) {
      res.statusCode = 400;
      res.end('bad url');
      return;
    }
    const { body, contentType } = await fetchBytes(target, { timeoutMs: Math.min(cfg.timeoutMs, 15000), userAgent: cfg.userAgent });
    res.statusCode = 200;
    res.setHeader('content-type', contentType.startsWith('image/') ? contentType : 'image/png');
    res.setHeader('cache-control', 'public, max-age=3600');
    res.end(body);
  } catch (err) {
    res.statusCode = 502;
    res.end(err instanceof Error ? err.message : 'icon failed');
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as never));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function sendJson(res: ServerResponse, code: number, body: Record<string, unknown>): void {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

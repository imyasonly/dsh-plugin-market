/**
 * 本机 HTTP 服务：/baitong-market（广场面板轮询）与 /baitong-market/icon（图标代理）。
 * method 分发：按 method 分派到各端点；新增技能面板所需端点。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchBytes, proxyEnvSnapshot } from './http.js';
import { getBaitongSkillDetail, installBaitongSkill, installedSlugs, listInstalledSkills, readSkillLockEntry, searchBaitongSkills, uninstallBaitongSkill } from './skill-market.js';
import { PatchProbeUnavailableError, fetchInstallPlan, findPatchIdConflict, installBaitongPlugin, isPluginInstallBusy, listPluginCategories, listPlugins, parsePluginRef, readInstalledPluginMeta, readProfileDependencies, readProfileDependenciesOf, readInstalledPluginReadme, resolveInstallSource, uninstallBaitongPlugin, withPluginInstallLock } from './plugin-market.js';
import { BOOT_ID, currentProfile, progress, publicInstallStatus } from './dsh-cli.js';
import { assignConfig, publicConfig, sanitizePatch, writeOverlay } from './config-store.js';
import { detectRuntime, isRestartPending, markRestartPending, restartDesktopApp, scheduleRestart, servingPort, trustedRestartRequest } from './restart.js';
import type { BaitongConfig } from './config-store.js';
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
      const installed = await installedSlugs(cfg.skillsDir);
      const result = await searchBaitongSkills(query, { cfg, limit, offset, installed });
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
      const deps = readProfileDependencies();
      const items = deps.map((d) => ({
        spec: d.spec,
        ...(readInstalledPluginMeta(d.pkg, d.profiles) ?? {
          pkg: d.pkg,
          profile: d.profiles[0] ?? '',
          profiles: d.profiles,
          dsh: false,
        }),
      }));
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
      void (async () => {
        try {
          const result = await withPluginInstallLock(() => installBaitongPlugin({
            owner: body.owner ?? url.searchParams.get('owner'),
            name: body.name ?? url.searchParams.get('name'),
          }, cfg, profile));
          progress.error = null;
          progress.lastLine = `安装完成：${String(result.fullName)}（${profile} profile），重启 dsh ${profile} 后生效`;
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (progress.error === null) progress.error = text.slice(0, 800);
        }
      })();
      return sendJson(res, 200, { ok: true, started: true, source, profile, warning });
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
      void (async () => {
        try {
          const result = await withPluginInstallLock(() => uninstallBaitongPlugin(pkg, profile));
          progress.error = null;
          progress.lastLine = `已卸载：${String(result.pkg)}（${profile} profile），重启 dsh ${profile} 后生效`;
        } catch (err) {
          const text = err instanceof Error ? err.message : String(err);
          if (progress.error === null) progress.error = text.slice(0, 800);
        }
      })();
      return sendJson(res, 200, { ok: true, started: true, pkg, profile });
    }
    if (method === 'pluginInstallStatus') {
      return sendJson(res, 200, {
        ok: true,
        ...publicInstallStatus(),
        busy: isPluginInstallBusy() || progress.active,
        restart: true,
        boot: BOOT_ID,
        runtime: detectRuntime(),
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

    // ===== 配置 =====
    if (method === 'config') {
      if (body.save) {
        assignConfig(cfg, sanitizePatch(body));
        writeOverlay(cfg);
      }
      return sendJson(res, 200, { ok: true, ...publicConfig(cfg) });
    }

    sendJson(res, 400, { ok: false, error: 'unknown method' });
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

/** 图标代理：外链头像经本机转发（避免 DSH 前端直连外站；仅 https） */
export async function handleIcon(req: IncomingMessage, res: ServerResponse, cfg: BaitongConfig): Promise<void> {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const target = url.searchParams.get('url') || '';
    if (!/^https:\/\//i.test(target)) {
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

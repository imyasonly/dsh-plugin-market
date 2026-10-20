/**
 * 百通插件市场：目录查询 + install-plan 校验 + 安装执行。
 * 契约对齐 DSH 插件生态通用规范，数据源为百通公开 API：
 *   GET {apiBase}/api/bt/dsh/plugins            目录（q/category/sort/scope/page/page_size）
 *   GET {apiBase}/api/bt/dsh/plugins/categories  类目
 *   GET {apiBase}/api/bt/dsh/plugins/{owner}/{name}/install-plan  安装计划
 * 安全链：--force 拒绝 / 仅 web profile / GITHUB_PIN pinned 校验 / headSha 一致性 /
 *        loader id 冲突预检（防装完 dsh web 起不来）/ pnpm prepare 拦截自动重试。
 */
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchOpts } from './skill-market.js';
import { addDshPlugin, currentProfile, isSafeProfile, profileDir, removeDshPlugin } from './dsh-cli.js';
import { dshHome } from './config-store.js';
import { fetchBytes, fetchJson, HttpError } from './http.js';
import type { BaitongConfig } from './config-store.js';

/** 插件一级类目（key 与百通后管字典一致，共 7 类） */
export const PLUGIN_CATEGORIES: Record<string, string> = {
  'fun-dressup': '趣味换装',
  'web-tools': '联网工具',
  memory: '记忆',
  'agent-workflow': 'Agent 工作流',
  'model-inference': '模型推理',
  client: '客户端',
  'admin-security': '管理安全',
};
export const PLUGIN_CATEGORY_KEYS = Object.keys(PLUGIN_CATEGORIES);

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
const PKG_RE = /^(@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** 已安装依赖条目（按包名合并后的形态） */
export interface InstalledDependency {
  pkg: string;
  spec: string;
  profiles: string[];
  /**
   * GitHub owner/repo（仅 spec 为 github: 形式时存在）。
   * 插件市场的「最新版本」是按 owner/repo 索引的，npm 包名对不上 —— 没有它就查不了平台版本。
   */
  repo: string | null;
}

/** 已安装插件的展示元信息（读不到返回 null） */
export interface InstalledPluginMeta {
  pkg: string;
  profile: string;
  profiles: string[];
  name: string;
  version: string;
  description: string;
  homepage: string;
  dsh: boolean;
}

/** npm 包名合法性（卸载入参校验，拒绝路径穿越与空段） */
export function isSafePkgName(raw: unknown): boolean {
  const name = String(raw || '').trim();
  if (!name || name.length > 214) return false;
  if (!PKG_RE.test(name)) return false;
  return name.split('/').every((part) => part && part !== '.' && part !== '..');
}

export function parsePluginRef(owner: unknown, name: unknown): { owner: string; name: string; fullName: string } {
  const o = String(owner || '').trim();
  const n = String(name || '').trim();
  if (!OWNER_RE.test(o)) throw new Error('无效插件 owner');
  if (!NAME_RE.test(n)) throw new Error('无效插件 name');
  return { owner: o, name: n, fullName: `${o}/${n}` };
}

export function parsePluginCategory(raw: unknown): string | undefined {
  const key = String(raw || '').trim();
  if (!key) return undefined;
  return PLUGIN_CATEGORY_KEYS.includes(key) ? key : undefined;
}

function sanitizePluginSort(raw: unknown): 'stars' | 'updated' | 'installs' {
  return raw === 'updated' || raw === 'installs' ? raw : 'stars';
}

function trimBase(raw: string): string {
  return String(raw || '').replace(/\/$/, '');
}

function pluginPageSize(raw: unknown): number {
  const n = Math.floor(Number(raw) || 24);
  return Math.max(1, Math.min(100, n));
}

function pluginPage(raw: unknown): number {
  const n = Math.floor(Number(raw) || 1);
  return Math.max(1, n);
}

/** 目录 URL（scope=all 含仅展示插件；Agent 工具用 verified 只出可直装的） */
export function buildPluginsUrl(apiBase: string, query: Record<string, unknown> = {}): string {
  const params = new URLSearchParams();
  const q = String(query.q ?? '').trim();
  if (q) params.set('q', q);
  params.set('scope', query.scope === 'all' ? 'all' : 'verified');
  params.set('sort', sanitizePluginSort(query.sort));
  const category = parsePluginCategory(query.category);
  if (category) params.set('category', category);
  params.set('page', String(pluginPage(query.page)));
  params.set('page_size', String(pluginPageSize(query.pageSize)));
  return `${trimBase(apiBase)}/api/bt/dsh/plugins?${params.toString()}`;
}

export function pluginCategoriesUrl(apiBase: string): string {
  return `${trimBase(apiBase)}/api/bt/dsh/plugins/categories`;
}

export function installPlanUrl(apiBase: string, owner: string, name: string): string {
  const ref = parsePluginRef(owner, name);
  return `${trimBase(apiBase)}/api/bt/dsh/plugins/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}/install-plan`;
}

export function pluginDetailUrl(apiBase: string, owner: string, name: string): string {
  const ref = parsePluginRef(owner, name);
  return `${trimBase(apiBase)}/api/bt/dsh/plugins/getDetail/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.name)}`;
}

/** 目录项清洗（后端字段 → DSH 卡片契约字段；异常行直接丢弃） */
export function mapMarketPlugin(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  try {
    const ref = parsePluginRef(r.owner, r.name);
    const repo = String(r.repositoryUrl || '');
    const avatar = String(r.avatarUrl || '');
    return {
      owner: ref.owner,
      name: ref.name,
      fullName: String(r.fullName || ref.fullName).slice(0, 200),
      displayName: String(r.displayName || ref.name).slice(0, 100),
      description: String(r.description || '').slice(0, 500),
      stars: Number(r.stars) || 0,
      installs: Number(r.installs) || 0,
      categoryKey: parsePluginCategory(r.categoryKey) || '',
      installability: r.installability === 'verified' ? 'verified' : 'unsupported',
      repositoryUrl: /^https:\/\/github\.com\//i.test(repo) ? repo.slice(0, 300) : '',
      avatarUrl: /^https:\/\//i.test(avatar) && avatar.length <= 500 ? avatar : '',
      installed: false,
    };
  } catch {
    return null;
  }
}

// ==================== 已安装识别（web profile package.json） ====================

const GITHUB_PIN = /^github:([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100})#([0-9a-f]{7,40})$/i;
const GITHUB_REPO = /(?:^github:|^https:\/\/github\.com\/)([A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100})(?:\.git)?(?:#|$)/i;

export function githubRepoFromSpec(spec: unknown): string | null {
  const matched = GITHUB_REPO.exec(String(spec || '').trim());
  if (!matched) return null;
  return matched[1].replace(/\.git$/i, '').toLowerCase();
}

/** 从 github: 规格里取出 pinned commit sha（无 sha 的裸 github:owner/repo 返回空串） */
export function githubShaFromSpec(spec: unknown): string {
  const matched = GITHUB_PIN.exec(String(spec || '').trim());
  return matched ? matched[2].toLowerCase() : '';
}

/**
 * 读已安装插件（合并所有 profile 的 dependencies）。
 * 桌面端与 web 端各自 profile，用户装在 desktop 的插件在 web 面板也要显示"已安装"，
 * 所以这里取并集而不是只看某一个 profile。
 */
export function readInstalledPlugins(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readProfileDependencies()) out[entry.pkg] = entry.spec;
  return out;
}

/**
 * 读所有 profile 的依赖条目，**按包名合并**。
 * 同一个包可能同时装在 desktop 与 web 两个 profile（例如本插件自身），
 * 合并成一条并保留 profiles 列表，避免「已安装」视图出现重复卡片 / 计数虚高。
 */
export function readProfileDependencies(): InstalledDependency[] {
  const byPkg = new Map<string, InstalledDependency>();
  const profilesDir = join(dshHome(), 'profiles');
  try {
    for (const name of readdirSync(profilesDir)) {
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) continue;
      try {
        const raw = JSON.parse(readFileSync(join(profilesDir, name, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, unknown>;
        };
        if (!raw.dependencies || typeof raw.dependencies !== 'object') continue;
        for (const [pkg, spec] of Object.entries(raw.dependencies)) {
          if (typeof spec !== 'string' || spec === '') continue;
          const hit = byPkg.get(pkg);
          if (hit) {
            if (!hit.profiles.includes(name)) hit.profiles.push(name);
            continue;
          }
          byPkg.set(pkg, { pkg, spec, profiles: [name], repo: githubRepoFromSpec(spec) });
        }
      } catch {
        /* 跳过坏 profile */
      }
    }
  } catch {
    /* profiles 目录不存在 */
  }
  return [...byPkg.values()].sort((a, b) => a.pkg.localeCompare(b.pkg));
}

/** 读单个 profile 的依赖（卸载前的归属校验用） */
export function readProfileDependenciesOf(profile: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readProfileDependencies()) {
    if (entry.profiles.includes(profile)) out[entry.pkg] = entry.spec;
  }
  return out;
}

/** 读已安装插件的展示元信息（name/version/description/dsh 标记），读不到就返回 null */
export function readInstalledPluginMeta(
  pkg: string,
  profiles: string[] | string,
): InstalledPluginMeta | null {
  const list = Array.isArray(profiles) ? profiles : [profiles];
  for (const profile of list) {
    try {
      const dir = join(dshHome(), 'profiles', profile, 'node_modules', ...pkg.split('/'));
      const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
      return {
        pkg,
        profile,
        profiles: list,
        name: typeof raw.name === 'string' ? raw.name : pkg,
        version: typeof raw.version === 'string' ? raw.version : '',
        description: typeof raw.description === 'string' ? raw.description : '',
        homepage: typeof raw.homepage === 'string' ? raw.homepage : '',
        dsh: 'dsh' in raw,
      };
    } catch {
      /* 换下一个 profile 试 */
    }
  }
  return null;
}

function packageNameMatches(pkg: string, plugin: Record<string, unknown>): boolean {
  const lower = pkg.toLowerCase();
  const name = String(plugin.name).toLowerCase();
  if (lower === name) return true;
  if (lower === `@${String(plugin.owner).toLowerCase()}/${name}`) return true;
  const bare = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  return bare === name;
}

export function isMarketPluginInstalled(plugin: Record<string, unknown>, installed: Record<string, string>): boolean {
  const aliases = new Set([
    `${plugin.owner}/${plugin.name}`.toLowerCase(),
    String(plugin.fullName).toLowerCase(),
  ]);
  const fromUrl = githubRepoFromSpec(plugin.repositoryUrl);
  if (fromUrl) aliases.add(fromUrl);
  let npmNameHit = false;
  for (const [pkg, spec] of Object.entries(installed)) {
    const repo = githubRepoFromSpec(spec);
    if (repo && aliases.has(repo)) return true;
    if (packageNameMatches(pkg, plugin)) {
      if (repo && !aliases.has(repo)) continue;
      npmNameHit = true;
    }
  }
  return npmNameHit;
}

// ==================== loader id 冲突预检 ====================

/** 从 cordis.patch.yml 文本提取条目 id（只认 `- id:` 行，不解析完整 YAML） */
export function patchEntryIds(yaml: string): string[] {
  const ids: string[] = [];
  for (const m of String(yaml || '').matchAll(/^[ \t]*-[ \t]*id:[ \t]*['"]?([A-Za-z0-9@._/-]+)['"]?[ \t]*$/gm)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** 收集已装包声明的 loader id → 持有包名（扫所有 profile，桌面端与 web 端都算） */
export function collectInstalledPatchIds(): Map<string, string> {
  const out = new Map<string, string>();
  const profilesDir = join(dshHome(), 'profiles');
  let names: string[] = [];
  try {
    names = readdirSync(profilesDir);
  } catch {
    return out;
  }
  for (const profile of names) {
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(profile)) continue;
    const dir = join(profilesDir, profile);
    for (const pkg of Object.keys(readInstalledPlugins())) {
      if (out.has(pkg)) continue;
      try {
        const raw = readFileSync(join(dir, 'node_modules', pkg, 'cordis.patch.yml'), 'utf8');
        for (const id of patchEntryIds(raw)) if (!out.has(id)) out.set(id, pkg);
      } catch {
        // 该包没有 cordis.patch.yml，不参与组合
      }
    }
  }
  return out;
}

/**
 * 预检不可用：拉待装仓库的 `cordis.patch.yml`（GitHub raw）时网络不可达。
 * 这只是"防呆"检查（防装完宿主起不来），拿不到远端文件 ≠ 有冲突 ——
 * 上层应降级放行（继续安装并告警），而不是把安装整个堵死：
 * 安装本身走 pnpm/git，有各自的代理与网络路径，未必和 Node fetch 同命运。
 */
export class PatchProbeUnavailableError extends Error {
  constructor(public readonly detail: string) {
    super(detail);
    this.name = 'PatchProbeUnavailableError';
  }
}

/** 拉待装仓库根部的 cordis.patch.yml 条目 id（404 = 无文件，返回空） */
export async function fetchPatchIdsFromSource(source: string, cfg: BaitongConfig): Promise<string[]> {
  const pin = GITHUB_PIN.exec(String(source || '').trim());
  if (!pin) return [];
  const url = `https://raw.githubusercontent.com/${pin[1]}/${pin[2]}/cordis.patch.yml`;
  try {
    const { body } = await fetchBytes(url, fetchOpts(cfg));
    return patchEntryIds(body.toString('utf8'));
  } catch (err) {
    if (err instanceof HttpError && /^HTTP 404/.test(err.message)) return [];
    throw new PatchProbeUnavailableError(err instanceof Error ? err.message : String(err));
  }
}

/**
 * loader id 冲突预检：两 bundle 声明相同 id 时宿主重启会拒绝整个插件树（dsh web 起不来）。
 * 安装前拦下，避免把宿主打进无法启动的状态。返回 null = 无冲突。
 */
export async function findPatchIdConflict(source: string, cfg: BaitongConfig): Promise<{ id: string; holder: string } | null> {
  const incoming = await fetchPatchIdsFromSource(source, cfg);
  if (!incoming.length) return null;
  const installed = collectInstalledPatchIds();
  const installedSpecs = readInstalledPlugins();
  const sourceRepo = githubRepoFromSpec(source);
  for (const id of incoming) {
    const holder = installed.get(id);
    if (!holder) continue;
    // 同仓库重装/升级不冲突（pnpm 覆盖同一份依赖）
    const holderRepo = githubRepoFromSpec(installedSpecs[holder] || '');
    if (holderRepo && sourceRepo && holderRepo === sourceRepo) continue;
    return { id, holder };
  }
  return null;
}

// ==================== 安装链 ====================

/**
 * 批量查询一组 npm 包的线上 latest 版本（已安装列表的「可更新」标签用）。
 *
 * 只处理 registry 形态的 spec（pnpm/git/link/file 源没有 latest 概念，跳过）；
 * registry 主源失败换镜像源；单包失败不影响其余（返回表里就是没有该键）。
 * 并发数控制在 6：已安装插件通常 <20 个，registry 顶得住，也不会拖慢面板。
 */
export async function fetchLatestVersions(
  pkgs: string[],
  cfg: BaitongConfig,
): Promise<Record<string, string>> {
  const REGISTRY_RE = /^(?:[\w@.-]+\/)?[\w.-]+$/;
  const targets = [...new Set(pkgs.map((p) => p.trim()).filter(Boolean))].slice(0, 60);
  const results: Record<string, string> = {};
  const queue = [...targets];
  const worker = async () => {
    for (;;) {
      const pkg = queue.shift();
      if (pkg === undefined) return;
      if (!REGISTRY_RE.test(pkg)) continue;
      for (const base of ['https://registry.npmjs.org', 'https://registry.npmmirror.com']) {
        try {
          const json = await fetchJson<{ version?: unknown }>(
            `${base}/${encodeURIComponent(pkg).replace(/%40/gi, '@').replace(/%2f/gi, '/')}/latest`,
            { timeoutMs: Math.min(cfg.timeoutMs, 8000), userAgent: cfg.userAgent },
          );
          const v = typeof json?.version === 'string' ? json.version : '';
          if (v) { results[pkg] = v; break; }
        } catch { /* 换下一个源 */ }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return results;
}

/** 已装 spec 是 registry 形态（非 github/git+/link/file/workspace）才有「线上 latest」可比 */
export function isRegistrySpec(spec: string): boolean {
  return !!spec && !/^(?:github:|git\+|git:|link:|file:|workspace:|https?:)/i.test(spec.trim());
}

/* ==================== 平台版本检查（GitHub 源插件的更新依据） ==================== */

/** 单个已装插件在平台上的版本信息 */
export interface PlatformVersionInfo {
  /** 平台上架插件当前生效的版本号（取自 pinned_sha 对应的版本行 version_label） */
  latest: string;
  /** 平台同步用的 commit sha —— 与 profile 里装的 sha 比对即知要不要更新 */
  sha: string;
}

/**
 * 批量查询一批 GitHub 插件在**插件平台**上的最新版本。
 *
 * 为什么不能只查 npm：平台收录的插件准则来自 GitHub 仓库（见平台 BtDshPluginDiscoveryJob /
 * BtDshPluginVersionCheckJob 按 Release 推进），安装源也是 `github:owner/repo#sha`，
 * 大量插件根本没往 npm publish。只查 npm registry 会让这些插件永远显示"已是最新"。
 *
 * 走平台批量接口 `POST {apiBase}/api/bt/dsh/plugins/version-check`（body: {fullNames[]}），
 * 一次拿回全部；旧平台没有该接口时回落到逐仓库 `GET .../versions/{owner}/{name}`。
 *
 * 失败语义：整批失败返回空表（前端不亮"可更新"），单仓库未收录同样不在表里。
 *
 * @param repos GitHub 全名列表（`owner/repo`）
 */
export async function fetchPlatformVersions(
  repos: string[],
  cfg: BaitongConfig,
): Promise<Record<string, PlatformVersionInfo>> {
  const unique = [...new Set(repos.map((r) => String(r || '').trim()).filter(Boolean))].slice(0, 60);
  if (unique.length === 0) return {};
  const valid = unique.filter((repo) => PLATFORM_REPO_RE.test(repo));
  if (valid.length === 0) return {};
  const opts = { timeoutMs: Math.min(cfg.timeoutMs, 8000), userAgent: cfg.userAgent };
  const base = trimBase(cfg.apiBase);

  // ① 批量接口（平台 2026-10-20 新增）：一次请求拿全
  try {
    const json = await fetchJson<unknown>(`${base}/api/bt/dsh/plugins/version-check`, {
      ...opts,
      method: 'POST',
      body: JSON.stringify({ fullNames: valid }),
      headers: { 'content-type': 'application/json' },
    });
    const rows = unwrapR<unknown>(json, {});
    if (rows && typeof rows === 'object' && !Array.isArray(rows)) {
      const out: Record<string, PlatformVersionInfo> = {};
      for (const [repo, raw] of Object.entries(rows as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object' || !PLATFORM_REPO_RE.test(repo)) continue;
        const label = String(((raw as Record<string, unknown>).versionLabel ?? '') as string).trim();
        const sha = String(((raw as Record<string, unknown>).sha ?? '') as string).trim();
        if (!label && !sha) continue;
        out[repo] = { latest: label, sha };
      }
      // 收录数为 0 也可能真的是"都没收录"，不能据此判定接口不存在；
      // 是否回落到单仓库渠道由调用方策略决定，这里始终以本结果为基准。
      return out;
    }
  } catch {
    /* 老平台没有批量接口（404/403/HTML）：回落到逐仓库渠道 */
  }

  // ② 旧平台回落：逐仓库查版本历史，取首行（平台按创建时间推进）
  const out: Record<string, PlatformVersionInfo> = {};
  const queue = [...valid];
  const worker = async () => {
    for (;;) {
      const repo = queue.shift();
      if (repo === undefined) return;
      const matched = PLATFORM_REPO_RE.exec(repo);
      if (!matched) continue;
      const url = `${base}/api/bt/dsh/plugins/versions/${encodeURIComponent(matched[1])}/${encodeURIComponent(matched[2])}`;
      try {
        const json = await fetchJson<unknown>(url, opts);
        const rows = unwrapR<unknown>(json, []);
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const top = rows[0];
        if (!top || typeof top !== 'object') continue;
        const label = String(((top as Record<string, unknown>).versionLabel ?? '') as string).trim();
        const sha = String(((top as Record<string, unknown>).sha ?? '') as string).trim();
        if (!label && !sha) continue;
        out[repo] = { latest: label, sha };
      } catch {
        /* 平台不可达/未收录：留空，不阻断其余仓库 */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

/** 平台版本接口入参格式：owner/repo（owner 与 repo 都用 GitHub 合法字符） */
const PLATFORM_REPO_RE = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})$/;

/** install-plan 校验：只校验 DSH 执行边界，不替市场内插件规定来源。 */
export function resolveInstallSource(raw: unknown, expected: { owner: string; name: string; fullName: string }): string {
  if (!raw || typeof raw !== 'object') throw new Error('安装计划无效');
  const plan = raw as Record<string, unknown>;
  const command = String(plan.command || '').trim();
  if (/(?:^|\s)--force(?:\s|$)/.test(command) || /(?:^|\s)-f(?:\s|$)/.test(command)) throw new Error('拒绝带 --force 的安装计划');
  const profile = String(plan.profile || 'web').trim() || 'web';
  if (profile !== 'web') throw new Error('仅支持 web profile');
  let source = String(plan.source || '').trim();
  if (!source && command) {
    const matched = /\bdsh\s+plugin\s+--profile\s+web\s+add\s+(\S+)/i.exec(command);
    if (!matched) throw new Error('安装计划没有可用的 source');
    source = matched[1];
  }
  // 各插件可使用 npm、github、git、URL、file/link 等 DSH 支持的安装规格。
  if (!source || source.length > 2000 || /[\"'&|<>^()%!`\r\n]/.test(source) || source.startsWith('-')) throw new Error('安装计划 source 不是安全的单一安装规格');
  const expectedRepo = `${expected.owner}/${expected.name}`;
  const plugin = (plan.plugin && typeof plan.plugin === 'object' ? plan.plugin : {}) as Record<string, unknown>;
  const fullName = String(plugin.fullName || '').trim();
  if (fullName && fullName.toLowerCase() !== expectedRepo.toLowerCase() && fullName.toLowerCase() !== expected.fullName.toLowerCase()) throw new Error('安装计划 fullName 与所选插件不一致');
  const pin = GITHUB_PIN.exec(source);
  if (pin) {
    if (pin[1].toLowerCase() !== expectedRepo.toLowerCase()) throw new Error('安装计划仓库与所选插件不一致');
    const headSha = String(plugin.headSha || '').trim();
    if (headSha) {
      const a = headSha.toLowerCase();
      const b = pin[2].toLowerCase();
      if (!a.startsWith(b) && !b.startsWith(a)) throw new Error('安装计划 commit 与 source 不一致');
    }
  }
  return source;
}

/**
 * 百通后端统一 R 包装：{ code: 200, msg, data: {...} }。
 * 必须解包到 data 才能取到 items/total 等字段，否则一律读到 undefined（表现为空列表）。
 * 与 skill-market.ts 的 unwrapR 同实现。
 */
function unwrapR<T>(body: unknown, fallback: T): T {
  if (body && typeof body === 'object') {
    const r = body as Record<string, unknown>;
    if ('data' in r) return (r.data ?? fallback) as T;
  }
  return body as T;
}

export async function fetchInstallPlan(cfg: BaitongConfig, owner: string, name: string): Promise<unknown> {
  const ref = parsePluginRef(owner, name);
  const raw = await fetchJson(installPlanUrl(cfg.apiBase, ref.owner, ref.name), fetchOpts(cfg));
  return unwrapR<Record<string, unknown>>(raw, {});
}

/** 安装入口：install-plan → 校验 → 冲突预检 → dsh plugin add（默认装到当前 profile） */
export async function installBaitongPlugin(
  plugin: { owner: unknown; name: unknown },
  cfg: BaitongConfig,
  profile = currentProfile(),
): Promise<Record<string, unknown>> {
  const ref = parsePluginRef(plugin.owner, plugin.name);
  const plan = await fetchInstallPlan(cfg, ref.owner, ref.name);
  const source = resolveInstallSource(plan, ref);
  const conflict = await findPatchIdConflict(source, cfg);
  if (conflict) {
    throw new Error(`插件加载 id「${conflict.id}」与已安装的 ${conflict.holder} 冲突，继续安装会让 DSH 无法启动，已拒绝。请先卸载 ${conflict.holder}。`);
  }
  const log = await addDshPlugin(source, profile);
  return {
    fullName: ref.fullName,
    source,
    profile,
    restartedHint: true,
    log: log.slice(-4000),
  };
}

/**
 * 卸载已安装插件。
 * 归属校验：包名必须合法，且确实出现在目标 profile 的 dependencies 里 ——
 * 否则 `dsh plugin remove` 会去动一个不属于该 profile 的包。
 */
export async function uninstallBaitongPlugin(
  pkgRaw: unknown,
  profileRaw: unknown,
): Promise<Record<string, unknown>> {
  const pkg = String(pkgRaw || '').trim();
  if (!isSafePkgName(pkg)) throw new Error(`无效插件包名: ${pkg}`);
  const profile = String(profileRaw || '').trim() || currentProfile();
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  const deps = readProfileDependenciesOf(profile);
  if (!(pkg in deps)) {
    throw new Error(`${profile} profile 未安装 ${pkg}，无法卸载`);
  }
  try {
    const log = await removeDshPlugin(pkg, profile);
    return { pkg, profile, removed: true, log: log.slice(-4000), fallback: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/cannot resolve profile bundle|cannot resolve package|profile bundle/i.test(message)) throw err;
    const dir = join(dshHome(), 'profiles', profile);
    const packageFile = join(dir, 'package.json');
    const raw = JSON.parse(readFileSync(packageFile, 'utf8')) as Record<string, unknown>;
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const deps = raw[section];
      if (deps && typeof deps === 'object') delete (deps as Record<string, unknown>)[pkg];
    }
    writeFileSync(packageFile, JSON.stringify(raw, null, 2) + '\n');
    rmSync(join(dir, 'node_modules', ...pkg.split('/')), { recursive: true, force: true });
    return { pkg, profile, removed: true, fallback: true, log: `清理残留依赖：${message}` };
  }
}

/** README 只读预览的字节上限，超过即截断并标记 truncated */
export const README_MAX_BYTES = 64 * 1024;
const README_FILES = ['README.md', 'README.markdown', 'README'];

/**
 * 读已安装插件的 README 文本（只读预览）。
 * pkg 必须来自该 profile 的依赖 —— 不接受任意路径，避免越界读取。
 */
export function readInstalledPluginReadme(
  pkgRaw: unknown,
  profileRaw: unknown,
): { pkg: string; profile: string; name: string; readme: string; truncated: boolean } {
  const pkg = String(pkgRaw || '').trim();
  if (!isSafePkgName(pkg)) throw new Error(`无效插件包名: ${pkg}`);
  const profile = String(profileRaw || '').trim() || currentProfile();
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  const deps = readProfileDependenciesOf(profile);
  if (!(pkg in deps)) throw new Error(`${profile} profile 未安装 ${pkg}`);
  const dir = join(dshHome(), 'profiles', profile, 'node_modules', ...pkg.split('/'));
  let name = pkg;
  try {
    const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
    if (typeof meta.name === 'string' && meta.name.trim()) name = meta.name.trim();
  } catch {
    /* 无 package.json 时退回 pkg 名 */
  }
  for (const file of README_FILES) {
    try {
      const buf = readFileSync(join(dir, file));
      const truncated = buf.byteLength > README_MAX_BYTES;
      return {
        pkg,
        profile,
        name,
        readme: buf.subarray(0, README_MAX_BYTES).toString('utf8'),
        truncated,
      };
    } catch {
      /* 试下一个候选文件名 */
    }
  }
  return { pkg, profile, name, readme: '', truncated: false };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== 目录查询 ====================

/** Agent 工具用：offset/limit → page/pageSize（含页内 skip，offset 未对齐时绝不重复返回） */
export function pluginPaging(offset: unknown, limit: unknown, fallbackLimit: number): { page: number; pageSize: number; offset: number; skip: number } {
  const off = Math.max(0, Math.floor(Number(offset) || 0));
  const explicit = Math.floor(Number(limit));
  const size = Number.isFinite(explicit) && explicit > 0 ? Math.min(100, explicit) : Math.max(1, Math.floor(fallbackLimit) || 24);
  return { page: Math.floor(off / size) + 1, pageSize: size, offset: off, skip: off % size };
}

export async function listPlugins(cfg: BaitongConfig, query: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const url = buildPluginsUrl(cfg.apiBase, query);
  const body = unwrapR<Record<string, unknown>>(await fetchJson(url, fetchOpts(cfg)), {});
  const installedMap = readInstalledPlugins();
  const items = ((body.items as unknown[]) || [])
    .map(mapMarketPlugin)
    .filter((it): it is Record<string, unknown> => !!it)
    .map((it) => ({ ...it, installed: isMarketPluginInstalled(it, installedMap) }));
  return {
    items,
    total: Number(body.total) || items.length,
    page: Number(body.page) || pluginPage(query.page),
    pageSize: Number(body.pageSize) || pluginPageSize(query.pageSize),
    apiBase: trimBase(cfg.apiBase),
  };
}

/** 聊天内插件搜索（Agent 工具入口）：offset 翻页 + 已安装标注（signal 由 http 层透传） */
export async function searchBaitongPlugins(cfg: BaitongConfig, opts: Record<string, unknown> = {}, _signal?: AbortSignal | null): Promise<Record<string, unknown>> {
  const paging = pluginPaging(opts.offset, opts.limit, cfg.maxResults);
  const page = await listPlugins(cfg, {
    q: opts.q,
    scope: 'verified',
    category: opts.category,
    sort: opts.sort,
    page: paging.page,
    pageSize: paging.pageSize,
  });
  const pageItems = (Array.isArray(page.items) ? page.items : []) as Record<string, unknown>[];
  const items = paging.skip > 0 ? pageItems.slice(paging.skip) : pageItems;
  return {
    query: String(opts.q || '').trim(),
    category: parsePluginCategory(opts.category),
    sort: sanitizePluginSort(opts.sort),
    items,
    total: page.total,
    offset: paging.offset,
    hasMore: paging.offset + items.length < Number(page.total),
  };
}

export async function listPluginCategories(cfg: BaitongConfig): Promise<Record<string, unknown>> {
  try {
    const body = unwrapR<Record<string, unknown>>(
      await fetchJson(pluginCategoriesUrl(cfg.apiBase), fetchOpts(cfg)),
      {},
    );
    const raw = body.items;
    const items = (Array.isArray(raw) ? raw : [])
      .map((it): { key: string; displayName: string } | null => {
        if (!it || typeof it !== 'object') return null;
        const key = parsePluginCategory((it as Record<string, unknown>).key);
        if (!key) return null;
        const displayName = String((it as Record<string, unknown>).displayName || PLUGIN_CATEGORIES[key] || key).trim().slice(0, 40);
        return { key, displayName: displayName || PLUGIN_CATEGORIES[key] };
      })
      .filter((it): it is { key: string; displayName: string } => !!it);
    if (items.length) return { items };
  } catch {
    // 后端类目接口异常时回退内置 7 类
  }
  return { items: PLUGIN_CATEGORY_KEYS.map((key) => ({ key, displayName: PLUGIN_CATEGORIES[key] })) };
}

// ==================== 安装互斥锁（串行化安装，防 pnpm 并发写坏 lockfile） ====================

let installChain: Promise<unknown> = Promise.resolve();
let installBusy = 0;

export function isPluginInstallBusy(): boolean {
  return installBusy > 0;
}

export function withPluginInstallLock<T>(fn: () => Promise<T>): Promise<T> {
  const guarded = async () => {
    installBusy += 1;
    try {
      return await fn();
    } finally {
      installBusy -= 1;
    }
  };
  const run = installChain.then(guarded, guarded);
  installChain = run.then(() => undefined, () => undefined);
  return run as Promise<T>;
}

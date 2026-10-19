/**
 * 百通技能市场：搜索/详情/安装/列表/卸载。
 * 数据源复用百通已上线的 AiSkillHub CLI 兼容接口（BtSkillCliController）：
 *   GET {apiBase}/api/v1/search?q=&offset=&limit=      搜索（公共技能 + 团队技能合并去重）
 *   GET {apiBase}/api/v1/skills/{slug}                 详情（含 download_url COS 预签名）
 *   GET {apiBase}/api/v1/download?slug=                下载（302 → COS 预签名 zip）
 * 安装：zip 下载 → 解压（拒绝路径穿越）→ 必须含 SKILL.md → 落 skillsDir → 写 lockfile。
 */
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fetchBytes, fetchJson, HttpError } from './http.js';
import type { BaitongConfig } from './config-store.js';
import { unzipToDir } from './unzip.js';

/**
 * 技能页分类 Tab（2026-10-19）：百通技能库的服务端分类，id 即查询入参 categoryId。
 * 目前就这三类；后端新增分类时在此补一行即可（前端胶囊从 skillSearch 响应里拿）。
 */
export const SKILL_CATEGORY_TABS: { id: string; name: string }[] = [
  { id: '2059122609146032129', name: '医疗' },
  { id: '2059192712453611521', name: '医药' },
  { id: '2059441305076809730', name: '大健康' },
];

/** 技能分类（对齐百通技能库的分类展示口径；不参与接口过滤，仅卡片标签） */
export const SKILL_CATEGORIES: Record<string, string> = {
  efficiency: '效率办公',
  writing: '文案写作',
  data: '数据分析',
  medical: '医药健康',
  marketing: '营销获客',
  education: '教育培训',
  other: '其他',
};
export const SKILL_CATEGORY_KEYS = Object.keys(SKILL_CATEGORIES);

export function categoryLabel(key: string): string {
  return SKILL_CATEGORIES[key] ?? key;
}

export function parseSkillCategory(raw: unknown): string | undefined {
  const key = String(raw || '').trim();
  if (!key) return undefined;
  return SKILL_CATEGORY_KEYS.includes(key) ? key : undefined;
}

export function fetchOpts(cfg: BaitongConfig): { timeoutMs: number; userAgent: string } {
  return { timeoutMs: cfg.timeoutMs, userAgent: cfg.userAgent };
}

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/;

export function parseSlug(raw: unknown): string {
  const slug = String(raw || '').trim();
  if (!SLUG_RE.test(slug)) throw new Error(`无效 slug: ${slug}`);
  return slug;
}

function trimBase(raw: string): string {
  return String(raw || '').replace(/\/$/, '');
}

// ==================== 搜索 ====================

/** R<...> 响应解包：{code:200, data:...} 直接取 data；非标准形态原样返回 */
function unwrapR<T>(body: unknown, fallback: T): T {
  if (body && typeof body === 'object') {
    const r = body as Record<string, unknown>;
    if ('data' in r) return (r.data ?? fallback) as T;
  }
  return body as T;
}

export interface SkillSearchOpts {
  cfg: BaitongConfig;
  category?: string;
  /** 服务端分类 ID（SKILL_CATEGORY_TABS 之一）：传给后端的 categoryId 查询参数 */
  categoryId?: string;
  limit: number;
  offset: number;
  installed: Set<string>;
  signal?: AbortSignal | null;
}

export async function searchBaitongSkills(query: string, opts: SkillSearchOpts): Promise<Record<string, unknown>> {
  const { cfg, limit, offset, installed } = opts;
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (opts.categoryId && /^d{1,32}$/.test(opts.categoryId)) params.set('categoryId', opts.categoryId);
  params.set('offset', String(offset));
  params.set('limit', String(Math.min(limit, 100)));
  const url = `${trimBase(cfg.apiBase)}/api/v1/search?${params.toString()}`;

  const body = await fetchJson(url, { ...fetchOpts(cfg), signal: opts.signal ?? null });
  const data = unwrapR<{ total?: number; results?: unknown[] }>(body, { total: 0, results: [] });
  const results = Array.isArray(data.results) ? data.results : [];
  interface SkillCard {
    slug: string;
    name: string;
    summary: string;
    version: string;
    category: string;
    tags: string;
    logo: string;
    downloadCount: number;
    rating: number | null;
    installed: boolean;
  }
  const items = results.map((raw): SkillCard | null => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const slug = String(r.slug || '');
    if (!SLUG_RE.test(slug)) return null;
    return {
      slug,
      name: String(r.name || slug).slice(0, 100),
      summary: String(r.summary || r.description || '').slice(0, 300),
      version: String(r.version || ''),
      category: String(r.category || ''),
      tags: String(r.tags || ''),
      logo: String(r.logo || ''),
      downloadCount: Number(r.downloadCount) || 0,
      rating: r.rating != null ? Number(r.rating) : null,
      installed: installed.has(slug),
    };
  }).filter((it): it is SkillCard => !!it);
  const total = Number(data.total) || items.length;
  return {
    query,
    items,
    total,
    offset,
    hasMore: offset + items.length < total,
    // 分类 Tab 一并带出（前端不用写死，加分类改宿主一处即可）
    categories: SKILL_CATEGORY_TABS,
  };
}

// ==================== 安装 ====================

export async function installBaitongSkill(slugRaw: string, cfg: BaitongConfig, signal?: AbortSignal | null): Promise<Record<string, unknown>> {
  const slug = parseSlug(slugRaw);
  // ① 详情拿 download_url（COS 预签名）
  const detailUrl = `${trimBase(cfg.apiBase)}/api/v1/skills/${encodeURIComponent(slug)}`;
  const detailBody = await fetchJson(detailUrl, { ...fetchOpts(cfg), signal });
  const detail = unwrapR<Record<string, unknown>>(detailBody, {});
  const downloadUrl = String(detail.download_url || '');
  if (!/^https?:\/\//i.test(downloadUrl)) {
    throw new Error('该技能暂无下载包（download_url 为空），无法安装');
  }
  // ② 下载 zip
  const { body } = await fetchBytes(downloadUrl, { timeoutMs: Math.max(cfg.timeoutMs, 120000), userAgent: cfg.userAgent, signal });
  // ③ 解压到临时目录 → 校验 SKILL.md → 移入 skillsDir
  const tmpDir = join(tmpdir(), `baitong-skill-${slug}-${Date.now()}`);
  const zipPath = `${tmpDir}.zip`;
  await pipeline(Readable.from(body), createWriteStream(zipPath));
  try {
    const extractDir = join(tmpDir, 'x');
    mkdirSync(extractDir, { recursive: true });
    const entries = await unzipToDir(zipPath, extractDir);
    // 扁平化单一顶层目录（对齐 AiSkillHub 包规范）
    let srcDir = extractDir;
    const top = readdirSync(extractDir);
    if (top.length === 1) {
      const only = join(extractDir, top[0]);
      if (statSync(only).isDirectory()) srcDir = only;
    }
    if (!existsSync(join(srcDir, 'SKILL.md'))) {
      throw new Error('技能包缺少 SKILL.md，视为无效包');
    }
    if (!entries.length) throw new Error('技能包为空');
    // ④ 落位：覆盖式安装（先删旧目录再移入）
    const destDir = join(cfg.skillsDir, slug);
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(cfg.skillsDir, { recursive: true });
    await pipeline(Readable.from(readFileSync(zipPath)), (await import('node:fs')).createWriteStream('/dev/null')).catch(() => undefined);
    // 直接移动解压结果（跨设备时退化为复制语义由 rename 的异常兜底为逐文件复制）
    try {
      const { renameSync } = await import('node:fs');
      mkdirSync(cfg.skillsDir, { recursive: true });
      renameSync(srcDir, destDir);
    } catch {
      copyDirSync(srcDir, destDir);
    }
    // ⑤ 写 lockfile（升级判断用 _meta.json.version）
    writeLockfile(cfg.skillsDir, slug, String(detail.version || ''), detail);
    return {
      slug,
      name: String(detail.name || slug),
      version: String(detail.version || ''),
      path: destDir,
      installed: true,
    };
  } finally {
    for (const dir of [tmpDir]) {
      try {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      } catch { /* 清理失败不阻塞 */ }
    }
    try {
      if (existsSync(zipPath)) rmSync(zipPath, { force: true });
    } catch { /* 同上 */ }
  }
}

function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    const from = join(src, name);
    const to = join(dest, name);
    if (statSync(from).isDirectory()) copyDirSync(from, to);
    else {
      // 🔴 必须静态 import（同 unzip.ts）：ESM 产物里没有 `require` 全局，
      // 裸 require 抛 ReferenceError ⇒ 技能安装失败。
      copyFileSync(from, to);
    }
  }
}

function lockfilePath(skillsDir: string): string {
  return join(skillsDir, '.skills_store_lock.json');
}

function writeLockfile(skillsDir: string, slug: string, version: string, detail: Record<string, unknown>): void {
  const file = lockfilePath(skillsDir);
  let lock: Record<string, unknown> = {};
  try {
    lock = JSON.parse(readFileSync(file, 'utf8'));
  } catch { /* 新文件 */ }
  const skills = (lock.skills && typeof lock.skills === 'object' ? lock.skills : {}) as Record<string, unknown>;
  skills[slug] = {
    version,
    source: 'baitong',
    installedAt: new Date().toISOString(),
    name: String(detail.name || slug),
  };
  lock.skills = skills;
  mkdirSync(skillsDir, { recursive: true });
  writeFileSync(file, JSON.stringify(lock, null, 2));
}

/** 读 lockfile 里单个技能的安装记录（无记录返回 null） */
export function readSkillLockEntry(skillsDir: string, slug: string): Record<string, unknown> | null {
  try {
    const lock = JSON.parse(readFileSync(lockfilePath(skillsDir), 'utf8')) as Record<string, unknown>;
    const skills = lock.skills && typeof lock.skills === 'object' ? (lock.skills as Record<string, unknown>) : {};
    const entry = skills[slug];
    return entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 技能详情（面板「详情」弹层）。
 * 远端只给当前版本，**没有版本历史接口** —— 所以这里返回的是
 * 「远端当前版本 + 本地安装记录」两组事实，不编造历史版本列表。
 * 预签名的 download_url 不下发给前端（长且含签名），只回 hasPackage 布尔。
 */
export async function getBaitongSkillDetail(
  slugRaw: unknown,
  cfg: BaitongConfig,
  installedSet: Set<string>,
): Promise<Record<string, unknown>> {
  const slug = parseSlug(slugRaw);
  const url = `${trimBase(cfg.apiBase)}/api/v1/skills/${encodeURIComponent(slug)}`;
  const body = await fetchJson(url, fetchOpts(cfg));
  const detail = unwrapR<Record<string, unknown>>(body, {});
  const lock = readSkillLockEntry(cfg.skillsDir, slug);
  const downloadUrl = String(detail.download_url || '');
  return {
    slug,
    name: String(detail.name || slug),
    summary: String(detail.summary || ''),
    description: String(detail.description || detail.summary || ''),
    version: String(detail.version || ''),
    category: String(detail.category || ''),
    tags: String(detail.tags || ''),
    logo: String(detail.logo || ''),
    downloadCount: Number(detail.downloadCount) || 0,
    rating: detail.rating != null && detail.rating !== '' ? String(detail.rating) : '',
    size: Number(detail.size) || 0,
    hasPackage: /^https?:\/\//i.test(downloadUrl),
    installed: installedSet.has(slug) || !!lock,
    local: lock
      ? {
          version: String(lock.version || ''),
          installedAt: String(lock.installedAt || ''),
          name: String(lock.name || ''),
        }
      : null,
    // 显式告知前端：远端无版本历史能力
    versionHistorySupported: false,
  };
}

// ==================== 本地列表 / 已装集合 / 卸载 ====================

export async function installedSlugs(skillsDir: string): Promise<Set<string>> {
  const items = await listInstalledSkills(skillsDir);
  return new Set(items.map((it) => String(it.slug)));
}

export async function listInstalledSkills(skillsDir: string): Promise<Record<string, unknown>[]> {
  let names: string[] = [];
  try {
    names = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const items: Record<string, unknown>[] = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const dir = join(skillsDir, name);
    try {
      if (!statSync(dir).isDirectory()) continue;
      if (!existsSync(join(dir, 'SKILL.md'))) continue;
      // _meta.json 尽力读取（缺省 version/时间等）。
      // 🔴 name 取安装时落盘的真实技能名（detail.name），目录名只是 slug（BT_xxx 编码）——
      // 之前直接拿目录名当 name，已安装列表的主标题就变成了一串编码。
      let version = '';
      let skillName = '';
      let metaTime: string | null = null;
      let files = 0;
      let bytes = 0;
      try {
        const meta = JSON.parse(readFileSync(join(dir, '_meta.json'), 'utf8'));
        version = String(meta.version || '');
        skillName = String(meta.name || '').trim();
        metaTime = meta.publishedAt ? new Date(Number(meta.publishedAt) || meta.publishedAt).toISOString() : null;
      } catch { /* 无 _meta.json */ }
      // _meta.json 没有名字时退回 SKILL.md frontmatter 的 name: 行（手工安装的技能只有这一处有名字）
      if (!skillName) {
        try {
          const head = readFileSync(join(dir, 'SKILL.md'), 'utf8').slice(0, 4096);
          const m = /^name:\s*(.+)$/m.exec(head);
          if (m) skillName = m[1].trim().replace(/^(["'])(.*)\1$/, '$2');
        } catch { /* SKILL.md 上面已校验存在，读失败忽略 */ }
      }
      try {
        for (const f of readdirSync(dir)) {
          files += 1;
          bytes += statSync(join(dir, f)).size;
        }
      } catch { /* 计数失败忽略 */ }
      items.push({
        slug: name,
        name: skillName || name, // 真实技能名；实在读不到再回退目录名
        version,
        files,
        bytes,
        updateTime: metaTime ?? new Date(statSync(dir).mtimeMs).toISOString(),
      });
    } catch {
      // 非 skill 目录跳过
    }
  }
  return items;
}

export async function uninstallBaitongSkill(slugRaw: string, skillsDir: string): Promise<Record<string, unknown>> {
  const slug = parseSlug(slugRaw);
  const dir = resolve(skillsDir, slug);
  // 路径穿越防护：目标必须仍在 skillsDir 内
  if (!dir.startsWith(resolve(skillsDir) + '\\') && !dir.startsWith(resolve(skillsDir) + '/')) {
    throw new Error('拒绝越界的卸载路径');
  }
  if (!existsSync(join(dir, 'SKILL.md'))) {
    throw new Error(`未安装技能: ${slug}`);
  }
  rmSync(dir, { recursive: true, force: true });
  // 清 lockfile 条目
  const file = lockfilePath(skillsDir);
  try {
    const lock = JSON.parse(readFileSync(file, 'utf8'));
    if (lock.skills && typeof lock.skills === 'object') {
      delete (lock.skills as Record<string, unknown>)[slug];
      writeFileSync(file, JSON.stringify(lock, null, 2));
    }
  } catch { /* 无 lockfile 忽略 */ }
  return { slug, removed: true };
}

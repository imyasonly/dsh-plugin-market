/**
 * 安装源选择：把「检查源」和「安装源」两条链路显式分开。
 *
 * 🔴 事故背景（2026-10-28 用户实测）：
 *   检查源固定官方源优先（fetchLatestVersions 里写死 npmjs → npmmirror），
 *   所以面板永远按官方源告诉你「有 2.2.4」；而安装走 pnpm，pnpm 读的是
 *   ~/.npmrc 的 registry=npmmirror —— 镜像对**刚发布**的版本有同步延迟，
 *   于是必然 ERR_PNPM_NO_MATCHING_VERSION，报错后再回滚旧版。
 *
 *   桌面端更糟：installBundle 由宿主 pluginManager 执行，我们注入不了 env，
 *   而宿主的 registryPlan 在「pnpm 自身配置指向 npmmirror」时计划里只有
 *   [null]（= npmmirror）一个源，没有任何回退，只能失败。
 *
 * 本模块提供：读本机实际生效的 registry、查某个 registry 上是否真有目标版本、
 * 以及「按顺序挑一个确实有这个版本的源」。调用方把结果传给安装链路
 * （web: npm_config_registry 环境变量；desktop: installBundle 的 registry 选项）。
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fetchJson } from './http.js';
import type { BaitongConfig } from './config-store.js';

export const OFFICIAL_REGISTRY = 'https://registry.npmjs.org';
export const NPMMIRROR_REGISTRY = 'https://registry.npmmirror.com';

/** 规范化 registry：只接受 http(s)，去尾部斜杠；非法返回空串（= 未配置） */
export function normalizeRegistry(url: unknown): string {
  const v = String(url ?? '').trim();
  if (!v || !/^https?:\/\//i.test(v)) return '';
  return v.replace(/\/+$/, '');
}

/** 从 .npmrc 文本里取 registry（后出现的覆盖先出现的，与 npm 一致） */
function registryFromNpmrc(text: string): string {
  let found = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const matched = /^registry\s*=\s*(.+)$/i.exec(line);
    if (!matched) continue;
    const value = normalizeRegistry(matched[1].trim().replace(/^["']|["']$/g, ''));
    if (value) found = value;
  }
  return found;
}

function readNpmrc(file: string): string {
  try {
    return registryFromNpmrc(readFileSync(file, 'utf8'));
  } catch {
    return '';
  }
}

/**
 * 本机「实际会生效」的 registry —— 也就是 pnpm 安装时真正去问的那个。
 *
 * 优先级对齐 pnpm：环境变量 > profile 目录的 .npmrc > 用户级 ~/.npmrc > 官方源。
 * 只读配置文件、不 spawn 子进程：这里每次更新都要用，起进程太慢且桌面端未必有 pnpm。
 */
export function readEffectiveRegistry(profileDirectory?: string): string {
  const fromEnv = normalizeRegistry(process.env.npm_config_registry ?? process.env.NPM_CONFIG_REGISTRY);
  if (fromEnv) return fromEnv;
  if (profileDirectory) {
    const local = readNpmrc(join(profileDirectory, '.npmrc'));
    if (local) return local;
  }
  const user = readNpmrc(join(homedir(), '.npmrc'));
  if (user) return user;
  return OFFICIAL_REGISTRY;
}

export interface RegistryChoice {
  /** 建议使用的安装源（http(s) URL） */
  registry: string;
  /** 命中的候选来源：configured=设置页配置，local=本机 npm 配置，official/mirror=兜底 */
  reason: 'configured' | 'local' | 'official' | 'mirror';
  /** 目标版本在所有候选源上都不存在（调用方应直接报错，而不是让 pnpm 去撞） */
  missing: boolean;
}

interface ProbeEntry {
  at: number;
  /** 该源上有哪些版本（corgi 包里本来就带着，缓存整张表判定才精确） */
  versions: Set<string>;
  latest: string;
}

const PROBE_TTL_MS = 60_000;
const PROBE_LIMIT = 200;
const probes = new Map<string, ProbeEntry>();

/**
 * 某个 registry 上是否有这个版本（有就顺带带回 dist-tags.latest）。
 *
 * 用 corgi 格式（application/vnd.npm.install-v1+json）拿包元数据：
 * 体积只有完整 packument 的几分之一，判断「镜像同步没同步」足够。
 */
export async function registryHasVersion(
  registry: string,
  pkg: string,
  version: string,
  opts: { timeoutMs?: number; userAgent?: string } = {},
): Promise<{ ok: boolean; latest: string }> {
  const base = normalizeRegistry(registry);
  if (!base || !pkg) return { ok: false, latest: '' };
  const key = `${base}|${pkg}`;
  const hit = probes.get(key);
  if (hit && Date.now() - hit.at < PROBE_TTL_MS) {
    return { ok: !version || hit.versions.has(version), latest: hit.latest };
  }
  const url = `${base}/${pkg.replace('/', '%2f')}`;
  try {
    const json = await fetchJson<{ 'dist-tags'?: { latest?: unknown }; versions?: Record<string, unknown> }>(url, {
      timeoutMs: opts.timeoutMs ?? 6000,
      userAgent: opts.userAgent,
      headers: { Accept: 'application/vnd.npm.install-v1+json' },
    });
    const latest = typeof json?.['dist-tags']?.latest === 'string' ? json['dist-tags'].latest : '';
    const versions = new Set(Object.keys(json?.versions ?? {}));
    const ok = !version || versions.has(version);
    if (probes.size >= PROBE_LIMIT) probes.clear();
    probes.set(key, { at: Date.now(), versions, latest });
    return { ok, latest };
  } catch {
    // 网络失败 / 404：当作「这个源给不出答案」，不缓存（下次还要试）
    return { ok: false, latest: '' };
  }
}

/**
 * 挑一个「确实有目标版本」的安装源。
 *
 * 顺序：设置页配置 → 本机 npm 配置（= 平时用的镜像，快）→ 官方源 → npmmirror。
 * 镜像同步延迟时，第一次探测就会跳过镜像落到官方源，用户看到的是「更新成功」
 * 而不是「ERR_PNPM_NO_MATCHING_VERSION + 已恢复旧版」。
 *
 * 版本号未知（安装最新版）时不探测，直接用第一个候选。
 */
export async function chooseInstallRegistry(
  pkg: string,
  version: string,
  cfg: Pick<BaitongConfig, 'npmRegistry' | 'userAgent' | 'timeoutMs'>,
  profileDirectory?: string,
): Promise<RegistryChoice> {
  const seen = new Set<string>();
  const candidates: { registry: string; reason: RegistryChoice['reason'] }[] = [];
  const push = (registry: string, reason: RegistryChoice['reason']) => {
    const base = normalizeRegistry(registry);
    if (!base || seen.has(base)) return;
    seen.add(base);
    candidates.push({ registry: base, reason });
  };
  push(cfg.npmRegistry, 'configured');
  push(readEffectiveRegistry(profileDirectory), 'local');
  push(OFFICIAL_REGISTRY, 'official');
  push(NPMMIRROR_REGISTRY, 'mirror');
  const first = candidates[0] ?? { registry: OFFICIAL_REGISTRY, reason: 'official' as const };
  if (!pkg || !version) return { ...first, missing: false };
  const timeoutMs = Math.min(cfg.timeoutMs || 6000, 8000);
  for (const candidate of candidates) {
    const { ok } = await registryHasVersion(candidate.registry, pkg, version, { timeoutMs, userAgent: cfg.userAgent });
    if (ok) return { registry: candidate.registry, reason: candidate.reason, missing: false };
  }
  return { registry: first.registry, reason: first.reason, missing: true };
}

/** 精确版本（x.y.z / x.y.z-pre）：只有它才能拿去问「这个源上有没有」 */
const EXACT_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * 从安装规格里拆出 registry 包的 name@version。
 *
 * github / git / link / file / http 等规格返回 null（它们没有「去哪个 npm 源取」的概念）。
 * 版本不是**精确版本**时（`pkg`、`pkg@latest`、`pkg@^1.0.0`、`pkg@1.x`）一律返回空 version：
 * 那种规格本来就该由 pnpm 自己去解析，拿它去问「这个源有没有 1.x」只会误判成缺版本。
 */
export function registrySpecOf(source: string): { pkg: string; version: string } | null {
  const spec = String(source ?? '').trim();
  if (!spec || /^(?:github:|git\+|git:|link:|file:|workspace:|https?:)/i.test(spec)) return null;
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { pkg: spec, version: '' };
  const version = spec.slice(at + 1);
  return { pkg: spec.slice(0, at), version: EXACT_VERSION_RE.test(version) ? version : '' };
}

/** 目标版本在所有源上都取不到时的统一文案（调用方直接回给面板） */
export function missingVersionMessage(pkg: string, version: string, registry: string): string {
  return `${pkg}@${version} 在 ${registry} 上还取不到（镜像同步有延迟）。`
    + '请稍后重试；或在设置里把「安装源」设为「npm 官方源」后再更新。';
}

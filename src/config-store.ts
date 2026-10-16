/**
 * 配置存取：默认值 + 用户覆盖文件（$DSH_HOME/baitong-market.json）。
 * 优先级：cordis.patch.yml config > 用户 overlay > 默认值（运行时 overlay 每次启动读取）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BaitongConfig {
  apiBase: string;
  skillsDir: string;
  timeoutMs: number;
  userAgent: string;
  maxResults: number;
}

export function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

/**
 * 默认百通 API 根地址（context path = /baitong_ai，公网可达）。
 *
 * 🔴 当前**临时指向测试环境** `ts.1100111.cn`（0.1.9 起的临时配置）。
 *    生产地址是 `s.1100111.cn`。切回生产有两种方式：
 *      - 不改包：设置页 / `BAITONG_API_BASE` / profile 的 `cordis.patch.yml` 任一覆盖即可；
 *      - 改包：把下面这一行换回 `s.` 后重新发版。
 *    用户的本地覆盖优先级高于本常量，所以已配置过的用户不受这次切换影响。
 *
 * 为什么编译进包里而不是只放配置文件：这是**公网可达**的服务，零配置即用是
 * 装完就能用的前提。真正要防的不是"有默认值"，而是"默认值不可改、不可查"——
 * 所以这里只放默认值，并配齐覆盖链与可观测性：
 *
 *   1. 环境变量 `BAITONG_API_BASE`（最高，见 envApiBase）
 *   2. 设置页保存 → $DSH_HOME/baitong-market.json（GUI）
 *   3. profile 层 `cordis.patch.yml`（GUI 唯一入口，支持热重载）
 *   4. 本仓库 `cordis.patch.local.yml` + `--patch`（本地联调，不随包发布）
 *   5. 本常量（兜底）
 *
 * 生效值会经 `pluginInstallStatus` 的 `apiBase` 字段回传，用户报障时可直接确认
 * 实际连的是哪个地址，不必翻配置。私有化部署改设置页或 profile 配置即可，**无需重编包**。
 */
export const DEFAULT_API_BASE = 'https://ts.1100111.cn/baitong_ai'; // 临时：测试环境。生产为 https://s.1100111.cn/baitong_ai

/**
 * 规范化根地址：缺协议补 http://（本地 127.0.0.1:5500 也能用）、去尾部斜杠。
 * 上游请求按 `${apiBase}/api/...` 拼接，尾部斜杠会导致 //api。
 */
export function normalizeApiBase(raw: string): string {
  let v = String(raw ?? '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
  return v.replace(/\/+$/, '');
}

/**
 * 环境变量覆盖（优先级高于设置页与 cordis.patch.yml）：
 * 本地联调 BAITONG_API_BASE=http://127.0.0.1:5500 pnpm build / dsh web
 */
export function envApiBase(): string | undefined {
  const raw = process.env.BAITONG_API_BASE;
  const v = raw ? normalizeApiBase(raw) : '';
  return v || undefined;
}

export function defaultSkillsDir(): string {
  return join(dshHome(), 'skills');
}

export function withDefaults(raw: Partial<BaitongConfig> = {}): BaitongConfig {
  return {
    apiBase: normalizeApiBase(envApiBase() ?? raw.apiBase ?? DEFAULT_API_BASE),
    skillsDir: String(raw.skillsDir ?? defaultSkillsDir()),
    timeoutMs: Number(raw.timeoutMs) || 20000,
    userAgent: String(raw.userAgent ?? 'Mozilla/5.0 (compatible; baitong-market/0.1)'),
    maxResults: Number(raw.maxResults) || 12,
  };
}

function overlayPath(): string {
  return join(dshHome(), 'baitong-market.json');
}

/** 启动时读取用户 overlay（settings 保存写入的文件）合并进运行时配置 */
export function readOverlay(): Record<string, unknown> {
  try {
    const raw = readFileSync(overlayPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function assignConfig(cfg: BaitongConfig, overlay: Record<string, unknown>): void {
  if (typeof overlay.apiBase === 'string' && overlay.apiBase) cfg.apiBase = overlay.apiBase;
  if (typeof overlay.skillsDir === 'string' && overlay.skillsDir) cfg.skillsDir = overlay.skillsDir;
  if (typeof overlay.timeoutMs === 'number' && overlay.timeoutMs > 0) cfg.timeoutMs = overlay.timeoutMs;
  if (typeof overlay.userAgent === 'string' && overlay.userAgent) cfg.userAgent = overlay.userAgent;
  if (typeof overlay.maxResults === 'number' && overlay.maxResults > 0) cfg.maxResults = overlay.maxResults;
}

/** 设置页保存：写 overlay（不进 git，不影响宿主配置） */
export function sanitizePatch(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const apiBase = input.apiBase == null ? '' : normalizeApiBase(String(input.apiBase));
  if (/^https?:\/\//i.test(apiBase) && apiBase.length < 300) out.apiBase = apiBase;
  if (typeof input.skillsDir === 'string' && input.skillsDir.length < 300) out.skillsDir = input.skillsDir;
  if (typeof input.timeoutMs === 'number' && input.timeoutMs >= 1000 && input.timeoutMs <= 120000) out.timeoutMs = input.timeoutMs;
  if (typeof input.maxResults === 'number' && input.maxResults >= 1 && input.maxResults <= 80) out.maxResults = input.maxResults;
  if (typeof input.userAgent === 'string' && input.userAgent.length < 200) out.userAgent = input.userAgent;
  return out;
}

export function writeOverlay(cfg: BaitongConfig): void {
  const dir = dshHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(overlayPath(), JSON.stringify(publicConfig(cfg), null, 2));
}

export function publicConfig(cfg: BaitongConfig): Record<string, unknown> {
  return {
    apiBase: cfg.apiBase,
    skillsDir: cfg.skillsDir,
    timeoutMs: cfg.timeoutMs,
    userAgent: cfg.userAgent,
    maxResults: cfg.maxResults,
  };
}

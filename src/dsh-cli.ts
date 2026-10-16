/**
 * dsh CLI 执行器：在宿主进程里 spawn `dsh plugin --profile web add`。
 * 🔴 不能走 Agent 沙箱 shell —— 沙箱进程写不了 web profile 目录。
 * 含：pnpm ndjson 进度解析、prepare 拦截自动写 dangerouslyAllowAllBuilds 重试、
 *    超时/取消处理、安装状态快照（面板轮询用）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dshHome } from './config-store.js';
import { createProgressTracker, type ProgressTracker } from './ndjson.js';

export const WEB_PROFILE = 'web';
export const INSTALL_TIMEOUT_MS = Number(process.env.BAITONG_INSTALL_TIMEOUT_MS) || 15 * 60 * 1000;

const TARGET_RE = /^[A-Za-z0-9@:./_#+-]+$/;
const CMD_METACHARS = /[\s"&|<>^()%!]/;
const NDJSON_COMMANDS = new Set(['add', 'remove', 'install']);

/** profile 名合法性（目录名，防路径穿越） */
const PROFILE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function isSafeProfile(profile: string): boolean {
  return PROFILE_RE.test(profile);
}

/**
 * 本插件自身的包根目录（用于反查"哪个 profile 在跑我"）。
 * lib/host.js → 上一级即包根；link 安装时会被 Node 解析成源码真实路径。
 */
function selfRoot(): string | null {
  try {
    return dirname(dirname(fileURLToPath(import.meta.url)));
  } catch {
    return null;
  }
}

/** 从本插件代码路径里抠出 profiles/<name>/node_modules 中的 <name> */
function profileFromSelfPath(root: string | null): string | null {
  if (!root) return null;
  const parts = root.split(/[\\/]+/);
  for (let i = parts.length - 2; i >= 0; i--) {
    if (parts[i] !== 'profiles') continue;
    const name = parts[i + 1];
    if (name && isSafeProfile(name)) return name;
  }
  return null;
}

/** 读一个 profile 的 dependencies（坏文件返回 null） */
function profileDeps(dir: string): Record<string, string> | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    return raw.dependencies ?? null;
  } catch {
    return null;
  }
}

/** 规范化比较用路径（Windows 大小写/分隔符不敏感，且容忍不存在） */
function normPath(p: string): string {
  let out = p.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  try {
    out = realpathSync.native(p).replace(/\\/g, '/');
  } catch {
    /* 路径不存在时用原值 */
  }
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/** 列出 ~/.dsh/profiles 下的合法 profile 名 */
function listProfiles(home: string): string[] {
  try {
    return readdirSync(join(home, 'profiles')).filter((n) => isSafeProfile(n));
  } catch {
    return [];
  }
}

/**
 * 探测当前运行 profile。桌面端 GUI 启动不带 --profile，且 web profile 是 link 安装
 * （代码路径不含 profiles/<name>），所以顺序是：
 *   1. BAITONG_DSH_PROFILE 环境变量
 *   2. 启动参数 --profile <name>
 *   3. 自身代码路径含 profiles/<name>/node_modules（注册表安装：desktop）
 *   4. 某 profile 用 link:<路径> 依赖本包且真实路径等于自身（link 安装：web）
 *   5. 某 profile 的 dependencies 里有本包键名（兜底）
 *   6. 工作目录名本身是 profile 目录
 *   7. 回退 web
 */
export function currentProfile(
  input: { env?: NodeJS.ProcessEnv; argv?: string[]; home?: string; selfPath?: string; cwd?: string } = {},
): string {
  const env = input.env ?? process.env;
  const argv = input.argv ?? process.argv;
  const home = input.home ?? dshHome();

  const explicit = env.BAITONG_DSH_PROFILE;
  if (explicit && isSafeProfile(explicit)) return explicit;

  const i = argv.indexOf('--profile');
  if (i >= 0 && argv[i + 1] && isSafeProfile(String(argv[i + 1]))) return String(argv[i + 1]);

  const root = input.selfPath !== undefined ? input.selfPath : selfRoot();
  const names = listProfiles(home);

  // 3. 注册表安装：真实路径落在 profiles/<name>/node_modules 下
  const fromPath = profileFromSelfPath(root);
  if (fromPath) return fromPath;

  // 4. link 安装：profile 的依赖写成 link:<源码路径>，且指向自身
  if (root) {
    const want = normPath(root);
    for (const name of names) {
      const deps = profileDeps(join(home, 'profiles', name));
      const spec = deps?.['@baitongserver/dsh-plugin-market'];
      if (!spec || !/^link:/i.test(spec)) continue;
      const target = spec.slice(5).trim();
      const abs = isAbsolute(target) ? target : resolve(join(home, 'profiles', name), target);
      if (normPath(abs) === want) return name;
    }
  }

  // 5. 兜底：谁依赖了本包
  for (const name of names) {
    const deps = profileDeps(join(home, 'profiles', name));
    // ⚠️ 键必须与 package.json 的 name 完全一致：这里靠它判断"哪个 profile 装了本插件"，
    // 对不上会静默 fallback，导致装/卸落到错误的 profile
    if (deps && deps['@baitongserver/dsh-plugin-market']) return name;
  }

  // 6. cwd 恰好是 <home>/profiles/<name>
  const cwd = input.cwd ?? process.cwd();
  if (normPath(cwd) === normPath(home) + '/profiles') return WEB_PROFILE;
  const cwdName = basename(cwd);
  if (isSafeProfile(cwdName) && normPath(dirname(cwd)) === normPath(join(home, 'profiles'))) return cwdName;

  return WEB_PROFILE;
}

/** 指定 profile 的目录（默认当前 profile，不再锁死 web） */
export function profileDir(profile = currentProfile()): string {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  return join(dshHome(), 'profiles', profile);
}

export function webProfileDir(): string {
  return profileDir(WEB_PROFILE);
}

/** 安装状态快照（/baitong-market method=pluginInstallStatus 轮询） */
export const progress = {
  active: false,
  target: '',
  startedAt: 0,
  lastLine: '',
  phase: null as string | null,
  done: 0,
  total: null as number | null,
  currentPackage: null as string | null,
  downloaded: null as string | null,
  size: null as string | null,
  ndjson: false,
  error: null as string | null,
};
export const BOOT_ID = `${String(process.pid)}-${String(Date.now())}`;

export function isSafePluginTarget(target: string): boolean {
  return TARGET_RE.test(target);
}

function quoteCmdArg(arg: string): string {
  if (!CMD_METACHARS.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

function cmdCommandLine(argv: string[]): string {
  return argv.map(quoteCmdArg).join(' ');
}

/** 定位当前 dsh 进程入口（优先复用本进程 node，避免 PATH 环境差异） */
export function dshArgv(input: { argv?: string[]; execArgv?: string[]; execPath?: string; argv0?: string; platform?: NodeJS.Platform } = {}): { file: string; args: string[]; cwd?: string; viaShell: boolean } {
  const argv = input.argv ?? process.argv;
  const execArgv = input.execArgv ?? process.execArgv;
  const execPath = input.execPath ?? process.execPath;
  const argv0 = input.argv0 ?? process.argv0;
  const platform = input.platform ?? process.platform;
  const node = nodeExecutable(argv0, execPath);
  const entry = argv[1];
  if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const abs = resolve(entry);
    return { file: node, args: [...execArgv, abs], cwd: dirname(abs), viaShell: false };
  }
  return { file: 'dsh', args: [], cwd: undefined, viaShell: platform === 'win32' };
}

function nodeExecutable(argv0: string | undefined, execPath: string): string {
  if (argv0 !== undefined && argv0 !== '' && isAbsolute(argv0) && existsSync(argv0)) return argv0;
  return execPath;
}

/** pnpm workspace 根需要 -w；非 add/remove 原样返回 */
export function pluginArgsFor(profileDirectory: string, pluginArgs: string[]): string[] {
  const args = [...pluginArgs];
  if (args[0] !== 'add' && args[0] !== 'remove') return args;
  if (!existsSync(join(profileDirectory, 'pnpm-workspace.yaml'))) return args;
  return [args[0], '-w', ...args.slice(1)];
}

export function preparePluginArgs(profileDirectory: string, pluginArgs: string[]): string[] {
  const args = pluginArgsFor(profileDirectory, pluginArgs);
  const command = args[0];
  if (command !== undefined && NDJSON_COMMANDS.has(command)) return [...args, '--reporter=ndjson'];
  return args;
}

export function publicInstallStatus(): Record<string, unknown> {
  return {
    active: progress.active,
    target: progress.target,
    seconds: progress.active ? Math.round((Date.now() - progress.startedAt) / 1000) : 0,
    lastLine: progress.lastLine,
    phase: progress.phase,
    done: progress.done,
    total: progress.total,
    currentPackage: progress.currentPackage,
    downloaded: progress.downloaded,
    size: progress.size,
    ndjson: progress.ndjson,
    error: progress.error,
    boot: BOOT_ID,
  };
}

// ==================== pnpm prepare 拦截处理 ====================

export function isPrepareBlocked(text: string): boolean {
  return /needs to execute build scripts|allowBuilds|ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED|ERR_PNPM_IGNORED_BUILDS/i.test(text);
}

export function withDangerouslyAllowAllBuilds(yaml: string): string {
  if (/(?:^|\n)dangerouslyAllowAllBuilds:\s*true\s*(?:\n|$)/.test(yaml)) return yaml;
  if (/(?:^|\n)dangerouslyAllowAllBuilds:\s*/m.test(yaml)) {
    return yaml.replace(/^dangerouslyAllowAllBuilds:\s*.*$/m, 'dangerouslyAllowAllBuilds: true');
  }
  if (yaml.trim() === '') return 'dangerouslyAllowAllBuilds: true\n';
  return `${yaml.replace(/\s*$/u, '\n')}\ndangerouslyAllowAllBuilds: true\n`;
}

export function writeDangerouslyAllowAllBuilds(profileDirectory: string): boolean {
  const file = join(profileDirectory, 'pnpm-workspace.yaml');
  let yaml = '';
  try {
    yaml = readFileSync(file, 'utf8');
  } catch {
    /* 下方创建 */
  }
  const next = withDangerouslyAllowAllBuilds(yaml);
  if (next === yaml) return false;
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(file, next);
  return true;
}

// ==================== pnpm 供应链冷却期（minimumReleaseAge）处理 ====================

/**
 * pnpm 的 minimumReleaseAge 会拒绝「刚发布不久」的版本。
 * 自我升级永远指向最新发布的版本，因此**必然**撞上这道闸：
 *   ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION ... within the minimumReleaseAge cutoff
 * 与其他校验不同，官方给了释放口：把该精确版本写进 pnpm-workspace.yaml 的
 * minimumReleaseAgeExclude 即放行（与 allowBuilds 同一套路）。
 */
export function isReleaseAgeBlocked(text: string): boolean {
  return /ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION|minimumReleaseAge cutoff|failed verification.*lockfile entries/i.test(text);
}

/** 把 `@scope/name@1.2.3` / `name@1.2.3` 拆成 pnpm 需要的排除项；非精确版本返回 null */
export function releaseAgeExcludeEntry(source: string): string | null {
  const spec = source.trim().replace(/^npm:/i, '');
  // git / link / file / url 等非 registry 规格不走冷却期
  if (/^(?:github|git\+|file|link|workspace|https?):/i.test(spec)) return null;
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : '';
  const version = at > 0 ? spec.slice(at + 1) : '';
  if (!name || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) return null;
  return `${name}@${version}`;
}

export function withMinimumReleaseAgeExclude(yaml: string, entry: string): string {
  const quoted = `'${entry}'`;
  const already = new RegExp(`^\\s*-\\s*['"]?${entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm');
  if (already.test(yaml)) return yaml;
  const lines = yaml.split('\n');
  const keyIndex = lines.findIndex((line) => /^\s*minimumReleaseAgeExclude:\s*.*$/.test(line));
  if (keyIndex === -1) {
    const block = `minimumReleaseAgeExclude:\n  - ${quoted}\n`;
    if (yaml.trim() === '') return block;
    return `${yaml.replace(/\s*$/u, '\n')}\n${block}`;
  }
  const baseIndent = /^(\s*)/.exec(lines[keyIndex])?.[1] ?? '';
  let insertAt = keyIndex + 1;
  while (insertAt < lines.length && /^\s+-\s/.test(lines[insertAt])) insertAt += 1;
  lines.splice(insertAt, 0, `${baseIndent}  - ${quoted}`);
  return lines.join('\n');
}

export function writeMinimumReleaseAgeExclude(profileDirectory: string, source: string): boolean {
  const entry = releaseAgeExcludeEntry(source);
  if (!entry) return false;
  const file = join(profileDirectory, 'pnpm-workspace.yaml');
  let yaml = '';
  try {
    yaml = readFileSync(file, 'utf8');
  } catch {
    /* 下方创建 */
  }
  const next = withMinimumReleaseAgeExclude(yaml, entry);
  if (next === yaml) return false;
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(file, next);
  return true;
}

export function rewritePnpmError(err: unknown): Error {
  const text = err instanceof Error ? err.message : String(err);
  if (isPrepareBlocked(text)) {
    return new Error('该插件需要构建脚本（prepare），pnpm 默认拦截。广场安装会写入 profile 的 dangerouslyAllowAllBuilds 并重试；若仍失败请检查 web profile 是否可写。');
  }
  if (isReleaseAgeBlocked(text)) {
    return new Error('该版本刚发布，被 pnpm 供应链冷却期（minimumReleaseAge）拦截。广场安装会把该版本写入 pnpm-workspace.yaml 的 minimumReleaseAgeExclude 并重试；若仍失败请手动添加该排除项。');
  }
  if (/ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF/.test(text)) {
    return new Error('当前 profile 的 node_modules 由不同主版本的 pnpm 生成，安装前需要先重建依赖。');
  }
  return err instanceof Error ? err : new Error(text);
}

// ==================== spawn 执行 ====================

export interface RunOptions {
  cwd?: string;
  timeoutMs: number;
  env?: Record<string, string>;
  viaShell?: boolean;
  detached?: boolean;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}

export async function runDshPlugin(profile: string, pluginArgs: string[]): Promise<string> {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  const target = pluginArgs[pluginArgs.length - 1] ?? '';
  if (!isSafePluginTarget(target)) throw new Error(`拒绝不安全的安装目标: ${target}`);
  const argv = dshArgv();
  const dir = profileDir(profile);
  const prepared = preparePluginArgs(dir, pluginArgs);
  const tracker = beginProgress(target);
  const feed = makeProgressFeeder(tracker);
  try {
    return await runCommand(argv.file, [...argv.args, 'plugin', '--profile', profile, ...prepared], {
      cwd: argv.cwd,
      timeoutMs: INSTALL_TIMEOUT_MS,
      env: { CI: 'true' },
      viaShell: argv.viaShell,
      detached: process.platform !== 'win32',
      onChunk: (text) => {
        feed(text);
        syncProgress(tracker);
      },
    });
  } catch (err) {
    // 超时/失败时把原因写入状态端点，轮询侧才能看到错误终态
    const text = err instanceof Error ? err.message : String(err);
    if (progress.error === null) progress.error = text.slice(0, 800);
    throw err;
  } finally {
    progress.active = false;
  }
}

/** 安装主链：add →（冷却期）放开该版本重试 →（hoist 差异）重建依赖重试 →（prepare 拦截）allowAllBuilds 重试 */
export async function addDshPlugin(source: string, profile = currentProfile()): Promise<string> {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  const dir = profileDir(profile);
  const retryAfterPrepare = async (err: unknown) => {
    const text = err instanceof Error ? err.message : String(err);
    if (!isPrepareBlocked(text)) throw rewritePnpmError(err);
    writeDangerouslyAllowAllBuilds(dir);
    try {
      return await runDshPlugin(profile, ['add', source]);
    } catch (retryErr) {
      throw rewritePnpmError(retryErr);
    }
  };
  const retryAfterReleaseAge = async (err: unknown) => {
    const text = err instanceof Error ? err.message : String(err);
    if (!isReleaseAgeBlocked(text)) return await retryAfterPrepare(err);
    // 该版本刚发布，写进 minimumReleaseAgeExclude 后原样重试即可
    writeMinimumReleaseAgeExclude(dir, source);
    try {
      return await runDshPlugin(profile, ['add', source]);
    } catch (retryErr) {
      return await retryAfterPrepare(retryErr);
    }
  };
  try {
    return await runDshPlugin(profile, ['add', source]);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (text.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
      await runDshPlugin(profile, ['install', '--no-frozen-lockfile']);
      try {
        return await runDshPlugin(profile, ['add', source]);
      } catch (retryErr) {
        return await retryAfterReleaseAge(retryErr);
      }
    }
    return await retryAfterReleaseAge(err);
  }
}

/** 卸载主链：remove →（hoist 差异）重建依赖后重试 */
export async function removeDshPlugin(pkg: string, profile = currentProfile()): Promise<string> {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  try {
    return await runDshPlugin(profile, ['remove', pkg]);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (text.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
      await runDshPlugin(profile, ['install', '--no-frozen-lockfile']);
      try {
        return await runDshPlugin(profile, ['remove', pkg]);
      } catch (retryErr) {
        throw rewritePnpmError(retryErr);
      }
    }
    throw rewritePnpmError(err);
  }
}

/**
 * 从 pnpm 输出里提炼**可读的原因**。
 * 加了 `--reporter=ndjson` 后失败输出是几十行 JSON，直接截尾 800 字符只会得到
 * `"stage":"importing_done"}` 这类无意义片段，把真正的报错淹没掉。
 */
export function summarizePnpmFailure(out: string): string {
  const lines = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const parsed: { level?: string; message?: unknown; code?: string; err?: { message?: string; code?: string } }[] = [];
  for (const line of lines) {
    if (!line.startsWith('{')) continue;
    try {
      parsed.push(JSON.parse(line) as never);
    } catch {
      /* 非 JSON 行忽略 */
    }
  }
  // 1) 明确的错误条目优先
  const bad = parsed.filter((entry) => entry.level === 'error' || entry.err || entry.code);
  const parts: string[] = [];
  for (const entry of bad) {
    const code = entry.err?.code ?? entry.code ?? '';
    const message = String(entry.err?.message ?? entry.message ?? '').trim();
    if (!message) continue;
    const item = code && !message.includes(code) ? `${code}: ${message}` : message;
    if (!parts.includes(item)) parts.push(item);
  }
  if (parts.length > 0) return parts.join(' | ').slice(-1200);
  // 2) 退回人类可读的非 debug 行
  const readable = lines.filter((line) => !/"level":"debug"/.test(line) && !/^\s*[{}]?\s*$/.test(line));
  if (readable.length > 0) return readable.join('\n').slice(-1200);
  // 3) 兜底：原始输出尾部
  return out.trim().slice(-800);
}

export function runCommand(command: string, args: string[], options: RunOptions): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawnShim(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}), CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      viaShell: options.viaShell === true,
      detached: options.detached === true && process.platform !== 'win32',
    } as never);
    let out = '';
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolvePromise(out);
    };
    const timer = setTimeout(() => {
      killChild(child);
      finish(new Error(`命令超时 ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    const onAbort = () => {
      killChild(child);
      finish(new Error('命令已取消'));
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', (chunk) => {
      const text = String(chunk);
      out = (out + text).slice(-256 * 1024);
      options.onChunk?.(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = String(chunk);
      out = (out + text).slice(-256 * 1024);
      options.onChunk?.(text);
    });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(`命令失败 (exit ${code}): ${summarizePnpmFailure(out) || 'no output'}`));
    });
  });
}

type SpawnOptionsLike = import('node:child_process').SpawnOptions & { viaShell?: boolean; detached?: boolean };

function spawnShim(file: string, args: string[], options: SpawnOptionsLike): import('node:child_process').ChildProcess {
  const { viaShell = false, ...spawnOptions } = options;
  if (!viaShell || process.platform !== 'win32') {
    return spawn(file, [...args], { ...spawnOptions, shell: false });
  }
  const comspec = process.env.ComSpec ?? 'cmd.exe';
  return spawn(comspec, ['/d', '/s', '/c', `"${cmdCommandLine([file, ...args])}"`], {
    ...spawnOptions,
    shell: false,
    windowsVerbatimArguments: true,
  } as never);
}
function killChild(child: import('node:child_process').ChildProcess): void {
  if (process.platform !== 'win32' && child.pid !== undefined) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      /* 走 child.kill 兜底 */
    }
  }
  try {
    child.kill('SIGTERM');
  } catch {
    /* 已退出 */
  }
}

function beginProgress(target: string): ProgressTracker {
  progress.active = true;
  progress.target = target;
  progress.startedAt = Date.now();
  progress.lastLine = '';
  progress.phase = null;
  progress.done = 0;
  progress.total = null;
  progress.currentPackage = null;
  progress.downloaded = null;
  progress.size = null;
  progress.ndjson = false;
  progress.error = null;
  return createProgressTracker();
}

function makeProgressFeeder(tracker: ProgressTracker): (chunk: string) => void {
  let lineBuffer = '';
  return (chunk: string) => {
    lineBuffer += chunk;
    let nl: number;
    while ((nl = lineBuffer.indexOf('\n')) !== -1) {
      const line = lineBuffer.slice(0, nl);
      lineBuffer = lineBuffer.slice(nl + 1);
      const trimmed = line.trim();
      if (trimmed === '') continue;
      tracker.feed(trimmed);
      if (!trimmed.startsWith('{')) progress.lastLine = trimmed.slice(0, 200);
    }
  };
}

function syncProgress(tracker: ProgressTracker): void {
  const snap = tracker.snapshot;
  progress.phase = snap.phase;
  progress.done = snap.done;
  progress.total = snap.total;
  progress.currentPackage = snap.currentPackage;
  progress.downloaded = snap.downloaded;
  progress.size = snap.size;
  progress.ndjson = snap.seen;
  if (snap.error !== null) progress.error = snap.error;
}

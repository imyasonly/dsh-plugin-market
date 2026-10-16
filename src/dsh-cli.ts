/**
 * dsh CLI 执行器：在宿主进程里 spawn `dsh plugin --profile web add`。
 * 🔴 不能走 Agent 沙箱 shell —— 沙箱进程写不了 web profile 目录。
 * 含：pnpm ndjson 进度解析、prepare 拦截自动写 dangerouslyAllowAllBuilds 重试、
 *    超时/取消处理、安装状态快照（面板轮询用）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
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
 * 探测当前运行 profile（优先级：BAITONG_DSH_PROFILE 环境变量 > 启动参数 --profile
 * > 扫描 ~/.dsh/profiles 下装过本插件的 > web）。
 *
 * 桌面端 GUI 启动不会带 --profile，且本插件是 link 安装（代码路径不含 profiles/<name>），
 * 只能靠「哪个 profile 的 package.json 依赖了本插件」反推。
 */
export function currentProfile(input: { env?: NodeJS.ProcessEnv; argv?: string[]; home?: string } = {}): string {
  const env = input.env ?? process.env;
  const argv = input.argv ?? process.argv;

  const explicit = env.BAITONG_DSH_PROFILE;
  if (explicit && isSafeProfile(explicit)) return explicit;

  const i = argv.indexOf('--profile');
  if (i >= 0 && argv[i + 1] && isSafeProfile(String(argv[i + 1]))) return String(argv[i + 1]);

  const profilesDir = join(input.home ?? dshHome(), 'profiles');
  try {
    for (const name of readdirSync(profilesDir)) {
      if (!isSafeProfile(name)) continue;
      try {
        const raw = JSON.parse(readFileSync(join(profilesDir, name, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, unknown>;
        };
        // ⚠️ 键必须与 package.json 的 name 完全一致：这里靠它判断"哪个 profile 装了本插件"，
        // 对不上会静默 fallback 到 web profile，导致装/卸落到错误的 profile
        if (raw.dependencies && raw.dependencies['@baitongserver/dsh-plugin-market']) return name;
      } catch {
        /* 跳过坏 profile */
      }
    }
  } catch {
    /* profiles 目录不存在 */
  }
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

export function rewritePnpmError(err: unknown): Error {
  const text = err instanceof Error ? err.message : String(err);
  if (isPrepareBlocked(text)) {
    return new Error('该插件需要构建脚本（prepare），pnpm 默认拦截。广场安装会写入 profile 的 dangerouslyAllowAllBuilds 并重试；若仍失败请检查 web profile 是否可写。');
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

/** 安装主链：add → 失败时（hoist 差异）重建依赖重试 →（prepare 拦截）allowAllBuilds 重试 */
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
  try {
    return await runDshPlugin(profile, ['add', source]);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (text.includes('ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF')) {
      await runDshPlugin(profile, ['install', '--no-frozen-lockfile']);
      try {
        return await runDshPlugin(profile, ['add', source]);
      } catch (retryErr) {
        return await retryAfterPrepare(retryErr);
      }
    }
    return await retryAfterPrepare(err);
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
      else finish(new Error(`命令失败 (exit ${code}): ${out.trim().slice(-800) || 'no output'}`));
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

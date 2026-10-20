/**
 * 插件执行器：desktop 使用宿主 pluginManager，其余 profile 在宿主进程运行 dsh CLI。
 * 🔴 不能走 Agent 沙箱 shell —— 沙箱进程写不了 web profile 目录。
 * 含：pnpm ndjson 进度解析、prepare 拦截自动写 dangerouslyAllowAllBuilds 重试、
 *    超时/取消处理、安装状态快照（面板轮询用）。
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/**
 * 读某个 profile 已选中的 bundle 层（`dsh.profile.bundles`）。
 * 「装上了」= 在 dependencies 里；「启用了」= 在 bundles 里 —— DSH 把两者分开记，
 * 只有同时成立才会被加载，所以面板要能区分这两种状态。
 */
export function readProfileBundles(profile: string): string[] {
  if (!isSafeProfile(profile)) return [];
  try {
    const raw = JSON.parse(readFileSync(join(dshHome(), 'profiles', profile, 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } };
    };
    const bundles = raw.dsh?.profile?.bundles;
    return Array.isArray(bundles) ? bundles.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** 指定 profile 的目录（默认当前 profile，不再锁死 web） */
export function profileDir(profile = currentProfile()): string {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  return join(dshHome(), 'profiles', profile);
}

export function webProfileDir(): string {
  return profileDir(WEB_PROFILE);
}

export interface PluginManagerResult {
  application: string;
  error?: { code?: string; diagnostic?: string };
  packageResult?: { exitCode: number; timedOut?: boolean; output: string; logPath?: string };
}

export interface DesktopPluginManager {
  installBundle(spec: string, options?: { enabled?: boolean }): Promise<PluginManagerResult>;
  removeBundle(name: string): Promise<PluginManagerResult>;
  listBundles?(): Promise<{ name: string; enabled: boolean; version?: string; source?: string; removable: boolean }[]>;
  listPlugins?(): Promise<{ entryId?: string; moduleName: string; enabled: boolean; readOnlyReason?: string }[]>;
  setPluginEnabled?(id: string, enabled: boolean): Promise<PluginManagerResult>;
  /** 选中/取消选中一个 bundle 层（写 dsh.profile.bundles；官方插件页的「启用」用的就是它） */
  setBundleEnabled?(name: string, enabled: boolean): Promise<PluginManagerResult>;
}

function checkManagerResult(result: PluginManagerResult): void {
  const run = result.packageResult;
  if (result.application === 'failed' || result.application === 'cancelled' || result.error || run?.timedOut || (run && run.exitCode !== 0)) {
    const diagnostic = result.error?.diagnostic || run?.output || result.error?.code || result.application;
    throw new Error(summarizePnpmFailure(diagnostic));
  }
}

async function installDesktopBundle(manager: DesktopPluginManager, target: string): Promise<PluginManagerResult> {
  // 🔴 全新安装必须 enabled: true。
  // 之前这里对「首次安装」也传 enabled:false，于是 installBundle 跳过了 selectBundle，
  // 包装进了 dependencies 却没进 profile 的 dsh.profile.bundles —— 重启 DSH 也不会加载，
  // 用户必须去 DSH 插件页手动点一次「启用」，表现就是"装完为什么不直接启用"。
  // 更新路径不受影响：already-installed 时下面会读回原有启用状态再重装。
  const first = await manager.installBundle(target, { enabled: true });
  if (first.error?.code !== 'already-installed') return first;
  const name = /^(@[^/]+\/[^@]+|[^@]+)(?:@.*)?$/.exec(target)?.[1];
  const bundle = (await manager.listBundles?.())?.find(row => row.name === name);
  if (!name || !bundle) throw new Error('无法确定已安装插件的状态，更新已停止。');
  if (!bundle.removable) throw new Error('该插件受桌面端保护，无法在运行中替换，请通过桌面端管理功能更新。');
  const spec = bundle.source ?? profileDeps(profileDir('desktop'))?.[name];
  // 精确版本用于失败恢复，避免恢复时又解析到新版本。
  const restore = bundle.version && spec && !/^(?:link:|file:|github:|git|https?:)/i.test(spec)
    ? `${name}@${bundle.version}` : spec;
  if (!restore) throw new Error('无法读取插件原始安装来源，更新已停止。');
  const pendingFile = join(profileDir('desktop'), '.plugin-manager', 'market-pending-updates.json');
  let pending: Record<string, { enabled: boolean; entries?: string[] }> = {};
  try { pending = JSON.parse(readFileSync(pendingFile, 'utf8')); } catch { /* 首次更新 */ }
  const enabled = pending[name]?.enabled ?? bundle.enabled;
  const savePending = () => {
    mkdirSync(dirname(pendingFile), { recursive: true });
    writeFileSync(pendingFile, JSON.stringify(pending, null, 2));
  };
  // removeBundle 可能先保存停用状态，再因运行实例无法卸载而失败。
  // 在调用前记录原状态，让重启后的再次更新仍能恢复原来的选择。
  const activeEntries = (await manager.listPlugins?.() ?? []).filter(row => row.moduleName === name && row.enabled);
  if (activeEntries.some(row => !row.entryId || row.readOnlyReason) || (activeEntries.length && !manager.setPluginEnabled)) {
    throw new Error('插件存在无法由宿主管理器停用的加载项，更新已停止。');
  }
  const entries = [...new Set([...(pending[name]?.entries ?? []), ...activeEntries.map(row => row.entryId!)])];
  pending[name] = { enabled, entries };
  savePending();
  const restoreEntries = async () => {
    for (const id of entries) {
      if (!manager.setPluginEnabled) throw new Error('宿主缺少插件条目启用接口');
      checkManagerResult(await manager.setPluginEnabled(id, true));
    }
  };
  progress.lastLine = '正在停止旧版插件并准备更新…';
  for (const row of activeEntries) checkManagerResult(await manager.setPluginEnabled!(row.entryId!, false));
  const removed = await manager.removeBundle(name);
  if (removed.error?.code === 'bundle-in-use') {
    throw new Error('旧版插件仍在运行，桌面端无法热卸载。已保存更新前的启用状态，请完全退出并重新打开 DeepSeek Harness，然后再次点击该插件的更新；更新成功后会恢复原来的启用状态。');
  }
  checkManagerResult(removed);
  let updated: PluginManagerResult;
  try {
    updated = await manager.installBundle(target, { enabled });
    checkManagerResult(updated);
  } catch (error) {
    const rawReason = error instanceof Error ? error.message : String(error);
    const reason = /ERR_PNPM_RESOLUTION_POLICY_VIOLATIONS_UNHANDLED|handleResolutionPolicyViolations callback/i.test(rawReason)
      ? '目标版本或其依赖仍处于 pnpm minimumReleaseAge 供应链观察期；当前 DSH Desktop 内置 pnpm 无法正确处理该拦截。为保证安全未关闭策略，请等待发布满 24 小时后再更新'
      : rawReason;
    progress.lastLine = '更新失败，正在恢复旧版插件…';
    try {
      checkManagerResult(await manager.installBundle(restore, { enabled }));
      await restoreEntries();
      delete pending[name];
      savePending();
    } catch (restoreError) {
      throw new Error(`更新失败：${reason}；恢复旧版失败：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
    throw new Error(`更新失败：${reason}；已恢复旧版插件`);
  }
  // 文件已经更新成功时，启用失败不能再尝试安装旧包覆盖新版。
  await restoreEntries();
  delete pending[name];
  savePending();
  return updated;
}

/**
 * 启用一个已安装但未被选中的插件。
 *
 * DSH 把「已安装」和「已启用」分开记：依赖在 profile 的 `dependencies` 里，
 * 生效与否看 `dsh.profile.bundles`。桌面端官方插件页装完会给一个「立即启用」按钮
 * （内部就是 setBundleEnabled → selectBundle），本插件安装时已直接启用，
 * 这里补的是「装过但被跳过启用 / 旧版本装完没启用」的场景。
 *
 * @param pkg 包名（必须已在目标 profile 的 dependencies 里）
 * @param profile 目标 profile
 * @returns 是否真的改动、以及是否需要重启才生效
 */
export async function enableInstalledPlugin(
  pkg: string,
  profile = currentProfile(),
): Promise<{ pkg: string; profile: string; enabled: boolean; changed: boolean; restartRequired: boolean }> {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  const deps = profileDeps(profileDir(profile));
  if (!deps || !(pkg in deps)) throw new Error(`${profile} profile 未安装 ${pkg}，无法启用`);
  if (profile === 'desktop') {
    // 以磁盘上的 dsh.profile.bundles 为准判断"是否已启用"（这是宿主启动时读的事实），
    // 不依赖 manager 是否可用 —— 否则在非宿主进程里会把已生效的插件误报成未登记。
    if (readProfileBundles('desktop').includes(pkg)) {
      return { pkg, profile, enabled: true, changed: false, restartRequired: false };
    }
    const manager = desktopManager();
    if (manager?.setBundleEnabled) {
      const result = await manager.setBundleEnabled(pkg, true);
      checkManagerResult(result);
      // application==='applied' 表示宿主已热加载；否则要重启
      return { pkg, profile, enabled: true, changed: true, restartRequired: result.application !== 'applied' };
    }
  }
  const dir = profileDir(profile);
  const manifestFile = join(dir, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } };
  };
  const previous = manifest.dsh?.profile?.bundles ?? [];
  if (previous.includes(pkg)) return { pkg, profile, enabled: true, changed: false, restartRequired: false };
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: [...previous, pkg] } };
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return { pkg, profile, enabled: true, changed: true, restartRequired: true };
}

// 每次操作读取服务，避免服务重载后保留失效的 manager 实例。
let desktopManager: () => DesktopPluginManager | undefined = () => undefined;
export function configureDesktopPluginManager(getManager: () => DesktopPluginManager | undefined): void {
  desktopManager = getManager;
}

async function runDesktopPlugin(command: 'add' | 'remove', target: string): Promise<string> {
  beginProgress(target);
  progress.logPath = null;
  progress.phase = 'installing';
  progress.lastLine = '正在通过桌面端插件管理器处理…';
  try {
    const manager = desktopManager();
    if (!manager) throw new Error('桌面端 pluginManager 服务不可用，请重启或升级 DeepSeek Harness 后重试。');
    const result = command === 'add'
      ? await installDesktopBundle(manager, target)
      : await manager.removeBundle(target);
    const run = result.packageResult;
    progress.logPath = run?.logPath ?? null;
    if (result.application === 'failed' || result.application === 'cancelled' || result.error || run?.timedOut || (run && run.exitCode !== 0)) {
      const diagnostic = result.error?.diagnostic || run?.output || result.error?.code || result.application;
      throw new Error(summarizePnpmFailure(diagnostic));
    }
    progress.phase = 'done';
    progress.lastLine = '操作完成，重启 DSH 后生效';
    return run?.output ?? progress.lastLine;
  } catch (err) {
    progress.error = (err instanceof Error ? err.message : String(err)).slice(0, 800);
    throw err;
  } finally {
    progress.active = false;
  }
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
  /** 最近一次操作的过程日志（完整 pnpm/dsh 输出），反馈问题时把该文件发给开发者 */
  logPath: null as string | null,
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

/**
 * 🔴 Electron 桌面端专用 CLI 入口（2026-10-19 修）。
 *
 * 事故（用户机器实测）：桌面端里点「更新」，报
 *   error: profile "desktop" is managed exclusively by the Electron application
 * 根因：desktop 是 Electron 保留 profile，普通 CLI 入口（profiles/.../lib/bin.js，
 * 无参数调用 runCli）在 parseDshArgs 里被 rejectElectronProfile 直接拒掉；只有
 * 桌面端自带的 dsh-desktop-host/lib/cli.js 会带 manageDesktopProfile: true 放行，
 * 并附带应用自带的 pnpm。所以桌面端必须走这个入口，而不是 profiles 下的通用 bin.js。
 */
export function desktopDshEntry(): { file: string; args: string[]; env: Record<string, string> } | null {
  const versions = process.versions as Record<string, string | undefined>;
  if (!versions.electron) return null; // 只有 Electron 进程（桌面端宿主）才走这条路
  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath;
  if (!resources) return null;
  const cli = join(resources, 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js');
  if (!existsSync(cli)) return null;
  const runtimeBin = join(resources, 'runtime', 'bin');
  return {
    file: process.execPath,
    args: ['--expose-internals', cli],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
      PATH: `${runtimeBin}${delimiter}${process.env.PATH ?? ''}`,
    },
  };
}

/**
 * 🔴 找一个「不依赖 PATH 的 dsh 入口」（2026-10-19 修）。
 *
 * 事故（用户机器实测）：桌面端 GUI 启动时 process.argv[1] 是 Electron 主入口，不匹配
 * bin\.js$ / dsh$，dshArgv 直接退化成裸调 `dsh`；而那台机器从未启用 DSH 的 PATH 注册
 * （官方注册机制存在但默认不开），cmd 报 "'dsh' 不是内部或外部命令"，安装/自我升级全挂。
 *
 * 修复：按官方 dsh.cmd shim 的两段路径反推固定落盘位置，全部 existsSync 校验：
 *   ① runtime 自带 node：~/.dsh/dsh-runtimes/<name>/dependencies/node/bin/node.exe
 *   ② CLI 实体：~/.dsh/profiles/node_modules/@deepseek-ai/dsh/lib/bin.js
 * 两者都存在 → 用 node 直接跑 bin.js，完全绕开 PATH。
 */
export function bundledDshEntry(): { file: string; args: string[]; cwd: string } | null {
  const home = dshHome();
  // ① 找一个自带 node 的 runtime（dsh-primary-runtime 是默认名，但别写死）
  let nodeExe: string | null = null;
  try {
    const runtimesDir = join(home, 'dsh-runtimes');
    for (const name of readdirSync(runtimesDir)) {
      const candidate = join(runtimesDir, name, 'dependencies', 'node', 'bin', process.platform === 'win32' ? 'node.exe' : 'bin', 'node');
      const winCandidate = join(runtimesDir, name, 'dependencies', 'node', 'bin', 'node.exe');
      const posixCandidate = join(runtimesDir, name, 'dependencies', 'node', 'bin', 'node');
      const target = process.platform === 'win32' ? winCandidate : posixCandidate;
      if (existsSync(target)) { nodeExe = target; break; }
      if (process.platform !== 'win32' && existsSync(candidate)) { nodeExe = candidate; break; }
    }
  } catch { /* 无 runtimes 目录 */ }
  // ② CLI 实体（官方 shim 硬编码的就是这个路径）
  const binJs = join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  if (!existsSync(binJs)) return null;
  // node 找不到时退回当前进程（桌面端进程即 Electron 的 node，能跑 JS 入口）
  const node = nodeExe ?? process.execPath;
  return { file: node, args: [binJs], cwd: dirname(binJs) };
}

/** 定位当前 dsh 进程入口（优先复用本进程 node，避免 PATH 环境差异） */
export function dshArgv(input: { argv?: string[]; execArgv?: string[]; execPath?: string; argv0?: string; platform?: NodeJS.Platform } = {}): { file: string; args: string[]; cwd?: string; viaShell: boolean; env?: Record<string, string> } {
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
  // 桌面端（Electron 宿主）优先用桌面自带 CLI：profiles 下的通用 bin.js 会拒绝
  // 保留 profile "desktop"，且不带应用自带的 pnpm。
  const desktop = desktopDshEntry();
  if (desktop) return { ...desktop, viaShell: false };
  // 自身 argv 不像 CLI 入口（典型：桌面端 GUI）：先试 DSH 自带的固定位置，
  // 彻底找不到才退回 PATH 里的 dsh —— 那台没启用 PATH 注册的机器靠这步救回来。
  const bundled = bundledDshEntry();
  if (bundled) return { ...bundled, viaShell: false };
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
    logPath: progress.logPath,
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

/**
 * 从 pnpm 的 lockfile 校验报错里抠出被拦下的 `name@version`。
 * 报错形如：
 *   [ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION] 1 lockfile entries failed verification:
 *     dsh-plugin@2.0.4 was published at 2026-10-18T12:06:14.059Z, ...
 * 这些是**已装依赖**，来源规格往往不是精确版本（例如 `pkg@latest`），
 * 所以必须按报错里列出的条目逐个写进 minimumReleaseAgeExclude。
 */
export function releaseAgeBlockedEntries(text: string): string[] {
  const found: string[] = [];
  const re = /(?:^|\s)((?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s+was published at/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const entry = `${match[1]}@${match[2]}`;
    if (!found.includes(entry)) found.push(entry);
  }
  return found;
}

export function rewritePnpmError(err: unknown): Error {
  const text = err instanceof Error ? err.message : String(err);
  if (isPrepareBlocked(text)) {
    return new Error('该插件需要构建脚本（prepare），pnpm 默认拦截。广场安装会写入 profile 的 dangerouslyAllowAllBuilds 并重试；若仍失败请检查 web profile 是否可写。');
  }
  if (isReleaseAgeBlocked(text)) {
    return new Error('该版本刚发布，被 pnpm 供应链冷却期（minimumReleaseAge）拦截。广场安装会把该版本写入 pnpm-workspace.yaml 的 minimumReleaseAgeExclude 并重试；若仍失败请手动添加该排除项。');
  }
  if (/ERR_PNPM_UNEXPECTED_STORE|currently linked from the store at|ERR_PNPM_UNEXPECTED_VIRTUAL_STORE_DIR/.test(text)) {
    return new Error('当前 profile 的 node_modules 由另一个版本的 pnpm（不同 store）生成，需要先重建依赖。');
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
  if (profile === 'desktop') {
    const command = pluginArgs[0];
    if ((command !== 'add' && command !== 'remove') || pluginArgs.length !== 2) {
      throw new Error('desktop profile 的依赖维护必须由桌面端插件管理器处理。');
    }
    return runDesktopPlugin(command, target);
  }
  const argv = dshArgv();
  const dir = profileDir(profile);
  const prepared = preparePluginArgs(dir, pluginArgs);
  const tracker = beginProgress(target);
  const feed = makeProgressFeeder(tracker);
  // 🔴 完整过程日志（2026-10-19 加）：远程用户报"安装/升级失败"时，面板里的报错经
  // summarizePnpmFailure 提炼，会丢掉 pnpm/dsh 的原始输出；让他们取这个文件回来即可定位，
  // 不用会话还在、面板还开着。失败与成功都落盘，每次操作一个文件。
  const logDir = join(dir, '.plugin-manager', 'logs', `operation-${opStamp()}`);
  let logFile: string | null = null;
  try {
    mkdirSync(logDir, { recursive: true });
    logFile = join(logDir, 'install.log');
    progress.logPath = logFile;
    appendLog(logFile, `# ${new Date().toISOString()} profile=${profile} args=${JSON.stringify(prepared)}`);
    appendLog(logFile, `# entry=${argv.file} ${JSON.stringify(argv.args)} viaShell=${argv.viaShell}`);
    if (argv.env) appendLog(logFile, `# entryEnv=${JSON.stringify(Object.keys(argv.env))}`);
    appendLog(logFile, `# platform=${process.platform} node=${process.version} pnpm=(managed by dsh)`);
  } catch {
    /* 日志写不进去不能阻塞安装 */
  }
  try {
    return await runCommand(argv.file, [...argv.args, 'plugin', '--profile', profile, ...prepared], {
      cwd: argv.cwd,
      timeoutMs: INSTALL_TIMEOUT_MS,
      // 桌面端入口需要 ELECTRON_RUN_AS_NODE / DSH_DESKTOP_NODE_EXECUTABLE / PATH 才跑得起来
      env: { ...(argv.env ?? {}), CI: 'true' },
      viaShell: argv.viaShell,
      detached: process.platform !== 'win32',
      onChunk: (text) => {
        feed(text);
        syncProgress(tracker);
        if (logFile) appendLog(logFile, text);
      },
    });
  } catch (err) {
    // 超时/失败时把原因写入状态端点，轮询侧才能看到错误终态
    const text = err instanceof Error ? err.message : String(err);
    if (progress.error === null) progress.error = text.slice(0, 800);
    if (logFile) appendLog(logFile, `# FAILED: ${text.slice(0, 4000)}`);
    throw err;
  } finally {
    progress.active = false;
    if (logFile) appendLog(logFile, `# end ${new Date().toISOString()}`);
  }
}

function opStamp(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendLog(file: string, text: string): void {
  try {
    appendFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  } catch {
    /* 日志失败不影响安装主流程 */
  }
}

/**
 * 重建 profile 依赖（node_modules 由别的 pnpm/store 生成、hoist 差异等场景）。
 * 🔴 加 `--config.minimumReleaseAge=0`：重建会把 lockfile 里**所有**条目重新过一遍
 * 供应链冷却期校验，而 profile 里往往已经有刚发布的插件；不放开这道闸，重建必挂。
 */
export function rebuildProfileDeps(profile: string): Promise<string> {
  return runDshPlugin(profile, ['install', '--no-frozen-lockfile', '--config.minimumReleaseAge=0']);
}

/** 安装主链：add →（store 不一致/hoist 差异）重建依赖 →（冷却期）放开被拦版本 →（prepare 拦截）allowAllBuilds */
export async function addDshPlugin(source: string, profile = currentProfile()): Promise<string> {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  // 桌面端由 manager 负责锁、回滚与依赖策略，不执行 CLI 的文件改写/重建重试。
  if (profile === 'desktop') return runDshPlugin(profile, ['add', source]);
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
    // 被拦下的可能是「已装依赖」而不只是本次目标（lockfile 校验会扫全部条目），
    // 所以按报错里列出的精确版本逐个写进 minimumReleaseAgeExclude，再原样重试。
    const blocked = releaseAgeBlockedEntries(text);
    if (blocked.length === 0) writeMinimumReleaseAgeExclude(dir, source);
    for (const entry of blocked) writeMinimumReleaseAgeExclude(dir, entry);
    try {
      return await runDshPlugin(profile, ['add', source]);
    } catch (retryErr) {
      return await retryAfterPrepare(retryErr);
    }
  };
  const retryAfterRebuild = async (err: unknown) => {
    const text = err instanceof Error ? err.message : String(err);
    if (!/ERR_PNPM_UNEXPECTED_STORE|currently linked from the store at|ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF|ERR_PNPM_UNEXPECTED_VIRTUAL_STORE_DIR/.test(text)) {
      return await retryAfterReleaseAge(err);
    }
    await rebuildProfileDeps(profile);
    try {
      return await runDshPlugin(profile, ['add', source]);
    } catch (retryErr) {
      return await retryAfterReleaseAge(retryErr);
    }
  };
  try {
    return await runDshPlugin(profile, ['add', source]);
  } catch (err) {
    return await retryAfterRebuild(err);
  }
}

/** 卸载主链：remove →（hoist 差异）重建依赖后重试 */
export async function removeDshPlugin(pkg: string, profile = currentProfile()): Promise<string> {
  if (!isSafeProfile(profile)) throw new Error(`非法 profile 名: ${profile}`);
  if (profile === 'desktop') return runDshPlugin(profile, ['remove', pkg]);
  try {
    return await runDshPlugin(profile, ['remove', pkg]);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF|ERR_PNPM_UNEXPECTED_STORE|currently linked from the store at|ERR_PNPM_UNEXPECTED_VIRTUAL_STORE_DIR/.test(text)) {
      await rebuildProfileDeps(profile);
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

/**
 * 同源一键重启。
 * - **web**（命令行 `dsh web`）：spawn 独立 helper，等端口释放后按原入口拉起；
 * - **desktop**（Electron 桌面端）：`dsh web` 与 GUI 无关，必须走 Electron 的
 *   `app.relaunch() + app.quit()`；**拿不到 Electron API 时不做任何进程操作**，
 *   把"怎么重启"交回用户（manual），绝不"假装重启"。
 *
 * 仅接受同源请求（防盗链重启）。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { IncomingMessage } from 'node:http';

/* ============================ 运行环境识别 ============================ */

export type RuntimeKind = 'desktop' | 'web';

/**
 * 桌面端判定（任一命中即可）：
 * - `process.versions.electron` 有值 ⇒ 当前就是 Electron 主进程；
 * - 可执行文件是桌面应用的（`DeepSeek Harness.exe`）。
 */
export function detectRuntime(): RuntimeKind {
  const versions = process.versions as Record<string, string | undefined>;
  if (versions && versions.electron) return 'desktop';
  if (/DeepSeek\s*Harness/i.test(process.execPath || '')) return 'desktop';
  return 'web';
}

/* ============================ 重启入口 ============================ */

/** Electron 运行时里我们用到的最小面（不依赖 electron 类型包） */
interface ElectronAppLike {
  relaunch?: () => void;
  quit?: () => void;
  exit?: (code?: number) => void;
}

interface ElectronModuleLike {
  app?: ElectronAppLike;
}

export interface RestartResult {
  pid: number | null;
  helperPid: number | null;
  via: string;
}

export interface DesktopRestartResult {
  /** electron-relaunch = 已安排应用级重启；manual = 做不到，请用户手动重启 */
  via: 'electron-relaunch' | 'manual';
  manual: boolean;
}

/** Node 的 Timeout 在 DOM lib 下会被推断成 number，这里统一做一次 unref 兜底 */
function unrefTimer(timer: unknown): void {
  const t = timer as { unref?: () => void } | null;
  if (t && typeof t.unref === 'function') t.unref();
}

/**
 * 桌面端重启：延迟到 HTTP 响应发出之后，再 `relaunch()` + `quit()`。
 *
 * `require('electron')` 有两种"拿不到 API"的情形，都安全降级为 manual：
 * 1. 宿主不是 Electron 主进程（模块不存在 ⇒ 抛错）；
 * 2. 命中 npm 上的 electron 包（返回的是可执行文件路径字符串，没有 `app`）。
 *
 * `quit()` 是"礼貌退出"，若被 `before-quit`（托盘常驻不退出之类）拦下，
 * `forceExitAfterMs` 后兜底 `exit(0)` 强制退出 —— 此时 `relaunch()` 已安排好新实例。
 */
export function restartDesktopApp(delayMs = 400, forceExitAfterMs = 2500): DesktopRestartResult {
  let electronModule: ElectronModuleLike | null = null;
  try {
    electronModule = createRequire(import.meta.url)('electron') as ElectronModuleLike;
  } catch {
    electronModule = null;
  }
  // 先取出引用再判类型：直接对可选属性做 typeof 窄化会被 TS 收窄成 never
  const app = electronModule && electronModule.app;
  const relaunch = app && app.relaunch;
  const quit = app && app.quit;
  const forceExit = app && app.exit;
  if (typeof relaunch !== 'function' || typeof quit !== 'function') {
    return { via: 'manual', manual: true };
  }
  const timer = setTimeout(() => {
    try {
      relaunch();
    } catch {
      /* ignore */
    }
    try {
      quit();
    } catch {
      /* ignore */
    }
    // quit 被拦下时，兜底强制退出（relaunch 已安排好新实例）
    const force = setTimeout(() => {
      if (typeof forceExit === 'function') {
        try {
          forceExit(0);
        } catch {
          /* ignore */
        }
      }
    }, forceExitAfterMs);
    unrefTimer(force);
  }, delayMs);
  // 别让这个 timer 拖住进程退出
  unrefTimer(timer);
  return { via: 'electron-relaunch', manual: false };
}

/* ============================ 重启防重标记 ============================ */

/**
 * 「已安排重启」防重窗口。
 * 重启成功时本进程会消失，标记无所谓；但若重启没生效（端口没释放、helper 挂了、
 * 桌面端 GUI 没被拉起），进程仍在 ⇒ 标记不能永久置位，否则用户会一直卡在
 * `restart already scheduled` 上。这里用时间戳惰性过期，无需定时器。
 * 时间参数可注入，便于测试。
 */
const RESTART_PENDING_TTL_MS = 20_000;
let restartingAt = 0;

export function markRestartPending(at = Date.now()): void {
  restartingAt = at;
}

export function isRestartPending(at = Date.now()): boolean {
  return restartingAt > 0 && at - restartingAt < RESTART_PENDING_TTL_MS;
}

/* ============================ web 端重启 ============================ */

/** 同源判定：host 为环回或与 req 头一致（反向代理场景由 Header 透传保证） */
export function trustedRestartRequest(req: IncomingMessage): boolean {
  const host = String(req.headers.host || '');
  if (!host) return false;
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) || !!req.headers['sec-fetch-site'];
}

export function servingPort(req: IncomingMessage): number {
  const host = String(req.headers.host || '');
  const m = /:(\d+)$/.exec(host);
  if (m) return Number(m[1]);
  return 443;
}

/**
 * 计划重启（仅 web）：spawn 一个独立 helper 进程，等当前进程退出后按原入口重启。
 * 本函数只负责「安排」重启，不阻塞响应。
 */
export function scheduleRestart(port: number): RestartResult {
  const argv = process.argv;
  const entry = argv[1] ?? '';
  const isDshEntry = /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry);
  const node = process.execPath;
  const helperScript = `
const { spawn } = require('node:child_process');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  // 等主进程释放端口（最多 30s），再拉起新进程
  for (let i = 0; i < 60; i++) {
    const ok = await new Promise((resolve) => {
      const net = require('node:net');
      const s = net.connect(${port}, '127.0.0.1');
      s.once('error', () => resolve(false));
      s.once('connect', () => { s.destroy(); resolve(true); });
    });
    if (!ok) break;
    await wait(500);
  }
  const child = spawn(${JSON.stringify(isDshEntry ? node : 'dsh')}, ${JSON.stringify(isDshEntry ? [...process.execArgv, entry, 'web', '--port', String(port)] : ['web', '--port', String(port)])}, {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  process.exit(0);
})();
`;
  const helper = spawn(node, ['-e', helperScript], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  helper.unref();
  return { pid: null, helperPid: helper.pid ?? null, via: isDshEntry ? 'respawn-entry' : 'respawn-dsh' };
}

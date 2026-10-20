/**
 * 结构化操作日志（对齐 dsh-plugin-hub 的 log.ts 设计，按本项目现状裁剪+拓展）。
 *
 * 每条 = level × category × event × message，JSONL 追加到 ~/.dsh/baitong-market.log。
 *   level    debug/info/success/warn/error —— 区分正常与异常
 *   category install/uninstall/update/diagnostics/settings/system —— 按操作域分类，
 *            查看器可按「安装时哪步不兼容」「卸载时哪步不兼容」针对性排查
 * 写入失败绝不影响主流程；读取时超过 MAX_LOG_LINES 就地裁剪，防无限膨胀。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, truncateSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { dshHome } from './config-store.js';

export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';
export type LogCategory = 'install' | 'uninstall' | 'update' | 'diagnostics' | 'settings' | 'system';

export interface LogEntry {
  at: number;
  level: LogLevel;
  category: LogCategory;
  /** 机器可读事件码：install.start / settings.update */
  event: string;
  /** 人类可读描述 */
  message: string;
}

export const LEVELS: LogLevel[] = ['debug', 'info', 'success', 'warn', 'error'];
export const CATEGORIES: LogCategory[] = ['install', 'uninstall', 'update', 'diagnostics', 'settings', 'system'];
export const MAX_LOG_LINES = 2000;

/**
 * 日志文件路径。
 * 🔴 用 join 拼（原生分隔符）：早期用字符串模板手拼目录和文件名，会得到
 * 「盘符路径 + 正斜杠文件名」这种混合分隔符的结果 —— 文件系统读写没问题，
 * 但 Windows explorer 的 /select, 定位会静默失败（窗口开了却不选中目标）。
 */
export function logFilePath(): string {
  return normalize(join(dshHome(), 'baitong-market.log'));
}

/** 追加一条（失败静默：日志是辅助设施） */
export function appendLog(level: LogLevel, category: LogCategory, event: string, message: string): void {
  const entry: LogEntry = { at: Date.now(), level, category, event, message: message.slice(0, 500) };
  try {
    const file = logFilePath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    /* 主流程不受影响 */
  }
}

/** 清空所有日志（截断文件）；返回是否成功。调用方随后自行追加一条"已清空"记录 */
export function clearLogs(): boolean {
  try {
    const file = logFilePath();
    if (!existsSync(file)) return true;
    truncateSync(file);
    return true;
  } catch {
    return false;
  }
}

export interface ReadLogOptions {
  offset?: number;
  limit?: number;
  category?: LogCategory | 'all';
  level?: LogLevel | 'all';
  query?: string;
}

/** 读取（倒序，最新在前）+ 过滤 + 分页；超过上限先裁剪文件 */
export function readLogs(opts: ReadLogOptions = {}): { entries: LogEntry[]; total: number } {
  const file = logFilePath();
  if (!existsSync(file)) return { entries: [], total: 0 };
  try {
    if (statSync(file).size > 1024 * 1024) {
      // 超过 1MB：只留最近 MAX_LOG_LINES 行（裁剪失败忽略，读侧照常进行）
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      truncateSync(file);
      appendFileSync(file, lines.slice(-MAX_LOG_LINES).join('\n') + '\n');
    }
    const all = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line): LogEntry | null => {
      try {
        const p = JSON.parse(line) as Record<string, unknown>;
        if (!p || typeof p !== 'object') return null;
        return {
          at: Number(p.at) || 0,
          level: LEVELS.includes(p.level as LogLevel) ? (p.level as LogLevel) : 'info',
          category: CATEGORIES.includes(p.category as LogCategory) ? (p.category as LogCategory) : 'system',
          event: String(p.event || ''),
          message: String(p.message || ''),
        };
      } catch {
        return null;
      }
    }).filter((it): it is LogEntry => !!it);
    let filtered = all.reverse();
    if (opts.category && opts.category !== 'all') filtered = filtered.filter((e) => e.category === opts.category);
    if (opts.level && opts.level !== 'all') filtered = filtered.filter((e) => e.level === opts.level);
    if (opts.query) {
      const q = opts.query.toLowerCase();
      filtered = filtered.filter((e) => e.event.toLowerCase().includes(q) || e.message.toLowerCase().includes(q));
    }
    const offset = Math.max(0, opts.offset || 0);
    const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
    return { entries: filtered.slice(offset, offset + limit), total: filtered.length };
  } catch {
    return { entries: [], total: 0 };
  }
}

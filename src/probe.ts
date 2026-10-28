/**
 * 连通性探测（对齐 dsh-plugin-hub 的 DiagnosticsView/probe 设计）。
 *
 * 三个通道，每个 = 目标地址 + 实时状态徽标（200 OK 绿 / 不可达红 / 探测中灰）：
 *   npm      registry（配置的镜像 → 官方源）—— 安装链路的依赖来源
 *   github   github.com —— git 源插件与冲突预检的可达性
 *   catalog  百通 API 根 —— 本项目的数据源（dsh-plugin 对应目录站点）
 *
 * 流式 NDJSON 逐条上报：每个探测先发 running 行，完成发 ok/fail 行；
 * 客户端逐行渲染，单通道可重测（点行按钮）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchJson } from './http.js';
import { readEffectiveRegistry } from './registry.js';
import type { BaitongConfig } from './config-store.js';

export interface ProbeEvent {
  type: 'running' | 'ok' | 'fail';
  key: 'npm' | 'github' | 'catalog';
  ms?: number | null;
  status?: number | null;
  display?: string;
}

/** 单通道探测（HTTP GET + 计时；超时/异常 = fail，不抛出） */
async function probeOne(
  key: ProbeEvent['key'],
  url: string,
  timeoutMs: number,
  userAgent: string,
  send: (ev: ProbeEvent) => void,
): Promise<void> {
  const started = Date.now();
  send({ type: 'running', key, display: url });
  try {
    await fetchJson(url, { timeoutMs, userAgent });
    send({ type: 'ok', key, ms: Date.now() - started, status: 200, display: url });
  } catch (err) {
    const status = err instanceof Error && /status (d{3})/i.test(err.message)
      ? Number(/status (d{3})/i.exec(err.message)?.[1])
      : null;
    // 4xx/5xx 也算"有响应"：能拿到状态码说明网络通，问题在服务端
    if (status) send({ type: 'ok', key, ms: Date.now() - started, status, display: url });
    else send({ type: 'fail', key, ms: Date.now() - started, status: null, display: url });
  }
}

/**
 * 流式探测路由处理器：NDJSON 逐行写。
 * 只信任同源 POST（与 pluginRestart 同款防 CSRF 姿态）。
 */
export function trustedPost(req: IncomingMessage): boolean {
  try {
    const origin = req.headers.origin;
    const host = req.headers.host;
    return !origin || !host || new URL(String(origin)).host === String(host);
  } catch {
    return false;
  }
}

export async function handleProbe(req: IncomingMessage, res: ServerResponse, cfg: BaitongConfig, only?: string): Promise<void> {
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
  });
  const send = (ev: ProbeEvent) => {
    try {
      res.write(JSON.stringify(ev) + '\n');
    } catch {
      /* 客户端断开 */
    }
  };
  // 探测的必须是**安装时真正会去问**的那个源：设置页留空时跟随本机 npm 配置，
  // 不是凭空假设官方源（否则镜像挂了你这边还显示绿色）。
  const registryBase = cfg.npmRegistry?.trim() || readEffectiveRegistry();
  const timeout = Math.min(cfg.timeoutMs, 8000);
  const targets: [ProbeEvent['key'], string][] = [
    ['npm', `${registryBase.replace(/\/+$/, '')}/@baitongserver/dsh-plugin-market/latest`],
    ['github', 'https://api.github.com/repos/imyasonly/dsh-plugin-market'],
    ['catalog', `${cfg.apiBase.replace(/\/+$/, '')}/api/bt/dsh/plugins/categories`],
  ];
  const list = only ? targets.filter(([k]) => k === only) : targets;
  // 逐路串行：同时只打三个请求，且结果顺序稳定
  for (const [key, url] of list) {
    await probeOne(key, url, timeout, cfg.userAgent, send);
  }
  res.end();
}

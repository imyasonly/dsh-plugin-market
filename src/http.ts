/**
 * HTTP 基础设施：fetch JSON / fetch Bytes，带超时与 abort 信号。
 * 上游仅指向百通 API（配置可覆盖），不执行响应中的任何内容。
 */

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOpts {
  timeoutMs?: number;
  userAgent?: string;
  signal?: AbortSignal | null;
}

/**
 * undici 抛出的 `TypeError: fetch failed` 不含任何定位信息 ——
 * 真实原因（DNS 解析失败 / 连接被拒 / TLS / 超时）藏在 `error.cause` 链里，
 * 可能是 AggregateError（happy-eyeballs 的多路尝试）。展开成一行可读文案，
 * 否则线上排查只能靠猜。
 */
export function describeFetchFailure(err: unknown, url: string): string {
  if (!(err instanceof Error)) return `请求失败: ${String(err)}`;
  const details: string[] = [];
  const push = (text: string) => {
    if (text && !details.includes(text)) details.push(text);
  };
  const walk = (node: unknown, depth: number) => {
    if (!node || depth > 3) return;
    const c = node as { code?: unknown; message?: unknown; address?: unknown; port?: unknown; errors?: unknown; cause?: unknown };
    const code = typeof c.code === 'string' ? c.code : '';
    const addr = [c.address, c.port].filter((v) => v != null && v !== '').join(':');
    const msg = typeof c.message === 'string' && c.message !== 'fetch failed' ? c.message : '';
    push([code, addr || msg].filter(Boolean).join(' '));
    if (Array.isArray(c.errors)) for (const sub of c.errors as unknown[]) walk(sub, depth + 1);
    walk(c.cause, depth + 1);
  };
  walk(err.cause, 0);
  const base = err.name === 'AbortError' ? '请求被中止' : err.message && err.message !== 'fetch failed' ? err.message : '请求失败';
  return `${base}${details.length ? `（${details.join('; ')}）` : ''}: ${url}`;
}

/** 当前进程的代理类环境变量快照（排查 "fetch failed" 用；只有本机地址，不含机密） */
export function proxyEnvSnapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'NODE_USE_ENV_PROXY']) {
    const value = process.env[key];
    if (value) out[key] = value;
  }
  return out;
}

export async function fetchJson<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { body } = await fetchBytes(url, opts);
  const text = body.toString('utf8');
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`响应不是合法 JSON: ${text.slice(0, 200)}`);
  }
}

export async function fetchBytes(url: string, opts: FetchOpts = {}): Promise<{ body: Buffer; contentType: string }> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`拒绝非 http(s) 地址: ${url}`);
  }
  const timeoutMs = opts.timeoutMs ?? 20000;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': opts.userAgent ?? 'Mozilla/5.0 (compatible; baitong-market/0.1)',
        Accept: 'application/json, */*',
      },
      redirect: 'follow',
    });
    if (!res.ok) {
      throw new HttpError(res.status, `HTTP ${res.status} ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { body: buf, contentType: res.headers.get('content-type') ?? 'application/octet-stream' };
  } catch (err) {
    // HttpError（非 2xx）是业务错误，原样抛；其余是网络层失败，展开 cause 链
    if (err instanceof HttpError) throw err;
    if (timedOut) throw new Error(`请求超时（${timeoutMs}ms）: ${url}`);
    throw new Error(describeFetchFailure(err, url));
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

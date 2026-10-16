/**
 * pnpm `--reporter=ndjson` 进度解析。
 * 只解析、不执行：识别 phase（resolve/fetch/link/build）、包名、进度计数与错误行。
 */

export interface ProgressSnapshot {
  phase: string | null;
  done: number;
  total: number | null;
  currentPackage: string | null;
  downloaded: string | null;
  size: string | null;
  seen: boolean;
  error: string | null;
}

export interface ProgressTracker {
  feed(line: string): void;
  readonly snapshot: ProgressSnapshot;
}

export function createProgressTracker(): ProgressTracker {
  let phase: string | null = null;
  let done = 0;
  let total: number | null = null;
  let currentPackage: string | null = null;
  let downloaded: string | null = null;
  let size: string | null = null;
  let seen = false;
  let error: string | null = null;

  return {
    feed(line: string) {
      let obj: Record<string, unknown> | null = null;
      if (line.startsWith('{')) {
        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed === 'object') obj = parsed as Record<string, unknown>;
        } catch {
          return; // 半截 JSON（ndjson 行未完整）：丢弃
        }
      }
      if (obj) {
        seen = true;
        const keys = Object.keys(obj);
        if (keys.includes('name')) {
          const pkg = String(obj.name ?? '');
          const msg = String(obj.message ?? '');
          const progressVal = obj.progress as Record<string, unknown> | undefined;
          if (progressVal) currentPackage = pkg;
          if (/^Packages:?\s*\+?\d+\s*$/i.test(msg)) {
            const m = /\+?(\d+)/.exec(msg);
            if (m) done = Number(m[1]);
          }
          const totalMatch = /(?:Packages|Done):\s*\+?(\d+)\/(\d+)/.exec(msg);
          if (totalMatch) {
            done = Number(totalMatch[1]);
            total = Number(totalMatch[2]);
          }
          if (msg.includes('ERR_') || msg.includes('ELIFECYCLE')) error = msg.slice(0, 800);
        } else if (keys.includes('progress')) {
          const progressVal = obj.progress as Record<string, unknown> | undefined;
          if (progressVal) currentPackage = String(progressVal.packageId ?? progressVal.requestor ?? '') || currentPackage;
          if (typeof progressVal?.progress === 'string') {
            const dl = progressVal.progress as string;
            if (dl.includes('/')) {
              const [a, b] = dl.split('/');
              downloaded = a;
              size = b;
            }
          }
        }
        return;
      }
      // 纯文本行（fallback：非 ndjson 输出）
      if (/^Packages:\s*\+?(\d+)/.test(line)) {
        const m = /^Packages:\s*\+?(\d+)(?:\s*\/\s*(\d+))?/.exec(line);
        if (m) {
          done = Number(m[1]);
          if (m[2]) total = Number(m[2]);
        }
      }
      if (/ERR_|ELIFECYCLE|Command failed/.test(line)) error = line.slice(0, 800);
    },
    get snapshot(): ProgressSnapshot {
      return { phase, done, total, currentPackage, downloaded, size, seen, error };
    },
  };
}

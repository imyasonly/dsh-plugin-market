/**
 * 渲染器：工具返回值 → Agent 可读文本。
 * 核心纪律：卡片出现后只回一句短话；「还有吗」必须带 offset；
 * 禁止向用户复述内部清单；点名安装才调 install 工具。
 * 类型说明：value 按 JSON 值传入（dsh-tools JsonValue），内部宽松取字段。
 */

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
}

function asItems(value: unknown): Record<string, unknown>[] {
  const r = asRecord(value);
  return Array.isArray(r.items) ? (r.items.filter((it) => it && typeof it === 'object') as Record<string, unknown>[]) : [];
}

export function renderSkillSearch(value: unknown): string {
  const result = asRecord(value);
  const items = asItems(result);
  if (!items.length)
    return '没有找到相关技能。对用户只说一句：没找到，可以换个词再搜。不要写长文。';
  const lines = items.map((it, i) => `${i + 1}. ${String(it.name ?? '')}${it.installed ? '（已安装）' : ''} · ${String(it.slug ?? '')}`);
  const start = Number(result.offset) || 0;
  const shown = start + items.length;
  const more = result.hasMore
    ? `用户若问还有吗，立刻再调用 baitong_skill_search 一次，query 仍为「${String(result.query ?? '')}」，offset=${shown}。`
    : '已经全部列出。';
  return [
    `卡片已展示 ${items.length} 条（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    `对用户最多回一句短话。禁止清单和长文。不要再调用 baitong_skill_search。${more}`,
  ].join('\n');
}

export function renderSkillInstall(value: unknown): string {
  const result = asRecord(value);
  return `✅ ${String(result.name ?? '')} 已安装到 ${String(result.path ?? '')}。新对话即可被 skill 工具发现。不要打印安装命令。`;
}

export function renderSkillList(value: unknown): string {
  const result = asRecord(value);
  const items = asItems(result);
  if (!items.length)
    return `还没有安装技能。目录：${String(result.skillsDir ?? '')}`;
  const lines = items.map((it, i) => `${i + 1}. ${String(it.name ?? '')} (${String(it.slug ?? '')})${it.version ? ` v${String(it.version)}` : ''}`);
  return `已安装 ${items.length} 个技能（${String(result.skillsDir ?? '')}）：\n${lines.join('\n')}`;
}

export function renderPluginSearch(value: unknown): string {
  const result = asRecord(value);
  const items = asItems(result);
  if (!items.length) {
    if ((Number(result.offset) || 0) > 0)
      return '本页没有新的插件了。对用户只说一句：没有了，前面都列过了。不要写长文。绝对禁止再次调用 baitong_plugin_search。';
    return '没有找到相关插件。对用户只说一句：没找到，可以换个词再搜。不要写长文。';
  }
  const lines = items.map((it, i) => `${i + 1}. ${String(it.owner ?? '')}/${String(it.name ?? '')}${it.installed ? '（已安装）' : ''}`);
  const start = Number(result.offset) || 0;
  const shown = start + items.length;
  const more = result.hasMore
    ? `用户若问还有吗，立刻再调用 baitong_plugin_search 一次，query 仍为「${String(result.query ?? '')}」且必须带 offset=${shown}。不带 offset 或 offset=0 会把上面 ${items.length} 张卡片原样再展示一遍，属于严重错误，绝对禁止。`
    : `已经全部列出。用户再问还有吗时，直接回答"没有了，前面都列过了"，绝对禁止再次调用 baitong_plugin_search。`;
  return [
    `插件卡片已展示 ${items.length} 条（内部序号，禁止复述给用户）：`,
    lines.join('\n'),
    `对用户最多回一句短话。禁止清单和长文。不要再调用 baitong_plugin_search。用户点名安装时才调 baitong_plugin_install（owner+name）。${more}`,
  ].join('\n');
}

export function renderPluginInstall(value: unknown): string {
  const result = asRecord(value);
  return `✅ ${String(result.fullName ?? '')} 已安装，请重启 DSH 后生效。对用户只说一句含重启提示的短话。不要打印安装命令。`;
}

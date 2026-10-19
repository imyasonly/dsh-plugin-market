/**
 * 百通插件广场 · Cordis 宿主入口。
 * 职责：注册 6 个 Agent 工具（插件搜索/安装 + 技能搜索/安装/列表/卸载）、
 *      注入 systemPrompt 行为约束、挂本机 HTTP 服务（/baitong-market）、注册设置页。
 * 数据源：百通后端公开 API（插件 /api/bt/dsh/plugins/**，技能 /api/v1/*）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import Schema from '@deepseek-ai/schemastery';
import { cloneJson, renderSkillSearch, renderSkillInstall, renderSkillList, renderPluginSearch, renderPluginInstall } from './renders.js';
import { searchBaitongSkills, installBaitongSkill, listInstalledSkills, uninstallBaitongSkill, installedSlugs, parseSkillCategory, SKILL_CATEGORY_KEYS } from './skill-market.js';
import { withDefaults, assignConfig, readOverlay, envApiBase, DEFAULT_API_BASE, type BaitongConfig } from './config-store.js';
import { searchBaitongPlugins, installBaitongPlugin, PLUGIN_CATEGORY_KEYS, withPluginInstallLock } from './plugin-market.js';
import { handleApi, handleIcon, handleLogo } from './local-api.js';
import { handleProbe as handleProbeRoute } from './probe.js';
import { appendLog } from './oplog.js';
import { currentPluginVersion } from './local-api.js';
import { currentProfile } from './dsh-cli.js';
import { INSTALL_TIMEOUT_MS } from './dsh-cli.js';

export const name = 'baitong-plugin-market';
export const inject = ['tools'];

/** 插件配置（设置页可见；apiBase 可在设置/cordis.patch.yml 覆盖指向私有化部署） */
export const Config = Schema.object({
  apiBase: Schema.string().default(envApiBase() ?? DEFAULT_API_BASE).description(`百通 API 根地址（不含 /api）；本地联调设环境变量 BAITONG_API_BASE，如 http://127.0.0.1:5500`),
  skillsDir: Schema.string().description('技能安装目录，默认 $DSH_HOME/skills'),
  timeoutMs: Schema.number().default(20000).description('上游请求超时（毫秒）'),
  userAgent: Schema.string().default('Mozilla/5.0 (compatible; baitong-market/0.1)').description('请求 UA'),
  maxResults: Schema.number().default(12).description('搜索结果上限'),
  npmRegistry: Schema.string().description('npm 镜像源（留空跟随本机 npm 配置）'),
  checkUpdatesOnStart: Schema.boolean().default(true).description('启动时检查插件更新'),
});

/** Cordis 上下文最小形态（宿主注入；inject 按服务名解构回调） */
interface HostCtx {
  tools: { register: (tool: unknown) => void };
  inject: (services: string[], cb: (...c: unknown[]) => void) => void;
}

/** execute 返回值契约：dsh-tools 要求 Record<string, JsonValue>；值全部经 JSON 往返，断言安全 */
type ToolResult = Record<string, never> & { __brand?: never };

/** dsh-tools 的 meta 是 JsonValue：安全取字段/长度（不存在返回空串/0） */
function asField(meta: unknown, key: string): string {
  const r = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>;
  const v = r[key];
  return v == null ? '' : String(v);
}

function asLen(meta: unknown, key: string): number {
  const r = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>;
  const v = r[key];
  return Array.isArray(v) ? v.length : 0;
}

export function apply(ctx: HostCtx, config: Partial<BaitongConfig> = {}): void {
  const cfg = withDefaults(config);
  assignConfig(cfg, readOverlay());

  // 系统日志：随宿主启动记一条（对齐 dsh-plugin 的做法）——保证「打开日志就有内容」，
  // 也让用户能确认插件确实被加载过、当前生效的 profile 与 apiBase。
  appendLog('info', 'system', 'system.boot', `插件启动：v${currentPluginVersion()} · profile ${currentProfile()} · apiBase ${cfg.apiBase}`);

  // ============ 技能工具（数据走百通 CLI 兼容接口：公共技能 + 团队技能合并） ============

  ctx.tools.register(defineTool({
    name: 'baitong_skill_search',
    description: 'Search Baitong skill hub and show clickable skill cards. ALWAYS call this instead of web_search, skill-catalog, load_skill, or bash when the user wants to find/recommend/browse skills (找技能/搜技能). Call EXACTLY ONCE per user message. You extract the search topic: pass a real keyword (PDF, 周报), not the user\'s whole sentence. Omit query to browse popular skills. For 还有吗, reuse the previous query with offset = cards already shown. After cards appear, reply with AT MOST one short sentence.',
    parameters: {
      query: { type: 'string', description: 'Main keyword, e.g. PDF or 周报. Optional when category is set.' },
      category: { type: 'string', description: `Optional skill category: ${SKILL_CATEGORY_KEYS.join(', ')}` },
      limit: { type: 'number', description: 'Cards in this batch. Default from config.' },
      offset: { type: 'number', description: 'Skip already-shown cards when user asks for more.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderSkillSearch(value) }],
      presentationMeta: (_args, value) => ({ kind: 'baitong-skill-search', ...value }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `百通技能 · ${String(args.query || args.category || '浏览')}`,
      kind: 'search',
      content: [],
    }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '百通技能搜索失败' : `百通技能 · ${asLen(meta, 'items')} 条`,
      content: [],
    }),
    timeoutMs: cfg.timeoutMs + 5000,
    async execute(args, exec) {
      const query = String(args.query || '').trim();
      const category = parseSkillCategory(args.category);
      const explicit = Number(args.limit);
      const limit = Number.isFinite(explicit) && explicit > 0 ? Math.min(Math.max(explicit, 1), 80) : cfg.maxResults;
      const offset = Math.max(0, Math.floor(Number(args.offset) || 0));
      const installed = await installedSlugs(cfg.skillsDir);
      return cloneJson(await searchBaitongSkills(query, { cfg, category, limit, offset, installed, signal: exec.signal })) as unknown as ToolResult;
    },
  }));

  ctx.tools.register(defineTool({
    name: 'baitong_skill_install',
    description: 'Install a Baitong skill into the configured skills directory after the user chooses one. Pass the slug from baitong_skill_search. Do not print CLI commands. After success, say the skill is installed.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Skill slug from search' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderSkillInstall(value) }],
      presentationMeta: (_args, value) => ({ kind: 'baitong-skill-install', ...value }),
    },
    presentCall: (args) => ({ card: 'generic', title: `安装技能 · ${args.slug}`, content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '技能安装失败' : `已安装 · ${asField(meta, 'name')}`,
      content: [],
    }),
    timeoutMs: cfg.timeoutMs + 30000,
    async execute(args, exec) {
      return cloneJson(await installBaitongSkill(String(args.slug || ''), cfg, exec.signal)) as unknown as ToolResult;
    },
  }));

  ctx.tools.register(defineTool({
    name: 'baitong_skill_list',
    description: 'List skills already installed in the Baitong skills directory. Use when the user asks what skills are installed or to manage local skills.',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderSkillList(value) }],
      presentationMeta: (_args, value) => ({ kind: 'baitong-skill-list', ...value }),
    },
    presentCall: () => ({ card: 'generic', title: '已装技能', content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '列出失败' : `已装 · ${asLen(meta, 'items')} 个`,
      content: [],
    }),
    async execute() {
      const items = await listInstalledSkills(cfg.skillsDir);
      return cloneJson({ skillsDir: cfg.skillsDir, items }) as unknown as ToolResult;
    },
  }));

  ctx.tools.register(defineTool({
    name: 'baitong_skill_uninstall',
    description: 'Uninstall a locally installed skill by slug. Only removes a directory under the configured skills directory that contains SKILL.md.',
    parameters: {
      slug: { type: 'string', required: true, description: 'Installed skill directory name / slug' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: `已卸载 ${asField(value, 'slug')}` }],
      presentationMeta: (_args, value) => ({ kind: 'baitong-skill-uninstall', ...value }),
    },
    presentCall: (args) => ({ card: 'generic', title: `卸载 · ${args.slug}`, content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '卸载失败' : `已卸载 · ${asField(meta, 'slug')}`,
      content: [],
    }),
    async execute(args) {
      return cloneJson(await uninstallBaitongSkill(String(args.slug || ''), cfg.skillsDir)) as unknown as ToolResult;
    },
  }));

  // ============ 插件工具（数据走百通插件市场公开 API） ============

  ctx.tools.register(defineTool({
    name: 'baitong_plugin_search',
    description: 'Search Baitong DSH plugin market and show clickable plugin cards. ALWAYS call this instead of web_search or bash when the user wants to find/recommend/browse DSH plugins (插件). Call EXACTLY ONCE per user message. You extract the search topic: pass a real keyword (浏览器自动化, browser), not the user\'s whole sentence. Omit query to browse popular plugins. For 还有吗 / "more?", you MUST reuse the previous query AND pass offset = number of cards already shown — calling again with offset=0 re-shows the SAME cards and is strictly forbidden. After cards appear, reply with AT MOST one short sentence.',
    parameters: {
      query: { type: 'string', description: 'Main keyword, e.g. 浏览器自动化 or browser. Optional when category is set.' },
      category: { type: 'string', description: `Optional plugin category: ${PLUGIN_CATEGORY_KEYS.join(', ')}` },
      sort: { type: 'string', description: 'stars, updated or installs. Default stars.' },
      limit: { type: 'number', description: 'Cards in this batch. Default from config.' },
      offset: { type: 'number', description: 'Skip already-shown cards when user wants more.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderPluginSearch(value) }],
      presentationMeta: (_args, value) => ({ kind: 'baitong-plugin-search', ...value }),
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `百通插件 · ${String(args.query || args.category || '浏览')}`,
      content: [],
    }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '插件搜索失败' : `百通插件 · ${asLen(meta, 'items')} 款`,
      content: [],
    }),
    timeoutMs: cfg.timeoutMs + 5000,
    async execute(args, exec) {
      return cloneJson(await searchBaitongPlugins(cfg, {
        q: args.query,
        category: args.category,
        sort: args.sort,
        limit: args.limit,
        offset: args.offset,
      }, exec?.signal)) as unknown as ToolResult;
    },
  }));

  ctx.tools.register(defineTool({
    name: 'baitong_plugin_install',
    description: 'Install a DSH plugin from the Baitong market into the current web profile after the user names one (装第一个 / 安装 dsh-browser). Pass owner and name from baitong_plugin_search results. Follows the plugin install-plan source (npm, GitHub, git, URL, file, or link) with safety checks. Do not print CLI commands. After success, tell the user to restart DSH.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Plugin owner from search' },
      name: { type: 'string', required: true, description: 'Plugin name from search' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: renderPluginInstall(value) }],
      presentationMeta: (_args, value) => ({ kind: 'baitong-plugin-install', ...value }),
    },
    presentCall: (args) => ({ card: 'generic', title: `安装插件 · ${args.owner}/${args.name}`, content: [] }),
    presentResult: (_args, { isError, meta }) => ({
      card: 'generic',
      title: isError ? '插件安装失败' : `已装插件 · ${asField(meta, 'fullName')}`,
      content: [],
    }),
    timeoutMs: INSTALL_TIMEOUT_MS + 60000,
    async execute(args) {
      return cloneJson(await withPluginInstallLock(() => installBaitongPlugin({
        owner: args.owner,
        name: args.name,
      }, cfg))) as unknown as ToolResult;
    },
  }));

  // ============ systemPrompt 行为约束 ============

  ctx.inject(['systemPrompt'], (c: unknown) => {
    const prompt = (c as { systemPrompt: { section: (opts: Record<string, unknown>) => void } }).systemPrompt;
    prompt.section({
      name: 'tool:baitong-plugin-market',
      order: 210,
      text: [
        'Finding / recommending / browsing Agent Skills: you MUST call baitong_skill_search. Never web_search, skill-catalog, load_skill, bash, or SKILL.md dump. Never print install commands or curl.',
        'You decide the keyword. Extract a real topic from the user; do not paste their whole sentence as query. No topic / just 好玩 有趣 推荐 → omit query to browse. 还有吗 → same previous query + offset. One call per user message.',
        'Do not say 点卡片查看 unless baitong_skill_search has already returned cards in this turn.',
        'After cards appear, reply with AT MOST one short sentence. Do NOT list skills or write essays.',
        'Install only after the user chooses a card: baitong_skill_install with that slug. Then one short sentence.',
        'For installed skills, call baitong_skill_list / baitong_skill_uninstall.',
        'Finding / recommending / browsing DeepSeek Harness (DSH) plugins (插件): you MUST call baitong_plugin_search, never web_search, bash, or printing install commands. One call per user message; extract a real keyword. 还有吗 → same previous query + offset. After plugin cards appear, reply with AT MOST one short sentence.',
        `Plugin categories: ${PLUGIN_CATEGORY_KEYS.join(', ')}.`,
        'Install a plugin only after the user names one from the cards: baitong_plugin_install with its owner and name. Then one short sentence reminding them to restart DSH. Never print dsh plugin / npm / curl commands.',
      ].join(' '),
    });
  });

  // ============ 本机 HTTP：广场面板轮询 + 图标代理 + 安装进度 ============

  ctx.inject(['webServer'], (c: unknown) => {
    const server = (c as {
      webServer: { register: (route: { kind: string; path: string; handler: (req: never, res: never) => void }) => void };
    }).webServer;
    server.register({ kind: 'exact', path: '/baitong-market', handler: (req, res) => handleApi(req, res, cfg) });
    server.register({ kind: 'exact', path: '/baitong-market/icon', handler: (req, res) => handleIcon(req, res, cfg) });
    server.register({ kind: 'exact', path: '/baitong-market/logo', handler: (req, res) => handleLogo(req, res) });
    server.register({
      kind: 'exact',
      path: '/baitong-market/probe',
      handler: (req, res) => {
        // 单通道重测：POST body { key }；全量探测 body 为空
        void (async () => {
          let only: string | undefined;
          try {
            const chunks: Buffer[] = [];
            const request = req as unknown as NodeJS.ReadableStream;
            for await (const c of request) chunks.push(c as Buffer);
            const body = JSON.parse(Buffer.concat(chunks).toString() || '{}') as { key?: unknown };
            if (body && (body.key === 'npm' || body.key === 'github' || body.key === 'catalog')) only = body.key;
          } catch { /* 空/坏 body = 全量 */ }
          await handleProbeRoute(req, res, cfg, only);
        })();
      },
    });
  });

  // ============ 设置页（配置项 + 保存即生效） ============

  ctx.inject(['settings'], (c: unknown) => {
    const settings = (c as { settings: { register: (id: string, schema: unknown, opts: Record<string, unknown>) => void } }).settings;
    settings.register('baitong-plugin-market', Config, { base: config });
  });
}

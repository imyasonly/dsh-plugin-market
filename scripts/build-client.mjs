// 编译 Web 客户端面板：src/client.js（JSX）→ lib/client.js。
//
// 为什么必须编译：dsh 浏览器侧通过 window.__ModuleLoader__.load 加载本文件，
// 浏览器不解析 JSX；React 由 factory 内的 require('react') 注入作用域，
// 故用 classic runtime（jsxFactory: React.createElement），不打包、不改模块格式。
//
// 不用 tsc 编译的原因：本文件是浏览器侧模块，不走 Node 端类型检查；
// tsc 也不处理 .js 里的 JSX（allowJs 关闭）。
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, '..', 'src', 'client.js')],
  outfile: join(here, '..', 'lib', 'client.js'),
  bundle: false,            // 保留 factory 的 require() 调用，由浏览器模块表解析
  format: 'iife',
  target: 'es2022',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  loader: { '.js': 'jsx' },
  legalComments: 'none',
});

console.log('[build] client.js compiled (JSX → React.createElement) → lib/client.js');
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import path from 'node:path';

// playwright-core 按需加载，并按多个候选根目录解析。
// 解释器会把符号链接解析成真实路径，插件以 link 方式安装时，
// 本地 node_modules 不在真实路径的上级目录里，因此必须回退到
// profile、DSH 安装目录等已知位置，否则浏览器宿主子进程会启动失败。
const require = createRequire(import.meta.url);
let resolved;

function candidateRoots() {
  const roots = [];
  const push = value => { if (typeof value === 'string' && value.trim() && !roots.includes(value.trim())) roots.push(value.trim()); };
  push(process.env.DSH_PROFILE_DIR);
  if (roots[0]) push(path.join(roots[0], 'node_modules'));
  // 从当前文件位置逐级向上找 node_modules（覆盖非 link 的常规安装）
  let current = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  for (let depth = 0; depth < 8; depth += 1) {
    push(path.join(current, 'node_modules'));
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  // DSH 自身运行时依赖
  push(process.env.DSH_RUNTIME_NODE_MODULES);
  for (const base of [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]) {
    if (!base) continue;
    for (const depth of ['DSH NEXT/resources/app.asar.unpacked/node_modules', 'DSH NEXT/resources/runtime/x64/primary-runtime/dependencies/node_modules']) {
      push(path.join(base, ...depth.split('/')));
    }
  }
  return roots.filter(root => existsSync(root));
}

export function loadPlaywright() {
  if (resolved) return resolved;
  const attempted = [];
  for (const specifier of ['playwright-core', 'playwright']) {
    try { resolved = require(specifier); return resolved; }
    catch (error) { if (error?.code !== 'MODULE_NOT_FOUND') throw error; attempted.push(specifier); }
  }
  try {
    resolved = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright-core');
    return resolved;
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    attempted.push('@playwright/mcp');
  }
  for (const root of candidateRoots()) {
    for (const specifier of ['playwright-core', 'playwright']) {
      try {
        resolved = createRequire(path.join(root, 'noop.js'))(specifier);
        return resolved;
      } catch (error) {
        if (!['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(error?.code)) throw error;
      }
    }
    attempted.push(root);
  }
  throw Object.assign(
    new Error(`缺少浏览器自动化依赖（已尝试 ${attempted.join('、')}）。请在插件目录执行 npm install 安装依赖后重试。`),
    { code: 'PLAYWRIGHT_MISSING' },
  );
}

// 保持原有 `import { chromium }` 用法；属性访问时才解析依赖。
export const chromium = new Proxy({}, {
  get(_target, property) {
    const instance = loadPlaywright().chromium;
    const value = instance?.[property];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
  has(_target, property) {
    return property in (loadPlaywright().chromium || {});
  },
});

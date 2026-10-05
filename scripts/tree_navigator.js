#!/usr/bin/env node
/**
 * Herdr 空间与页签两级交互式树状导航器
 * 支持：
 * 1. 空间（Space/Workspace）点击或按空格键展开/折叠（▾ / ▸）
 * 2. 空间下属所有页签展示在二级树中（├─ / └─）
 * 3. 每个页签后方带可点击的 [✖] 快速关闭按钮
 * 4. 点击页签名称直接切换（focus）该页签
 * 5. 全面支持终端鼠标点击与键盘上下移动操作
 */

const { execSync, spawn } = require('child_process');
const readline = require('readline');

const HERDR_BIN = process.env.HERDR_BIN_PATH || 'herdr';

// 折叠状态记录：workspace_id -> boolean (true: 展开, false: 折叠)
const expandedState = {};

// 存储可点击的交互项几何边界（用于鼠标坐标命中检测）
// 格式: { y, xStart, xEnd, type: 'space_toggle'|'tab_focus'|'tab_close', id: string }
let clickTargets = [];
let focusedIndex = 0; // 键盘选中的行索引
let flatItems = [];   // 用于键盘上下导航的项目展平列表

function runCmd(args) {
  try {
    const res = execSync(`${HERDR_BIN} ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return JSON.parse(res);
  } catch (_) {
    return null;
  }
}

function fetchState() {
  const wsData = runCmd('workspace list');
  const tabData = runCmd('tab list');

  const workspaces = (wsData && wsData.result && wsData.result.workspaces) || [];
  const tabs = (tabData && tabData.result && tabData.result.tabs) || [];

  // 初始化展开状态（默认当前激活的空间展开，其余折叠）
  workspaces.forEach(ws => {
    if (expandedState[ws.workspace_id] === undefined) {
      expandedState[ws.workspace_id] = !!ws.focused;
    }
  });

  return { workspaces, tabs };
}

function render() {
  const { workspaces, tabs } = fetchState();
  const width = process.stdout.columns || 60;

  clickTargets = [];
  flatItems = [];

  // 清屏
  process.stdout.write('\x1b[2J\x1b[H');

  // 标题栏
  console.log('\x1b[1;37;44m 空间与页签树状工作区 (点击 ▾/▸ 折叠展开 | 点击 [✖] 秒关页签) \x1b[0m');
  console.log('\x1b[90m' + '─'.repeat(Math.min(width, 70)) + '\x1b[0m');

  let currentLine = 3; // 渲染从第 3 行开始（1-indexed）

  workspaces.forEach((ws, wsIdx) => {
    const isExpanded = !!expandedState[ws.workspace_id];
    const wsTabs = tabs.filter(t => t.workspace_id === ws.workspace_id);
    const arrow = isExpanded ? '▾' : '▸';
    const isFocusedWs = ws.focused;
    const wsTitle = `${arrow} [${ws.label || `工作区${ws.number}`}] (${wsTabs.length} 页签)`;

    // 记录空间行的点击目标与键盘项
    const wsColor = isFocusedWs ? '\x1b[1;32m' : '\x1b[1;37m';
    const wsBadge = isFocusedWs ? ' \x1b[32m● 当前空间\x1b[0m' : '';

    flatItems.push({ type: 'space', id: ws.workspace_id });
    const isSelectedRow = focusedIndex === flatItems.length - 1;
    const cursor = isSelectedRow ? '\x1b[1;33m▶ \x1b[0m' : '  ';

    console.log(`${cursor}${wsColor}${wsTitle}\x1b[0m${wsBadge}`);

    clickTargets.push({
      y: currentLine,
      xStart: 1,
      xEnd: width,
      type: 'space_toggle',
      id: ws.workspace_id
    });
    currentLine++;

    // 二级树：渲染该空间下的所有页签
    if (isExpanded) {
      if (wsTabs.length === 0) {
        console.log(`     \x1b[90m(无打开的页签)\x1b[0m`);
        currentLine++;
      } else {
        wsTabs.forEach((tab, tIdx) => {
          const isLast = tIdx === wsTabs.length - 1;
          const branch = isLast ? '└─' : '├─';
          const tabFocused = tab.focused;
          const activeMark = tabFocused ? '\x1b[34m[活跃]\x1b[0m ' : '';
          const tabLabel = tab.label || `页签 ${tab.number}`;
          const tabNameSnippet = tabLabel.length > 20 ? tabLabel.slice(0, 18) + '..' : tabLabel;

          flatItems.push({ type: 'tab', id: tab.tab_id, wsId: ws.workspace_id });
          const isSelectedTabRow = focusedIndex === flatItems.length - 1;
          const tabCursor = isSelectedTabRow ? '\x1b[1;33m▶ \x1b[0m' : '  ';

          // 绘制：缩进 + 分支 + 标签名称 + 快速关闭按钮 [✖]
          const leftPart = `${tabCursor}   ${branch} ${activeMark}\x1b[${tabFocused ? '1;36' : '37'}m${tabNameSnippet}\x1b[0m`;
          const closeButton = ` \x1b[1;31m[✖]\x1b[0m`;
          
          console.log(`${leftPart}${closeButton}`);

          // 注册页签命中区（点击切换页签）与关闭按钮命中区（点击关闭）
          const tabTextLen = 7 + (tabFocused ? 7 : 0) + tabNameSnippet.length;
          clickTargets.push({
            y: currentLine,
            xStart: 3,
            xEnd: tabTextLen,
            type: 'tab_focus',
            id: tab.tab_id
          });

          clickTargets.push({
            y: currentLine,
            xStart: tabTextLen + 1,
            xEnd: tabTextLen + 5,
            type: 'tab_close',
            id: tab.tab_id
          });

          currentLine++;
        });
      }
    }
  });

  console.log('\n\x1b[90m快捷键: [↑/↓] 选中 | [回车] 切换页签 | [空格] 折叠/展开 | [X] 关闭页签 | [Q] 退出\x1b[0m');
}

// 执行交互动作
function handleAction(type, id) {
  if (type === 'space_toggle') {
    expandedState[id] = !expandedState[id];
    render();
  } else if (type === 'tab_focus') {
    try {
      execSync(`${HERDR_BIN} tab focus ${id}`, { stdio: 'ignore' });
    } catch (_) {}
    render();
  } else if (type === 'tab_close') {
    try {
      execSync(`${HERDR_BIN} tab close ${id}`, { stdio: 'ignore' });
    } catch (_) {}
    render();
  }
}

// 启用终端鼠标支持（SGR 模式）
function enableMouse() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1006h');
  }
}

function disableMouse() {
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1006l');
  }
}

// 解析终端鼠标序列，格式如: \x1b[<0;24;15M
function parseMouseEvent(str) {
  const match = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
  if (!match) return null;
  const button = parseInt(match[1], 10);
  const x = parseInt(match[2], 10);
  const y = parseInt(match[3], 10);
  const isDown = match[4] === 'M';
  return { button, x, y, isDown };
}

// 首次绘制
render();
enableMouse();

// 定时自动同步最新页签状态（每 3 秒刷新一次）
const interval = setInterval(() => {
  render();
}, 3000);

// 监听键盘与鼠标输入
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();

process.stdin.on('data', chunk => {
  const str = chunk.toString();

  // 1. 鼠标事件处理
  const mouse = parseMouseEvent(str);
  if (mouse && mouse.isDown && mouse.button === 0) { // 鼠标左键点击
    for (const target of clickTargets) {
      if (mouse.y === target.y && mouse.x >= target.xStart && mouse.x <= target.xEnd) {
        handleAction(target.type, target.id);
        return;
      }
    }
  }

  // 2. 键盘控制处理
  if (chunk[0] === 113 || chunk[0] === 81 || chunk[0] === 27 && chunk.length === 1 || chunk[0] === 3) {
    // Q, q, Esc, Ctrl+C 退出
    clearInterval(interval);
    disableMouse();
    process.exit(0);
  } else if (str === '\x1b[A') { // 上方向键
    focusedIndex = Math.max(0, focusedIndex - 1);
    render();
  } else if (str === '\x1b[B') { // 下方向键
    focusedIndex = Math.min(flatItems.length - 1, focusedIndex + 1);
    render();
  } else if (str === ' ') { // 空格键切换折叠
    const item = flatItems[focusedIndex];
    if (item && item.type === 'space') {
      handleAction('space_toggle', item.id);
    }
  } else if (str === '\r' || str === '\n') { // 回车键进入
    const item = flatItems[focusedIndex];
    if (item) {
      if (item.type === 'space') {
        handleAction('space_toggle', item.id);
      } else if (item.type === 'tab') {
        handleAction('tab_focus', item.id);
      }
    }
  } else if (str === 'x' || str === 'X') { // X 键快捷关闭选中页签
    const item = flatItems[focusedIndex];
    if (item && item.type === 'tab') {
      handleAction('tab_close', item.id);
    }
  }
});

process.on('exit', () => {
  disableMouse();
});

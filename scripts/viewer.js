#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '/Users/mac';

// 格式化时间
function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (isToday) return timeStr;
  return `${d.getMonth() + 1}/${d.getDate()} ${timeStr}`;
}

// 收集所有 Agent 的提示词历史
function collectAllPrompts() {
  const prompts = [];

  // 1. 读取 Codex 提示词 (~/.codex/history.jsonl)
  const codexFile = path.join(HOME, '.codex', 'history.jsonl');
  if (fs.existsSync(codexFile)) {
    try {
      const content = fs.readFileSync(codexFile, 'utf-8');
      const lines = content.trim().split('\n');
      for (const line of lines.slice(-60)) {
        if (!line) continue;
        try {
          const item = JSON.parse(line);
          if (item.text && typeof item.text === 'string' && item.text.trim()) {
            prompts.push({
              source: 'Codex',
              sourceColor: '\x1b[35m', // 紫色
              time: item.ts ? item.ts * 1000 : Date.now(),
              text: item.text.trim()
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 2. 读取 Pi 会话提示词 (~/.pi/agent/sessions/*/*.jsonl)
  const piBase = path.join(HOME, '.pi', 'agent', 'sessions');
  if (fs.existsSync(piBase)) {
    try {
      const dirs = fs.readdirSync(piBase);
      for (const dir of dirs) {
        const fullDir = path.join(piBase, dir);
        if (!fs.statSync(fullDir).isDirectory()) continue;
        const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
          const filePath = path.join(fullDir, file);
          try {
            const stat = fs.statSync(filePath);
            // 只分析最近 7 天内活跃的会话
            if (Date.now() - stat.mtimeMs > 7 * 86400 * 1000) continue;
            const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
            for (const line of lines.slice(-50)) {
              if (!line) continue;
              try {
                const item = JSON.parse(line);
                if (item.message && item.message.role === 'user') {
                  const content = item.message.content || [];
                  const textParts = content
                    .filter(c => c.type === 'text' && c.text)
                    .map(c => c.text.trim());
                  const fullText = textParts.join(' ').trim();
                  if (fullText) {
                    prompts.push({
                      source: 'Pi',
                      sourceColor: '\x1b[36m', // 青色
                      time: item.timestamp ? new Date(item.timestamp).getTime() : stat.mtimeMs,
                      text: fullText
                    });
                  }
                }
              } catch (_) {}
            }
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  // 3. 读取 Claude Code 提示词 (~/.claude/history.jsonl)
  const claudeFile = path.join(HOME, '.claude', 'history.jsonl');
  if (fs.existsSync(claudeFile)) {
    try {
      const lines = fs.readFileSync(claudeFile, 'utf-8').trim().split('\n');
      for (const line of lines.slice(-40)) {
        if (!line) continue;
        try {
          const item = JSON.parse(line);
          if (item.prompt && typeof item.prompt === 'string' && item.prompt.trim()) {
            prompts.push({
              source: 'Claude',
              sourceColor: '\x1b[33m', // 黄色
              time: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
              text: item.prompt.trim()
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  // 按时间降序排列（最新在前）
  prompts.sort((a, b) => b.time - a.time);

  // 去重连续相同的 prompt
  const deduped = [];
  for (const p of prompts) {
    if (deduped.length > 0 && deduped[deduped.length - 1].text === p.text) continue;
    deduped.push(p);
  }

  return deduped;
}

let lastRenderHash = '';

function render() {
  const width = process.stdout.columns || 60;
  const height = process.stdout.rows || 24;
  const list = collectAllPrompts();

  const currentHash = JSON.stringify(list.slice(0, 10).map(x => [x.source, x.time, x.text]));
  if (currentHash === lastRenderHash) {
    return; // 无新数据不重绘闪烁
  }
  lastRenderHash = currentHash;

  // 清屏并重绘
  process.stdout.write('\x1b[2J\x1b[H');

  // 顶部 Header
  console.log('\x1b[1;37;44m 会话历史提示词 (按 Q 退出 / 自动实时更新) \x1b[0m');
  console.log('\x1b[90m' + '─'.repeat(Math.min(width, 80)) + '\x1b[0m');

  if (list.length === 0) {
    console.log('\n\x1b[33m暂未在 ~/.codex、~/.pi、~/.claude 探测到提示词记录。\x1b[0m');
    return;
  }

  // 渲染前 15 条
  const displayItems = list.slice(0, 15);
  displayItems.forEach((item, idx) => {
    const num = `\x1b[1;32m#${idx + 1}\x1b[0m`;
    const source = `${item.sourceColor}[${item.source}]\x1b[0m`;
    const time = `\x1b[90m${formatTime(item.time)}\x1b[0m`;

    console.log(`${num} ${source} ${time}`);
    
    // 换行缩进显示文本
    const lines = item.text.split('\n');
    const firstLine = lines[0].trim();
    console.log(`  \x1b[1m${firstLine}\x1b[0m`);
    if (lines.length > 1) {
      const more = lines.slice(1).join(' ').trim();
      const snippet = more.length > 60 ? more.slice(0, 60) + '...' : more;
      console.log(`  \x1b[90m${snippet}\x1b[0m`);
    }
    console.log('');
  });
}

// 首次渲染
try {
  render();
} catch (_) {}

process.stdout.on('error', err => {
  if (err.code === 'EPIPE') process.exit(0);
});

// 每 2 秒自动轮询一次，监测新提示词并自动热更新
const pollInterval = setInterval(() => {
  render();
}, 2000);

// 处理键盘退出
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.on('data', chunk => {
  // 按 Q, q, Esc (27), Ctrl+C (3)
  if (chunk[0] === 113 || chunk[0] === 81 || chunk[0] === 27 || chunk[0] === 3) {
    clearInterval(pollInterval);
    process.exit(0);
  }
});

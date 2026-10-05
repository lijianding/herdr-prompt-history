#!/usr/bin/env node
/**
 * Herdr Agent 任务同步守护进程
 * 定时检测所有处于活跃运行状态的 Agent（Pi, Codex, Claude），
 * 提取其最新任务提示词摘要，并通过官方通道注入为 Pane 的 $task 元数据。
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HOME = process.env.HOME || '/Users/mac';
const HERDR_BIN = process.env.HERDR_BIN_PATH || 'herdr';

function runCmd(args) {
  try {
    const res = execSync(`${HERDR_BIN} ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] });
    return JSON.parse(res);
  } catch (_) {
    return null;
  }
}

// 缓存上一次为每个 pane 报告的任务文本，避免重复调用
const lastReportedTask = {};

function getLatestTaskForPane(pane) {
  const agent = (pane.agent || '').toLowerCase();
  const cwd = pane.foreground_cwd || pane.cwd || '';

  // 1. 如果是 Pi，直接从 Herdr 暴露的 session_path 中读取
  if (agent === 'pi' && pane.agent_session && pane.agent_session.value) {
    const sessionFile = pane.agent_session.value;
    if (fs.existsSync(sessionFile)) {
      try {
        const lines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n');
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 30); i--) {
          const item = JSON.parse(lines[i]);
          if (item.message && item.message.role === 'user') {
            const content = item.message.content || [];
            const textParts = content.filter(c => c.type === 'text' && c.text).map(c => c.text.trim());
            const full = textParts.join(' ').trim();
            if (full) return full;
          }
        }
      } catch (_) {}
    }
  }

  // 2. 如果是 Codex，优先查看 ~/.codex/history.jsonl
  if (agent === 'codex') {
    const codexHistory = path.join(HOME, '.codex', 'history.jsonl');
    if (fs.existsSync(codexHistory)) {
      try {
        const lines = fs.readFileSync(codexHistory, 'utf-8').trim().split('\n');
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
          const item = JSON.parse(lines[i]);
          if (item.text && item.text.trim()) {
            return item.text.trim();
          }
        }
      } catch (_) {}
    }
  }

  // 3. 如果是 Claude Code
  if (agent === 'claude') {
    const claudeHistory = path.join(HOME, '.claude', 'history.jsonl');
    if (fs.existsSync(claudeHistory)) {
      try {
        const lines = fs.readFileSync(claudeHistory, 'utf-8').trim().split('\n');
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 20); i--) {
          const item = JSON.parse(lines[i]);
          if (item.prompt && item.prompt.trim()) {
            return item.prompt.trim();
          }
        }
      } catch (_) {}
    }
  }

  // 4. 回退：如果有 stripped 终端标题，且非通用标题，使用终端标题
  if (pane.terminal_title_stripped) {
    const t = pane.terminal_title_stripped.trim();
    if (t && !t.startsWith('π -') && !t.startsWith('bash') && !t.startsWith('zsh')) {
      return t;
    }
  }

  // 5. 回退：使用 pane.label
  if (pane.label) {
    return pane.label;
  }

  return '';
}

// 格式化任务文本为适合侧边栏单行展示的紧凑摘要（最多 25 字符）
function formatTaskSnippet(rawText) {
  if (!rawText) return '';
  const firstLine = rawText.split('\n')[0].trim();
  // 移除常见前缀
  const cleaned = firstLine.replace(/^(请帮我|帮我|请|查看|分析|执行)\s*/, '');
  if (cleaned.length > 25) {
    return cleaned.slice(0, 24) + '…';
  }
  return cleaned;
}

function syncTasks() {
  const paneList = runCmd('pane list');
  if (!paneList || !paneList.result || !paneList.result.panes) return;

  const panes = paneList.result.panes;
  for (const pane of panes) {
    // 仅针对有识别出 agent 的窗格同步任务
    if (!pane.agent) continue;

    const taskText = getLatestTaskForPane(pane);
    const snippet = formatTaskSnippet(taskText);

    if (!snippet) continue;

    if (lastReportedTask[pane.pane_id] === snippet) {
      continue; // 无变化跳过
    }

    try {
      // 通过官方 report-metadata 上报 $task token
      // 避免特殊字符 shell 转义问题，使用安全替换
      const safeTokenVal = snippet.replace(/["\\`$]/g, '');
      execSync(`${HERDR_BIN} pane report-metadata ${pane.pane_id} --source herdr-prompt-history --token task="${safeTokenVal}"`, {
        stdio: 'ignore'
      });
      lastReportedTask[pane.pane_id] = snippet;
    } catch (_) {}
  }
}

// 首次执行
syncTasks();

// 如果作为独立守护进程运行（带 --daemon 参数），则启动轮询
if (process.argv.includes('--daemon')) {
  setInterval(syncTasks, 2000);
}

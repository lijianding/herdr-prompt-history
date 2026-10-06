#!/usr/bin/env node
/**
 * Herdr Agent 任务同步守护进程 (v0.3.1)
 * 修复：各 Agent（特别是 Codex）在不同页签/工作区下各自独立提取任务，杜绝全局污染。
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

/**
 * 为特定的 Pane 提取其专有的任务内容，确保不同页签互不干扰
 */
function getLatestTaskForPane(pane) {
  const agent = (pane.agent || '').toLowerCase();
  const cwd = pane.foreground_cwd || pane.cwd || '';

  // 1. 针对 Codex：Codex 原生会将当前页签的独立任务通过 OSC 写入终端标题（格式：任务名称 | 工作区名称）
  // 必须优先按当前 Pane 的终端标题提取，绝对不能直接读取全局 history.jsonl
  if (agent === 'codex') {
    const title = (pane.terminal_title_stripped || pane.terminal_title || '').trim();
    if (title) {
      if (title.includes('|')) {
        const parts = title.split('|');
        const taskPart = parts[0].trim();
        if (taskPart && !['codex', 'bash', 'zsh'].includes(taskPart.toLowerCase())) {
          return taskPart;
        }
      } else if (!['codex', 'bash', 'zsh'].includes(title.toLowerCase())) {
        return title;
      }
    }

    // 备选：根据当前 Pane 的 cwd，从 ~/.codex/state_5.sqlite 中匹配当前项目的活跃会话
    try {
      const dbPath = path.join(HOME, '.codex', 'state_5.sqlite');
      if (fs.existsSync(dbPath) && cwd) {
        const query = `SELECT title, first_user_message FROM threads WHERE cwd='${cwd.replace(/'/g, "''")}' ORDER BY updated_at DESC LIMIT 1;`;
        const out = execSync(`sqlite3 "${dbPath}" "${query}"`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
        if (out) {
          const parts = out.split('|');
          const matched = (parts[0] || parts[1] || '').trim();
          if (matched && !matched.startsWith('<send_user_message_question_reply>')) {
            return matched;
          }
        }
      }
    } catch (_) {}

    // 回退：使用 pane.label
    if (pane.label) {
      return pane.label;
    }
  }

  // 2. 针对 Pi：严格读取当前 Pane 自身挂载的专属 session 文件
  if (agent === 'pi') {
    if (pane.agent_session && pane.agent_session.value) {
      const sessionFile = pane.agent_session.value;
      if (fs.existsSync(sessionFile)) {
        try {
          const lines = fs.readFileSync(sessionFile, 'utf-8').trim().split('\n');
          for (let i = lines.length - 1; i >= Math.max(0, lines.length - 40); i--) {
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

    // 回退：终端标题或 label
    if (pane.label) return pane.label;
    const title = (pane.terminal_title_stripped || pane.terminal_title || '').trim();
    if (title && !title.startsWith('π -') && !['bash', 'zsh'].includes(title.toLowerCase())) {
      return title;
    }
  }

  // 3. 针对 Claude Code：匹配对应项目的会话
  if (agent === 'claude') {
    const title = (pane.terminal_title_stripped || pane.terminal_title || '').trim();
    if (title && !['claude', 'bash', 'zsh'].includes(title.toLowerCase())) {
      if (title.includes('|')) return title.split('|')[0].trim();
      return title;
    }
    if (pane.label) return pane.label;
  }

  // 4. 通用兜底
  if (pane.label) return pane.label;
  const genericTitle = (pane.terminal_title_stripped || pane.terminal_title || '').trim();
  if (genericTitle && !['bash', 'zsh', 'sh'].includes(genericTitle.toLowerCase())) {
    if (genericTitle.includes('|')) return genericTitle.split('|')[0].trim();
    return genericTitle;
  }

  return '';
}

// 格式化任务文本为适合侧边栏展示的紧凑摘要（最多 25 字符）
function formatTaskSnippet(rawText) {
  if (!rawText) return '';
  const firstLine = rawText.split('\n')[0].trim();
  // 移除常见无实质意义前缀
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
    if (!pane.agent) continue;

    const taskText = getLatestTaskForPane(pane);
    const snippet = formatTaskSnippet(taskText);

    if (!snippet) continue;

    // 只有发生变化时才调用 report-metadata
    if (lastReportedTask[pane.pane_id] === snippet) {
      continue;
    }

    try {
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

// 如果带 --daemon 参数，则持续轮询
if (process.argv.includes('--daemon')) {
  setInterval(syncTasks, 2000);
}

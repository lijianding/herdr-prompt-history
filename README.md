# herdr-prompt-history

Herdr plugin for session prompt history, interactive workspace/tabs tree navigator, and active agent task syncer.

## Features

1. **Prompt History (`prompt-viewer`)**:
   - Aggregates live prompt histories across Claude Code, Pi CLI, and OpenAI Codex.
   - Beautiful ANSI TUI rendered in a split pane with real-time polling updates.
   - Quick toggle via keybinding.

2. **Workspace & Tabs Tree Navigator (`tree-navigator`)**:
   - Two-level interactive tree view: Workspace (Space) -> Tabs.
   - Click workspace name or press Space/Enter to expand / collapse (`▾` / `▸`).
   - Each tab includes a quick close button `[✖]`. Click or press `X` to instantly close the tab.
   - Click tab name or press Enter to focus on the tab.

3. **Active Agent Task Syncer (`task-daemon`)**:
   - Automatically inspects all running agent panes.
   - Extracts current user prompt / task summary and reports display metadata (`$task`).
   - Shows active task summaries directly under each agent in the lower-left sidebar.

## Installation

```bash
herdr plugin install lijianding/herdr-prompt-history
```

Or for local development:
```bash
herdr plugin link /path/to/herdr-prompt-history
```

## Configuration

Add the following to `~/.config/herdr/config.toml`:

```toml
[ui.sidebar.agents]
row_gap = 1
rows = [
    ["state_icon", "agent", "state_text"],
    ["$task"]
]

[[keys.command]]
key = "prefix+p"
type = "plugin_action"
command = "herdr-prompt-history.toggle-viewer"
description = "Toggle prompt history viewer on the right"

[[keys.command]]
key = "prefix+t"
type = "plugin_action"
command = "herdr-prompt-history.toggle-tree"
description = "Toggle workspace and tabs tree navigator"
```

## License

MIT

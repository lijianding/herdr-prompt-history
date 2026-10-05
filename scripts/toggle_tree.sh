#!/usr/bin/env bash
set -uo pipefail

herdr_bin="${HERDR_BIN_PATH:-herdr}"
target_title="Workspace Tree"

pane_list="$("$herdr_bin" pane list 2>/dev/null || true)"

existing_pane_id="$(echo "$pane_list" | jq -r --arg title "$target_title" '
  .result.panes[]? | select(.label == $title or .title == $title or .custom_name == $title) | .pane_id
' 2>/dev/null | head -n 1 || true)"

if [ -n "$existing_pane_id" ] && [ "$existing_pane_id" != "null" ]; then
  # 已开启则关闭（隐藏）
  "$herdr_bin" pane close "$existing_pane_id" >/dev/null 2>&1 || true
else
  # 未开启则在右侧分屏打开树状导航面板（支持鼠标点击折叠展开与✖关闭）
  "$herdr_bin" plugin pane open \
    --plugin "herdr-prompt-history" \
    --entrypoint "tree-navigator" \
    --placement split \
    --direction right \
    --no-focus >/dev/null 2>&1 || true
fi

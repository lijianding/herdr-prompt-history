#!/usr/bin/env bash
set -uo pipefail

herdr_bin="${HERDR_BIN_PATH:-herdr}"
target_title="Prompt History"

# 获取当前工作区的所有 pane 列表（JSON）
pane_list="$("$herdr_bin" pane list 2>/dev/null || true)"

# 检查当前 Tab 或当前服务器是否已有 prompt-viewer pane
# 同时检查 label、title、custom_name，并校验当前 focused tab
existing_pane_id="$(echo "$pane_list" | jq -r --arg title "$target_title" '
  .result.panes[]? | select(.label == $title or .title == $title or .custom_name == $title) | .pane_id
' 2>/dev/null | head -n 1 || true)"

if [ -n "$existing_pane_id" ] && [ "$existing_pane_id" != "null" ]; then
  # 已存在该分屏：关闭它（Toggle 隐藏）
  "$herdr_bin" pane close "$existing_pane_id" >/dev/null 2>&1 || true
else
  # 不存在：在当前 Tab 内部向右拆分新建分屏
  "$herdr_bin" plugin pane open \
    --plugin "herdr-prompt-history" \
    --entrypoint "prompt-viewer" \
    --placement split \
    --direction right \
    --no-focus >/dev/null 2>&1 || true
fi

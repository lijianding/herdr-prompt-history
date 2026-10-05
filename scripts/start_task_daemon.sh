#!/usr/bin/env bash
# 启动后台守护任务同步器（如果未运行）
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pid_file="/tmp/herdr_task_syncer.pid"

if [ -f "$pid_file" ]; then
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    # 守护进程已在运行中
    exit 0
  fi
fi

# 启动后台常驻轮询同步器
nohup node "$script_dir/task_daemon.js" --daemon >/dev/null 2>&1 &
echo $! > "$pid_file"

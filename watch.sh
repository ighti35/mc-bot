#!/bin/bash
# 实时查看 Claude_Bot 的思考过程日志
cd "$(dirname "$0")"
echo "实时查看 Claude_Bot 思考日志 (Ctrl+C 退出)..."
echo "────── 先在游戏里对 Claude_Bot 说句话，这里就会滚动展示它的思考 ──────"
tail -f data/bot.log

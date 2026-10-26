#!/usr/bin/env bash
# StudyPilot 定时同步：把工作区真实改动提交，并推送到 Gitee(origin) / GitHub(github)
#
# 用法:
#   bash scripts/git-auto-sync.sh                 # 自动生成提交说明
#   bash scripts/git-auto-sync.sh "同步：xxx｜改动：yyy"
#
# 退出码:
#   0 无改动 / 已提交且全部推送成功
#   1 提交失败
#   2 安全检查拦截（暂存区含疑似敏感文件，已取消暂存）
#   3 提交成功但部分远端推送失败
#   4 提交成功但两个远端都推送失败
#
# 设计原则：只提交当下真实存在的改动，不做任何补造；无改动时直接退出，不产生空提交。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

LOG="$REPO_ROOT/.git/auto-sync.log"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }

# ---- 0. 中间状态保护 ----
for marker in .git/rebase-merge .git/rebase-apply .git/MERGE_HEAD .git/CHERRY_PICK_HEAD .git/REVERT_HEAD; do
  if [ -e "$marker" ]; then
    log "跳过：仓库处于 merge/rebase/cherry-pick/revert 中间状态（$marker），请先手动处理"
    exit 0
  fi
done

if [ -z "$(git status --porcelain)" ]; then
  log "无改动，跳过"
  exit 0
fi

# ---- 1. 暂存 ----
git add -A || { log "暂存失败"; exit 1; }

# ---- 2. 敏感文件拦截（宁可漏提交，不可泄露凭据）----
STAGED="$(git diff --cached --name-only)"
BLOCKED="$(printf '%s\n' "$STAGED" \
  | grep -Ei '(^|/)\.env($|\.)|\.db$|\.sqlite3?$|\.sessions\.json$|\.pem$|\.key$|\.p12$|_token$|credentials' \
  | grep -Eiv '(example|sample|template|\.env\.md)' || true)"
if [ -n "$BLOCKED" ]; then
  git reset -q
  log "拦截：暂存区含疑似敏感文件，已全部取消暂存，本次不提交"
  printf '%s\n' "$BLOCKED" | tee -a "$LOG"
  exit 2
fi

# ---- 3. 大文件提醒（不拦截，只记录）----
BIG="$(git diff --cached --numstat | awk '$1 ~ /^[0-9]+$/ && $1 > 5000 {print $1" 行  "$3}')"
if [ -n "$BIG" ]; then
  log "提示：本次包含较大文本改动"
  printf '%s\n' "$BIG" | tee -a "$LOG"
fi

# ---- 4. 提交说明 ----
MSG="${1:-}"
if [ -z "$MSG" ]; then
  COUNT="$(git diff --cached --name-only | wc -l | tr -d ' ')"
  STAT="$(git diff --cached --shortstat | sed 's/^ *//')"
  AREAS="$(git diff --cached --name-only | awk -F/ 'NF>1{print $1} NF==1{print "根目录"}' | sort -u | paste -sd'、' -)"
  MSG="同步：${AREAS}｜改动：${COUNT} 个文件，${STAT}｜定时自动提交"
fi

# ---- 5. 提交 ----
if ! git commit -q -m "$MSG"; then
  log "提交失败，改动仍留在工作区"
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"
log "已提交 ${COMMIT}  ${MSG}"

# ---- 6. 推送（两个远端独立处理，一端失败不影响另一端）----
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "master" ]; then
  log "警告：当前分支是 ${BRANCH}，不是 master，本次只提交不推送"
  exit 0
fi

export GIT_TERMINAL_PROMPT=0
export GCM_INTERACTIVE=Never

push_one() {
  local name="$1" limit="$2" out
  if out="$(timeout "$limit" git push "$name" "HEAD:refs/heads/master" 2>&1)"; then
    log "推送成功 [${name}]"
    return 0
  fi
  log "推送失败 [${name}]：$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-300)"
  return 1
}

FAIL=0
push_one origin 300 || FAIL=$((FAIL + 1))
push_one github 90 || FAIL=$((FAIL + 1))

case "$FAIL" in
  0) log "同步完成：Gitee 与 GitHub 均已更新"; exit 0 ;;
  1) log "同步部分完成：一个远端推送失败，详见上方日志"; exit 3 ;;
  *) log "同步未完成：两个远端都推送失败，提交已在本地，网络或凭据恢复后重跑本脚本即可"; exit 4 ;;
esac

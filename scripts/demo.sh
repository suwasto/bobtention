#!/usr/bin/env bash
# scripts/demo.sh
#
# Bobtention Demo Script — Phase 8 T8.5
#
# Simulates the 5 demo acts from PRD §38–§41 by piping hook payloads
# through each compiled hook script.  Requires `npm run build` first.
#
# Usage:
#   ./scripts/demo.sh [act-number]
#
#   ./scripts/demo.sh        # run all 5 acts
#   ./scripts/demo.sh 1      # run only Act 1
#   ./scripts/demo.sh 2      # run only Act 2
#
# Each act prints the hook output to stderr (as Bob would see it).

set -euo pipefail

BOBTENTION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOKS_DIR="$BOBTENTION_DIR/dist/hooks"

# Color helpers
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

run_hook() {
  local hook_name="$1"
  local payload="$2"
  echo "$payload" | node "$HOOKS_DIR/$hook_name.js" 2>&1 || true
}

section() {
  echo ""
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
  echo -e "${BOLD}${CYAN}  $1${RESET}"
  echo -e "${BOLD}${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
}

step() { echo -e "  ${GREEN}→${RESET} $1"; }
pause() { sleep "${DEMO_PAUSE:-0.3}"; }

# ─── Verify build ────────────────────────────────────────────────────────────

if [ ! -f "$HOOKS_DIR/pre-tool-use.js" ]; then
  echo -e "${RED}ERROR: dist/hooks/pre-tool-use.js not found.${RESET}"
  echo "       Run: npm run build"
  exit 1
fi

ACT="${1:-all}"

# ─── Act 1 — Normal Work ─────────────────────────────────────────────────────

run_act1() {
  section "Act 1 — Autonomous Work (OAuth login)"
  echo ""
  echo -e "  Developer: ${BOLD}Implement OAuth login with Google.${RESET}"
  echo ""

  SESSION_ID="demo-act1-$(date +%s)"

  step "SessionStart"
  run_hook "session-start" '{"session_id":"'"$SESSION_ID"'"}'
  pause

  step "UserPromptSubmit — capturing intent"
  run_hook "user-prompt-submit" '{"session_id":"'"$SESSION_ID"'","prompt":"Implement OAuth login with Google"}'
  pause

  declare -a AUTH_ACTIONS=(
    '{"session_id":"'"$SESSION_ID"'","tool_name":"read_file","tool_input":{"path":"src/auth/oauth.ts"}}'
    '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/auth/google-provider.ts"}}'
    '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/auth/callback.ts"}}'
    '{"session_id":"'"$SESSION_ID"'","tool_name":"bash","tool_input":{"command":"npm test -- auth"}}'
    '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/auth/callback.ts"}}'
    '{"session_id":"'"$SESSION_ID"'","tool_name":"bash","tool_input":{"command":"npm test -- auth"}}'
  )
  declare -a AUTH_LABELS=(
    "inspect repository"
    "find authentication module"
    "inspect OAuth callback"
    "run tests"
    "fix callback"
    "run tests"
  )

  for i in "${!AUTH_ACTIONS[@]}"; do
    step "PreToolUse: ${AUTH_LABELS[$i]}"
    run_hook "pre-tool-use" "${AUTH_ACTIONS[$i]}"
    step "PostToolUse"
    run_hook "post-tool-use" "${AUTH_ACTIONS[$i]}"
    pause
  done

  step "Stop"
  run_hook "stop" '{"session_id":"'"$SESSION_ID"'"}'

  echo ""
  echo -e "  ${GREEN}✓ Bobtention stayed out of the way — no interruptions.${RESET}"
}

# ─── Act 2 — Stuck ───────────────────────────────────────────────────────────

run_act2() {
  section "Act 2 — Stuck (repeated test failure × 4)"
  echo ""

  SESSION_ID="demo-act2-$(date +%s)"

  step "SessionStart + UserPromptSubmit"
  run_hook "session-start" '{"session_id":"'"$SESSION_ID"'"}'
  run_hook "user-prompt-submit" '{"session_id":"'"$SESSION_ID"'","prompt":"Fix OAuth callback returning 401"}'
  pause

  for attempt in 1 2 3 4; do
    step "Attempt $attempt → PreToolUse (edit fix)"
    run_hook "pre-tool-use" '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/auth/callback.ts"}}'

    step "Attempt $attempt → PostToolUse (test fails)"
    run_hook "post-tool-use" '{
      "session_id":"'"$SESSION_ID"'",
      "tool_name":"bash",
      "tool_input":{"command":"npm test"},
      "tool_response":{
        "output":"FAIL tests/auth/oauth_callback_test.ts\noauth_callback_test > should return token > failed"
      }
    }'
    pause
  done

  echo ""
  echo -e "  ${YELLOW}⚠  After 4 identical failures Bobtention blocks the next action.${RESET}"
  step "PreToolUse attempt 5 — will be BLOCKED"
  run_hook "pre-tool-use" '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/auth/callback.ts"}}' || true

  echo ""
  echo -e "  ${GREEN}✓ Bobtention detected stuck trajectory and requested human attention.${RESET}"
}

# ─── Act 3 — Task Drift ───────────────────────────────────────────────────────

run_act3() {
  section "Act 3 — Task Drift (OAuth → PaymentService)"
  echo ""

  SESSION_ID="demo-act3-$(date +%s)"

  step "SessionStart + UserPromptSubmit — intent: OAuth login"
  run_hook "session-start" '{"session_id":"'"$SESSION_ID"'"}'
  run_hook "user-prompt-submit" '{"session_id":"'"$SESSION_ID"'","prompt":"Implement OAuth login"}'
  pause

  # Establish auth scope
  for auth_file in "src/auth/oauth.ts" "src/auth/provider.ts" "src/auth/session.ts" "src/auth/callback.ts" "src/auth/middleware.ts"; do
    step "PreToolUse: edit $auth_file"
    run_hook "pre-tool-use" '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"'"$auth_file"'"}}'
    run_hook "post-tool-use" '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"'"$auth_file"'"}}'
    pause
  done

  echo ""
  step "PreToolUse: edit src/payment/PaymentService.kt  ← DRIFT"
  run_hook "pre-tool-use" '{
    "session_id":"'"$SESSION_ID"'",
    "tool_name":"edit",
    "tool_input":{"path":"src/payment/PaymentService.kt"}
  }' || true

  echo ""
  echo -e "  ${GREEN}✓ Bobtention detected task drift from OAuth to payment code.${RESET}"
}

# ─── Act 4 — Human Override ───────────────────────────────────────────────────

run_act4() {
  section "Act 4 — Human Override (developer chooses Continue)"
  echo ""

  SESSION_ID="demo-act4-$(date +%s)"

  step "SessionStart + UserPromptSubmit"
  run_hook "session-start" '{"session_id":"'"$SESSION_ID"'"}'
  run_hook "user-prompt-submit" '{"session_id":"'"$SESSION_ID"'","prompt":"Fix OAuth callback returning 401"}'
  pause

  # Trigger a block via 4 failures
  for i in 1 2 3 4; do
    run_hook "post-tool-use" '{
      "session_id":"'"$SESSION_ID"'",
      "tool_name":"bash",
      "tool_input":{"command":"npm test"},
      "tool_response":{"output":"FAIL oauth_callback_test > should return token > failed"}
    }' > /dev/null
  done

  echo ""
  echo -e "  Bobtention has blocked the next action."
  echo -e "  Developer chooses: ${BOLD}[Continue]${RESET}"
  echo ""

  step "Developer runs: npx bobtention override $SESSION_ID"
  node "$BOBTENTION_DIR/dist/scripts/override.js" "$SESSION_ID" 2>&1 || true
  pause

  step "Next PreToolUse — override consumed → ALLOWED"
  run_hook "pre-tool-use" '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/auth/callback.ts"}}'

  echo ""
  echo -e "  ${GREEN}✓ Bobtention routed attention; it did not replace human judgment.${RESET}"
}

# ─── Act 5 — High-Impact Change ───────────────────────────────────────────────

run_act5() {
  section "Act 5 — High-Impact Change (migration file)"
  echo ""

  SESSION_ID="demo-act5-$(date +%s)"

  step "SessionStart + UserPromptSubmit"
  run_hook "session-start" '{"session_id":"'"$SESSION_ID"'"}'
  run_hook "user-prompt-submit" '{"session_id":"'"$SESSION_ID"'","prompt":"Add user profile picture field"}'
  pause

  step "Normal work: edit src/users/profile.ts"
  run_hook "pre-tool-use" '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/users/profile.ts"}}'
  run_hook "post-tool-use" '{"session_id":"'"$SESSION_ID"'","tool_name":"edit","tool_input":{"path":"src/users/profile.ts"}}'
  pause

  echo ""
  step "PreToolUse: edit db/migrations/20240101_add_avatar_url.sql  ← HIGH IMPACT"
  run_hook "pre-tool-use" '{
    "session_id":"'"$SESSION_ID"'",
    "tool_name":"edit",
    "tool_input":{"path":"db/migrations/20240101_add_avatar_url.sql"}
  }' || true

  echo ""
  echo -e "  ${GREEN}✓ Bobtention flagged the migration file as a high-impact change.${RESET}"
}

# ─── Run acts ─────────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║          Bobtention Demo                    ║${RESET}"
echo -e "${BOLD}║   Human attention router for IBM Bob        ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"

case "$ACT" in
  1) run_act1 ;;
  2) run_act2 ;;
  3) run_act3 ;;
  4) run_act4 ;;
  5) run_act5 ;;
  all)
    run_act1
    run_act2
    run_act3
    run_act4
    run_act5
    echo ""
    section "Demo Complete"
    echo ""
    echo -e "  ${GREEN}All 5 acts completed successfully.${RESET}"
    echo ""
    ;;
  *)
    echo "Usage: $0 [1|2|3|4|5|all]"
    exit 1
    ;;
esac

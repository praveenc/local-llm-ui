#!/bin/bash
# Claude Code statusline for local-llm-ui
# Shows model, git info, context usage, cost, and session stats
# Tailored for AI SDK development workflow

set -euo pipefail

# Read JSON from stdin
input=$(cat)

# ANSI color codes
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
CYAN='\033[36m'
MAGENTA='\033[35m'
BLUE='\033[34m'

# Extract fields with jq (fallback to defaults for null/missing)
MODEL=$(echo "$input" | jq -r '.model.display_name // "Unknown"')
MODEL_ID=$(echo "$input" | jq -r '.model.id // ""')
CWD=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // "."')
PROJECT_DIR=$(echo "$input" | jq -r '.workspace.project_dir // ""')
PCT=$(echo "$input" | jq -r '.context_window.used_percentage // 0' | cut -d. -f1)
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')
LINES_ADDED=$(echo "$input" | jq -r '.cost.total_lines_added // 0')
LINES_REMOVED=$(echo "$input" | jq -r '.cost.total_lines_removed // 0')
AGENT=$(echo "$input" | jq -r '.agent.name // ""')
VIM_MODE=$(echo "$input" | jq -r '.vim.mode // ""')

# Get git info (branch + status)
GIT_BRANCH=""
GIT_STATUS=""
if command -v git &>/dev/null && [ -d "$CWD/.git" ] || git -C "$CWD" rev-parse --git-dir &>/dev/null 2>&1; then
    GIT_BRANCH=$(git -C "$CWD" branch --show-current 2>/dev/null || echo "")
    # Check for uncommitted changes
    if [ -n "$GIT_BRANCH" ]; then
        if ! git -C "$CWD" diff --quiet 2>/dev/null || ! git -C "$CWD" diff --cached --quiet 2>/dev/null; then
            GIT_STATUS="*"
        fi
        # Check for untracked files
        if [ -n "$(git -C "$CWD" ls-files --others --exclude-standard 2>/dev/null | head -1)" ]; then
            GIT_STATUS="${GIT_STATUS}+"
        fi
    fi
fi

# Format duration as HH:MM:SS or MM:SS
format_duration() {
    local ms=$1
    local secs=$((ms / 1000))
    local mins=$((secs / 60))
    local hours=$((mins / 60))
    secs=$((secs % 60))
    mins=$((mins % 60))

    if [ "$hours" -gt 0 ]; then
        printf "%d:%02d:%02d" "$hours" "$mins" "$secs"
    else
        printf "%d:%02d" "$mins" "$secs"
    fi
}

# Format cost (show cents if < $1)
format_cost() {
    local cost=$1
    if (( $(echo "$cost < 0.01" | bc -l) )); then
        printf "\$0.00"
    elif (( $(echo "$cost < 1" | bc -l) )); then
        printf "\$%.2f" "$cost"
    else
        printf "\$%.2f" "$cost"
    fi
}

# Build context bar with color based on usage
build_context_bar() {
    local pct=$1
    local width=15
    local filled=$((pct * width / 100))
    local empty=$((width - filled))

    # Color based on usage level
    local color
    if [ "$pct" -lt 50 ]; then
        color="$GREEN"
    elif [ "$pct" -lt 75 ]; then
        color="$YELLOW"
    elif [ "$pct" -lt 90 ]; then
        color="$RED"
    else
        color="${BOLD}${RED}"
    fi

    local bar=""
    [ "$filled" -gt 0 ] && bar=$(printf "%${filled}s" | tr ' ' '█')
    [ "$empty" -gt 0 ] && bar="${bar}$(printf "%${empty}s" | tr ' ' '░')"

    printf "${color}${bar}${RESET} ${pct}%%"
}

# --- LINE 1: Model | Agent | Git | Directory ---
line1=""

# Model (with short ID hint for provider identification)
provider_hint=""
case "$MODEL_ID" in
    *bedrock*|*anthropic.claude*) provider_hint="BR" ;;
    *anthropic*) provider_hint="AN" ;;
    *groq*) provider_hint="GQ" ;;
    *cerebras*) provider_hint="CB" ;;
    *lmstudio*|*lm-studio*) provider_hint="LM" ;;
    *ollama*) provider_hint="OL" ;;
    *mantle*) provider_hint="MT" ;;
    *gpt*|*openai*) provider_hint="OA" ;;
    *) provider_hint="" ;;
esac

if [ -n "$provider_hint" ]; then
    line1="${BOLD}${CYAN}${MODEL}${RESET} ${DIM}(${provider_hint})${RESET}"
else
    line1="${BOLD}${CYAN}${MODEL}${RESET}"
fi

# Agent name (if running as subagent)
if [ -n "$AGENT" ]; then
    line1="${line1} ${MAGENTA}⚡${AGENT}${RESET}"
fi

# Vim mode indicator
if [ -n "$VIM_MODE" ]; then
    if [ "$VIM_MODE" = "NORMAL" ]; then
        line1="${line1} ${DIM}[N]${RESET}"
    else
        line1="${line1} ${GREEN}[I]${RESET}"
    fi
fi

# Git branch
if [ -n "$GIT_BRANCH" ]; then
    line1="${line1} ${DIM}│${RESET} ${BLUE}⎇ ${GIT_BRANCH}${YELLOW}${GIT_STATUS}${RESET}"
fi

# Directory (just the folder name)
DIR_NAME="${CWD##*/}"
line1="${line1} ${DIM}│${RESET} ${DIM}📁 ${DIR_NAME}${RESET}"

# --- LINE 2: Context bar | Cost | Duration | Lines ---
line2=""

# Context bar
line2="$(build_context_bar "$PCT")"

# Cost
FORMATTED_COST=$(format_cost "$COST")
line2="${line2} ${DIM}│${RESET} ${GREEN}${FORMATTED_COST}${RESET}"

# Duration
FORMATTED_DURATION=$(format_duration "$DURATION_MS")
line2="${line2} ${DIM}│${RESET} ${DIM}⏱ ${FORMATTED_DURATION}${RESET}"

# Lines changed (only show if there are changes)
if [ "$LINES_ADDED" -gt 0 ] || [ "$LINES_REMOVED" -gt 0 ]; then
    line2="${line2} ${DIM}│${RESET} ${GREEN}+${LINES_ADDED}${RESET}/${RED}-${LINES_REMOVED}${RESET}"
fi

# Output both lines
echo -e "$line1"
echo -e "$line2"

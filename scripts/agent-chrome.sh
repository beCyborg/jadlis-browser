#!/bin/bash
# agent-chrome.sh — the agent's own Chrome profiles with a CDP port on 127.0.0.1 (jadlis-browser).
#   Install: copy this file and agent-chrome-cdp.mjs to ~/.claude/scripts/, chmod +x both.
#   Profiles and ports come from ~/.config/jadlis/agent-chrome.conf (AGENT_CHROME_CONF overrides), one
#   `name=port [app=<Application name>]` per line; no `app=` → "Google Chrome" (e.g. `work=9334 app=Google Chrome Beta`).
#   No config file → one built-in profile `agent=9333`.
#   Default profile (no profile argument): BROWSER_PROFILE from ~/.config/jadlis/agent.conf, else `agent`.
#   Each profile is a separate Chrome instance with its own data dir under
#   ~/Library/Application Support/Jadlis Agent Chrome/<profile>; the user's own Chrome is never touched.
# Usage: agent-chrome.sh {ensure|status|stop|window [url]|front [targetId]|open|hold [min]|release|idle-stop} [profile]
#        agent-chrome.sh profile    print the default profile
#        agent-chrome.sh profiles   print the configured profiles as name=port (the app is in `status`)
#        agent-chrome.sh watch      for launchd: keep BROWSER_KEEPALIVE profiles up, idle-stop the others
#        agent-chrome.sh version    the jadlis-browser version that installed this copy (setup stamp)
#        agent-chrome.sh --help
#   ensure     start if not running, wait for the port, heal discarded/crashed tabs; "clients" = other operators connected now
#   status     port, tabs, healed tabs (heals like ensure, never starts Chrome)
#   stop       Browser.close over CDP (Chrome flushes cookies), kill only as fallback
#   window     open a background window for a parallel operator, print its targetId
#   front      bring one tab (targetId, default the first) and its window to the front — e.g. a CAPTCHA the solver
#              extension must see in an active tab; no hold
#   open       ensure + bring the profile's window to the front for manual work (log in by hand);
#              holds idle-stop for HOLD_MIN (120) min
#   hold       an operator stopping with BLOCKED keeps the profile up while its Claude Code process lives,
#              at most WAIT_MIN (1440) min or the given minutes; `release` drops this process's hold
#   idle-stop  stop the profile when no CDP client was connected for IDLE_MIN (30) minutes, no live `open` hold
#              and no live BLOCKED hold is set; run it every few minutes from launchd (`watch` does)
#   Keep-alive: BROWSER_KEEPALIVE="name1 name2" in agent.conf — `watch` starts those profiles when they are down
#              and never idle-stops them.
# Needs: macOS, Google Chrome (or the app named per profile), Node.js 22+ (global WebSocket). Binary paths are resolved explicitly: launchd gives a minimal PATH.
set -u

USAGE="usage: agent-chrome.sh {ensure|status|stop|window [url]|front [targetId]|open|hold [min]|release|idle-stop} [profile]
       agent-chrome.sh {profile|profiles|watch|version|--help}"

CMD=${1:-}
case "$CMD" in
  -h|--help|help) echo "$USAGE"; exit 0 ;;
  '') echo "$USAGE" >&2; exit 64 ;;
esac

CURL=/usr/bin/curl
OPEN=/usr/bin/open
LSOF=/usr/sbin/lsof
NODE=${AGENT_CHROME_NODE:-}
if [ -z "$NODE" ]; then
  for n in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node; do
    [ -n "$n" ] && [ -x "$n" ] && { NODE=$n; break; }
  done
fi
HELPER=${AGENT_CHROME_HELPER:-"$(cd "$(dirname "$0")" && pwd)/agent-chrome-cdp.mjs"}
ROOT="$HOME/Library/Application Support/Jadlis Agent Chrome"
STATE="$ROOT/.state"
LOG="$HOME/.claude/logs/agent-chrome.log"
IDLE_MIN=${AGENT_CHROME_IDLE_MIN:-30}
HOLD_MIN=${AGENT_CHROME_HOLD_MIN:-120}
WAIT_MIN=${AGENT_CHROME_WAIT_MIN:-1440}
CONF=${AGENT_CHROME_CONF:-$HOME/.config/jadlis/agent-chrome.conf}
AGENT_CONF=${JADLIS_AGENT_CONF:-$HOME/.config/jadlis/agent.conf}

# Profile config as `name=port<TAB>app` lines (app may be empty), comments and blanks dropped; built-in default when
# the file is missing.
conf_lines() {
  if [ -r "$CONF" ]; then
    awk '$0 !~ /^[[:space:]]*#/ && $0 ~ /=/ {
      line = $0; app = ""; i = index(line, "app=")
      if (i > 1) { app = substr(line, i + 4); line = substr(line, 1, i - 1) }
      sub(/^[[:space:]]+/, "", app); sub(/[[:space:]]+$/, "", app); gsub(/[[:space:]]/, "", line)
      if (split(line, a, "=") == 2 && a[1] != "") print a[1] "=" a[2] "\t" app
    }' "$CONF"
  else
    printf 'agent=9333\t\n'
  fi
}
profiles() { conf_lines | cut -f1; }
# The application that runs a profile: `app=` of its config line, else Google Chrome.
profile_app() {
  local a; a=$(conf_lines | awk -F'\t' -v p="$1" '{ split($1, n, "=") } n[1] == p { print $2; exit }')
  echo "${a:-Google Chrome}"
}
default_profile() {
  local p=""
  [ -r "$AGENT_CONF" ] && p=$(awk -F= '$1 == "BROWSER_PROFILE" { sub(/^[^=]*=/, ""); gsub(/["\047[:space:]]/, ""); print; exit }' "$AGENT_CONF")
  echo "${p:-agent}"
}

keepalive_list() {
  [ -r "$AGENT_CONF" ] || return 0
  awk -F= '$1 == "BROWSER_KEEPALIVE" { sub(/^[^=]*=/, ""); gsub(/["\047]/, ""); gsub(/,/, " "); print; exit }' "$AGENT_CONF"
}

case "$CMD" in
  profile) default_profile; exit 0 ;;
  profiles) profiles; exit 0 ;;
  version) cat "$(cd "$(dirname "$0")" && pwd)/.jadlis-browser-version" 2>/dev/null || echo unknown; exit 0 ;;
  watch)
    keep=" $(keepalive_list) "
    for name in $(profiles | cut -d= -f1); do
      case "$keep" in
        *" $name "*) "$0" status "$name" >/dev/null 2>&1 || "$0" ensure "$name" >/dev/null 2>&1 ;;
        *) "$0" idle-stop "$name" >/dev/null 2>&1 ;;
      esac
    done
    exit 0 ;;
esac

P=${2:-$(default_profile)}; ARG=${3:-}
case "$P" in
  *[!a-z0-9_-]*) echo "agent-chrome.sh: bad profile name: $P" >&2; exit 64 ;;
esac
PORT=$(profiles | awk -F= -v p="$P" '$1 == p { print $2; exit }')
if [ -z "$PORT" ]; then
  known=$(profiles | cut -d= -f1 | paste -sd ' ' -)
  echo "agent-chrome.sh: unknown profile '$P' — known: ${known:-none} (config: $CONF)" >&2; exit 64
fi
case "$PORT" in
  ''|*[!0-9]*) echo "agent-chrome.sh: bad port '$PORT' for profile '$P' in $CONF" >&2; exit 78 ;;
esac
DIR="$ROOT/$P"
APP=$(profile_app "$P")

case "$CMD" in
  ensure|status|stop|window|front|open|hold|release|idle-stop) ;;
  *) echo "$USAGE" >&2; exit 64 ;;
esac
if [ -z "$NODE" ]; then echo '{"ok":false,"error":"node not found — install Node.js 22+ or set AGENT_CHROME_NODE"}'; exit 69; fi
if [ ! -r "$HELPER" ]; then echo "{\"ok\":false,\"error\":\"helper not found: $HELPER — copy agent-chrome-cdp.mjs next to agent-chrome.sh\"}"; exit 69; fi
mkdir -p "$STATE" "$(dirname "$LOG")"

log() { printf '%s %s %s\n' "$(date '+%F %T')" "$P" "$*" >> "$LOG"; }
alive() { $CURL -s -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; }
main_pid() { /usr/bin/pgrep -o -f -- "--user-data-dir=$DIR" 2>/dev/null; }
lease() { touch "$STATE/$P.lease"; }
# CDP clients other than Chrome itself — each running operator's Playwright MCP keeps one websocket open.
# The Claude Code process that runs this operator: CLAUDE_PID, else the nearest ancestor named claude, else PPID.
owner_pid() {
  if [ -n "${CLAUDE_PID:-}" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then echo "$CLAUDE_PID"; return; fi
  local p=$PPID c
  for _ in 1 2 3 4 5 6 7 8; do
    [ -z "$p" ] || [ "$p" -le 1 ] && break
    c=$(/bin/ps -o comm= -p "$p" 2>/dev/null)
    case "${c##*/}" in claude|claude-*) echo "$p"; return ;; esac
    p=$(/bin/ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
  done
  echo "$PPID"
}
# Live BLOCKED holds: $STATE/$P.wait.<pid> holding an expiry epoch; dead or expired ones are removed.
live_waits() {
  local f pid exp n=0 now; now=$(date +%s)
  for f in "$STATE/$P".wait.*; do
    [ -e "$f" ] || continue
    pid=${f##*.}; exp=$(cat "$f" 2>/dev/null)
    if [ -n "$exp" ] && [ "$now" -lt "$exp" ] 2>/dev/null && kill -0 "$pid" 2>/dev/null; then n=$((n + 1)); else rm -f "$f"; log "wait hold of $pid ended"; fi
  done
  echo "$n"
}
clients() { $LSOF -nP -iTCP:$PORT -sTCP:ESTABLISHED 2>/dev/null | awk 'NR>1 && $1 !~ /Google/ {print $2}' | sort -u | wc -l | tr -d ' '; }

start() {
  mkdir -p "$DIR"
  $OPEN -g -n -a "$APP" --args \
    --user-data-dir="$DIR" --remote-debugging-port=$PORT \
    --no-first-run --no-default-browser-check \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
    || { log "open -a \"$APP\" failed"; return 1; }
  for _ in $(seq 1 60); do alive && return 0; sleep 0.5; done
  return 1
}

case "$CMD" in
  ensure)
    if ! alive; then
      if [ -n "$(main_pid)" ]; then
        echo "{\"ok\":false,\"error\":\"Chrome for $P runs (pid $(main_pid)) but port $PORT does not answer — run: agent-chrome.sh stop $P\"}"
        log "ensure: process without port"; exit 1
      fi
      log "start ($APP)"
      start || { echo "{\"ok\":false,\"error\":\"$APP did not start or port $PORT did not come up in 30 s\"}"; log "start failed"; exit 1; }
    fi
    lease; n=$(clients)
    out=$("$NODE" "$HELPER" $PORT heal | sed "s/^{/{\"profile\":\"$P\",\"clients\":$n,/"); rc=${PIPESTATUS[0]}
    echo "$out"; log "ensure $out"; exit $rc ;;
  status)
    if ! alive; then echo "{\"ok\":false,\"profile\":\"$P\",\"running\":false,\"app\":\"$APP\",\"port\":$PORT,\"pid\":\"$(main_pid)\"}"; exit 1; fi
    n=$(clients)
    out=$("$NODE" "$HELPER" $PORT heal); rc=$?
    echo "$out" | sed "s/^{/{\"profile\":\"$P\",\"running\":true,\"app\":\"$APP\",\"port\":$PORT,\"clients\":$n,\"hold\":$( [ -e "$STATE/$P.hold" ] && echo true || echo false ),\"waits\":$(live_waits),/"; exit $rc ;;
  window)
    alive || { echo "{\"ok\":false,\"error\":\"not running — run: agent-chrome.sh ensure $P\"}"; exit 1; }
    lease
    "$NODE" "$HELPER" $PORT window "$ARG" ;;
  front)
    alive || { echo "{\"ok\":false,\"error\":\"not running — run: agent-chrome.sh ensure $P\"}"; exit 1; }
    lease
    "$NODE" "$HELPER" $PORT front "$ARG" ;;
  hold)
    min=${ARG:-$WAIT_MIN}
    case "$min" in ''|*[!0-9]*) echo "agent-chrome.sh: hold takes minutes" >&2; exit 64 ;; esac
    [ "$min" -gt "$WAIT_MIN" ] && min=$WAIT_MIN
    op=$(owner_pid); echo $(( $(date +%s) + min * 60 )) > "$STATE/$P.wait.$op"; lease
    log "hold by $op for ${min} min"
    echo "{\"ok\":true,\"profile\":\"$P\",\"hold_pid\":$op,\"minutes\":$min}" ;;
  release)
    op=$(owner_pid); rm -f "$STATE/$P.wait.$op"; lease; log "release by $op"
    echo "{\"ok\":true,\"profile\":\"$P\",\"released\":$op}" ;;
  open)
    "$0" ensure "$P" >/dev/null || exit 1
    touch "$STATE/$P.hold"; log "open (hold)"
    "$NODE" "$HELPER" $PORT front ;;
  stop)
    rm -f "$STATE/$P.hold" "$STATE/$P.lease"
    if alive; then "$NODE" "$HELPER" $PORT close >/dev/null; fi
    for _ in $(seq 1 30); do [ -z "$(main_pid)" ] && { echo '{"ok":true,"stopped":"cdp"}'; log "stop cdp"; exit 0; }; sleep 0.5; done
    pid=$(main_pid)
    if [ -n "$pid" ]; then kill "$pid"; sleep 3; [ -n "$(main_pid)" ] && kill -9 "$(main_pid)"; log "stop kill $pid"; echo "{\"ok\":true,\"stopped\":\"kill\"}"; exit 0; fi
    echo '{"ok":true,"stopped":"not running"}' ;;
  idle-stop)
    alive || exit 0
    # An `open` hold keeps the profile up for manual work, but expires after HOLD_MIN minutes.
    if [ -e "$STATE/$P.hold" ]; then
      hage=$(( ( $(date +%s) - $(/usr/bin/stat -f %m "$STATE/$P.hold") ) / 60 ))
      [ "$hage" -lt "$HOLD_MIN" ] && exit 0
      rm -f "$STATE/$P.hold"; lease; log "hold expired after ${hage} min"; exit 0
    fi
    # A connected Playwright MCP client keeps a websocket to the port open for the whole agent run;
    # an operator that stopped with BLOCKED keeps a wait hold while its Claude Code process lives.
    if [ "$(clients)" -gt 0 ] || [ "$(live_waits)" -gt 0 ] || [ ! -e "$STATE/$P.lease" ]; then lease; exit 0; fi
    age=$(( ( $(date +%s) - $(/usr/bin/stat -f %m "$STATE/$P.lease") ) / 60 ))
    if [ "$age" -ge "$IDLE_MIN" ]; then log "idle ${age} min — stop"; "$0" stop "$P" >/dev/null; fi ;;
esac

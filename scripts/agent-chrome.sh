#!/bin/bash
# agent-chrome.sh — the agent's own Chrome profiles with a CDP port on 127.0.0.1 (jadlis-browser).
#   Install: copy this file and agent-chrome-cdp.mjs to ~/.claude/scripts/, chmod +x both.
#   Profiles and ports come from ~/.config/jadlis/agent-chrome.conf (AGENT_CHROME_CONF overrides), one
#   `name=port [app=<Application name>] [ext=<folder>[:<folder>…]]` per line; no `app=` → "Google Chrome"
#   (e.g. `work=9334 app=Google Chrome Beta`). `ext=` names unpacked extension folders (absolute paths) that the
#   helper loads over CDP after every start and in ensure/status when the profile runs without them; a missing
#   folder is a warning in the JSON "ext" list, never a failed start. No config file → one built-in profile `agent=9333`.
#   Per-profile proxy (2026-11-16, stream w2-proxyroute): `proxy=<name>` reads the upstream from
#   ~/.config/jadlis/proxies/<name>.url (mode 600, one line http://user:pass@host:port | socks5://…; `{session}` becomes an
#   8-char id of the profile → its own sticky IP from a residential pool). A local gost forwarder on 127.0.0.1:<port+10000>
#   carries the login; Chrome only gets --proxy-server to that forwarder, so a dead forwarder breaks pages instead of leaking
#   the home IP. `expect=<CC>` — the exit IP must be in that country; `pending=direct` — while the .url file is missing the
#   profile starts on the home IP and says so ("proxy_state":"pending"). With a proxy set, a start whose exit IP does not
#   answer, equals the home IP or misses `expect=` is refused, and ensure refuses a running Chrome that lacks the proxy flag.
#   Start without focus: Chrome starts with --no-startup-window (macOS does not make a windowless app frontmost),
#   then the helper opens the first window in the background over CDP; that window also runs Chrome's session
#   restore when «Continue where you left off» is on. Only `open` and `front` raise a window on purpose.
#   Default profile (no profile argument): BROWSER_PROFILE from ~/.config/jadlis/agent.conf, else `agent`.
#   Each profile is a separate Chrome instance with its own data dir under
#   ~/Library/Application Support/Jadlis Agent Chrome/<profile>; the user's own Chrome is never touched.
# Usage: agent-chrome.sh {ensure|status|stop|window [url]|front [targetId]|open|hold [min]|release|idle-stop} [profile]
#        agent-chrome.sh profile    print the default profile
#        agent-chrome.sh profiles   print the configured profiles as name=port (the app is in `status`)
#        agent-chrome.sh watch      for launchd: keep BROWSER_KEEPALIVE profiles up, idle-stop the others
#        agent-chrome.sh version    the jadlis-browser version that installed this copy (setup stamp)
#        agent-chrome.sh --help
#   ensure     start if not running (no focus change), wait for the port, heal discarded/crashed tabs, load `ext=`;
#              "clients" = other operators connected now, "boot.restored" = tabs session restore brought back
#   status     port, tabs, healed tabs, `ext=` (heals and loads like ensure, never starts Chrome)
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

# Profile config as `name=port<TAB>app<TAB>ext` lines (app and ext may be empty), comments and blanks dropped;
# built-in default when the file is missing. The keys `app=` and `ext=` start after whitespace, in any order; a value
# runs to the next key or the end of the line (app names and folders may hold spaces); several `ext=` join with `:`.
conf_lines() { # name=port \t app \t ext \t proxy \t expect \t pending
  if [ -r "$CONF" ]; then
    awk '$0 !~ /^[[:space:]]*#/ && $0 ~ /=/ {
      line = $0; app = ""; ext = ""; px = ""; ex = ""; pd = ""; rest = ""
      K = "[[:space:]](app|ext|proxy|expect|pending)="
      if (match(line, K)) { rest = substr(line, RSTART + 1); line = substr(line, 1, RSTART - 1) }
      while (rest != "") {
        eq = index(rest, "="); key = substr(rest, 1, eq - 1); rest = substr(rest, eq + 1)
        if (match(rest, K)) { val = substr(rest, 1, RSTART - 1); rest = substr(rest, RSTART + 1) }
        else { val = rest; rest = "" }
        sub(/^[[:space:]]+/, "", val); sub(/[[:space:]]+$/, "", val)
        if (key == "app") app = val
        else if (key == "proxy") px = val
        else if (key == "expect") ex = val
        else if (key == "pending") pd = val
        else if (val != "") ext = (ext == "" ? val : ext ":" val)
      }
      gsub(/[[:space:]]/, "", line)
      if (split(line, a, "=") == 2 && a[1] != "") print a[1] "=" a[2] "\t" app "\t" ext "\t" px "\t" ex "\t" pd
    }' "$CONF"
  else
    printf 'agent=9333\t\t\t\t\t\n'
  fi
}
profile_field() { conf_lines | awk -F'\t' -v p="$1" -v i="$2" '{ split($1, n, "=") } n[1] == p { print $i; exit }'; }
profiles() { conf_lines | cut -f1; }
# The application that runs a profile: `app=` of its config line, else Google Chrome.
profile_app() {
  local a; a=$(conf_lines | awk -F'\t' -v p="$1" '{ split($1, n, "=") } n[1] == p { print $2; exit }')
  echo "${a:-Google Chrome}"
}
# Extension folders of a profile (`ext=`), `:`-separated; empty when the line has none.
profile_ext() { conf_lines | awk -F'\t' -v p="$1" '{ split($1, n, "=") } n[1] == p { print $3; exit }'; }
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
EXT=$(profile_ext "$P")
# Helper flags for heal: --ext only when the profile names extension folders (no `ext=` → today's behaviour).
EXTARGS=(); [ -n "$EXT" ] && EXTARGS=(--ext "$EXT")
# Proxy of this profile (see the header). PXSTATE: none | pending (file not there yet, pending=direct) | missing | armed.
PROXY=$(profile_field "$P" 4); EXPECT=$(profile_field "$P" 5); PENDING=$(profile_field "$P" 6)
PROXY_DIR=${AGENT_CHROME_PROXY_DIR:-$HOME/.config/jadlis/proxies}
FPORT=$((PORT + 10000))
GOST=${AGENT_CHROME_GOST:-/opt/homebrew/bin/gost}
JQ=/opt/homebrew/bin/jq
PXSTATE=none
if [ -n "$PROXY" ]; then
  if [ -f "$PROXY_DIR/$PROXY.url" ]; then PXSTATE=armed; elif [ "$PENDING" = direct ]; then PXSTATE=pending; else PXSTATE=missing; fi
fi
PXARGS=(); PXJSON="\"proxy\":\"${PROXY:-none}\",\"proxy_state\":\"$PXSTATE\","

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

sedq() { printf '%s' "$1" | sed -e 's/[\\/&]/\\&/g'; }  # escape for a sed replacement
# ---- proxy forwarder (gost) -------------------------------------------------------------------------------------
fwd_pid() { local f="$STATE/$P.gost.pid" p; [ -s "$f" ] || return 1; p=$(cat "$f"); kill -0 "$p" 2>/dev/null && echo "$p"; }
fwd_stop() { local p; p=$(fwd_pid) && kill "$p" 2>/dev/null; rm -f "$STATE/$P.gost.pid" "$STATE/$P.gost.yaml"; }
ipinfo() { # $1 = forwarder port or empty
  local via=(); [ -n "${1:-}" ] && via=(-x "http://127.0.0.1:$1")
  $CURL -fsS -m 15 ${via[@]+"${via[@]}"} https://ipinfo.io/json 2>/dev/null | $JQ -c '{ip, country, city, org, timezone}' 2>/dev/null || echo '{}'
}
home_ip() { # this Mac's own public IP, cached for an hour
  local c="$STATE/home-ip"
  if [ ! -s "$c" ] || [ $(( $(date +%s) - $(/usr/bin/stat -f %m "$c") )) -gt 3600 ]; then ipinfo "" | $JQ -r '.ip // empty' > "$c"; fi
  cat "$c"
}
# Start the forwarder if needed and check the exit. Sets PXARGS (Chrome flags), PXJSON, PXTZ. Prints a refusal and
# returns 1 when the proxy is set but the exit is wrong.
proxy_up() {
  PXARGS=(); PXTZ=""
  case "$PXSTATE" in
    none) return 0 ;;
    pending) PXJSON="\"proxy\":\"$PROXY\",\"proxy_state\":\"pending\",\"note\":\"proxy $PROXY not bought yet — home IP\","; return 0 ;;
    missing) PXREASON="proxy file $PROXY_DIR/$PROXY.url is missing"; return 1 ;;
  esac
  local f="$PROXY_DIR/$PROXY.url"
  [ "$(/usr/bin/stat -f %Lp "$f")" = 600 ] || { PXREASON="$f must be mode 600"; return 1; }
  [ -x "$GOST" ] || { PXREASON="gost not found at $GOST (brew install gost)"; return 1; }
  if ! fwd_pid >/dev/null; then
    /usr/bin/python3 - "$f" "$STATE/$P.gost.yaml" "$FPORT" "$(printf '%s' "$P" | /sbin/md5 -q | cut -c1-8)" <<'PY' || { PXREASON="bad proxy URL in $f"; return 1; }
import os, sys, urllib.parse
src, dst, port, sid = sys.argv[1:5]
u = urllib.parse.urlsplit(open(src).read().strip().replace("{session}", sid))
if u.scheme not in ("http", "socks5", "socks5h") or not u.hostname or not u.port:
    sys.exit("proxy url must be http:// or socks5://[user:pass@]host:port")
kind = "http" if u.scheme == "http" else "socks5"
auth = ""
if u.username:
    q = lambda s: '"' + urllib.parse.unquote(s or "").replace("\\", "\\\\").replace('"', '\\"') + '"'
    auth = "\n        auth:\n          username: %s\n          password: %s" % (q(u.username), q(u.password))
conf = """services:
- name: agent-chrome
  addr: 127.0.0.1:%s
  handler:
    type: http
    chain: upstream
  listener:
    type: tcp
chains:
- name: upstream
  hops:
  - name: hop0
    nodes:
    - name: provider
      addr: %s:%s
      connector:
        type: %s%s
      dialer:
        type: tcp
""" % (port, u.hostname, u.port, kind, auth)
fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, conf.encode()); os.close(fd)
PY
    nohup "$GOST" -C "$STATE/$P.gost.yaml" >/dev/null 2>&1 &
    echo $! > "$STATE/$P.gost.pid"
    for _ in $(seq 1 50); do $CURL -s -m 1 -o /dev/null "http://127.0.0.1:$FPORT" 2>/dev/null; [ $? -ne 7 ] && break; sleep 0.1; done
    log "forwarder up on $FPORT ($PROXY)"
  fi
  local info eip ecc; info=$(ipinfo "$FPORT"); eip=$($JQ -r '.ip // empty' <<<"$info"); ecc=$($JQ -r '.country // empty' <<<"$info")
  if [ -z "$eip" ]; then fwd_stop; PXREASON="proxy $PROXY does not answer"; return 1; fi
  if [ "$eip" = "$(home_ip)" ]; then fwd_stop; PXREASON="proxy $PROXY exits on the home IP $eip"; return 1; fi
  if [ -n "$EXPECT" ] && [ "$ecc" != "$EXPECT" ]; then fwd_stop; PXREASON="exit IP $eip is in '$ecc', expected '$EXPECT'"; return 1; fi
  PXTZ=$($JQ -r '.timezone // empty' <<<"$info")
  PXARGS=(--proxy-server="http://127.0.0.1:$FPORT" --force-webrtc-ip-handling-policy=disable_non_proxied_udp)
  PXJSON="\"proxy\":\"$PROXY\",\"proxy_state\":\"armed\",\"exit\":$info,"
}
# The running Chrome must carry the forwarder flag when the proxy is armed (it was started before the proxy existed →
# it would browse on the home IP).
running_has_proxy() { /bin/ps -ww -o command= -p "$(main_pid)" 2>/dev/null | grep -q -- "--proxy-server=http://127.0.0.1:$FPORT"; }
set_webrtc_pref() { # profile preference, not only the flag (on the server the flag alone leaked the IP, 16.11)
  local f="$DIR/Default/Preferences"; mkdir -p "$DIR/Default"; [ -s "$f" ] || echo '{}' > "$f"
  $JQ '.webrtc.ip_handling_policy = "disable_non_proxied_udp" | .webrtc.multiple_routes_enabled = false | .webrtc.nonproxied_udp_enabled = false' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}

# --no-startup-window: Chrome comes up with no window, so it never becomes the frontmost app (with a startup window
# it takes the focus even under `open -g`; `open -j` still gives it ~2 s). `heal --boot` opens the first window.
start() {
  mkdir -p "$DIR"
  local envs=()
  if [ ${#PXARGS[@]} -gt 0 ]; then
    set_webrtc_pref
    [ -n "${PXTZ:-}" ] && envs=(--env "TZ=$PXTZ")
  fi
  $OPEN -g -n ${envs[@]+"${envs[@]}"} -a "$APP" --args \
    --user-data-dir="$DIR" --remote-debugging-port=$PORT \
    --no-first-run --no-default-browser-check --no-startup-window \
    --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling \
    ${PXARGS[@]+"${PXARGS[@]}"} \
    || { log "open -a \"$APP\" failed"; return 1; }
  for _ in $(seq 1 60); do alive && return 0; sleep 0.5; done
  return 1
}

case "$CMD" in
  ensure)
    boot=()
    if ! alive; then
      if [ -n "$(main_pid)" ]; then
        echo "{\"ok\":false,\"error\":\"Chrome for $P runs (pid $(main_pid)) but port $PORT does not answer — run: agent-chrome.sh stop $P\"}"
        log "ensure: process without port"; exit 1
      fi
      if ! proxy_up; then
        echo "{\"ok\":false,\"profile\":\"$P\",\"proxy\":\"$PROXY\",\"refused\":true,\"error\":\"refused to start: $PXREASON\"}"
        log "start refused: $PXREASON"; exit 1
      fi
      log "start ($APP${PROXY:+, proxy $PROXY $PXSTATE})"
      start || { fwd_stop; echo "{\"ok\":false,\"error\":\"$APP did not start or port $PORT did not come up in 30 s\"}"; log "start failed"; exit 1; }
      boot=(--boot)
    elif [ "$PXSTATE" = armed ] || [ "$PXSTATE" = missing ]; then
      # Running already: it must have been started with this proxy, and the forwarder must still exit right.
      if ! running_has_proxy; then
        echo "{\"ok\":false,\"profile\":\"$P\",\"proxy\":\"$PROXY\",\"refused\":true,\"error\":\"Chrome for $P runs without its proxy $PROXY — restart it: agent-chrome.sh stop $P && agent-chrome.sh ensure $P\"}"
        log "ensure refused: running without proxy"; exit 1
      fi
      if ! proxy_up; then
        echo "{\"ok\":false,\"profile\":\"$P\",\"proxy\":\"$PROXY\",\"refused\":true,\"error\":\"proxy check failed: $PXREASON — pages fail closed (no home IP)\"}"
        log "ensure refused: $PXREASON"; exit 1
      fi
    else
      proxy_up || true
    fi
    lease; n=$(clients)
    out=$("$NODE" "$HELPER" $PORT heal ${boot[@]+"${boot[@]}"} ${EXTARGS[@]+"${EXTARGS[@]}"} | sed "s/^{/{\"profile\":\"$P\",\"clients\":$n,$(sedq "$PXJSON")/"); rc=${PIPESTATUS[0]}
    echo "$out"; log "ensure $out"; exit $rc ;;
  status)
    if ! alive; then echo "{\"ok\":false,\"profile\":\"$P\",\"running\":false,\"app\":\"$APP\",\"port\":$PORT,$PXJSON\"pid\":\"$(main_pid)\"}"; exit 1; fi
    n=$(clients)
    out=$("$NODE" "$HELPER" $PORT heal ${EXTARGS[@]+"${EXTARGS[@]}"}); rc=$?
    pf=false; running_has_proxy && pf=true
    echo "$out" | sed "s/^{/{\"profile\":\"$P\",\"running\":true,\"app\":\"$APP\",\"port\":$PORT,\"clients\":$n,$(sedq "$PXJSON")\"proxy_flag\":$pf,\"hold\":$( [ -e "$STATE/$P.hold" ] && echo true || echo false ),\"waits\":$(live_waits),/"; exit $rc ;;
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
    for _ in $(seq 1 30); do [ -z "$(main_pid)" ] && { fwd_stop; echo '{"ok":true,"stopped":"cdp"}'; log "stop cdp"; exit 0; }; sleep 0.5; done
    pid=$(main_pid)
    if [ -n "$pid" ]; then kill "$pid"; sleep 3; [ -n "$(main_pid)" ] && kill -9 "$(main_pid)"; fwd_stop; log "stop kill $pid"; echo "{\"ok\":true,\"stopped\":\"kill\"}"; exit 0; fi
    fwd_stop; echo '{"ok":true,"stopped":"not running"}' ;;
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

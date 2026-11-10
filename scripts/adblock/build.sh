#!/bin/bash
# build.sh — build the cookie-refusal extension for the agent's Chrome profiles: DuckDuckGo autoconsent (action optOut)
# bundled as one content script (MAIN world, document_start, all frames) of an unpacked MV3 extension.
# Usage: build.sh [--out <folder>]
#   default folder: ~/.local/share/jadlis-browser/autoconsent-ext — keep it stable: the extension id follows its path.
#   skip list: ~/.config/jadlis/adblock-skip-hosts.txt (ADBLOCK_SKIP_HOSTS overrides), created from
#   skip-hosts.default.txt on the first build. One host per line, subdomains included, `#` = comment.
# The first build runs `npm ci --ignore-scripts` next to this file (exact versions from package-lock.json).
# `setup.mjs --adblock` copies this folder to ~/.local/share/jadlis-browser/adblock-build/ and runs it there.
# A running profile picks up a rebuilt folder only after: node ~/.claude/scripts/agent-ext.mjs reload <profile>
# Prints one JSON line: {"ok","out","version","bytes","sha256","skip_hosts","skip_file"}.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/.local/share/jadlis-browser/autoconsent-ext"
if [ "${1:-}" = "--out" ]; then OUT="${2:?--out needs a folder}"; fi
case "$OUT" in /*) ;; *) echo '{"ok":false,"error":"--out must be an absolute path"}'; exit 64 ;; esac
SKIP="${ADBLOCK_SKIP_HOSTS:-$HOME/.config/jadlis/adblock-skip-hosts.txt}"
command -v node >/dev/null && command -v npm >/dev/null || { echo '{"ok":false,"error":"node and npm are needed"}'; exit 69; }
cd "$HERE"

if [ ! -f "$SKIP" ]; then
  mkdir -p "$(dirname "$SKIP")"
  cp skip-hosts.default.txt "$SKIP"
  echo "created skip list: $SKIP" >&2
fi
# Install when node_modules is missing or older than the lock file (npm writes node_modules/.package-lock.json).
if [ ! -f node_modules/@duckduckgo/autoconsent/package.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --ignore-scripts --no-audit --no-fund --loglevel=error >&2
fi

mkdir -p build
node -e '
const fs = require("fs");
const hosts = fs.readFileSync(process.argv[1], "utf8").split("\n")
  .map(l => l.replace(/#.*/, "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/[\/:].*$/, "").replace(/^\*?\.+/, ""))
  .filter(Boolean);
fs.writeFileSync("build/skip-hosts.json", JSON.stringify([...new Set(hosts)]));' "$SKIP"
VER="$(node -p 'require("./node_modules/@duckduckgo/autoconsent/package.json").version')"
npx --no-install esbuild --bundle --format=iife --target=es2021 --legal-comments=none --log-level=warning \
  "--define:AUTOCONSENT_VERSION=\"$VER\"" src/entry.ts --outfile=build/autoconsent.js
node -e 'new Function(require("fs").readFileSync("build/autoconsent.js", "utf8"))'   # the bundle parses

mkdir -p "$OUT"
cat > "$OUT/manifest.json.tmp-$$" <<JSON
{
  "manifest_version": 3,
  "name": "Jadlis cookie refusal (autoconsent)",
  "version": "$VER",
  "description": "Answers cookie consent banners with a refusal. Built from @duckduckgo/autoconsent by jadlis-browser scripts/adblock/build.sh.",
  "content_scripts": [
    { "matches": ["<all_urls>"], "js": ["autoconsent.js"], "run_at": "document_start", "all_frames": true, "world": "MAIN" }
  ]
}
JSON
cp build/autoconsent.js "$OUT/autoconsent.js.tmp-$$"
mv "$OUT/autoconsent.js.tmp-$$" "$OUT/autoconsent.js"
mv "$OUT/manifest.json.tmp-$$" "$OUT/manifest.json"
node -e '
const [out, ver, skip] = process.argv.slice(1), fs = require("fs"), b = fs.readFileSync(out + "/autoconsent.js");
console.log(JSON.stringify({ ok: true, out, version: ver, bytes: b.length,
  sha256: require("crypto").createHash("sha256").update(b).digest("hex"),
  skip_hosts: JSON.parse(fs.readFileSync("build/skip-hosts.json", "utf8")).length, skip_file: skip }));' "$OUT" "$VER" "$SKIP"

# Changelog — jadlis-browser

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

## [3.1.0] — 2026-11-07 — установщик, удержание Chrome на BLOCKED, капча, Playwright MCP 0.0.84 / installer, BLOCKED hold, CAPTCHA rule, Playwright MCP 0.0.84

### Для человека
- Одна команда `node scripts/setup.mjs` ставит и обновляет агента, скрипты и службу и печатает версию, которая реально стоит. С `BROWSER_AUTO_SETUP="yes"` это делает сама первая сессия после обновления.
- Chrome больше не гаснет, пока оператор ждёт твоего ответа на BLOCKED: страница с вопросом остаётся открытой. Основной профиль можно держать включённым всегда (`BROWSER_KEEPALIVE`).
- Оператор не кликает в капчу: выводит её вкладку вперёд и ждёт расширение-решатель 60–90 секунд. Длинные сценарии он режет на короткие шаги.

### For agents
- Added: `scripts/setup.mjs [--dry-run] [--no-launchd] [--auto]` — copies `agent-chrome.sh`/`agent-chrome-cdp.mjs` to `~/.claude/scripts/` (+ `.jadlis-browser-version` stamp), renders `~/.claude/agents/browser-operator.md` with one `pw-<name>` server per `agent-chrome.conf` line and `{{VERSION}}`, creates the conf from the example only when missing, writes and reloads `~/Library/LaunchAgents/com.jadlis.agent-chrome.plist` (`agent-chrome.sh watch`, RunAtLoad, every 120 s), backs up replaced files as `.bak-<ts>`, prints `{ok, version, installed, playwright, profiles, keepalive, launchd, changed}`.
- Added: `hooks/hooks.json` SessionStart(startup) → `setup.mjs --auto`: a no-op unless `BROWSER_AUTO_SETUP="yes"` in `~/.config/jadlis/agent.conf` and the stamp differs from the plugin version; mkdir lock against parallel sessions.
- Added: `agent-chrome.sh hold [profile] [min]` / `release [profile]` — `$STATE/<p>.wait.<pid>` bound to the Claude Code process (`CLAUDE_PID`, else the nearest `claude` ancestor), max `AGENT_CHROME_WAIT_MIN` (1440); `idle-stop` keeps the profile while a live hold exists; `status` reports `waits`.
- Added: `agent-chrome.sh watch` (keep-alive for `BROWSER_KEEPALIVE` profiles, idle-stop for the rest), `front [profile] [targetId]` (helper `front` takes a targetId), `version`.
- Changed: `assets/browser-operator.md.template` — pin `@playwright/mcp@0.0.84`; BLOCKED → `hold`, resume → `release`; new «CAPTCHA» section (front, no click, wait 60–90 s, image hCaptcha / QR / DataDome → BLOCKED, no submit loops); short `run_code` rule (one sub-goal per call, return `{ok, url, data}`); report line `BROWSER: jadlis-browser <version>`.
- Changed: `skills/browser/SKILL.md` — server 0.0.84, CAPTCHA and BLOCKED-hold facts, «Installation» = setup.mjs; `references/gotchas.md` «Капча»; both READMEs.
- Migration: run `node "$P/scripts/setup.mjs"` once (it replaces a hand-made agent file, keeping a `.bak-<ts>`); old per-profile launchd jobs that call `agent-chrome.sh idle-stop|ensure` can be removed in favour of `com.jadlis.agent-chrome`.

## [3.0.2] — 2026-11-03 — шаблон агента и скрипты профиля в плагине / agent template and profile scripts ship with the plugin

### Для человека
- Плагин теперь сам несёт всё, что обещает README: шаблон агента `browser-operator` и скрипт `agent-chrome.sh` для своего профиля Chrome агента. Раньше их нужно было где-то взять.
- В скилле и обоих README появился раздел про установку: куда скопировать шаблон и скрипты и как заполнить список профилей.
- По умолчанию у агента один профиль Chrome — `agent`. Ещё профили добавляются строкой в `~/.config/jadlis/agent-chrome.conf`.
- Пароли по-прежнему не попадают в контекст модели: одноразовый `secret-relay.py` из плагина jadlis-secrets, а без него — «слепой» буфер обмена.
- Из текстов убраны личные пути и имена профилей автора.

### For agents
- Added: `assets/browser-operator.md.template` — generic agent: one inline server `pw-agent` (`--cdp-endpoint http://127.0.0.1:9333`) + bridge `pw`, pin `@playwright/mcp@0.0.83`, `{{HOME}}` rendered at install with `sed`; profile from the task, else `agent-chrome.sh profile` (`BROWSER_PROFILE` in `~/.config/jadlis/agent.conf`, else `agent`); secrets via `secret-relay.py serve|receive` + `op-agent.sh` (jadlis-secrets, vault `OP_VAULT` from agent.conf read with `sed`, not sourced) or blind clipboard (`pbcopy` → `ControlOrMeta+V` → `pbcopy < /dev/null`, length only); card details are a human step unless the task gives a relay; report format and BLOCKED → SendMessage loop kept.
- Added: `scripts/agent-chrome.sh` — profiles from `~/.config/jadlis/agent-chrome.conf` (`AGENT_CHROME_CONF`), built-in `agent=9333` when the file is missing; profile argument optional (default from agent.conf); new `profile`, `profiles`, `--help` (no Chrome, no port access); node resolved from `AGENT_CHROME_NODE` / PATH / Homebrew paths; helper looked up next to the script (`AGENT_CHROME_HELPER`); output carries `"profile"`.
- Added: `scripts/agent-chrome-cdp.mjs` (`#!/usr/bin/env node`, usage guard for missing args) and `scripts/agent-chrome.conf.example` (`agent=9333`).
- Changed: `skills/browser/SKILL.md` — generic profiles (`mcp__pw-<profile>__`), output-dir instead of a personal path, new «Installation» section with `${CLAUDE_PLUGIN_ROOT}` paths; `references/cli.md`, `references/details.md`, `references/gotchas.md`, `TESTS.md` — personal paths, profile names and site names removed.
- Changed: `README.md`, `README.en.md` — three browsers = agent profile over CDP, the user's Chrome over the bridge, headless `playwright-cli`; install section copies the template and scripts; «what you need» no longer points at files the plugin did not ship; EN language switch matches the house first line.
- Changed: `CHANGELOG.md` 3.0.0/3.0.1 entries — personal labels, vault paths and launchd names removed; `.claude-plugin/plugin.json` — `version` → 3.0.2, `description`.
- Migration: existing installs keep their own `~/.claude/agents/browser-operator.md` and scripts; the plugin never overwrites them. New installs follow the README install section.

## [3.0.1] — 2026-10-08 — итоги ресёрча «Экономный браузер-агент» / findings of the turn-saving research

### Для человека
- В скилл вошли выводы ресёрча: пакет шагов вместо пошаговых вызовов, интерфейс сразу, если у сайта нет API, и повтор сохранённого сценария вместо новой разведки.

### For agents
- Changed: `skills/browser/SKILL.md` «Techniques that save turns» — batching evidence (162 vs 79 calls on one 30-test benchmark; every call re-reads the history), split a script only where the next step depends on what was read, no usable API → UI at once, new item 6 «Explore once, replay next time» (save the working script or endpoint + payload in `site_<name>.md`; Stagehand-style caches need Browserbase). Source: the author's research note «Экономный браузер-агент» (15 of 16 claims confirmed).
- Added: `skills/browser/references/details.md` — failure-born rules cut from the 2.1.0 skill, kept instead of deleted (research: rare rules go to a reference file): form field types, dialogs incl. `beforeunload` (TickTick 08.10), `wait_for`, stale refs, schema drift, Cloudflare challenge on fetch, bridge-only notes. `SKILL.md` points to it in one line; technique 1 checks `status`/`content-type` before parsing.
- Added: `references/gotchas.md` — cookie copy from the user's Chrome into an agent profile: 9 of 13 domains accepted copied sessions; check login in the user's Chrome before and after a copy.
- Changed: `.claude-plugin/plugin.json` — `version` → 3.0.1.

## [3.0.0] — 2026-10-07 — три браузера: два своих профиля Chrome агента + твой Chrome запасным путём / three browsers: agent Chrome profiles + the user's Chrome as fallback

### Для человека
- Агент работает в своих профилях Chrome: один для рабочих сервисов, второй для твоих личных аккаунтов из утверждённого списка. Окна открываются в фоне, фокус у тебя не забирают.
- Загрузка файлов теперь работает. Несколько операторов могут работать одновременно.
- Твой Chrome через расширение остаётся запасным путём — только для сайтов, где агент нигде не залогинен.
- Пароли и ключи больше не идут через буфер обмена.
- Скилл сократился с 25 КБ до ~8 КБ: факты среды и приёмы, которые экономят ходы.

### For agents
- Breaking: removed `.mcp.json` and `userConfig.PLAYWRIGHT_MCP_EXTENSION_TOKEN` — the plugin now ships the skill only. The Playwright MCP servers `pw-<profile>` (`--cdp-endpoint http://127.0.0.1:9333`, `:9334`) and `pw` (`--extension`) are inline in `~/.claude/agents/browser-operator.md`, pin `@playwright/mcp@0.0.83`; the bridge token comes from `PLAYWRIGHT_MCP_EXTENSION_TOKEN` in the environment. Tool prefixes: `mcp__pw-<profile>__`, `mcp__pw__` (no more `mcp__plugin_jadlis-browser_playwright__`).
- Changed: `skills/browser/SKILL.md` rewritten (25 KB → ~8 KB): three-browser table, facts (what raises Chrome, active-tab clicks, false navigation timeout, upload, files, session cookies), turn-saving techniques (network first, one run_code script, direct URLs, extract with code), parallel rule for one profile (own background window via CDP `Target.createTarget` + run_code by `targetId`), bridge section (pid-based raise, bridge killers, token redaction).
- Changed: `skills/browser/TESTS.md` — new matrix for agent profiles over CDP (2026-10-07), gate split into agent profile / bridge.
- Added: `skills/browser/references/gotchas.md` section «Агентские профили» — discarded tabs hang 0.0.83, process without port, AppleScript addresses the newest Chrome.
- Changed: `.claude-plugin/plugin.json` — `version` → 3.0.0, `displayName`, `description`; `README.md`, `README.en.md` — three browsers.
- Migration: profile scripts lived outside the plugin in this version (`~/.claude/scripts/agent-chrome.sh`, `agent-chrome-cdp.mjs`, `secret-relay.py`) and were started by the author's own launchd jobs; 3.0.2 ships the agent template and the profile scripts.

## [2.1.1] — 2026-10-08 — репозиторий переехал на GitLab / repository moved to GitLab

### Для человека

- Плагин теперь живёт на GitLab: https://gitlab.com/beCyborg/jadlis-browser. Аккаунт GitHub beCyborg заблокирован, поэтому старые ссылки открывают 404.
- Каталог ставится новой командой: `claude plugin marketplace add https://gitlab.com/beCyborg/jadlis-hub.git`. Если ты уже ставил его со старой ссылки GitHub, удали каталог командой `claude plugin marketplace remove jadlis` и поставь всё заново по README. Плагины этого каталога при удалении тоже снимутся.
- Работа плагина не изменилась.

### For agents

- Changed: every `github.com/beCyborg/*` link in README pairs now points to `gitlab.com/beCyborg/*`; `marketplace add` uses the full `https://…/jadlis-hub.git` URL (non-GitHub hosts have no `owner/repo` shorthand).
- Changed: `.claude-plugin/plugin.json` `homepage`/`repository` → GitLab; version 2.1.0 → 2.1.1.
- Changed: CI moved from `.github/workflows/ci.yml` (reusable workflow in `beCyborg/jadlis-hub`) to `.gitlab-ci.yml` including `/ci/plugin-ci.yml` from `beCyborg/jadlis-hub` on GitLab — same checks: `claude plugin validate --strict`, gitleaks full history, README parity, privacy grep.

## [2.1.0] — 2026-09-30 — гибрид MCP + Playwright CLI, пин 0.0.83 / hybrid MCP + Playwright CLI, pin 0.0.83

### Для человека
- Залогиненный Chrome по-прежнему через Playwright MCP — пин поднят с 0.0.80 до 0.0.83 (флаги те же, по changelog ничего не удалено).
- Свои лендинги и публичные страницы с JS теперь проверяются через `playwright-cli` в фоновых браузерах — несколько сессий параллельно, твой Chrome не трогается.
- Новое правило: к Chrome через расширение подключается только один клиент за раз — два клиента 30.09 повесили Chrome.

### For agents
- Changed: pin `@playwright/mcp@0.0.80` → `0.0.83` in `skills/browser/SKILL.md`, `TESTS.md` (matrix still from the 0.0.80 run — re-run the gate), `README.md`, `README.en.md`; `.mcp.json` (the personal build without `.mcp.json` keeps its live pin in `~/.claude/agents/browser-operator.md`). 0.0.81–0.0.83: `--profile-dir-name`, headless `--idle-timeout` 1 h, token connect fails after 30 s instead of hanging, `browser_emulate_media` (25th core tool), WebMCP tools as `webmcp_<tool>`, `--file-paths=absolute`, `browser_find filename` (#42077). `--extension --snapshot-mode=none --console-level=error --image-responses=omit --output-dir` unchanged in `--help`.
- Added: `skills/browser/SKILL.md` section «Hybrid: MCP bridge or headless CLI» — logged-in/forms/social/phone → MCP, strictly one extension client; own landings and public JS pages → `playwright-cli -s=<name>` headless, parallel sessions OK.
- Added: `skills/browser/references/cli.md` — `@playwright/cli` 0.1.22 reference (sessions, recipes, gotchas: same-session race, false click error on navigation >5 s, `attach --extension=chrome` since the bare flag is broken, token redaction, no auto-reconnect).
- Changed: `SKILL.md` «Параллелизм», «Безопасность», «Когда НЕ использовать», routing summary, description — two extension clients hang Chrome; never print the `connect.html?…token=` URL; Immersive Translate overlay → JS click; slow navigation → verify before retrying.
- Changed: `.claude-plugin/plugin.json` — `version` → 2.1.0.
- Migration: none; `@playwright/cli@0.1.22` installed globally with npm (uses system Chrome headless, no `install-browser`).

## [2.0.0] — 2026-09-10 — выделен в отдельное репо `jadlis-browser` / split out into its own repo

### Для человека
- Плагин переехал из монорепо `jadlis-desktop` в собственное репо и называется теперь `jadlis-browser`: ставится `claude plugin install jadlis-browser@jadlis`, маркетплейс добавляется по адресу `https://github.com/beCyborg/jadlis-hub`.
- Короткая команда не изменилась — скилл по-прежнему поднимается сам и доступен как `/browser`; полная форма стала `/jadlis-browser:browser`.
- Совместимости со старым именем нет: старую установку `browser@jadlis` нужно удалить и поставить заново.

### For agents
- Changed: репо — корень теперь сам плагин (`plugins/browser/` → корень), история сохранена через `git filter-repo`.
- Changed: `.claude-plugin/plugin.json` — `name` `browser` → `jadlis-browser`, `version` 1.1.2 → 2.0.0, `homepage`/`repository` → `https://github.com/beCyborg/jadlis-browser`.
- Changed: `skills/browser/SKILL.md` — префикс инструментов `mcp__plugin_browser_playwright__` → `mcp__plugin_jadlis-browser_playwright__`.
- Changed: `README.md`, `README.en.md` — установка/обновление `jadlis-browser@jadlis`, маркетплейс `https://github.com/beCyborg/jadlis-hub`, ссылка на корневой README монорепо убрана (репо теперь одно), H1 и `/plugin` → `jadlis-browser`, тег схемы `jadlis-browser--v2.0.0`.
- Fixed: `README.md`, `README.en.md` — пин Playwright MCP в разделе «Границы и стоимость» был `0.0.78`, приведён к фактическому `0.0.80` из `.mcp.json` и `SKILL.md`.
- Removed: `docs/img/` — картинки принадлежали корневому README монорепо (`hero-jadlis-desktop.webp`, `how-jadlis-desktop.webp`, `hub-12.webp` и промпт к ним); README плагина их не использует.
- Added: `.github/workflows/ci.yml` — вызов `beCyborg/jadlis-hub/.github/workflows/plugin-ci.yml@main` в режиме `mode: plugin`.
- Unchanged: `.mcp.json`, `userConfig.PLAYWRIGHT_MCP_EXTENSION_TOKEN`, имена папок скиллов.
- Migration: `claude plugin uninstall browser@jadlis` → `claude plugin marketplace add https://github.com/beCyborg/jadlis-hub` → `claude plugin install jadlis-browser@jadlis`.

## [1.1.2] — 2026-09-07 — переименование репо / repo renamed

### Для человека
- Репо переименовано в `jadlis-desktop`, маркетплейс `jadlis` (`browser@jadlis`, `computer-use@jadlis`); старый адрес редиректит, старые установки продолжают работать.

### For agents
- Changed: `.claude-plugin/plugin.json` — `version` 1.1.1 → 1.1.2, `homepage`/`repository` → `https://github.com/beCyborg/jadlis-desktop`.
- Changed: `plugins/browser/README.md`, `plugins/browser/README.en.md`, корневые `README.md`/`README.en.md`, `CLAUDE.md` — установка через `https://github.com/beCyborg/jadlis-start.git` и `browser@jadlis`.
- Changed: `.github/workflows/` — единый `ci.yml`, вызывает `beCyborg/jadlis-start/.github/workflows/plugin-ci.yml@main` (`mode: marketplace`).
- Unchanged: `.claude-plugin/marketplace.json` — имя `becyborg-desktop` и записи плагинов сохранены ради уже сделанных установок.
- Migration: не требуется.

## [1.1.1] — 2026-09-07 — пин Playwright MCP 0.0.80 / pin Playwright MCP 0.0.80

### Для человека
- Плагин ставит ту версию Playwright MCP, на которой мост расширения проверен живьём (0.0.80); на 0.0.78 мост работает по protocol v1.

### For agents
- Changed: `.mcp.json` — `@playwright/mcp@0.0.78` → `@playwright/mcp@0.0.80`; согласовано с `SKILL.md` и `TESTS.md`, которые уже описывают 0.0.80 и расширение ≥0.3.0 / protocol v2.
- Changed: `.claude-plugin/plugin.json` — `version` 1.1.0 → 1.1.1.
- Migration: не требуется.

## [1.1.0] — 2026-09-07 — скилл по итогам живого прогона 0.0.80 / skill rewritten from a live 0.0.80 run

### Для человека
- Скилл переписан по результатам живой проверки моста: авто-reconnect, ловушка перекрытого окна Chrome (клики висят по таймауту), правила записи файлов только в `.playwright-mcp/`, неработающий `file_upload` в extension mode.
- Рядом со скиллом появились тест-матрица (`TESTS.md`) и файл ловушек моста (`references/gotchas.md`) — «Extension not found» чаще всего означает отсутствие Full Disk Access, а не отсутствие расширения.

### For agents
- Changed: `plugins/browser/skills/browser/SKILL.md` — перенесён из локальной версии автора; разделы «Подключение и восстановление», «ГЛАВНАЯ ЛОВУШКА: перекрытое окно Chrome», «Файлы», «JS-паттерны», «Параллелизм», «Routing summary»; замеры лестницы чтения; `description` в новом формате Triggers / RU triggers / Do NOT use for.
- Added: `plugins/browser/skills/browser/TESTS.md` — матрица возможностей моста с датами прогонов и гейтом перед бампом пина.
- Added: `plugins/browser/skills/browser/references/gotchas.md` — ловушки моста и доступа (Full Disk Access, TCC-контекст tmux).
- Changed: `plugins/browser/.claude-plugin/plugin.json` — `version` 1.0.1 → 1.1.0.
- Migration: не требуется; `.mcp.json` не менялся — пин остаётся `@playwright/mcp@0.0.78`, тогда как скилл описывает проверенный вживую 0.0.80 (бамп пина — отдельным решением).

## [1.0.1] — 2026-09-06 — двуязычный README и гейты передачи / bilingual README and handover gates

### Для человека
- README плагина переписан по пяти секциям (Зачем / Как выглядит / Как поставить / Как пользоваться / Границы и стоимость), рядом появился английский `README.en.md`.
- Основной путь установки теперь через хаб `jadlis`; свой маркетплейс `becyborg-desktop` остался как альтернатива.
- В CI добавлена проверка на утечку секретов, в репозитории — конвенции для агентов (`CLAUDE.md`).

### For agents
- Added: `plugins/browser/README.en.md`, `plugins/browser/CHANGELOG.md`; в корне репо — `README.en.md`, `CLAUDE.md`, `docs/img/hub-12.webp`.
- Changed: `plugins/browser/README.md` — 5 секций + «Обновление», Mermaid-схема лестницы чтения, установка через `claude plugin install browser@jadlis`.
- Changed: `.github/workflows/plugin-validate.yml` — job `gitleaks` (`gitleaks/gitleaks-action@v2`, `fetch-depth: 0`) рядом с job `validate`.
- Changed: `plugins/browser/.claude-plugin/plugin.json` — `version` 1.0.0 → 1.0.1.
- Migration: не требуется, `.mcp.json` и скилл не менялись.

## [1.0.0] — 2026-09-01 — первый релиз плагина / first plugin release

### Для человека
- MCP-сервер `playwright` в Extension Mode: Claude работает в живом Chrome пользователя, с куками, логинами и 2FA.
- Скилл учит лестнице чтения страницы (find → evaluate → scoped snapshot → полный снапшот → скриншот) — та же задача укладывается в ~27K токенов вместо ~114K с авто-снапшотами.
- Репозиторий приведён к домашнему стандарту: явный semver, `$schema` в манифестах, LICENSE, CI-валидация плагинов.

### For agents
- Added: `plugins/browser/` — `.mcp.json` (`@playwright/mcp@0.0.78` с `--extension --snapshot-mode=none --console-level=error --image-responses=omit`), `skills/browser/SKILL.md`, `userConfig.PLAYWRIGHT_MCP_EXTENSION_TOKEN` (`sensitive: true`).
- Added: маркетплейс `becyborg-desktop` в `.claude-plugin/marketplace.json`; `.github/workflows/plugin-validate.yml`; `LICENSE` (MIT).
- Changed: README синхронизирован с выверенной инструкцией — имя маркетплейса в командах, механика обновления, формулировка про дисциплину расхода токенов.

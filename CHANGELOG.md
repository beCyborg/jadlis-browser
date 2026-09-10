# Changelog — jadlis-browser

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

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

# Changelog — browser

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

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

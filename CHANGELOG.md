# Changelog — browser

Формат: [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).

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

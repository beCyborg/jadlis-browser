---
name: browser
description: Управляет залогиненным Chrome пользователя через Playwright MCP (mcp__plugin_browser_playwright__browser_*, Extension Mode) — куки, логины, 2FA доступны. TRIGGER when — user says «используй мой браузер», «в моём браузере», «через браузер», «открой в браузере», «в Chrome», «на залогиненном сайте», or refers to actions in their logged-in browser session. DON'T use for — web search (→ поисковые инструменты), scraping public sites without login (→ Firecrawl/fetch), testing own app (write Playwright script via Bash), native desktop apps (→ скилл computer-use из соседнего плагина).
---

Управляй реальным Chrome пользователя через мост Playwright Extension (Extension Mode): работаешь в его существующей сессии — все логины, куки, расширения на месте, без `--remote-debugging-port`. Полные имена инструментов — `mcp__plugin_browser_playwright__browser_*`; ниже короткие `browser_*`.

## Среда запуска (учитывать, не менять)

Сервер стартует с `--extension --snapshot-mode=none --console-level=error --image-responses=omit`. Три следствия, которые скилл обязан соблюдать:

- **`--snapshot-mode=none`** — снапшот НЕ возвращается автоматически после click/navigate. После каждого действия ты «слеп», пока явно не позовёшь `browser_find`/`browser_snapshot`. Это осознанная токен-экономия (авто-снапшоты копятся до ~114K токенов на задачу против ~27K без них). Локализуй элементы через `browser_find`, а не полным снапшотом.
- **`--image-responses=omit`** — base64 скриншота НЕ приходит. `browser_take_screenshot` без `filename` даёт пустой вывод. Правило: скриншот ВСЕГДА с `filename`, затем смотреть файл через Read.
- **`--caps` не задан** — только core-набор (vision/pdf/devtools отключены намеренно).

## Диагностика подключения

Первый вызов в сессии — `browser_tabs(action: "list")`. Если ошибка соединения, проверь по списку: Chrome запущен обычным способом? расширение Playwright Extension установлено (id `mmlmfjhmonkocbjadbfplnigmagldckm`)? не закрыт ли bridge-таб? профиль Chrome — дефолтный (preflight видит только Default)? Скажи пользователю, что именно проверить.

## Лестница чтения — от дешёвого к дорогому

Всегда поднимайся снизу: бери самый дешёвый инструмент, который решает задачу.

1. **`browser_find`** — grep по accessibility-дереву, возвращает совпавшие узлы с ref'ами. Дешёвая замена снапшоту для «где на странице элемент X». `text` (подстрока, регистронезависимо) ИЛИ `regex` (`"/error/i"`) — не оба.
   ```
   browser_find(text: "Checkout")
   browser_find(regex: "/итого|total/i")
   ```
2. **`browser_evaluate`** — JS-функция, возвращает только вычисленное значение (~100 токенов). Параметр `function` — ФУНКЦИЯ, не строка. Опц. `target` (ref/селектор → приходит `element`), `filename` для больших результатов.
   ```
   browser_evaluate(function: "() => ({url: location.href, title: document.title})")
   browser_evaluate(function: "() => [...document.querySelectorAll('a')].map(a => a.href)", filename: "links.json")
   browser_evaluate(function: "(el) => el.textContent", target: "#price")
   ```
3. **Scoped `browser_snapshot`** — часть дерева с `target` + `depth` (~200–400 ток. на простой странице). `target` = ref или уникальный CSS/текст-селектор (НЕ `selector`). Большие узлы → `filename` (md-файл) и читай через Read/Grep.
   ```
   browser_snapshot(target: "main", depth: 3)
   browser_snapshot(target: "#results", filename: "snap.md")
   ```
4. **Полный `browser_snapshot`** (без `target`) — последнее средство для незнакомой структуры; тяжёлая страница = 10–50K токенов.
5. **`browser_take_screenshot`** — только визуальная семантика (цвета, layout, canvas/WebGL). Required `type` («png»|«jpeg») и `scale` («css»|«device»); ВСЕГДА `filename`, затем Read. При omit+filename payload в контекст не тащится.
   ```
   browser_take_screenshot(type: "png", scale: "css", filename: "page.png")   # затем Read page.png
   ```

## Правила эффективности

1. **Не поллить снапшотами.** Ждать появления/исчезновения текста — `browser_wait_for(text: "...")` / `textGone` / `time`, а не повторная навигация или новый снапшот.
2. **Минимум навигаций.** Каждый `browser_navigate` дописывает свежий снапшот в историю — вот откуда 114K. Не гоняй туда-обратно.
3. **Формы — одним вызовом** `browser_fill_form`, а не серия `browser_type`.
4. **Дебаг API** — `browser_network_requests(static: false, filter: "...", filename: "...")` (required `static`; `filter` — regexp по URL), детали по номеру — `browser_network_request`. Не вываливать сеть в контекст.
5. **Консоль** — `browser_console_messages(level: "error")` (required `level` ∈ error|warning|info|debug — включает более серьёзные).
6. **Длинные flow (5+ шагов)** — делегируй субагенту (см. ниже).
7. **Ошибка параметра** («unknown parameter»/«required») — не гадать: сверить живую схему через ToolSearch `select:mcp__plugin_browser_playwright__<tool>`. Схемы дрейфуют между версиями.

## Действия

- `browser_click(target: "e42")` — required `target` (ref или селектор), опц. `button`, `doubleClick`, `modifiers`.
- `browser_type(target: "#q", text: "запрос", submit: true)` — `submit` жмёт Enter после ввода.
- `browser_fill_form` — `fields`: массив `{target, name, type, value}`, все 4 обязательны; `type ∈ textbox|checkbox|radio|combobox|slider`; checkbox value = "true"/"false"; combobox value = текст опции.
- `browser_select_option(target: "#country", values: ["PL"])` — `values` массив.
- `browser_press_key(key: "Enter")`, `browser_hover(target: "...")`, `browser_handle_dialog(accept: true)`, `browser_file_upload(paths: ["/abs/path"])`.

## Типовые сценарии

**Что сейчас на активной вкладке** (без снапшота/скриншота):
```
browser_tabs(action: "list")
browser_evaluate(function: "() => ({url: location.href, title: document.title})")
```

**Найти элемент** (например, кнопку) — `browser_find`, не полный снапшот:
```
browser_find(text: "Checkout")   # вернёт ref → используй в browser_click(target: ref)
```

**Заполнить и отправить форму логина** — один `fill_form`:
```
browser_navigate(url: "https://example.com/login")
browser_fill_form(fields: [
  {target: "#email", name: "email", type: "textbox", value: "user@example.com"},
  {target: "#password", name: "password", type: "textbox", value: "..."},
  {target: "#remember", name: "remember", type: "checkbox", value: "true"}
])
browser_click(target: "button[type=submit]")
browser_wait_for(text: "Личный кабинет")
```

**Извлечь данные с залогиненного сайта:**
```
browser_navigate(url: "https://...")
browser_evaluate(function: "() => [...document.querySelectorAll('.item')].map(x => x.textContent)")
```

## Безопасность и хрупкость (extension mode)

- **Реальные привилегии пользователя.** Extension действует под его куками/логинами. Перед send/purchase/delete/submit на залогиненных сервисах — явное подтверждение пользователя.
- **Инъекции.** A11y-снапшот и `browser_find` фильтруют `display:none`-текст, а `browser_evaluate` c `textContent`/`innerHTML` — нет. На недоверенной странице «дешевле» ≠ «безопаснее».
- **`browser_run_code_unsafe` — под гейтом.** Официально «RCE-equivalent»: исполняет произвольный JS в процессе сервера под привилегиями пользователя. НЕ дефолт для батчей. Только на доверенной известной странице и по явной необходимости. Параметр `code` = `async (page) => {...}`:
  ```
  browser_run_code_unsafe(code: "async (page) => { await page.click('#next'); return page.url(); }")
  ```
  Для недоверенных страниц — точечные click/type/fill_form.
- **Вкладки хрупки.** Один линейный flow за раз; не строй многотабовые/параллельные сценарии. После ручного вмешательства пользователя — пере-проверь активную вкладку через `browser_tabs(action: "list")`. Чужие вкладки закрыть нельзя. Параллельные субагенты ДЕЛЯТ один Chrome — не параллелить браузерные flow.

## Делегирование субагенту

Длинные flow (5+ шагов) отдавай субагенту, чтобы не засорять основной контекст, с жёстким return-contract: субагент возвращает `{итоговый URL, извлечённые данные, выполненные действия, ошибки}` — без сырых снапшотов и скриншотов в ответе.

## Когда НЕ использовать

- **Веб-поиск** → поисковые инструменты (WebSearch, поисковый MCP).
- **Скрапинг публичного сайта без логина** → Firecrawl / WebFetch — дешевле и не занимает браузер пользователя.
- **Тесты своего приложения** → Claude пишет Playwright-скрипт и гоняет через Bash (в разы дешевле по токенам).
- **Native desktop приложения** (Finder, Notes, Maps, System Settings) → скилл computer-use (плагин computer-use из этого же маркетплейса).

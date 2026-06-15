# 10 — Збірка, тести, деплой

## npm-скрипти (root `package.json`)

| Команда | Призначення |
|---|---|
| `npm run dev` | Vite dev-сервер `packages/game` (tuning hot-reload), `localhost:5173` |
| `npm run dev:host` | Локальний онлайн-хост через `tsx scripts/dev-host/main.ts` (env `PORT`=8787, `PLAYERS`=2, `SEED`=1, `ARENA`=arena-002.json) |
| `npm run build` | Type-check обох пакетів + production Vite build |
| `npm run typecheck` | `tsc --noEmit` над sim(+test), bots(+test), net(+test), game, dev-host, e2e |
| `npm test` | Усі Vitest-сюїти (sim+bots+net headless у Node; + ws-adapter TCP-тест) |
| `npm run e2e` | Playwright (Chromium/SwiftShader, dev-server + dev:host, `window.__testApi`) |
| `npm run lint` | ESLint, з sim+bots determinism-гардами (no `Math.random`/`Date.now`/таймери) |
| `npm run check:deps` | dependency-cruiser: чистота sim/bots/net |
| `npm run export:art` | `assets/*.aseprite` → атласи (локальний Aseprite, закомічено) |
| `npm run export:cards` | `cards.png` → per-slot картки (чистий Node) |

`packages/sim`/`bots`/`net` **не мають build-кроку** — їхній `exports` указує на `src/index.ts`, Vite/Vitest їдять TS напряму. tsconfig sim не має DOM lib (перша лінія захисту чистоти).

## Стратегія тестування

Шарувате e2e: правила гри тестуються headless у `packages/sim` (bot-driven раунди); браузерне e2e покриває лише shell-glue й ніколи не пере-тестує правила.

### Vitest (~38 файлів)

`include: ["packages/*/test/**/*.test.ts", "scripts/dev-host/**/*.test.ts"]`, `environment: "node"`.

**`packages/sim/test` (~73 тести, 19 файлів):**

| Файл | Покриває |
|---|---|
| `determinism.test.ts` | побайтова ідентичність state/events за 600 тіків; відхиляє mismatched input-count; id-counter get/set |
| `arena.test.ts` | `parseArena` приймає валідні; відхиляє неправильні row count/length/символи/спавни |
| `arrows.test.ts` | постріл/no-op/aim/нормалізація/стик+pickup (вид збережено)/wrap |
| `kills.test.ts` | arrow-kill через wrap; no-self-kill у muzzle; stomp + bounce; бічна колізія не stomp |
| `movement.test.ts` (~14) | apex tap vs hold, coyote, jump buffer, wrap, run, wall-stop/slide, 45° wall-jump + lock, edge-fall, ground/air dash |
| `teams.test.ts` (~13) | FFA/teams валідація, scoring, mutual-wipe draw, FF-off придушення arrow/laser/bomb/stomp, FFA self-bomb |
| `chest.test.ts`, `powerups.test.ts`, `special-arrows.test.ts` | спавн/grant скринь; flap/invisibility; bomb/laser/bounce механіка |
| `round.test.ts`, `match.test.ts` | кінець раунду/матчу, рестарти, draw, victim-pos |
| `rng.test.ts`, `snapshot.test.ts`, `rollback.test.ts` | mulberry32 + state; JSON-serializable снапшот; replay==continue; divergence→re-restore |
| `cross-engine.test.ts` | стабільна FNV-1a послідовність хешів == `golden-state-hashes.json` |
| `bot-round.test.ts` | побайтовий event-лог == `golden-bot-round.json`; sim не має залежностей |
| `wire.test.ts` | усі 128 інпут-комбо round-trip; frame + version; відхилення |
| `content.test.ts` | arena-001/002/tuning валідні |
| `step-budget.test.ts` | **4 гравці × 6000 тіків < 0.5 ms/step** (hard CI-assert) |

**`packages/net/test` (~49 тестів, 9 файлів):** loopback (доставка/loss/jitter/clamp), codec (усі типи + truncation/version/tag), host (commit/repeat-last/snapshot/ack/late-drop), clock (точність ±0, tick-paired під 50% loss), rollback (no-correction/correction==host/resync), params, convergence (clean/10%loss/heavy-jitter повна збіжність), client, runtime-convergence (інпути реально доходять хоста).

**`packages/bots/test` (~25):** sense/behavior/config/bot-match. **`packages/game/test` (12):** input (deadzone, мапінг, hot-plug, settings) + juice.

### Golden-фікстури

- **`golden-bot-round.json`** — серіалізований `SimEvent[]` з раунду `hunterBot`+`patrolBot` (seed `0xbada55`). Доводить побайтову відтворюваність повного event-логу.
- **`golden-state-hashes.json`** — `{tick, hash}` FNV-1a кожні 30 тіків до 600 (seed `0xbada55`). Доводить детермінізм **стану**, а не лише подій.

Обидва регенеруються `UPDATE_GOLDEN=1 npm test`. Linux CI пере-верифікує їх — це **cross-OS перевірка float-детермінізму** (golden-логи створено на Windows dev-машині).

### Playwright e2e (13 тестів, 4 спеки)

`testDir: e2e`, `workers: 1`, `timeout: 60000`, `baseURL: localhost:5173`, software WebGL (`--use-gl=angle --use-angle=swiftshader` — headless Chromium-GPU-контекст падає й лінькувато відновлюється, стопорячи Phaser-boot; SwiftShader детермінований Win+Linux). **Два webServer'и:** `npm run dev` (5173) + `npm run dev:host` (8787).

- **`shell.spec.ts`** (6) — boot без console-помилок; контент тече в sim (arena «canopy», quiver 3); реальні клавіші рухають обох; атласи + recolor; ~60 Гц тіків за ~10 с.
- **`lobby.spec.ts`** (2) — дві клавіатури join/ready/countdown → матч; інжектований геймпад джойнить + драйвить.
- **`bots.spec.ts`** (2) — `?bots=1&difficulty=hard` людина-vs-бот; lobby add-bot.
- **`online.spec.ts`** (1) — дві вкладки через `?online=ws://localhost:8787` грають матч і сходяться побайтово (`getConfirmedHashAt`).

## Чистота через dependency-cruiser (`.dependency-cruiser.cjs`)

Три `error`-правила:

- **sim-purity** — `packages/sim/src` → нічого поза собою (включно з забороною sim→net);
- **bots-purity** — `packages/bots/src` → лише себе + `packages/sim/src`;
- **net-purity** — `packages/net/src` → лише себе + `packages/sim/src`.

`tsPreCompilationDeps: true` → навіть type-only ребро sim↔net enforced. `enhancedResolveOptions` шанує `exports`.

## CI/CD (GitHub Actions)

### `ci.yml` — push до `main`, кожен `pull_request`, `workflow_dispatch`

Node 22, npm-кеш. Дві джоби:

- **gate:** `npm ci` → `typecheck` → `lint` → `check:deps` → `npm test` → `build`.
- **e2e:** `npm ci` → `playwright install --with-deps chromium` → `npm run e2e`.

Обидві — обов'язкові статус-чеки під server-enforced ruleset «Protect main» (strict, PR required з 0 approvals, squash-only, force-push/deletion blocked, admin bypass).

### `deploy.yml` — continuous deploy на GitHub Pages (push до `main`)

`build` (npm ci → build → `configure-pages` → `upload-pages-artifact` path `packages/game/dist`) → `deploy` (`deploy-pages`, OIDC, environment `github-pages`). Публікує на **https://forgou37.github.io/shoot-and-run/**. Vite-build використовує відносний `base: './'` (лише build; dev/e2e лишаються `/`), щоб ассети резолвилися під project-pages-subpath. Деплой пост-merge → шипиться лише gate-green-код.

### `release.yml` — на тег `v*` або dispatch

`npm ci` → `build` → zip `packages/game/dist` → `gh release create --generate-notes`. Деплой тут навмисно не зв'язаний (continuous deploy це робить).

## Процес розробки (CONTRIBUTING.md)

Production-like PR-флоу: Issue → spec/plan → branch → one-task-per-commit (conventional-префікс + task id) → self-verify (локальний gate + `/code-review` + `/security-review`) → PR з evidence → власник squash-merge'ить.

- **Ролі:** Власник = продукт/фінальний review/merge; Claude = інженерія + first-pass review/QA.
- **Definition of Done:** тести зелені, локальний gate зелений, e2e якщо чіпали shell, golden-лог побайтово ідентичний (або свідомо регенерований), sim-чистота, tuning-is-data, reviews прогнані, `CLAUDE.md` оновлено.
- **SemVer:** MAJOR = breaking sim API/save-формат; MINOR = відвантажена спека/фіча; PATCH = фікси/контент.

## `tsconfig.base.json`

`strict`, ES2022, ESNext, `moduleResolution: bundler`, `resolveJsonModule`, `isolatedModules`, `skipLibCheck`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noEmit`. Sim's tsconfig **опускає DOM lib**.

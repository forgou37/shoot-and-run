# 11 — Дорожня карта й рішення

Канонічне джерело правди — `CLAUDE.md` § Decisions Log і теки `specs/`. Цей документ — навігаційне резюме.

## Дорожня карта специфікацій

| Spec | Тема | Стан |
|---|---|---|
| 000 | Baseline first playable | ✅ done |
| 001 | Game feel & match structure: juice, best-of-N, scores; shell e2e | ✅ done |
| 002 | Скрині, спецстріли (bomb/laser/bounce), power-up'и (invisibility/flight) | ✅ done |
| 003 | Повний roster: геймпади, 3–4 гравці, teams/FF, title/lobby/pause | ✅ done |
| 004 | Реальні боти: heuristic AI з лобі (FFA/teams, 3 складності) | ✅ done |
| 005 | AI-пайплайн: headless `run-rounds` → генератор арен + метрики + judge-loop | ⏳ майбутнє |
| 006 | Арт-пас I: sprite-пайплайн + анімація гравця | ✅ done |
| 007 | Арт-пас II: джунглеве середовище (тайлсет, фон, скриня, arena-002) + спрайти стріл | ✅ done |
| 008 | Онлайн umbrella + netcode-фундамент (snapshot/restore, input-серіалізація, determinism-hardening) | ✅ done |
| 009 | Netcode session-шар (`packages/net`): clock sync, input delay, prediction/rollback над loopback | ✅ done |
| 010 | Реальний WebSocket-транспорт + локальна онлайн-гра (дві вкладки на localhost, без Cloudflare) | ✅ done |
| 011 | Cloudflare signaling (Worker + Durable Object) + dedicated server + room codes — **перший інтернет-матч** | ⏳ майбутнє |
| 012 | Player-hosted / listen-server: WebRTC DataChannel P2P, NAT/TURN, host-leaving | ⏳ майбутнє |
| 013 | Netplay-поліш: lag-comp tuning, спектатори, reconnection, метрики, anti-cheat, host migration | ⏳ майбутнє |
| 014 | Плаваючі бустери + shield power-up + арт-пас III (4 персонажні архери + напрямні пози) | 📋 spec'нуто, не реалізовано |

Нумерація: 008–013 зарезервовані netcode-roadmap'ом; 014 — геймплей+арт, незалежний від netcode, тому взяв наступний вільний номер.

## Специфікація 014 (найближча геймплейна, не в коді)

**Мета:** відкриття скрині більше не дає миттєво — випадає **бустер**, що плаває над скринею (м'яко погойдуючись); гравець має **торкнутися** плаваючого бустера в повітрі. Новий **shield** поглинає перше влучання й рендериться бульбашкою. Плюс арт-пас: іконка кожного типу бустера, перемальована стріла, **чотири окремі персонажні аркуші архерів** (замість per-slot recolor), **напрямні пози прицілювання** (↗45°/↑/↘45°).

Ключові sim-зміни (заплановані): нова сутність `BoosterState` + `SimState.boosters`; модуль `booster.ts` (спавн-зі-скрині, pickup-on-contact, переміщений `grant()`); `PlayerState.shielded`; `consumeShield` helper у всіх трьох kill-шляхах; нові події `booster_collected`, `shield_blocked`. Golden-лог лишиться побайтово ідентичним (раунд закінчується ~тік 165 на arrow-kill до будь-якого спавну скринь). Розбито на PR A (sim) / B (booster+arrow арт) / C (персонажні архери + aim-пози).

## Decisions Log — ключові рішення

Повна таблиця — у `CLAUDE.md`. Найважливіші:

| Дата | Скоуп | Рішення |
|---|---|---|
| 2026-06-12 | engine | Phaser 3 + TS + Vite (стек розробника, web-first) |
| 2026-06-12 | architecture | Engine-agnostic sim-ядро в `packages/sim`, Phaser як рендер-shell |
| 2026-06-12 | sim-core | 60 Гц fixed-step + інтерполяція; власна wrap-aware AABB-vs-tile колізія; mulberry32 |
| 2026-06-12 | sim-core | Float-детермінізм достатній у межах одного JS-рушія (fixed-point відкинуто) |
| 2026-06-12 | tooling | npm workspaces + Vitest + ESLint + dependency-cruiser |
| 2026-06-12 | testing | Шарувате e2e: правила headless у sim; браузерне — лише shell-smoke |
| 2026-06-12 | sim-events | `player_killed` несе позицію жертви |
| 2026-06-13 | sim-movement | wall-slide (hold-into-wall), straight-down edge-fall, dash |
| 2026-06-13 | art/content | Спека 007: shell бутиться в arena-002; автотайлінг через exposure-mask; arrow-rotation `atan2` |
| 2026-06-13 | sim-modes | Teams через `team?: 0\|1`; FFA-шляхи побайтово ідентичні |
| 2026-06-13 | shell-input | Спека 003: uniform `InputDevice`, hot-plug DeviceManager, boot→title→lobby→arena |
| 2026-06-14 | shell-text | 1-бітовий runtime bitmap-шрифт (фікс blur під апскейлом) |
| **2026-06-14** | **netcode** | **Онлайн додано (реверс «online never»): host-authoritative rollback, dedicated-first, Cloudflare-native** |
| 2026-06-14 | sim-movement | 45° wall-jump + control-lock |
| 2026-06-14 | bots | Спека 004: боти в `packages/bots` як `InputDevice`, власний seeded RNG |
| 2026-06-15 | shell-ui | Лобі: hi-res DOM-overlay картки персонажів |
| 2026-06-15 | process | Production-like PR-флоу (реверс «PR rejected»); репо стало публічним |
| 2026-06-15 | ci-cd | Continuous deploy на GitHub Pages |
| 2026-06-15 | netcode | Фаза 008 (фундамент): snapshot/restore, 1-байт input wire, golden-state-hashes |
| 2026-06-15 | netcode | Фаза 009 (session-шар): loopback, codec, host, clock, rollback, params |
| 2026-06-15 | netcode | Фаза 010: реальний WebSocket + дві вкладки на localhost (без Cloudflare) |

### Найважливіший реверс: «онлайн ніколи» → онлайн (2026-06-14)

Початково (2026-06-12) онлайн був назавжди поза скоупом: «локальний-онлайн компілюється в статичні файли, серверного компонента немає й не буде». Власник це скасував. Чому це не зламало архітектуру: детермінована, input-driven, fixed-step симуляція робить rollback майже безкоштовним і точним; host authority поглинає float-розбіжності (тож fixed-point досі не потрібен). Тверді правила (sim-purity, детермінізм, tuning-is-data) **не змінилися** — вони обмежують netcode-дизайн.

## Backlog (вибірка з `specs/backlog.md`)

Нові ідеї спершу йдуть сюди, тоді промотуються в нумеровану специфікацію.

**Бій / стріли:** splitting/drill/oversized стріли; weighted chest-таблиці; руйнування тайлів bomb-стрілою (потребує мутабельного стану арени — обережно з детермінізмом); arrow-catching; dodge/roll з i-frames; arrow-vs-arrow deflection.

**Power-up'и:** speed boost, mirror/decoy. (shield промотовано в 014.)

**Game feel:** трупи з фізикою; slow-mo на round-winning kill; death-cam nudge; jump/land dust; particle-wrap на швах.

**Match:** round-timer з sudden-death; draw-поліш; match-victory-екран.

**Меню/UX:** arena-select (читає `content/arenas/`); rebinding; settings.

**Audio:** SFX event-driven від SimEvents (shell-only); музика пізніше.

**Інфраструктура:** **replay-система** (`{arenaId, tuning-snapshot, seed, per-tick inputs}` → playback через sim — майже безкоштовно завдяки детермінізму, фундамент для баг-репро й eval); in-game debug-overlay (хітбокси, tick, event-ticker).

**Назавжди ніколи:** копіювання назв/ассетів/тексту TowerFall.

## AI-пайплайн генерації арен (спека 005, майбутнє)

Offline-пайплайн (ціль лише після того, як гра весела руками):

1. **Генератор** — LLM-агент емітить арени як JSON за схемою; схема-валідація (вже в sim) відкидає некоректне до симуляції; структурні pre-checks (зв'язність із wrap, чесність спавнів за симетрією, open-space ratio).
2. **Headless evals** — N раундів (різні сіди, пари ботів зі спеки 004) через `run-rounds`.
3. **Метрики балансу** (з event-логів — ось чому кожна значуща подія має бути SimEvent): розподіл вбивств по спавнах, довжина раунду vs 10–60 с, draw-rate, покриття мапи, економіка стріл.
4. **LLM-as-judge** — rubric-оцінка цікавості розкладки.
5. **Ітерація** — feedback-loop; кандидати, що проходять пороги, потрапляють у `content/arenas/` як коміти й проходять той самий CI-гейт.

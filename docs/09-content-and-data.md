# 09 — Контент і дані

Усе, чого може торкатися дизайнер (або майбутній LLM-генератор), — це файл даних, ніколи не код. Усі content-файли валідуються при завантаженні; схема-валідація живе в `packages/sim`, тож headless-пайплайн отримує її безкоштовно.

| Файл | Вміст | Валідатор |
|---|---|---|
| `content/arenas/*.json` | одна арена на файл: tile-grid, спавни, метадані | `parseArena` (sim) |
| `content/tuning.json` | кожне число геймфілу + shell-блоки | `parseTuning` (sim) + `parseJuice`/`parseInputSettings`/`parseUiSettings` (game) + `parseNetParams` (net) |
| `content/players.json` | ідентичності слотів + клавіатурні профілі | `parsePlayersConfig` (game) |
| `content/bots.json` | пресети складності ботів | `parseBotConfig` (bots) |

## Формат арени

```json
{
  "name": "canopy",
  "tiles": [ "....................", ... ],   // рівно 15 рядків × 20 символів
  "spawns":     [ { "x": 48, "y": 58 }, ... ],   // >= 4
  "chestSpots": [ { "x": 160, "y": 92 }, ... ]   // опціонально
}
```

- `tiles`: 15 рядків × 20 символів, `'#'`=solid, `'.'`=empty. Тайл 16 px, арена 320×240.
- `spawns`: `>= 4`, кожен валідовано бути на ґрунті (`SPAWN_GROUND_TOLERANCE` 32 px) і хітбоксом у межах.
- `chestSpots`: опціонально; арена без них ніколи не спавнить скрині.

### Дві арени

- **arena-001 «crossfire»** — sim-тест/golden-фікстура. **Ніколи не змінюється** (тримає golden-логи побайтово стабільними). Розріджена: дві верхні полиці, центральна платформа, дві бічні, розколота нижня підлога. 4 спавни, 3 chestSpots.
- **arena-002 «canopy»** — арена, в яку **бутиться shell** (спека 007). Щільніша симетрична джунглева розкладка: верхні пілони, бічні полиці на рядках 4/7/9/11, центральні платформи, розколота підлога. 4 спавни `(48,58)/(272,58)/(32,202)/(288,202)`, 4 chestSpots.

> Чому дві: arena-001 заморожена як еталон детермінізму (golden bot-round грається саме на ній). arena-002 — те, у що реально грають. Розрив дозволяє рартити/додавати арени, не торкаючись доказу детермінізму.

## `tuning.json` — ЄДИНИЙ файл тюнінгу (тверде правило 3)

### Sim-ключі (тривалості в ms → конвертуються в тіки при init)

| Категорія | Ключі (поточні значення) |
|---|---|
| Гравітація/падіння | `gravity:900`, `maxFallSpeed:240` |
| Біг/повітря | `runSpeed:100`, `airAccel:600` |
| Стрибок | `jumpVelocity:260`, `jumpCutFactor:0.4`, `coyoteTimeMs:80`, `jumpBufferMs:100` |
| Стіна | `wallSlideSpeed:40`, `wallJumpSpeed:240`, `wallJumpControlLockMs:150` |
| Dash | `dashSpeed:300`, `dashDurationMs:130`, `dashCooldownMs:450` |
| Стріли | `arrowSpeed:350`, `arrowGravity:180`, `arrowBounceCount:5` |
| Бій | `stompBounceVelocity:180`, `bombRadiusPx:28` |
| Power-up | `invisibilityDurationMs:10000`, `flightDurationMs:10000`, `flapVelocity:220` |
| Скрині | `chestIntervalMs:8000`, `maxChestsAlive:2`, `specialArrowsPerChest:3` |
| Раунд/матч | `startingArrows:3`, `roundsToWin:3`, `roundRestartDelayMs:1500`, `matchRestartDelayMs:4000` |

### Shell-only блоки (sim ігнорує всі)

```json
"input": { "stickDeadzone": 0.25 },
"ui":    { "lobbyCountdownMs": 3000 },
"juice": {
  "hitstopMs": 80, "shakeDurationMs": 180, "shakeMagnitudePx": 3,
  "killBurstParticles": 24, "stickPuffParticles": 6,
  "bombBurstParticles": 48, "invisibilityOpacity": 0.2
},
"net": {              // валідується в packages/net
  "inputDelayTicks": 3, "snapshotIntervalTicks": 30,
  "maxRollbackTicks": 120, "jitterBufferTicks": 4
}
```

`parseTuning` зрізає до своїх ключів, тож `juice`/`input`/`ui`/`net` ніколи не сягають sim → determinism-артефакти недоторкані. Hot-reload у dev через Vite HMR (`sim.setTuning`); в онлайні tuning **запінено** при init.

## `players.json`

```json
{
  "slots": [
    { "slot": 0, "name": "Maks",    "color": "#ba68c8" },
    { "slot": 1, "name": "Igor B",  "color": "#ff8a65" },
    { "slot": 2, "name": "Lyosha",  "color": "#4fc3f7" },
    { "slot": 3, "name": "Igor Sh", "color": "#81c784" }
  ],
  "keyboards": [
    { "left":"KeyA","right":"KeyD","up":"KeyW","down":"KeyS","jump":"KeyG","shoot":"KeyF","dash":"ShiftLeft" },
    { "left":"ArrowLeft","right":"ArrowRight","up":"ArrowUp","down":"ArrowDown","jump":"Period","shoot":"Slash","dash":"ShiftRight" }
  ]
}
```

Порядок відображення Maks · Igor B · Lyosha · Igor Sh відповідає re-art-рішенню карток (2026-06-15). Картки мапляться за **нормалізованим іменем**, не за індексом слота.

## `bots.json`

Три пресети складності — повна таблиця в [Ботах і AI](08-bots-and-ai.md).

## Атласи спрайтів (`packages/game/public/assets/*.json`)

Aseprite `json-hash`-формат: `frames` (з `frame{x,y,w,h}`, `duration`), `meta` (`image`, `size`, `frameTags[]`, `layers[]`). Експорти **закомічені**; CI ніколи не запускає Aseprite.

| Атлас | Кадри | Теги |
|---|---|---|
| **archer** | 19 × 16×16 (sheet 304×16) | `idle` 0–1 pingpong, `run` 2–7, `jump` 8–9, `fall` 10–11 pingpong, `shoot` 12–14, `death` 15–18 |
| **arrow** | 1 × 16×16 | `flying` |
| **chest** | 1 × 12×10 | `closed` |
| **jungle-tiles** | 10 × 16×16 (sheet 160×16) | `grass`/`grass-l`/`grass-r`/`grass-lr`/`dirt`/`dirt-l`/`dirt-r`/`dirt-lr`/`vine-a`/`vine-b` |
| **jungle-bg** | 1 × 320×240 | — (повноекранний фон) |

## Build-скрипти

### `export-art.mjs` (`npm run export:art`)

Реекспортує кожен `assets/*.aseprite` в атласи під `public/assets/`. Знаходить Aseprite через env `ASEPRITE` або відомі шляхи. Для кожного джерела — Aseprite batch (`-b --sheet-type horizontal --format json-hash --list-tags --list-layers`), пише `<name>.png` + `<name>.json`. **CI/build ніколи не запускають** (експорти закомічені, потрібен локальний Aseprite).

### `slice-cards.mjs` (`npm run export:cards`)

Чистий Node (без Aseprite, без залежностей) — рукописний PNG decode/encode (CRC32, zlib inflate/deflate, усі 5 PNG-фільтрів). Вхід: `assets/cards/cards.png` (один прозорий аркуш, 4 картки в ряд). `detectColumns` знаходить 4 прогони непрозорих колонок (alpha `> 16`); кидає якщо не 4. Обчислює **спільний** вертикальний кроп (рядкове вирівнювання) + uniform-ширину, центр-падить кожну в `CW×CH` (без downscale). `SHEET_ORDER = ["igorsh","lyosha","maks","igorb"]` (порядок аркуша L→R, незалежний від порядку лобі). Виходи: `card_<name>.png` (~156×557), закомічені, малюються hi-res DOM-overlay'єм лобі.

## Контент-валідація як перший клас

Усі три content-файли мають unit-покриття (`content.test.ts` у sim, `input.test.ts`/`juice.test.ts` у game, `config.test.ts` у bots). Згенеровані арени (спека 005) прибуватимуть як коміти й проходитимуть **той самий** CI-гейт (схема-валідація + повна сюїта), що й ручний контент.

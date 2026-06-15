# 06 — Рендеринг і графіка (`packages/game`)

Shell — тонкий шар Phaser 3 над чистим `@shoot-and-run/sim`. Жодних ігрових правил тут немає: сцени трактують `sim.state` як read-only, а просувають симуляцію лише `doTick`/`doNetTick`.

## Bootstrap (`main.ts`)

Гра **не конструюється**, доки не завантажено піксельний шрифт (Phaser не пере-растеризує текст, коли webfont приходить пізніше):

```ts
void loadFont().finally(() => {
  const game = new Phaser.Game({
    type: Phaser.AUTO,            // WebGL з canvas-fallback
    width: ARENA_WIDTH, height: ARENA_HEIGHT,   // 320 × 240
    pixelArt: true,               // NEAREST-фільтр, antialias off
    roundPixels: true,
    backgroundColor: "#1a1a2e",
    scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, TitleScene, LobbyScene, ArenaScene, OnlineArenaScene]
  });
});
```

**Pixel-perfect масштаб (`sizeCanvas`):** backing store лишається 320×240; CSS-бокс ставиться найбільшим **цілим** кратним, що влазить у device-пікселі:

```ts
const dpr = window.devicePixelRatio || 1;
const zoom = Math.max(1, Math.floor(Math.min(
  (innerWidth * dpr) / ARENA_WIDTH, (innerHeight * dpr) / ARENA_HEIGHT)));
canvas.style.width  = `${(ARENA_WIDTH * zoom) / dpr}px`;
canvas.style.height = `${(ARENA_HEIGHT * zoom) / dpr}px`;
```

Реєструється на `READY` + `window resize`. Це уникає дробового блюру `Scale.FIT`. Ключі сцен: `"boot"`, `"title"`, `"lobby"`, `"arena"`, `"online"`.

## Фіксований крок (`loop.ts`)

```ts
const TICK_MS = 1000 / TICK_RATE;   // 16.667 ms
const MAX_FRAME_MS = 100;           // catch-up clamp

class FixedStepDriver {
  advance(deltaMs, step) {
    this.accumulatorMs += Math.min(deltaMs, MAX_FRAME_MS);
    while (this.accumulatorMs >= TICK_MS) { step(); this.accumulatorMs -= TICK_MS; }
    return this.accumulatorMs / TICK_MS;   // alpha ∈ [0,1) для інтерполяції
  }
}
```

- Акумулятор: кожен кадр додає clamped `deltaMs`, крутить 0..N цілих тіків, повертає дробовий залишок як **alpha** для лерпу.
- `MAX_FRAME_MS = 100` запобігає death-spiral після перемикання вкладки/паузи дебагера.
- **Пауза — суто shell-річ:** сцена просто не кличе `advance()`; акумулятор замерзає, симуляція недоторкана (детермінізм збережено). Те саме з hitstop і manual-режимом e2e.

## Потік сцен і URL-параметри

`BootScene.create()` один раз: `buildPixelFont(this)`, парсить `players.json`/`bots.json`, будує два app-singletoni вводу (`KeyboardInput`, `DeviceManager`), кладе `AppContext` у реєстр, `installBaseTestApi`. Тоді **маршрутизує** за URL:

| Параметр | Поведінка |
|---|---|
| `?online=ws://host:port` / `?online=1` | `1` → `ws://<hostname>:8787`; старт сцени `"online"` |
| `?bots=N` (1–3) | quickstart людина-vs-боти; старт `"arena"` |
| `?difficulty=easy\|normal\|hard` | пресет складності бота (дефолт `normal`) |
| `?quickstart=1` | матч 2 клавіатури FFA; старт `"arena"` |
| `?rects=1` | (читається в `ArenaScene`) дебаг-рендер кольоровими прямокутниками |
| (нічого) | старт `"title"` |

`QUICKSTART_SEED = 1` (фіксований для відтворюваного dev/e2e-boot).

**TitleScene** — заголовок + підказка; будь-який join/start-edge → `"lobby"`.

## LobbyScene — вибір персонажа

«Натисни кнопку, щоб приєднатися», чотири ілюстровані картки.

- **Стейт:** `entries: Map<deviceId, Entry{device, slotIndex, ready, team}>` (люди); `bots: Map<slotIndex, BotSlot{difficultyName, team}>` (`BotDevice` будується лише на старті матчу, щоб можна було перебирати складність); `mode: "ffa"|"teams"`, `friendlyFire`, `countdownMsLeft`.
- **Кожен кадр:** `pruneDisconnected`, тоді `EdgeReader.read(devices)` дає `DeviceEdges`; join/ready/back/leave; **контролер** (людина в найнижчому слоті) керує режимом (`up`=cycleMode, `down`=FF toggle / cycleDifficulty, `right`=addBot, `left`=removeBot); не-контролер у teams міняє команду left/right.
- **Режими:** вхід у teams вимагає `participantCount() >= 3`; обидві команди мають бути присутні; вхід у teams скидає readiness і ставить `friendlyFire=false`.
- **Старт:** `allReady = participantCount() >= 2 && кожна людина ready`; боти завжди ready (самотня людина може битися з ботами). Countdown від `app.lobbyCountdownMs` (3000), на `<=0` → `startMatch()` будує `MatchConfig` (humans + свіжі `BotDevice`), сортований за `slotIndex`, і `scene.start("arena", config)`.
- **Рендер:** персистентні display-об'єкти, мутовані щокадру. Арт карток — **hi-res DOM overlay** (`CardOverlay`), не на Phaser-display-list. `frameGfx` малює 2px-рамку **зовні** зайнятої картки (зелена=ready, фіолетова=bot). Статус/чіп-тексти під картками (`KEY 1`/`PAD 2`/`BOT`+складність, `+T1/T2` у teams).

## ArenaScene — повний локальний матч

Бутиться в `content/arenas/arena-002.json` («canopy»).

- **`init(MatchConfig)`** скидає per-match-стан (сцени-сінглтони перевикористовуються). **`preload`** вантажить атласи архера/середовища/стріл.
- **`create`:** `parseArena`, `createSim({arena, tuning, players, seed, friendlyFire})`; **пізнє прив'язування ботів** — для кожного `BotDevice` → `attach(() => sim.state, slot, seed, arena)` (бот потребує живий sim); `prev = snapshot()` для інтерполяції; `EnvironmentRenderer` або (за `?rects=1`) `drawTiles`; `ArcherRenderer` + `ArrowRenderer`; particles; HUD (score-тексти кольором слота, team-тексти в кутах); pause-панель. Dev-only **tuning hot-reload** через `import.meta.hot.accept(...)` → `sim.setTuning(...)`.
- **`doTick`** — єдине місце просування sim:
  ```ts
  const inputs = devices.map(d => d.sample());
  prev = snapshot();
  const events = sim.step(inputs);
  applyJuice(events); archers.onEvents(events);  // + eventLog (cap 1000)
  ```
- **`update`:** manual → `render(1)`. Інакше pause-меню / `openPause()` (esc, будь-який pause-edge, або втрата призначеного пада) / hitstop-замороження / `driver.advance(delta, doTick)` → `render(alpha)`.
- **Пауза:** `["Resume","To Lobby","To Title"]`, `anims.pauseAll()` морозить спрайт-аніми разом із sim.
- **`render(alpha)`:** інтерполює `x/y` через `lerpWrapped`; alpha гравця = `invisibleTicksLeft>0 ? juice.invisibilityOpacity : 1`; стріли лише `flying`/`stuck`; `drawQuiverDots` (до 6 кольорових 2×2-крапок над головою за `ARROW_COLORS`).

**`lerpWrapped(prev, curr, alpha, range)`** обирає найкоротший шлях через шов: якщо `|curr-prev| > range/2` — додає/віднімає `range`. **`drawWrappedRect`** дзеркалить прямокутник через краї.

## OnlineArenaScene — онлайн-клієнт

**Не володіє sim** — крутить `ClientSession` на тому ж `FixedStepDriver`.

- **`create`:** парсить arena-002 + tuning + `parseNetParams`; локальний пристрій = перша клавіатура; `new WebSocketTransport(cfg.url)`; `new ClientSession({transport, arena, tuning, inputDelayTicks, maxRollbackTicks})`. Tuning **запінено** — без hot-reload у net-сесії.
- **`doNetTick`:**
  ```ts
  const beforeTick = session.predictedTick;
  prev = before ? snapshotPositions(before) : null;
  const events = session.tick(localDevice.sample());
  if (session.predictedTick - beforeTick > 1) prev = null;  // стрибок >1 тіка — снап, не розмаз
  if (events.length) archers.onEvents(events);
  recordConfirmedHash();
  ```
  Це **снапінг інтерполяції на стрибках prediction** — коли prediction скаче більш ніж на тік (startup-lead / catch-up після rollback-cap-стола), `prev` обнуляється, щоб render не розмазував.
- **Без локального hitstop** — заморозка клієнтського годинника десинхронізувала б його з хостом; juice лише event-driven.
- **Dev-проба:** `recordConfirmedHash` зберігає `fnv1a(JSON.stringify(session.snapshotConfirmed()))` за `confirmedTick` → e2e `getConfirmedHashAt` порівнює дві вкладки на побайтову збіжність.

## Рендерери

### Архер (`render/archer.ts`)

- Канонічний атлас `"archer"`. **Recolor-ramp:** `CANONICAL_RAMP = ["#2d7fc4","#4fc3f7","#a8e6ff"]` (shadow/base/highlight). `recolorArcherTexture(scene, slot, color)`: slot 0 — канонічний без змін; решта — canvas-копія з піксельною заміною кожного ramp-RGB на `slotRamp(color)` (HSL: shadow `l-0.22`, base `l`, highlight `l+0.22`). Ідемпотентно (текстури глобальні).
- **Анім-теги:** `ARCHER_TAGS = ["idle","run","jump","fall","shoot","death"]` (19 кадрів 16×16). Playback: idle yoyo loop, run loop, jump one-shot, fall yoyo loop, shoot one-shot, death one-shot. `buildSlotAnims` дзеркалить тайминг `createFromAseprite`. Ключі `archer-{slot}-{tag}`.
- **`selectTag(p)`:** dead→death; airborne→jump/fall за знаком `vy`; grounded→run/idle за `|vx|>1`. Shoot — косметичний one-shot від `arrow_fired`. `update` флипить X за `facing`, origin `(0.5,1)` (ноги внизу хітбокса). Wrap-дзеркала: `QUAD=4` спрайти на слот.

> Спека 014 (не реалізовано) замінить per-slot recolor на чотири окремі персонажні аркуші + напрямні пози прицілювання.

### Стріли (`render/arrows.ts`)

`load.image("arrow")`. Канонічно дивиться вправо; `rotation = atan2(a.vy, a.vx)` поки летить, **кешується per-id** — встромлена стріла тримає останній кут польоту. `KIND_TINTS`: bomb `0xff5252`, laser `0x40e8ff`, bounce `0xffd740`. `QUAD=4` wrap-дзеркала.

### Середовище (`render/environment.ts`)

Атлас `"jungle-tiles"` (10 кадрів), фон `"jungle-bg"` (320×240), `"chest"`.

- **Автотайлінг через wrap-aware exposure-mask:** для кожного solid-тайла обчислюється `openAbove/openLeft/openRight` проти **загорнутих** сусідів; база = `openAbove ? "grass" : "dirt"`, суфікс `-lr`/`-l`/`-r`/`""`.
- **Ліани:** якщо тайл нижче відкритий — детермінований `hash = (c*7 + r*13) % 5` ставить `"vine-a"` (0) або `"vine-b"` (2). Без RNG.
- Глибини: `DEPTH_BG=-20`, `DEPTH_TILES=-10`, `DEPTH_CHESTS=-1`, сутності 0. Скрині — feet-aligned image per id.

### Картки (`render/cards.ts` + `card-overlay.ts`)

- `cardImageUrl(slotName)` → `assets/card_${name.toLowerCase().replace(/\s+/g,"")}.png` — **name-normalized** ключ (слідує ідентичності roster'а, напр. «Igor B» → `igorb`), відносний URL для Pages-subpath.
- **`CardOverlay`** — hi-res DOM-шар: fixed-position `<div>` (z-index 10, `pointerEvents:none`) з одним `<img>` на слот (`imageRendering:auto`). `layout()` читає `canvas.getBoundingClientRect()` і мапить логічний `CardRect` (320×240-простір) у CSS-пікселі, no-op поки бокс не рухався. Це **обходить ліміт буфера 320×240** — намальовані картки лишаються чіткими в піксельному UI. Кличеться щокадру (дешево), знищується на SHUTDOWN.

**Чому overlay:** буфер 320×240 — жорсткий ліміт деталізації в-движку (картки крихтіли б до ~8% арту). Підняти роздільність глобально зламало б sim/контент/golden-лог. Lobby-only hi-res-шар escape'ить ліміт без жодного впливу на sim — поширений патерн піксельних ігор (чіткі портрети в піксельному UI). Картки нарізає `npm run export:cards` (див. [Контент і дані](09-content-and-data.md)).

## Піксельний шрифт (`theme.ts`)

Весь shell-текст — runtime-згенерований **1-бітовий bitmap-шрифт** (Phaser `BitmapText` + fixed-grid `RetroFont`), ніколи не живий TTF-canvas-Text (який AA-розмивається під апскейлом).

- FreePixel @12px: `CELL_W=6`, `CELL_H=11`, `COLS=16`, `ALPHA_CUTOFF=128`, `LETTER_SPACING=1`.
- **`buildPixelFont(scene)`** (ідемпотентний, у BootScene): малює кожен гліф у канву, **порогує** alpha `>=128` → непрозорий білий (1-біт), реєструє через `textures.addCanvas`, `setFilter(NEAREST)`, `RetroFont.Parse`.
- **`addPixelText(scene, x, y, text, sizePx, color, opts)`**: snap-scale до цілого, `setLetterSpacing(1)`, `setTint(hexToInt(color))`.
- **`loadFont()`**: реєструє `FontFace` з імпортованого `assets/fonts/FreePixel.ttf` й `await face.load()`. Кличеться в `main.ts` до конструкції гри.

**Чому 1-біт:** TTF через canvas-text-API завжди grayscale-AA, і м'які краї жахливо розмиваються при NEAREST-апскейлі буфера 320×240 ×N. 1-бітовий атлас, семплений NEAREST, лишається піксель-чітким на будь-якому цілому масштабі в кожному браузері.

## Juice (`juice.ts` + ефекти в ArenaScene)

`juice.ts` лише **парсить** shell-only блок `juice`. Самі ефекти — в `ArenaScene` (`applyJuice`, `createParticles`):

| Ефект | Тригер | Ключі |
|---|---|---|
| **Hitstop** | `player_killed` → морозить sim + інтерполяцію + `anims.pauseAll()` | `hitstopMs` (80) |
| **Screen shake** | kill (`×1.5`/`×2` на bomb) | `shakeDurationMs` (180), `shakeMagnitudePx` (3) |
| **Kill burst** | `player_killed`, колір слота | `killBurstParticles` (24) |
| **Stick puff** | `arrow_stuck` | `stickPuffParticles` (6) |
| **Bomb burst** | `arrow_exploded` | `bombBurstParticles` (48) |
| **Invisibility** | alpha гравця в render | `invisibilityOpacity` (0.2) |

OnlineArenaScene парсить juice, але **не** застосовує hitstop/shake (десинк), лише `invisibilityOpacity` + event-аніми.

## Арт-пайплайн

- `npm run export:art` — `assets/*.aseprite` → `packages/game/public/assets/` атласи (потрібен локальний Aseprite; CI ніколи не запускає, експорти закомічені).
- `npm run export:cards` — `assets/cards/cards.png` → per-slot `card_<name>.png` (чистий Node, без Aseprite).
- Арт генерується в-сесії Claude'ом через Aseprite MCP, власник — арт-директор.

Деталі форматів атласів — у [Контенті й даних](09-content-and-data.md).

## `test-api.ts` — `window.__testApi` для e2e

Dev-only. `installBaseTestApi` дає `getPhase()` (`"title"`/`"lobby"`/`"match"`). `ArenaScene` доповнює: `getState()`, `getArenaName()`, `getEvents()`, `setManual(on)`, `stepTicks(n)`, `getSpriteProbe()` (перевірка завантажених текстур/анімів). `OnlineArenaScene`: `getState()` (predicted), `getNetProbe()` (`{ready, confirmedTick, predictedTick, confirmedHash}`), `getConfirmedHashAt(tick)`.

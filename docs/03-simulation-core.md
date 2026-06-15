# 03 — Ядро симуляції (`packages/sim`)

Чиста, детермінована, headless TypeScript-симуляція. Нуль Phaser/DOM/canvas. Уся випадковість — через один seeded mulberry32 PRNG; увесь час — цілі тіки на 60 Гц.

`SIM_VERSION = "0.0.0"`. `index.ts` реекспортує усе з модулів `arena`, `arrow`, `chest`, `constants`, `events`, `input`, `kills`, `physics`, `rng`, `round`, `state`, `tuning`, `wire` + тип `SimSnapshot`.

## Структура модулів

| Файл | Відповідальність |
|---|---|
| `index.ts` | Публічний API: `createSim`, `createSimFromSnapshot`, типи, `buildSim` |
| `state.ts` | Форма `SimState` й усіх сутностей |
| `input.ts` | `PlayerInput`, `emptyInput()` |
| `tuning.ts` | `Tuning`, `DerivedTuning`, `parseTuning`, `deriveTuning`, `msToTicks` |
| `constants.ts` | Геометрія/час: `TILE_SIZE`, розміри хітбоксів, `TICK_RATE` тощо |
| `rng.ts` | mulberry32, `getState`/`setState` |
| `arena.ts` | Типи арени + `parseArena` (схема-валідація) |
| `physics.ts` | Wrap-aware AABB-vs-tile колізія, swept-рух |
| `player.ts` | Рух, стрибок, dash, wall-slide/jump, stomp-bounce, таймери power-up |
| `arrow.ts` | Політ за видом, стик, підбір, gravity стріли |
| `kills.ts` | Вбивства стрілою/stomp/bomb; teams/friendlyFire |
| `chest.ts` | Спавн/відкриття скринь (PRNG-driven), grant |
| `round.ts` | Стейт-машина раунду + матчу |
| `events.ts` | Визначення `SimEvent` |
| `snapshot.ts` | `SimSnapshot`, DOM-free `deepClone` |
| `wire.ts` | 1-байтовий інпут + versioned input-frame (де)серіалізація, varint |

## Публічний API

### Конфіги

```ts
interface PlayerSlotConfig { slot: number; team?: 0 | 1; }

interface SimConfig {
  arena: ArenaData;
  tuning: Tuning;
  players: PlayerSlotConfig[];
  seed: number;
  friendlyFire?: boolean;   // дефолт true; лише в teams-режимі
}

interface RestoreConfig {   // без `seed` — RNG відновлюється зі снапшота
  arena: ArenaData;
  tuning: Tuning;
  players: PlayerSlotConfig[];
  friendlyFire?: boolean;
}
```

### Фабрики

- **`createSim(config): Sim`** — свіжа симуляція. Сідить RNG (`createRng(seed)`), деривує тюнінг, визначає teams-режим, ставить `friendlyFire ?? true`. Лічильник id сутностей стартує з **1** (id гравців виділяються першими). Тік 0, фаза раунду `"running"`, номер 1. Кидає помилку, якщо індекс гравця не має відповідного спавну на арені.
- **`createSimFromSnapshot(snapshot, config): Sim`** — відновлення. Deep-клонує `snapshot.state`, створює RNG з seed 0 і робить `setState(snapshot.rngState)`, відновлює лічильник із `snapshot.nextEntityId`. Кидає, якщо `config.players.length !== state.players.length`.

Обидві проходять через приватний `buildSim(arena, initialTuning, friendlyFire, rng, state, initialNextEntityId)` — логіка кроку в одному місці.

### `resolveTeamsMode(players)`

- 0 гравців мають `team` → FFA.
- Усі мають `team` → teams.
- Часткове призначення → кидає `"teams: either all players carry a team or none do"`.
- Обидві команди мають бути непорожні, інакше `"teams: both team 0 and team 1 must be non-empty"`.

### Порядок `step()` — контракт детермінізму

Цей порядок підсистем — load-bearing; зміна без регенерації golden-логів заборонена.

1. Якщо `inputs.length !== players.length` → кидає.
2. Якщо `state.tick === 0` → пушить `{ tick: 0, type: "round_started" }`.
3. Якщо `round.phase === "running"`:
   - для кожного **живого** гравця (за індексом): `updatePlayer(p, inputs[i], arena, tuning)`;
   - `checkStomps(...)`;
   - `handleShooting(...)`;
   - `updateArrows(...)`;
   - `checkArrowKills(...)`;
   - `resolveExplosions(...)`;
   - `state.arrows = collectPickups(arrows.filter(a => a.phase !== "spent"), ...)` — викидає згорілі стріли, тоді підбір;
   - `updateChests(...)`.
4. `updateRound(...)` — щотіка, навіть коли раунд завершено.
5. `state.tick++`.
6. Повертає зібрані `events`.

## Стан симуляції (`state.ts`)

```ts
type ArrowKind = "normal" | "bomb" | "laser" | "bounce";
type ArrowPhase = "flying" | "stuck" | "exploding" | "spent";
type RoundPhase = "running" | "ended";
type ChestContents = "bomb" | "laser" | "bounce" | "invisibility" | "flight";

interface SimState {
  tick: number;
  round: RoundState;
  match: MatchState;
  players: PlayerState[];
  arrows: ArrowState[];
  chests: ChestState[];
  nextChestTick: number;     // наступний тік спроби спавну скрині
}
```

### `PlayerState`

```ts
interface PlayerState {
  id: number;             // детермінований id сутності
  slot: number;           // 0-based, стабільний між раундами
  team: number | null;    // 0|1 у teams, null у FFA
  x: number; y: number;   // центр, float-пікселі
  vx: number; vy: number;
  facing: 1 | -1;
  quiver: ArrowKind[];    // стріляється з фронту; спецстріли unshift на фронт
  alive: boolean;
  grounded: boolean;
  coyoteTicksLeft: number;
  jumpBufferTicksLeft: number;
  prevJumpHeld: boolean;
  prevShootHeld: boolean;
  prevDashHeld: boolean;
  dashTicksLeft: number;
  dashCooldownTicksLeft: number;
  dashDir: 1 | -1;
  wallJumpLockTicksLeft: number;
  jumpCutAvailable: boolean;
  invisibleTicksLeft: number;   // таймер power-up
  flightTicksLeft: number;      // таймер power-up
}
```

### `ArrowState`, `ChestState`, `RoundState`, `MatchState`

```ts
interface ArrowState {
  id: number; ownerSlot: number; kind: ArrowKind; phase: ArrowPhase;
  firedTick: number;     // керує muzzle-immunity
  bouncesLeft: number;   // лише bounce
  pierced: boolean;      // laser: пройшов перший бар'єр
  insideSolid: boolean;  // laser: зараз усередині першого бар'єру
  x: number; y: number; vx: number; vy: number;
}

interface ChestState { id: number; x: number; y: number; contents: ChestContents; }

interface RoundState {
  phase: RoundPhase;
  winner: number | "draw" | null;  // slot або "draw" поки ended; null поки running
  restartTicksLeft: number;
  number: number;                  // 1-based
}

interface MatchState {
  scores: number[];          // per-player-index лічильник виживань
  winner: number | null;     // FFA: slot-переможець; teams: id команди
  teamScores: number[] | null;  // [team0, team1] у teams; null у FFA
}
```

## Ввід (`input.ts`)

```ts
interface PlayerInput {
  left: boolean; right: boolean; up: boolean; down: boolean;
  jump: boolean; shoot: boolean; dash: boolean;
}
function emptyInput(): PlayerInput   // усі false
```

## RNG (`rng.ts`) — mulberry32

Єдине джерело випадковості в симуляції. Стан — рівно один uint32, повністю захоплюється для snapshot/restore.

```ts
interface Rng {
  next(): number;             // float у [0, 1)
  nextInt(max: number): number;  // floor(next() * max), у [0, max)
  getState(): number;
  setState(state: number): void;  // reseed через state >>> 0
}
function createRng(seed: number): Rng
```

Внутрішнє `a = seed >>> 0`, кожен `next()`:

```ts
a = (a + 0x6d2b79f5) >>> 0;
let t = a;
t = Math.imul(t ^ (t >>> 15), t | 1);
t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
```

## Арена й валідація схеми (`arena.ts`)

Фіксовані константи геометрії: `TILE_SIZE=16`, `ARENA_COLS=20`, `ARENA_ROWS=15`, `ARENA_WIDTH=320`, `ARENA_HEIGHT=240`. Символи: `SOLID="#"`, `EMPTY="."`. `EPS=1e-6`.

```ts
interface SpawnPoint { x: number; y: number; }
interface ArenaData {
  name: string;
  tiles: string[];           // ARENA_ROWS рядків по ARENA_COLS символів
  spawns: SpawnPoint[];
  chestSpots?: SpawnPoint[]; // арена без цього ніколи не спавнить скрині
}
```

**`parseArena(data)` (кидає на першому порушенні):**

- top-level — об'єкт (не масив);
- `name` — непорожній рядок;
- `tiles` — масив рівно `ARENA_ROWS` (15) рядків; кожен рівно `ARENA_COLS` (20) символів `#`/`.`;
- `spawns` — масив `>= MIN_SPAWNS` (4); кожен валідовано `validatePlacedPoint` з half-extents гравця (6, 6);
- `chestSpots` — опціонально; кожен валідовано з half-extents скрині (5, 4);
- повертає типізовану **копію**.

**`validatePlacedPoint`:** точка — об'єкт з кінцевими `x`,`y`; хітбокс повністю в межах арени; не перекриває solid-тайл; має ґрунт у межах `SPAWN_GROUND_TOLERANCE` (32 px) під ногами.

## Фізика (`physics.ts`) — wrap-aware AABB-vs-tile

### Хелпери загортання

```ts
wrapMod(n, m) = ((n % m) + m) % m;          // додатне модуло
wrapDelta(d, range)                          // найкоротша знакова дельта в [-range/2, range/2)
solidAt(arena, col, row)                     // isSolid з wrapMod по col/row — ось чому край стикається з протилежним
tileSpan(center, half) = { min: floor((center-half)/16), max: floor((center+half-EPS)/16) }
```

### Swept-рух по осях

`moveAxisX(arena, x, y, halfW, halfH, dx)` свіпить колонка-за-колонкою по рядках, які охоплює `tileSpan(y, halfH)`:

- `dx > 0`: від `floor((x+halfW-EPS)/16)+1` до `floor((newX+halfW-EPS)/16)`; на першій solid-колонці snap до `wrapMod(col*16 - halfW, ARENA_WIDTH)`, `hit=true`.
- `dx < 0`: дзеркально, snap до `wrapMod((col+1)*16 + halfW, ARENA_WIDTH)`.
- без hit → `wrapMod(newX, ARENA_WIDTH)`.

`moveAxisY(...)` — вертикальне дзеркало (рядки, `ARENA_HEIGHT`). Обидва загортають фінальну позицію. Свіп tunnel-safe навіть для великих швидкостей.

### Проби

- `isSupported(...)` — solid у рядку `floor((y+halfH+1)/16)` через колонки AABB (ґрунт у межах 1 px під ногами, wrap-aware).
- `isAgainstWall(..., dir)` — solid у пробній колонці на 1 px збоку.

### Розміри хітбоксів (`constants.ts`)

- Гравець: `PLAYER_WIDTH = PLAYER_HEIGHT = 12` → half 6.
- Летюча стріла (тонкий бокс по домінантній осі): `ARROW_HALF_LONG=5`, `ARROW_HALF_SHORT=2`. `arrowHalves()`: якщо `|vx| >= |vy|` → `{hw:5, hh:2}`, інакше `{hw:2, hh:5}`.
- Скриня: `CHEST_WIDTH=10`, `CHEST_HEIGHT=8`.
- `PICKUP_RADIUS=12`, `MUZZLE_IMMUNITY_TICKS=6`, `STOMP_TOLERANCE=8`, `SPAWN_GROUND_TOLERANCE=32`, `MIN_SPAWNS=4`.
- Час: `TICK_RATE=60`, `DT=1/60`.

## Тюнінг (`tuning.ts`)

`parseTuning(data)` валідує й залишає лише sim-ключі (блоки `juice`/`input`/`ui`/`net` ігноруються — їх читають shell і `packages/net`). `deriveTuning(tuning)` один раз конвертує ms → тіки через `msToTicks(ms) = round(ms * 60 / 1000)`, утворюючи `DerivedTuning` (наприклад `coyoteTicks`, `jumpBufferTicks`, `dashTicks`, `dashCooldownTicks`, `wallJumpLockTicks`, `chestIntervalTicks`, `invisibilityTicks`, `flightTicks`, `roundRestartDelayTicks`, `matchRestartDelayTicks`).

Повний перелік sim-ключів і значень — у [Контенті й даних](09-content-and-data.md).

## Події (`events.ts`)

`type KillCause = "arrow" | "stomp" | "bomb";` Кожна подія несе `tick`. Дискримінований union:

```ts
type SimEvent =
  | { tick; type: "round_started" }
  | { tick; type: "arrow_fired"; playerSlot; arrowId; kind: ArrowKind }
  | { tick; type: "arrow_stuck"; arrowId; x; y }
  | { tick; type: "arrow_exploded"; arrowId; x; y }
  | { tick; type: "arrow_picked_up"; arrowId; playerSlot }
  | { tick; type: "player_killed"; victim; killer; cause: KillCause; x; y }
  | { tick; type: "round_ended"; winner: number | "draw" }
  | { tick; type: "match_ended"; winner: number; scores: number[] }
  | { tick; type: "chest_spawned"; chestId; x; y; contents: ChestContents }
  | { tick; type: "chest_opened"; chestId; slot; contents: ChestContents };
```

`player_killed` несе позицію жертви (`x`,`y`), бо в момент споживання події раунд уже міг скинутися. Події — єдиний вихідний канал симуляції.

## Snapshot / restore (`snapshot.ts`)

```ts
interface SimSnapshot {
  version: string;     // SIM_VERSION на момент захоплення
  state: SimState;     // deep clone
  rngState: number;    // uint32 з Rng.getState()
  nextEntityId: number;// наступне значення лічильника id
}
function deepClone<T>(value: T): T
```

- `deepClone` — рукописний структурний клон (об'єкти/масиви/примітиви; без класів/Map/функцій/Date). Примітиви повертаються as-is (бітовий патерн збережено). Рукописний, бо tsconfig sim не має DOM lib (`structuredClone` недоступний), а JSON round-trip відкинуто — він псує `-0`/`NaN`/`Infinity`.
- **Лічильник id** — closure-змінна в `buildSim` (`nextEntityId`, `allocId = () => nextEntityId++`), **не** частина `SimState`. Свіжі sim'и стартують з 1. Доступний лише для snapshot/restore через `getEntityIdCounter()`/`setEntityIdCounter(v)` (сеттер коерсить `v >>> 0`).
- Снапшот **не** зберігає init-константи (arena/tuning/players/friendlyFire) — це контракт сесії, який каллер постачає сам.

Це субстрат для client-side prediction + rollback: знімок на останньому підтвердженому тіку, ре-степ хвоста інпутів.

## Wire-формат (`wire.ts`)

`PROTOCOL_VERSION = 1`. Помилки: `WireFormatError` (обрізане/некоректне) і `ProtocolVersionError(expected, received)`.

### 1-байтове кодування інпуту

`encodeInputByte(input)` / `decodeInputByte(byte)`:

| Біт | Поле |
|---|---|
| 0 | left |
| 1 | right |
| 2 | up |
| 3 | down |
| 4 | jump |
| 5 | shoot |
| 6 | dash |
| 7 | reserved (завжди 0) |

### Varint (unsigned LEB128, арифметична форма)

Експортується, щоб `packages/net` повторно використовував одну реалізацію. Арифметична (`% 128`, `Math.floor(v/128)`, `* scale`), не бітові зсуви — коректна для будь-якого невід'ємного safe-integer (без 32-бітного overflow на великих тіках).

- `writeVarint(out: number[], value)` — кидає `WireFormatError` на негативному/нецілому;
- `readVarint(bytes, offset)` → `{ value, next }` — кидає на обрізаному/занадто довгому.

### Input frame

```ts
interface InputFrame { tick: number; inputs: PlayerInput[]; }
```

`serializeInputFrame(tick, inputs)`: `[varint PROTOCOL_VERSION][varint tick][uint8 playerCount][playerCount input-байтів]`. Кидає, якщо `inputs.length > 255`.

`parseInputFrame(bytes)`: читає version varint (інакше `ProtocolVersionError`), tick varint, uint8 count, тоді `count` байтів.

## Інваріанти, які треба тримати в голові

- Порядок підсистем у `step()`, порядок гравців у `updatePlayer`, порядки ітерацій у pickups/kills/stomps/chests — усі load-bearing.
- **Teams побайтово ідентичні FFA** завдяки `team !== null`-гарду в `spared()` та окремим `endFfaRound`/`endTeamsRound` (golden-лог залежить від цього).
- Усі тюнінг-числа — у `content/tuning.json`; геометрія/час — фіксовані в коді.

Як ці механіки відчуваються та їхні точні алгоритми — у [Геймплеї й механіках](04-gameplay-and-mechanics.md).

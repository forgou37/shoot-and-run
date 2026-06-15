# 12 — Довідник API і глосарій

Швидкий довідник публічних поверхонь кожного пакета. Точні алгоритми — у профільних документах.

## `@shoot-and-run/sim`

```ts
// Фабрики
createSim(config: SimConfig): Sim
createSimFromSnapshot(snapshot: SimSnapshot, config: RestoreConfig): Sim

// Інтерфейс Sim
interface Sim {
  readonly state: Readonly<SimState>;
  step(inputs: readonly PlayerInput[]): SimEvent[];
  setTuning(next: Tuning): void;
  snapshot(): SimSnapshot;
  getEntityIdCounter(): number;
  setEntityIdCounter(value: number): void;
}

// RNG
createRng(seed: number): Rng                  // { next, nextInt, getState, setState }

// Арена
parseArena(data: unknown): ArenaData
isSolid(tiles, col, row): boolean

// Тюнінг
parseTuning(data: unknown): Tuning
deriveTuning(tuning: Tuning): DerivedTuning
msToTicks(ms: number): number                 // round(ms * 60 / 1000)

// Фізика (wrap-aware)
wrapMod(n, m); wrapDelta(d, range); solidAt(arena, col, row)
moveAxisX(...); moveAxisY(...); isSupported(...); isAgainstWall(...)
arrowHalves(arrow): { hw, hh }

// Ввід / wire
emptyInput(): PlayerInput
encodeInputByte(input): number; decodeInputByte(byte): PlayerInput
serializeInputFrame(tick, inputs): Uint8Array; parseInputFrame(bytes): InputFrame
writeVarint(out, value); readVarint(bytes, offset): { value, next }

// Snapshot
deepClone<T>(value: T): T

// Константи
TILE_SIZE=16, ARENA_COLS=20, ARENA_ROWS=15, ARENA_WIDTH=320, ARENA_HEIGHT=240
TICK_RATE=60, DT=1/60, PLAYER_WIDTH=PLAYER_HEIGHT=12, CHEST_WIDTH=10, CHEST_HEIGHT=8
PICKUP_RADIUS=12, MUZZLE_IMMUNITY_TICKS=6, STOMP_TOLERANCE=8
PROTOCOL_VERSION=1, SIM_VERSION="0.0.0"

// Помилки
WireFormatError; ProtocolVersionError(expected, received)
```

## `@shoot-and-run/bots`

```ts
makeBot(opts: { seed, slot, difficulty, arena }): Bot     // { input(state): PlayerInput }
botSeed(matchSeed: number, slot: number): number          // власний PRNG-стрім бота
botTick(state, slot, ctx, memory): PlayerInput            // одна тіка політики
createBotMemory(): BotMemory
parseBotConfig(data): BotConfig
parseBotDifficulty(data, where): BotDifficulty
botDifficulty(config, name): BotDifficulty
BOTS_VERSION = "0.0.0"
```

## `@shoot-and-run/net`

```ts
// Транспорт (інтерфейси)
interface Transport { id; send(data); onMessage(h); onClose(h); close() }
interface TransportServer { onConnection(h); close() }

// Codec
encodeMessage(msg: NetMessage): Uint8Array
decodeMessage(bytes: Uint8Array): NetMessage
// теги: input=0, authoritative=1, snapshot=2, ack=3, hello=4

// Хост
createHostRuntime(config): HostRuntimeHandle   // step(): boolean, ready, snapshot()
HostSession(config): HostSessionHandle         // receiveInput, step, snapshot

// Клієнт
new ClientSession(config): {
  tick(localInput): SimEvent[]; ready; confirmedTick; predictedTick;
  predictedState(); snapshotConfirmed(); close()
}
RollbackController(config): { predict, confirm, resync, predictedState, ... }
ClockSync(smoothing?, maxPending?): { onSend, onAck, synced, estimateHostTick, targetTick }

// Тести/loopback
new LoopbackNetwork(opts: { seed, latencyTicks?, jitterTicks?, lossRate? })
  // .advance(tick), .server, .now, .dropped

// Params
parseNetParams(tuning): NetParams   // inputDelayTicks, snapshotIntervalTicks, maxRollbackTicks, jitterBufferTicks
NET_VERSION = "0.0.0"
```

## `@shoot-and-run/game` (shell, ключові поверхні)

```ts
// Цикл
class FixedStepDriver { advance(deltaMs, step): number /* alpha */ }
TICK_MS = 1000 / 60

// Ввід
interface InputDevice { id; kind; connected; sample(): PlayerInput; pausePressed(): boolean }
class KeyboardInput; class DeviceManager; class EdgeReader
readStandardGamepad(pad, deadzone): PlayerInput
parsePlayersConfig(json); parseInputSettings(json); parseUiSettings(json)

// Рендер
class ArcherRenderer; recolorArcherTexture(scene, slot, color)
class ArrowRenderer; class EnvironmentRenderer; class CardOverlay
cardImageUrl(slotName): string

// Шрифт / juice
loadFont(): Promise<void>; buildPixelFont(scene); addPixelText(scene, x, y, text, sizePx, color, opts)
parseJuice(json): JuiceConfig

// Net (browser)
class WebSocketTransport implements Transport

// Сцени: BootScene, TitleScene, LobbyScene, ArenaScene, OnlineArenaScene
// window.__testApi: getPhase, getState, getEvents, setManual, stepTicks, getSpriteProbe,
//                   getNetProbe, getConfirmedHashAt
```

## URL-параметри

| Параметр | Дія |
|---|---|
| `?quickstart=1` | матч 2 клавіатури FFA |
| `?bots=N&difficulty=easy\|normal\|hard` | людина проти N (1–3) ботів |
| `?online=ws://host:port` / `?online=1` | онлайн-клієнт (1 → `ws://<hostname>:8787`) |
| `?rects=1` | дебаг-рендер кольоровими прямокутниками |

## Wire-формати (швидко)

**1-байт input:** біт 0 left, 1 right, 2 up, 3 down, 4 jump, 5 shoot, 6 dash, 7 reserved.

**Input frame:** `[varint VERSION][varint tick][u8 count][count байтів]`.

**Net message:** `[uvarint VERSION][u8 tag][payload]`.

## Глосарій

| Термін | Значення |
|---|---|
| **tick** | один крок симуляції 60 Гц; симуляція не знає wall-clock |
| **sim** | чисте детерміноване ядро (`packages/sim`) |
| **shell** | Phaser-обгортка: рендер + ввід (`packages/game`) |
| **wrap / тор** | загортання екрана на всіх 4 краях |
| **quiver** | сагайдак — `ArrowKind[]`, стріляється з фронту |
| **stomp** | вбивство стрибком згори |
| **muzzle immunity** | 6 тіків, протягом яких власна стріла не вбиває власника |
| **coyote time** | вікно після сходу з платформи, у яке ще можна стрибнути |
| **jump buffer** | натиск стрибка трохи раніше приземлення спрацює |
| **jump cut** | відпускання стрибка обрізає висоту (`jumpCutFactor`) |
| **wall slide / wall jump** | сповзання по стіні / відскок під 45° |
| **dash** | короткий швидкий ривок, скасовується стрибком |
| **flap** | повітряний імпульс під power-up flight |
| **golden log** | еталонний лог подій (`golden-bot-round.json`) / хешів стану (`golden-state-hashes.json`) |
| **deepClone** | рукописний DOM-free структурний клон стану |
| **confirmed sim** | клієнтська sim на авторитетних інпутах (== хост) |
| **predicted sim** | спекулятивна sim попереду, repeat-last здогад |
| **rollback** | re-sim від confirmed-знімка при misprediction |
| **repeat-last** | здогад/fill: повторити останній відомий інпут |
| **host-authoritative** | хост — єдине джерело правди стану |
| **clock sync** | оцінка тіка хоста з ack-RTT для націлювання інпуту |
| **FFA / Teams** | вільний бій / 2v2 з friendly-fire-перемикачем |
| **best-of-N** | `roundsToWin` раундів для перемоги в матчі |
| **exposure mask** | автотайлінг: вибір варіанта тайла за відкритими сусідами |
| **MatchConfig** | roster (slot+device+team), що лобі передає матчу |
| **AppContext** | app-wide сінглтони в Phaser-реєстрі (DeviceManager, keyboard, slots, botConfig) |

## Куди йти далі

- Розуміння правил гри → [03 Ядро симуляції](03-simulation-core.md) + [04 Геймплей](04-gameplay-and-mechanics.md)
- Робота над онлайном → [05 Netcode](05-netcode.md)
- Робота над візуалом/сценами → [06 Рендеринг](06-rendering-and-graphics.md)
- Додати арену/тюнінг → [09 Контент і дані](09-content-and-data.md)
- Налаштувати CI/деплой → [10 Збірка, тести, деплой](10-build-test-deploy.md)
- Що далі по плану → [11 Дорожня карта й рішення](11-roadmap-and-decisions.md)

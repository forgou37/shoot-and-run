# 08 — Боти й AI (`packages/bots`)

Чистий headless-пакет, що імпортує лише `@shoot-and-run/sim`. Бот подається матчу як `InputDevice` (`BotDevice`, `kind:"bot"`), чий `sample()` крутить heuristic-політику `(state, slot, ctx) → PlayerInput` над живим `sim.state`. Симуляція, kills, rounds, teams — недоторкані. Чистота enforced правилом `bots-purity`.

## Чому боти — поза симуляцією

Боти **читають** стан і **виробляють** ввід — тобто вони чисті споживачі стану на наявному device-seam. Тому вони не належать симуляції: правила не змінюються, детермінізм збережено, а heuristic-політика — рівно те, що кликатиме майбутній eval-пайплайн (спека 005). Кожен бот володіє власним mulberry32 `botSeed(matchSeed, slot)` (**ніколи** не PRNG симуляції — інакше десинхронізував би спавн скринь), тож бот-матчі лишаються replayable.

## Контракти (`types.ts`)

```ts
interface BotDifficulty {           // дані з content/bots.json
  reactionDelayTicks: number;       // переоцінювати ціль/загрозу раз на N тіків
  aimTolerance: number;             // перпендикулярний допуск (px) для «прицілився»
  aimErrorChance: number;           // [0,1] шанс схибити постріл
  dodgeChance: number;              // [0,1] шанс зреагувати на вхідну стрілу
  dashChance: number;               // [0,1] шанс витратити dash
}
interface BotContext { rng: Rng; difficulty: BotDifficulty; arena: ArenaData; }
interface BotMemory {               // мутабельний scratch між тіками
  decisionTicksLeft; targetSlot: number|null; wasThreatened; 
  dodgeTicksLeft; dodgeDir: 1|-1; fireCooldownLeft;
  prevJumpOut; prevShootOut; prevDashOut;   // rising-edge латчі
}
type BotPolicy = (state, slot, ctx, memory) => PlayerInput;
interface Bot { input(state): PlayerInput; }
```

## Перцепція (`sense.ts`) — уся wrap-aware

| Примітив | Що дає |
|---|---|
| `wrapVecTo(from, to)` | найкоротший знаковий `{dx,dy}` на торі |
| `findSelf(state, slot)` | власний `PlayerState` |
| `opponentsOf(me, state)` | живі не-я й (у teams) не-тіммейти |
| `nearestOpponent(me, opponents)` | найближчий за квадратом wrap-дистанції |
| `nearestPickup(me, state)` | найближча `stuck`-стріла або скриня |
| `nearestThreat(me, state)` | найімовірніша вхідна стріла: проєкція по швидкості, time-to-closest-approach `t = (r·v)/|v|²`, утримати якщо `0 ≤ t ≤ THREAT_HORIZON_S` і miss² ≤ `THREAT_RADIUS_PX²` |
| `moveToward(input, me, targetX)` | ставить left/right до wrap-цілі |
| `aimAt(me, tx, ty, tolerance)` | резолвить 8-напрямне прицілювання; `aligned` коли ціль у `tolerance` від променя (діагональ при `\|adx-ady\| ≤ tolerance`) |
| `faceAndFire(...)` | тримає напрямні клавіші на ціль; повертає, чи варто стріляти (aligned + `dist ≤ range`); shoot **не** тисне (cooldown на каллері) |
| `stompTargetBelow(me, opponents)` | опонент знизу для stomp'у |

## Стек поведінки (`bot.ts`)

`botSeed(matchSeed, slot) = (matchSeed ^ ((slot+1) * 0x9e3779b1)) >>> 0`.

`botTick(state, slot, ctx, mem)` — один тік рішень:

1. Мертвий/відсутній → `emptyInput()`, очистити edge/dodge.
2. Декремент `fireCooldownLeft`, `decisionTicksLeft`. Переобрати ціль лише коли `decisionTicksLeft <= 0` (тоді reset до `max(1, round(reactionDelayTicks))`) — **це і є реакційна затримка**.
3. **Пріоритетний стек:**
   - **1. Dodge (найвищий):** на rising-edge загрози (`!wasThreatened`) і `rng.next() < dodgeChance` — закомітити `DODGE_TICKS` ухилення геть. Під час dodge: стерувати геть; на землі — `wantJump` (перестрибнути горизонтальний постріл); у повітрі — `rng.next() < dashChance` → `wantDash` (повітряний джюк).
   - **2a. Engage** (є стріли + ціль): `faceAndFire`; якщо не вирівняний або `gap > PREFERRED_RANGE_PX` — `moveToward` ціль і (якщо `gap > DASH_CLOSE_RANGE_PX` + dash готовий + `rng < dashChance`) `wantDash`. Стрибок якщо ціль вище або стіна попереду. Стріляти коли `lined && fireCooldownLeft===0 && rng.next() >= aimErrorChance`.
   - **2b. Scavenge** (немає стріл/цілі): stomp-ціль знизу → зависнути над нею; інакше без стріл → йти до `nearestPickup` (стрибок якщо вище); інакше переслідувати ціль. Перестрибувати стіни.
4. **Конвертація в rising-edge:** `out.jump/shoot/dash` тиснуться лише на перехід want false→true. На shoot — `fireCooldownLeft = FIRE_COOLDOWN_TICKS`. Латчити prev*.

`makeBot({seed, slot, difficulty, arena})` → `{ input: state => botTick(...) }` з `createRng(seed)` + `createBotMemory()`.

## Структурні константи (`constants.ts`)

Не виставлені як дані (це структура поведінки, не геймфіл): `FIRE_RANGE_PX=90`, `PREFERRED_RANGE_PX=48`, `VERTICAL_REACH_PX=20`, `THREAT_HORIZON_S=0.35`, `THREAT_RADIUS_PX=16`, `FIRE_COOLDOWN_TICKS=16`, `DODGE_TICKS=14`, `DASH_CLOSE_RANGE_PX=120`.

## Складності (`content/bots.json` + `config.ts`)

| Пресет | reactionDelayTicks | aimTolerance | aimErrorChance | dodgeChance | dashChance |
|---|---|---|---|---|---|
| **easy** | 16 | 12 | 0.5 | 0.1 | 0.05 |
| **normal** | 8 | 7 | 0.2 | 0.5 | 0.25 |
| **hard** | 3 | 4 | 0.03 | 0.9 | 0.5 |

Складніший бот = нижчі reaction/tolerance/error, вищі dodge/dash.

`parseBotDifficulty` валідує: `reactionDelayTicks` ціле `>= 1`; `aimTolerance > 0`; три chance-ключі — кінцеві в `[0,1]`. Кидає точні `bots: <where>.<key> ...`. `parseBotConfig` вимагає `{ difficulties: Record<string, BotDifficulty> }` з `>= 1` пресетом. `botDifficulty(config, name)` — lookup, кидає на невідомому.

## Тестування

- `sense.test.ts` (~16) — wrap-перцепція, виключення self/dead/teammate, aim горизонталь/вертикаль/діагональ.
- `behavior.test.ts` (~8) — engage стріляє при вирівнюванні; `aimErrorChance=1` придушує; dodge стрибає при `dodgeChance=1`; scavenge йде до pickup; реакційне кешування цілі.
- `config.test.ts` — приймає shipped-конфіг; 10 поганих конфігів кидають `/^bots:/`.
- `bot-match.test.ts` (5) — побайтово ідентичний раунд між прогонами; детермінований на arena-001; повний best-of-N до `match_ended`; кожна складність завершує раунд; пакет залежить лише від sim.

Боти також драйвлять golden-bot-round (sim-фікстура): `hunterBot` + `patrolBot` грають раунд на seed `0xbada55`, лог подій еталонний.

## Майбутнє: eval-пайплайн (спека 005)

Headless `run-rounds --arena X --bots A,B --rounds N --seed S` → JSONL-логи подій + статистика. Це субстрат eval-харнесу AI-генератора арен: для кожної кандидат-арени — N раундів різними сідами/парами ботів, тоді метрики балансу (розподіл вбивств по спавнах, довжина раунду, draw-rate, покриття мапи, економіка стріл) + LLM-as-judge. Боти спеціально спроєктовані як чисті state→input-політики саме для цього.

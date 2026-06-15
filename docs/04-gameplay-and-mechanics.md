# 04 — Геймплей і механіки

Цей документ описує кожну ігрову механіку з двох боків: як вона **відчувається** і як саме **реалізована** в `packages/sim`. Усі числа — ключі з `content/tuning.json` (поточні значення наведено в дужках).

## Рух гравця (`player.ts`)

`HALF_W = HALF_H = 6`. `updatePlayer(p, input, arena, t)` мутує гравця на місці. Порядок операцій усередині тіка — частина контракту детермінізму:

1. **Краї інпуту:** `jumpPressed = jump && !prevJumpHeld`; `jumpReleased = !jump && prevJumpHeld`; `dashPressed = dash && !prevDashHeld`. На `jumpPressed` → `jumpBufferTicksLeft = t.jumpBufferTicks` (**jump buffering**).
2. **Напрямок погляду:** `dir = (right?1:0) - (left?1:0)`; якщо `dir !== 0` → `facing = dir`.
3. **Старт dash'у:** якщо `dashPressed && dashTicksLeft===0 && dashCooldownTicksLeft===0` → `dashTicksLeft = t.dashTicks`, `dashDir = dir || facing`.
4. **Швидкість / гравітація / wall-slide:**
   - **під час dash:** `vx = dashDir * t.dashSpeed`, `vy = 0` (гравітація призупинена, плаский ривок);
   - інакше якщо **на землі:** `vx = dir * t.runSpeed` (миттєвий розгін/зупинка — щільно);
   - інакше в повітрі, `dir !== 0` і `wallJumpLockTicksLeft === 0`: **air control** `vx += dir * t.airAccel * DT`, клемп до `±t.runSpeed`;
   - у повітрі: гравітація `vy += t.gravity * DT`, клемп до `t.maxFallSpeed`. **Wall slide:** якщо `vy > t.wallSlideSpeed && dir !== 0 && isAgainstWall(...,dir)` → `vy = t.wallSlideSpeed`.
5. **Стрибок** (лише якщо `jumpBufferTicksLeft > 0`):
   - `groundJump = grounded || coyoteTicksLeft > 0`;
   - `wallJump = !groundJump && dir !== 0 && isAgainstWall(...,dir)`;
   - якщо `groundJump || wallJump || flightTicksLeft > 0`:
     - **wall-jump (45°):** `vx = -dir * t.wallJumpSpeed`, `vy = -t.wallJumpSpeed` (рівні компоненти → 45°), `facing = -dir`, `wallJumpLockTicksLeft = t.wallJumpLockTicks`;
     - інакше `vy = groundJump ? -t.jumpVelocity : -t.flapVelocity` (**flap** у повітрі з активним flight);
     - очистити grounded, `coyoteTicksLeft=0`, `jumpBufferTicksLeft=0`. `jumpCutAvailable = groundJump || wallJump` (flap **не** обрізається);
     - стрибок **скасовує dash:** якщо `dashTicksLeft>0` → обнулити й завести `dashCooldownTicksLeft`;
   - пріоритет: ground/coyote > wall > flap.
6. **Jump cut (змінна висота):** якщо `jumpReleased && vy < 0 && jumpCutAvailable` → `vy *= t.jumpCutFactor`, очистити прапорець.
7. **Інтеграція X:** `moveAxisX(...,vx*DT)`; якщо hit → `vx=0`.
8. **Інтеграція Y:** `moveAxisY(...,vy*DT)`; `landed = hit && vy > 0`; якщо hit → `vy=0`.
9. **Grounded / coyote-бухгалтерія:**
   - `supported = vy >= 0 && isSupported(...)`; `grounded = landed || (grounded && supported)`;
   - якщо grounded → обнулити coyote й wallJumpLock;
   - інакше якщо `wasGrounded && !jumpedThisTick` (**зійшов з краю**): якщо не dash → обнулити `vx` (падіння прямо вниз, без параболічного перенесення; air control/dash далі стерують), `coyoteTicksLeft = t.coyoteTicks`;
   - інакше декремент coyote.
10. **Таймери dash;** декремент `jumpBufferTicksLeft`, `wallJumpLockTicksLeft`, `invisibleTicksLeft`, `flightTicksLeft`.
11. Зберегти `prevJumpHeld`, `prevDashHeld` (`prevShootHeld` оновлюється в `handleShooting`).

### Механіки відчуття керування

| Механіка | Що дає гравцеві | Ключі тюнінгу |
|---|---|---|
| **Variable jump** | тап = низький стрибок, утримання = високий | `jumpVelocity` (260), `jumpCutFactor` (0.4) |
| **Coyote time** | можна стрибнути ще кілька тіків після сходу з платформи | `coyoteTimeMs` (80) |
| **Jump buffer** | натиск стрибка трохи раніше приземлення спрацює | `jumpBufferMs` (100) |
| **Air control** | керування в повітрі з обмеженим розгоном | `airAccel` (600), клемп `runSpeed` (100) |
| **Wall slide** | сповільнене сповзання при притисканні до стіни | `wallSlideSpeed` (40) |
| **Wall jump** | відскок під 45° від стіни, розворот обличчям | `wallJumpSpeed` (240), `wallJumpControlLockMs` (150) |
| **Dash** | короткий швидкий ривок, ground або air, скасовується стрибком | `dashSpeed` (300), `dashDurationMs` (130), `dashCooldownMs` (450) |
| **Straight-down edge fall** | хода з краю (без стрибка) гасить горизонталь | — |
| **Gravity/fall cap** | передбачуване падіння | `gravity` (900), `maxFallSpeed` (240) |

**Чому wall-jump-lock потрібен:** без `wallJumpControlLockMs` air-control-клемп за один тік повернув би горизонтальну швидкість запуску до `runSpeed` і сплющив би дугу до майже вертикальної. Lock призупиняє air control (але не гравітацію — парабола лишається), щоб 45° реально читалися на екрані.

## Стрільба і стріли (`arrow.ts`)

### Постріл — `handleShooting(...)`

Для кожного **живого** гравця на rising-edge `shoot` (`shoot && !prevShootHeld`; `prevShootHeld` оновлюється тут щотіка). No-op якщо не натиснуто або `quiver.length === 0`.

- **8-напрямне прицілювання** з утримуваних клавіш у момент пострілу: `dirX = right-left`, `dirY = down-up`. Якщо обидва 0 → `(facing, 0)`. Інакше нормалізація на `sqrt(dirX²+dirY²)`.
- `kind = quiver.shift()` (фронт сагайдака). Стріла з'являється в центрі гравця, `vx=nx*t.arrowSpeed`, `vy=ny*t.arrowSpeed`. `bouncesLeft = kind==="bounce" ? t.arrowBounceCount : 0`. `firedTick = tick`, `phase = "flying"`.
- Емітить `arrow_fired { playerSlot, arrowId, kind }`.

### Політ — `updateArrows(...)` (лише `phase==="flying"`)

- **laser** → окремий `updateLaser`.
- решта: **arrow gravity** `vy += t.arrowGravity * DT`, тоді свіп X, тоді Y:
  - **normal:** на тайл-hit → `stick`;
  - **bomb:** на tile-hit → `phase = "exploding"` (розв'язується цього ж тіка); не встромляється;
  - **bounce:** на hit, якщо `bouncesLeft > 0` → відбити вісь (`vx=-vx`/`vy=-vy`), декремент; інакше `stick`.
- `stick(a)`: `phase="stuck"`, обнулити швидкість, емітить `arrow_stuck { arrowId, x, y }`.

### Laser — `updateLaser(...)`

Рух без гравітації; семпл solidity центром:

- якщо `pierced` → встромляється на наступному solid (другий бар'єр);
- інакше якщо `insideSolid && !solidNow` → `pierced=true` (вийшов з першого);
- інакше якщо `solidNow` → `insideSolid=true` (увійшов у перший).

Тобто проходить наскрізь перший суцільний бар'єр і встромляється у другий.

### Підбір — `collectPickups(...)`

Для кожної `stuck`-стріли перший живий гравець (за індексом) у межах `PICKUP_RADIUS` (12, wrap-aware, порівняння квадратів) підбирає: `quiver.unshift(a.kind)` (**вид збережено** — встромлений laser повертається лазером), емітить `arrow_picked_up`, стріла зникає.

### Огляд видів стріл

| Вид | Поведінка | Колір (рендер) |
|---|---|---|
| **normal** | встромляється в стіну, підбирається | `0xf0e6c8` |
| **bomb** | вибухає при контакті з тайлом/тілом, радіус `bombRadiusPx` (28) | `0xff5252` |
| **laser** | пробиває перший бар'єр, без гравітації, **пронизує гравців** (continue, не встромляється на тілі) | `0x40e8ff` |
| **bounce** | відбивається `arrowBounceCount` (5) разів, тоді встромляється | `0xffd740` |

`arrowSpeed` (350), `arrowGravity` (180).

## Вбивства (`kills.ts`)

### Friendly-fire гард

```ts
spared(friendlyFire, teamA, teamB) = !friendlyFire && teamA !== null && teamA === teamB;
```

`teamA !== null`-гард означає, що FFA-шляхи лишаються побайтово ідентичними (у FFA команди null → вбивства ніколи не «щадяться»).

### `checkArrowKills(...)` (летючі стріли)

Для кожної стріли × кожен **живий** гравець:

- skip self, поки `tick - firedTick < MUZZLE_IMMUNITY_TICKS` (6); після цього власна стріла може вбити власника;
- overlap: `|dx| < hw+6 && |dy| < hh+6` (wrap-aware);
- якщо `spared` → тіммейт, пролітає;
- **bomb** на контакті з тілом → `phase="exploding"`, break (радіус-вбивство цього тіка, жертва включена);
- інакше `alive=false`, емітить `player_killed { cause:"arrow" }`:
  - **laser:** `continue` (пронизує, скан далі, не встромляється);
  - інші: стріла стає `stuck`, емітить `arrow_stuck`, break.

### `resolveExplosions(...)` (`phase==="exploding"`)

Емітить `arrow_exploded`. Для кожного живого гравця, що **не** `spared` (щадить тіммейтів **і себе**, коли FF off): у межах `t.bombRadiusPx` → вбивство `cause:"bomb"` (**без muzzle-immunity** — стрілець включений у FFA). Тоді `phase="spent"`.

### `checkStomps(...)`

Для кожної впорядкованої пари (attacker, victim), обидва живі, різні:

- потрібен відносний рух униз: `attacker.vy - victim.vy > 0`;
- горизонтальний overlap: `|wrapDelta(attacker.x - victim.x, W)| < PLAYER_WIDTH` (12);
- вертикальна смуга: `feetToHead = wrapDelta(attacker.y+6 - (victim.y-6), H)` у `[0, STOMP_TOLERANCE]` (0..8). Бічний overlap — ніколи не вбивство;
- якщо не `spared` → вбивство `cause:"stomp"` (тіммейт-stomp з FF off — голови стають платформами);
- у будь-якому разі **bounce:** `attacker.vy = -t.stompBounceVelocity` (180), очистити grounded/coyote/jumpCutAvailable.

## Скрині (`chest.ts`)

Пул вмісту (рівні ваги): `["bomb","laser","bounce","invisibility","flight"]`.

`updateChests(...)`:

- no-op, якщо арена без `chestSpots`;
- **спавн:** коли `state.tick >= state.nextChestTick`:
  - якщо `chests.length < t.maxChestsAlive` (2), обчислити вільні споти (без наявної скрині на тих x,y); якщо є — обрати `free[rng.nextInt(free.length)]`, `contents = POOL[rng.nextInt(POOL.length)]`, пушнути, емітити `chest_spawned`;
  - завжди переплан: `nextChestTick = tick + t.chestIntervalTicks` (8000 ms);
- **відкриття (дотик):** перший живий гравець, чий AABB перекриває (`|dx| < 11`, `|dy| < 10`, wrap-aware), миттєво відкриває: `grant(...)`, емітить `chest_opened`, скриня зникає.

`grant(p, contents, t)`:

- `bomb`/`laser`/`bounce`: `unshift` цей вид `t.specialArrowsPerChest` (3) разів на фронт сагайдака;
- `invisibility`: `p.invisibleTicksLeft = t.invisibilityTicks` (10000 ms);
- `flight`: `p.flightTicksLeft = t.flightTicks` (10000 ms).

> Зверни увагу: специфікація **014** змінює це на двокроковий потік (скриня → плаваючий бустер, який треба зловити в повітрі) + додає shield. Це ще не реалізовано в коді. Див. [Дорожню карту](11-roadmap-and-decisions.md).

## Power-up'и

- **Invisibility** (`invisibleTicksLeft`): чистий таймер у `PlayerState`. Сама симуляція на нього не розгалужується — це косметика (рендер ховає архера на `juice.invisibilityOpacity`).
- **Flight / flap** (`flightTicksLeft`): поки > 0, кожен `jumpPressed` у повітрі (з буфером) дає імпульс `-t.flapVelocity` (220). З землі — звичайний стрибок. Flap'и не jump-cut'аються.

Обидва скидаються в 0 при ресеті раунду.

## Раунд і матч (`round.ts`)

`updateRound(...)` працює щотіка. `teamsMode = match.teamScores !== null`.

**Поки `running`** — обчислити живих, визначити `roundOver`:

- **FFA:** `alive.length === 0 || (players.length > 1 && alive.length <= 1)`;
- **Teams:** `alive.length === 0 || alive.every(p => p.team === alive[0].team)`;
- якщо завершено: `phase="ended"`, `endFfaRound`/`endTeamsRound`, тоді `restartTicksLeft = match.winner !== null ? matchRestartDelayTicks : roundRestartDelayTicks`.

**`endFfaRound`:** `winner = alive.length===1 ? alive[0].slot : "draw"`, емітить `round_ended`. Якщо не draw → `match.scores[idx]++`; якщо `>= roundsToWin` (3) → `match.winner`, емітить `match_ended`. (Побайтово ідентично pre-teams-логіці — golden-лог залежить.)

**`endTeamsRound`:** `winner = alive.length===0 ? "draw" : alive[0].team`. Кожен вцілілий тікає індивідуальний `match.scores[idx]`. Якщо не draw → `teamScores[winner]++`; якщо `>= roundsToWin` → `match.winner = winner` (id команди), `match_ended`.

**Поки `ended`** — декремент `restartTicksLeft`; коли `<= 0`:

- якщо `match.winner !== null` (матч завершено → новий матч): обнулити `scores`, `teamScores` → `[0,0]` якщо teams, очистити `match.winner`, `round.number = 0`;
- `resetPlayer(...)` для всіх (спавн за індексом гравця), очистити `arrows` й `chests`, `nextChestTick = tick + chestIntervalTicks`, `phase="running"`, `round.winner=null`, `round.number++`, емітить `round_started`.

`resetPlayer` відновлює спавн x/y, обнуляє швидкість, `facing=1`, сагайдак з `startingArrows` (3) normal-стріл, `alive=true` й обнуляє кожне транзієнтне поле/таймер.

| Ключ | Значення | Сенс |
|---|---|---|
| `startingArrows` | 3 | стартовий сагайдак |
| `roundsToWin` | 3 | best-of-N |
| `roundRestartDelayMs` | 1500 | пауза між раундами |
| `matchRestartDelayMs` | 4000 | пауза в кінці матчу |
| `chestIntervalMs` | 8000 | інтервал спавну скринь |
| `maxChestsAlive` | 2 | максимум живих скринь |
| `specialArrowsPerChest` | 3 | спецстріл за скриню |

## Загортання екрана (тор)

Усе wrap-aware: рух (`moveAxisX/Y`), колізія (`solidAt` через `wrapMod`), підбір/вбивства/stomp (`wrapDelta`), спавн скринь, а в рендері — інтерполяція (`lerpWrapped`) і дзеркала спрайтів. Сутність біля краю стикається з протилежним боком арени й може одночасно бути видимою з двох сторін.

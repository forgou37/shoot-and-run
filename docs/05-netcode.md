# 05 — Netcode (онлайн-мультиплеєр)

Host-authoritative rollback-netcode (специфікації 008–010). `packages/net` — чистий і headless: може імпортувати лише `@shoot-and-run/sim`, нічого з Phaser/DOM (enforced правилом `net-purity`). Єдині «брудні» шари — браузерний `WebSocketTransport` і `ws`-адаптер хоста — живуть **поза** пакетом.

## Чому rollback (а не lockstep чи snapshot-interpolation)

Детермінована, input-driven, fixed-timestep симуляція робить rollback майже безкоштовним і **точним** — саме те, що треба для вбивства з одного влучання. Host authority поглинає будь-яку float-розбіжність (тож fixed-point не потрібен). У симуляції немає трансцендентних функцій (лише IEEE-коректно-округлений `Math.sqrt`), тож вона майже напевно cross-machine детермінована — і це доведено headless ще у фазі 008, до появи будь-якого транспорту.

Відкинуто: snapshot-interpolation без prediction (мильно, додає лаг вводу); P2P deterministic lockstep (не пасує dedicated-хостингу, стопориться на найповільнішому пірі).

## Модель: confirmed + predicted

Кожен клієнт веде **дві** симуляції:

- **confirmedSim** — годується **лише** авторитетними інпутами хоста, по порядку. За детермінізмом її стан на тіку T побайтово рівний стану хоста на T. Ground truth, ніколи не спекулятивна.
- **predictedSim** — біжить попереду: локальний інпут застосовується миттєво, віддалені інпути вгадуються через **repeat-last**. На авторитетному повідомленні або дешево підтверджує (здогад збігся), або відкочується до confirmed-знімка й ре-симулює вперед. Видима корекція стається **лише** коли віддалений інпут реально відрізнявся від здогаду.

```
host:        ──tick──tick──tick──►  (авторитетний, repeat-last fill)
                │ broadcast: authoritative + periodic snapshot + ack
                ▼
client confirmed: ──replay авторитетних інпутів── (== host побайтово)
client predicted: ──── біжить попереду на inputDelay, repeat-last здогад ────►
                        ▲ rollback + re-sim лише при misprediction
```

## Transport / TransportServer seam (`transport.ts`)

Лише інтерфейс. Датаграми **можуть губитися й переупорядковуватися** — rollback це толерує, тож реалізації не зобов'язані бути reliable/ordered. Зіркова топологія.

```ts
interface Transport {
  readonly id: string;
  send(data: Uint8Array): void;
  onMessage(handler: (data: Uint8Array) => void): void;  // єдиний handler
  onClose(handler: () => void): void;
  close(): void;
}
interface TransportServer {
  onConnection(handler: (transport: Transport) => void): void;
  close(): void;
}
```

## Протокол повідомлень (`protocol.ts`)

```ts
interface HelloMessage { type:"hello"; slot; seed; playerCount; arenaId }   // Host→Client, раз на конекті
interface InputMessage { type:"input"; tick; input: PlayerInput }            // Client→Host
interface AuthoritativeInputsMessage { type:"authoritative"; tick; inputs: PlayerInput[] }  // Host→Client, slot order
interface SnapshotMessage { type:"snapshot"; snapshot: SimSnapshot }         // Host→Client, періодичний
interface AckMessage { type:"ack"; tick; inputTick }                          // Host→Client, RTT/clock
type NetMessage = HelloMessage | InputMessage | AuthoritativeInputsMessage | SnapshotMessage | AckMessage;
```

`inputTick` у ack — ключовий механізм: ack відлунює тік підтвердженого інпуту, тож клієнт парує ack↔send за цим тіком (а не за порядком прибуття).

## Wire-codec (`codec.ts`)

Фреймінг: `[uvarint PROTOCOL_VERSION][uint8 tag][payload]`.

| Тип | Tag | Payload |
|---|---|---|
| input | `0` | `[uvarint tick][input-байт]` |
| authoritative | `1` | `[uvarint tick][uvarint count][count input-байтів]` |
| snapshot | `2` | `[uvarint utf8Len][utf8(JSON.stringify(snapshot))]` |
| ack | `3` | `[uvarint tick][uvarint inputTick]` |
| hello | `4` | `[uvarint slot][uvarint seed][uvarint playerCount][uvarint len][utf8(arenaId)]` |

- **Повторне використання sim-хелперів:** `PROTOCOL_VERSION` (1), `ProtocolVersionError`, `WireFormatError`, `encodeInputByte`/`decodeInputByte`, `writeVarint`/`readVarint` — одна реалізація wire, не дві (security-review замінив приватну копію varint на експорт із sim).
- Локальний — лише DOM-free UTF-8 кодек (`encodeUtf8`/`decodeUtf8`), бо sim не має `TextEncoder`/`TextDecoder`.
- `decodeMessage` спершу читає version varint (інакше `ProtocolVersionError`), тоді tag, кожна гілка bounds-checks довжини й кидає `WireFormatError` на обрізаному/невідомому tag.
- **Валідація снапшота (захист від untrusted input):** JSON парситься в try/catch, тоді `assertSnapshotShape(snap)` (перевіряє: top-level об'єкт; `state` об'єкт; `state.tick` кінцеве число; `state.players` масив; `rngState`/`nextEntityId` кінцеві) **до** того, як снапшот сягне `resync`. Це не дає засіяти клієнтський sim із `NaN`/відсутніми полями.
- **JSON-застереження:** payload снапшота — JSON, що коерсить `-0`/`NaN`/`Infinity`. Безпечно сьогодні лише тому, що cross-engine guard уже хешує `JSON.stringify` снапшотів — тобто стан **зобов'язаний** лишатися JSON-стабільним.

## LoopbackNetwork (`loopback.ts`) — детерміністичний тестовий транспорт

In-process реалізація seam з seeded latency/jitter/loss, керована **явним** віртуальним годинником (без wall-time).

```ts
interface LoopbackOptions { seed; latencyTicks?; jitterTicks?; lossRate? }
```

- PRNG = `createRng(opts.seed)` (mulberry32 як утиліта). Той самий seed + та сама послідовність send'ів ⇒ ідентичний розклад доставки.
- `_enqueue`: loss-drop із `rng.next() < loss`; `delay = latency (+ симетричний U[-jitter,+jitter])`; `deliverTick = max(nowTick+1, nowTick+delay)` — датаграма **ніколи** не приходить у минуле чи тим самим тіком.
- `advance(toTick)`: доставляє все з `deliverTick <= toTick`, відсортоване за `(deliverTick, seq)` — детерміністичний порядок.

Модель використання: `кожен тік: net.advance(tick)`.

## HostSession (`host.ts`) — авторитетний цикл

Володіє канонічним sim. Чистий/headless: крокується явним `step()`, шле вихідні датаграми через інжектований `send(clientId, data)`. Без таймерів і DOM.

Стан: `sim = createSim(...)`, `slotByClient`, `buffer: Map<tick, (PlayerInput|undefined)[]>` (per-(tick,slot) буфер), `lastInput[]` (джерело repeat-last), `committedTick`, `lateDropped`.

- **`receiveInput(clientId, tick, input)`:** якщо `tick < committedTick` → `lateDropped++` (тік уже авторитетний). Інакше записати в буфер `row[slot] = input`. **Завжди** шле ack `{type:"ack", tick: committedTick, inputTick: tick}`.
- **`step()`** — авторитетний тік:
  ```ts
  const t = committedTick;
  const row = buffer.get(t);
  for (let slot = 0; slot < playerCount; slot++) {
    const used = row?.[slot] ?? lastInput[slot];   // repeat-last fill
    inputs.push(used); lastInput[slot] = used;
  }
  sim.step(inputs);
  broadcast({ type:"authoritative", tick:t, inputs });
  if (t % snapshotIntervalTicks === 0) broadcast({ type:"snapshot", snapshot: sim.snapshot() });
  buffer.delete(t); committedTick = t + 1;
  ```
- **`broadcast`** кодує **один раз** і шле ті самі байти всім клієнтам.

**Авторитетність:** хост ніколи не стопориться в очікуванні вводу — відсутнє repeat-last-fill'иться детерміновано, sim крокує, і обрані хостом інпути транслюються як єдине джерело правди. Вікно input-delay живе на **клієнті** (він тегує інпут на близький майбутній тік, щоб встигнути до коміту).

## HostRuntime (`host-runtime.ts`) — менеджмент з'єднань

Обгортає `HostSession` менеджментом з'єднань. Transport-agnostic, керується явним `step()`.

- **Валідація на init:** `expectedClients` — ціле в `[1, playerCount]`; **щільний in-order roster** — `players[i].slot === i` (інакше `roster must use dense in-order slots`). Це критично, бо канонічний sim адресує гравців за **індексом масиву**, а клієнт відбудовує щільний `{slot:i}` roster із `playerCount`.
- **`onConnection(transport)`:** якщо `connections >= expected` → `transport.close()`. Інакше `clientId = c${k}`, одразу шле **hello** `{slot, seed, playerCount, arenaId}`; `onMessage` декодить у try/catch (fail → `malformed++`), на `input` → `host.receiveInput(...)`.
- **Start policy (v1):** чекати всіх expected-клієнтів, тоді бігти з тіка 0. `step()` повертає `false` поки `connections < expected`.

## ClockSync (`clock.ts`) — синхронізація тіків

Оцінює поточний тік хоста з ack round-trip'ів, щоб клієнт цілив у `hostTick + inputDelay`.

- **Парування за inputTick** (не за порядком прибуття): `sentAt: Map<inputTick, localTick>`. Втрачений/переупорядкований ack губить лише власний семпл.
- На `onAck(inputTick, hostTick, localNow)`: `rtt = localNow - sentLocal`, `oneWay = rtt/2`, `sampleOffset = hostTick + oneWay - localNow`. EMA-згладжування `offset += smoothing * (sampleOffset - offset)` (α=0.2).
- За фіксованої затримки D `sampleOffset` точно дорівнює істинному offset K (`hostTick = localTick + K`).
- Виходи: `estimateHostTick(localNow) = round(localNow + offset)`, `targetTick(localNow, inputDelayTicks) = estimateHostTick + inputDelayTicks`.

## RollbackController (`rollback.ts`) — серце алгоритму

Стан: `confirmedSim`, `confirmedSnapshot`, `predictedSim`, `confirmedTick`, `predictedTick`, `localInputs: Map<tick,PlayerInput>`, `authoritative: Map<tick,PlayerInput[]>` (буфер до contiguous), `predictedLog: Map<tick,PlayerInput[]>`, `lastConfirmedRemote[]` (джерело repeat-last). `inputsEqual` порівнює per-slot через `encodeInputByte` (байтова рівність).

`resolveInputs(tick)`: якщо є авторитетний рядок — використати дослівно; інакше локальний slot = `localInputs.get(tick) ?? emptyInput()`, кожен віддалений = `lastConfirmedRemote[slot]`.

**`predict(tick, input): SimEvent[]`**

```ts
if (tick !== predictedTick) return [];
localInputs.set(tick, input);            // записати ДО cap-перевірки — стол не губить локальний інпут
if (predictedTick - confirmedTick >= maxRollback) return [];  // застрягли на капі
const ins = resolveInputs(tick);
const events = predictedSim.step(ins);
predictedLog.set(tick, ins);
predictedTick = tick + 1;
return events;                            // події ЛИШЕ з цього живого forward-кроку
```

Re-sim'и під час rollback **не** видають подій — лише живий forward-крок, тож juice спрацьовує раз на реальний тік.

**`confirm(tick, inputs): boolean`** — rollback-цикл:

```ts
if (tick < confirmedTick) return false;
authoritative.set(tick, inputs);
let mispredicted = false;
while (authoritative.has(confirmedTick)) {      // застосувати кожен CONTIGUOUS авторитетний тік
  const auth = authoritative.get(confirmedTick);
  const used = predictedLog.get(confirmedTick);
  if (used && !inputsEqual(used, auth)) mispredicted = true;
  confirmedSim.step(auth);
  lastConfirmedRemote = auth.slice();
  // прибрати localInputs/predictedLog/authoritative для цього тіка
  confirmedTick++;
}
confirmedSnapshot = confirmedSim.snapshot();
if (confirmedTick > predictedTick) {            // клієнт ВІДСТАВАВ — fast-forward prediction
  predictedSim = createSimFromSnapshot(confirmedSnapshot, restoreConfig);
  predictedTick = confirmedTick; predictedLog.clear(); return false;
}
if (mispredicted) { resimFromConfirmed(); return true; }
return false;
```

Повертає `true` **iff** `mispredicted` — рівно «віддалений інпут відрізнявся від здогаду». Out-of-order авторитетні тіки буферяться й дренуються лише contiguous від `confirmedTick` — це й толерує переупорядкування без явного jitter-буфера.

**`resimFromConfirmed()`:** відбудувати `predictedSim` зі знімка, тоді replay `resolveInputs(t)` для `t ∈ [confirmedTick, predictedTick)`. Точна ре-симуляція, не lerp.

**`resync(snapshot)`** — лікує діри від втрат із хост-снапшота: якщо новіший за `confirmedTick`, перебудовує обидві sim'и з нього, чистить застарілі `localInputs`/`authoritative`, але **тримає** `lastConfirmedRemote` (останній утримуваний інпут — кращий repeat-last здогад одразу після heal'у).

Додатково: `snapshotConfirmed()`, `snapshotPredicted()`, `predictedState()` (живий читабельний стан для рендеру; стрибає на корекції).

## ClientSession (`client.ts`) — оркестратор

Зв'язує ClockSync + RollbackController + codec над одним `Transport`. Керується `tick(localInput)` раз на крок.

- `onMessage`: `hello` → `bootstrap`; `authoritative` → `controller.confirm`; `snapshot` → `controller.resync`; `ack` → `clock.onAck(inputTick, hostTick, localTick)`; `input` ігнорується.
- `bootstrap`: будує FFA-roster `{slot:i}` × playerCount, створює RollbackController з `localSlot: slot`.
- **`tick(localInput)`:**
  ```ts
  localTick++;
  const target = clock.synced ? clock.targetTick(localTick, inputDelayTicks)
                              : controller.confirmedTick + inputDelayTicks;  // bootstrap-lead до першого ack
  while (controller.predictedTick <= target) {
    const tk = controller.predictedTick;
    if (tk - controller.confirmedTick >= maxRollbackTicks) break;
    const stepEvents = controller.predict(tk, localInput);
    if (controller.predictedTick === tk) break;  // не просунувся (cap) — уникнути spin
    transport.send(encodeMessage({ type:"input", tick:tk, input: localInput }));
    clock.onSend(tk, localTick);
    events.push(...stepEvents);
  }
  ```

## Налаштування (`params.ts` + `content/tuning.json` → блок `net`)

```ts
interface NetParams { inputDelayTicks; snapshotIntervalTicks; maxRollbackTicks; jitterBufferTicks }
```

Поточні: `inputDelayTicks: 3`, `snapshotIntervalTicks: 30`, `maxRollbackTicks: 120`, `jitterBufferTicks: 4`. `parseNetParams` валідує (невід'ємні цілі; `snapshotIntervalTicks >= 1`, `maxRollbackTicks >= 1`). `jitterBufferTicks` — **зарезервовано**, ще не споживається (rollback уже толерує переупорядкування). Sim ігнорує блок `net` — golden-артефакти недоторкані.

## Dev-host (`scripts/dev-host/`) — локальний dedicated-хост

Node-процес, що крутить авторитетний `HostRuntime` + sim і обслуговує браузерні клієнти по реальному WebSocket на localhost. Запуск через `tsx` (`npm run dev:host`) — без build-кроку. Єдиний Node-/`ws`-специфічний код; `packages/net` лишається headless. У спеці 011 «випускається» в Cloudflare Durable Object заміною лише транспорту + bootstrap'у.

- **`ws-transport-server.ts`** — адаптер `ws` → `TransportServer`: `WsTransport implements Transport` (`binaryType="nodebuffer"`, `toUint8` нормалізує `RawData`, `send` лише при `OPEN`). `createWsTransportServer({port, host?})` — монотонний connection-id (одна сесія на процес).
- **`main.ts`** — bootstrap. Env (launch, не геймфіл-тюнінг): `PORT` (8787), `PLAYERS` (2), `SEED` (1), `ARENA` (`arena-002.json`). Читає `content/tuning.json` + арену, парсить, створює `HostRuntime`, **цикл 60 Гц** `setInterval(() => runtime.step(), 1000/TICK_RATE)`. `runtime.step()` no-op поки не підключилися всі. `SIGINT`/`SIGTERM` → чистий shutdown.

**Як грати:** відкрий дві вкладки на `?online=ws://localhost:8787`. Хост призначає слоти в порядку конекту через hello, чекає `PLAYERS` клієнтів, біжить із тіка 0.

## WebSocketTransport (браузер, `packages/game/src/net/`)

Перша конкретна реалізація `Transport` для браузера над DOM `WebSocket`. Живе в `packages/game` (не `net`), бо називає DOM `WebSocket`.

- `binaryType="arraybuffer"`; датаграми, надіслані до `OPEN`, чергуються в `preOpen` і флашаться на `onopen` — каллер може будувати транспорт + `ClientSession` і одразу слати інпути, не чекаючи конекту;
- кожен `send` копіює в свіжий `ArrayBuffer` (володіння байтами);
- лише бінарні вхідні фрейми; `onerror`/`onclose` → один `fireClose()` (ідемпотентний).

**TCP-застереження:** WebSocket reliable+ordered (TCP); rollback толерує loss/reorder, але TCP head-of-line blocking може хитати під втратами — прийнятний v1-компроміс. Unreliable WebRTC DataChannel — спека 012, замінний за тим самим `Transport` seam.

## Збіжність — підсумок

Обидві sim'и стартують з однакового детермінованого стану на тіку 0. Хост комітить кожен тік (repeat-last fill) і транслює авторитетні інпути + періодичні снапшоти. Confirmed-sim клієнта replay'ить рівно ті авторитетні інпути → побайтово рівна хосту на кожному підтвердженому тіку (доведено determinism-guard'ом). Predicted-sim біжить попереду, відкочуючись лише коли авторитетний віддалений інпут відрізнявся від здогаду. Діри від втрат лікуються снапшотами через `resync()`. Усе це прогнано headless над `LoopbackNetwork` (seeded loss/jitter, явний `advance`) і end-to-end у двох вкладках проти Node dev-хоста — обидва сходяться побайтово (e2e `online.spec.ts` порівнює `getConfirmedHashAt`).

Наступні фази (не реалізовано): **011** Cloudflare signaling (Worker + Durable Object) + room codes + перший інтернет-матч; **012** player-hosted listen-server (WebRTC P2P, NAT/TURN); **013** netplay-поліш (lag-comp, спектатори, reconnection, host migration).

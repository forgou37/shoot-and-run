# 02 — Архітектура

## Загальна форма

Монорепо на **npm workspaces** з однією жорсткою межею: ігрові правила відокремлені від рушія рендерингу.

```
arcade-game/
├─ packages/
│  ├─ sim     — чиста TypeScript-симуляція гри. НУЛЬ Phaser/DOM/canvas.
│  ├─ bots    — heuristic AI-лучники (pure, headless; імпортує лише sim)
│  ├─ net     — host-authoritative rollback-netcode (pure, headless; імпортує лише sim)
│  └─ game    — Phaser 3 shell: рендер, ввід, сцени, (онлайн)транспорт
├─ content/   — увесь ігровий контент як JSON (arenas, tuning, players, bots)
├─ scripts/   — export-art, slice-cards, dev-host (локальний онлайн-хост)
├─ e2e/       — Playwright-сюїти
└─ specs/     — нумеровані специфікації + backlog
```

Пакети називаються `@shoot-and-run/{sim,bots,net,game}`, усі `private`, ESM. `sim`, `bots`, `net` **не мають build-кроку** — їхній `exports` указує прямо на `src/index.ts`, і Vite/Vitest споживають TS-джерело напряму.

### Граф залежностей

```
        ┌───────┐
        │  sim  │  ← імпортує НІЧОГО (zero dependencies)
        └───┬───┘
     ┌──────┼──────┐
     ▼      ▼      ▼
 ┌──────┐ ┌────┐ ┌──────┐
 │ bots │ │net │ │ game │  game → phaser + sim + bots + net
 └──────┘ └────┘ └──────┘
```

- `sim` не залежить ні від чого (доводиться runtime-тестом, що його `dependencies`/`devDependencies` порожні).
- `bots` і `net` можуть імпортувати **лише** `sim` (і себе).
- `game` — єдиний пакет, що знає про Phaser і DOM.

## Тверді правила (інваріанти)

Ці правила перевизначають будь-яку дефолтну поведінку. Вони enforced машинно, не лише на словах.

1. **Spec discipline.** Реалізується лише те, що в поточній специфікації. Нові ідеї йдуть у `specs/backlog.md`, не в код.
2. **Sim purity.** `packages/sim` ніколи не імпортує Phaser, DOM чи canvas — ні `window`, ні `document`, ні `performance`, ні `requestAnimationFrame`. Перевіряється `npm run check:deps` (dependency-cruiser) у CI.
3. **Tuning is data.** Усі числа геймфілу — в одному `content/tuning.json`. Hot-reloadable у dev. Захардкоджене тюнінг-число — баг.
4. **Deterministic sim.** Лише seeded RNG усередині `packages/sim`. Жодних `Date.now()`, `Math.random()`, `performance.now()`. Однакові `arena + tuning + seed + послідовність інпутів` ⇒ ідентичний лог подій, завжди.
5. **One task per commit**, повідомлення з префіксом task id.
6. **Placeholder visuals** до завершення артових специфікацій (зараз арт уже є).

### Три рівні захисту чистоти симуляції

| Рівень | Механізм |
|---|---|
| Компіляція | tsconfig `sim` **не має DOM lib** → `window`/`document` не типчекаються у sim |
| Статика | dependency-cruiser-правило `sim-purity` (+ `bots-purity`, `net-purity`) у CI |
| Рантайм | тест у sim, що перевіряє: пакет не має жодних залежностей |

dependency-cruiser працює з `tsPreCompilationDeps: true`, тож навіть **type-only** ребро `sim ↔ net` (типи транспорту/протоколу) реально enforced — інакше воно було б невидиме для `check:deps`.

## Контракт `Sim` (центральний API)

Симуляція спілкується із зовнішнім світом **лише** через повернені події та читабельний стан — без колбеків, без глобалів. Це той самий API, який споживатиме майбутній AI-пайплайн.

```ts
const sim = createSim({ arena, tuning, players, seed, friendlyFire? });
const events: SimEvent[] = sim.step(inputs);   // рівно один тік 60 Гц
sim.state;                                      // readonly-знімок для рендеру / статистики
```

Повний інтерфейс:

```ts
interface Sim {
  readonly state: Readonly<SimState>;
  step(inputs: readonly PlayerInput[]): SimEvent[];
  setTuning(next: Tuning): void;          // dev hot-reload, діє з наступного тіка
  snapshot(): SimSnapshot;                // для prediction/rollback і replay
  getEntityIdCounter(): number;
  setEntityIdCounter(value: number): void;
}
```

Фабрики: `createSim(config)` (свіжа) та `createSimFromSnapshot(snapshot, config)` (відновлення). Обидві проходять через спільний внутрішній `buildSim(...)`, тож логіка кроку існує **в одному місці**, і докази детермінізму автоматично покривають шлях відновлення.

Детальніше — у [Ядрі симуляції](03-simulation-core.md).

## Модель часу

**60 Гц фіксований крок**, керований акумулятором у shell.

- Shell може рендерити на будь-якій частоті оновлення й **інтерполює** позиції сутностей між попереднім і поточним тіком.
- Сама симуляція не має поняття wall-clock — лише тіки.
- Тривалості в `tuning.json` задаються в **мілісекундах** (зручно дизайнеру) і конвертуються в тіки **один раз при ініціалізації** через `msToTicks(ms) = round(ms * 60 / 1000)`.

Реалізація акумулятора — у `packages/game/src/loop.ts` (`FixedStepDriver`), деталі в [Рендерингу](06-rendering-and-graphics.md).

## Потік даних за один кадр

```
   браузерний кадр (rAF, будь-яка частота)
            │
            ▼
  device.sample() → PlayerInput[]        (ввід → плоскі структури)
            │
            ▼
  FixedStepDriver.advance(dt, doTick)     (акумулятор: 0..N тіків)
            │  кожен тік:
            ▼
  sim.step(inputs) → SimEvent[]           (єдине місце просування симуляції)
            │
            ├──► applyJuice(events)        (hitstop, shake, particles)
            └──► sim.state (readonly)
                      │
                      ▼
          render(alpha) з інтерполяцією   (lerpWrapped між prev і curr)
```

В онлайні `sim.step` замінюється на `ClientSession.tick(input)`, що всередині веде confirmed + predicted симуляції (див. [Netcode](05-netcode.md)).

## Одиниці й константи

- Одиниці: **пікселі**. Tile size **16 px**. Арена **320×240** (20×15 тайлів).
- Позиції — float'и в пікселях; рендерер може масштабувати цілим кратним.
- Геометричні/часові константи (`TILE_SIZE`, `ARENA_WIDTH/HEIGHT`, `TICK_RATE`, розміри хітбоксів) **навмисно захардкоджені** у `constants.ts`/`arena.ts` — це не геймфіл-тюнінг, а контракт моделі.
- Колекції сутностей — звичайні масиви зі стабільним порядком вставки; id призначає детермінований лічильник, ніколи не випадково.

## Чому саме так (ключові рішення)

| Рішення | Чому | Що відкинули |
|---|---|---|
| Engine-agnostic ядро в `packages/sim` | headless-симуляція для AI-пайплайну + детермінований replay/тести | логіка всередині Phaser-сцен — зв'язала б правила з рендером |
| Власна wrap-aware AABB-vs-tile колізія | загортання на краях рушії broadphase не моделюють | Phaser Arcade Physics — імпортує Phaser + variable-delta недетермінований |
| Float-детермінізм (без fixed-point) | у межах одного JS-рушія float'ів достатньо; host authority поглинає розбіжності | fixed-point — зайва складність |
| npm workspaces + Vitest | нуль зайвого тулчейну для малого репо; Vitest ділить Vite-пайплайн | pnpm/turborepo — overkill; Jest — повільніший ESM/TS |

Повний журнал рішень — у [Дорожній карті й рішеннях](11-roadmap-and-decisions.md) та `CLAUDE.md` § Decisions Log.

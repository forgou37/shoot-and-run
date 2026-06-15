# 07 — Ввід і пристрої

Симуляція бачить **лише** `PlayerInput` — ніколи пристрій. Shell перекладає клавіатуру/геймпад/бота в плоскі структури вводу. Усе у `packages/game/src/input/`.

## Абстракція `InputDevice` (`device.ts`)

```ts
interface InputDevice {
  id: string;            // стабільний: "keyboard:0", "pad:2", "bot:0"
  kind: "keyboard" | "pad" | "bot";
  connected: boolean;
  sample(): PlayerInput;
  pausePressed(): boolean;
}
```

### Реалізації

- **`KeyboardDevice`** — завжди `connected`; `pausePressed()` завжди false (пауза клавіатури — це scene-level Esc-listener); делегує `sample` в `KeyboardInput.sample(keys)`.
- **`GamepadDevice`** — `readStandardGamepad(pad, deadzone)`:
  - **left/right:** axis 0 (`< -dz` / `> dz`) **або** d-pad-кнопки 14/15;
  - **up/down:** axis 1 **або** кнопки 12/13;
  - **jump** = кнопка 0 (A), **shoot** = кнопка 2 (X), **dash** = кнопка 5 (RB);
  - **pause** = кнопка 9 (Start);
  - `current()` перечитує свіжо щосемпл; відключений → `emptyInput()`.
- **`BotDevice`** (`bot-device.ts`) — `kind:"bot"`, завжди connected, ніколи pause. Будується в лобі/quickstart зі `BotDifficulty`; `attach(getState, slot, matchSeed, arena)` пізно прив'язує **після** `createSim`, конструюючи `makeBot({ seed: botSeed(matchSeed, slot), … })`, тож бот-матч лишається replayable. До attach — нейтральний.

## DeviceManager (`device-manager.ts`)

Володіє живим списком пристроїв: фіксовані клавіатурні профілі + підключені пади.

- Конструктор сідить уже-присутні пади, тоді підписується на `gamepadconnected`/`gamepaddisconnected` (**hot-plug**).
- `devices()` повертає клавіатури першими, тоді підключені пади за індексом.
- `windowGamepadHost(window)` адаптує `Window` (геймпади на `navigator`, події на `window`); інтерфейси `GamepadHost`/`GamepadLike` роблять його test-fakeable.
- `dispose()` знімає listeners.

## KeyboardInput (`keyboard.ts`)

Сирий трекер `Set<KeyboardEvent.code>` (навмисно не Phaser-плагін). Слухає `keydown`/`keyup`/`blur` (blur чистить — щоб клавіші не «залипали»). `sample(keys: KeyBindings)` мапить кожен action на `isDown(keys.<action>)`.

## EdgeReader (`menu-input.ts`)

Per-device детектор rising-edge для меню. `read(devices)` семплить кожен пристрій + `pausePressed`, порівнює з запам'ятаним `prev` за id, повертає:

```ts
interface DeviceEdges {
  joinOrConfirm;  // jump ↑
  back;           // shoot ↑
  up; down; left; right;
  pause;          // Start ↑
}
```

**Перший кадр, коли пристрій уперше побачено, не дає edge'ів** — поглинає утримувану кнопку, перенесену з попередньої сцени. `forget(id)` скидає стан.

## Парсинг конфігів (`players-config.ts`, `settings.ts`)

- **`parsePlayersConfig`** валідує `content/players.json`: `slots[]` (`{slot,name,color}`, унікальні невід'ємні slot-id, `>=2` слоти, `#rrggbb`-колір) і `keyboards[]` (`>=1` профіль; кожен біндить `ACTION_KEYS = left,right,up,down,jump,shoot,dash` на непорожні `KeyboardEvent.code`). Живе в shell (не sim), бо key-коди/кольори — device/render-концерни.
- **`parseInputSettings`** → `input.stickDeadzone` (`[0,1)`; **0.25**).
- **`parseUiSettings`** → `ui.lobbyCountdownMs` (`>=0`; **3000**).

### Поточні біндинги (`content/players.json`)

| Профіль | Рух | Jump | Shoot | Dash |
|---|---|---|---|---|
| Клавіатура 0 | WASD | `KeyG` | `KeyF` | `ShiftLeft` |
| Клавіатура 1 | Стрілки | `Period` | `Slash` | `ShiftRight` |
| Геймпад (стандарт) | axis 0/1 + d-pad | A (0) | X (2) | RB (5) |

Pause: Esc (клавіатура), Start (9, геймпад).

## Прив'язування пристроїв до слотів

Прив'язка device → slot стається **в лобі**, не в конфігах. Гравець натискає кнопку (`joinOrConfirm`-edge), `LobbyScene` дає йому `lowestFreeSlot()`, ставить `team = slot % 2` (для teams). `players.json` зберігає лише ідентичності слотів (ім'я+колір) і два клавіатурні профілі. Зібраний roster (`MatchConfig`) лобі передає матчу.

## Hot-plug і авто-пауза

`DeviceManager` ловить підключення/відключення геймпадів у реальному часі. У матчі, якщо призначений гравцеві пад зник (`kind==="pad" && !connected`), `ArenaScene.update` відкриває паузу. Це дає couch-friendly поведінку: висмикнув контролер — гра стала на паузу, а не продовжила без гравця.

## Тестованість

`DeviceManager` + `GamepadDevice` повністю покриті unit-тестами (`packages/game/test/input.test.ts`): deadzone 0.25, мапінг стіка/d-pad/кнопок, hot-plug-id (`keyboard:0/1`, `pad:1`). Геймпад у e2e (`lobby.spec.ts`) драйвиться через інжектований `navigator.getGamepads`-shim — Playwright не вміє синтезувати реальний геймпад.

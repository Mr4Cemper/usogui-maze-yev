# Usogui Maze yev

A board game for two devices: two hidden mazes, played out loud, with a hash that keeps both players honest.

Inspired by the Labyrinth game from the manga *Usogui*.

**[▶ Play it here](https://Mr4Cemper.github.io/usogui-maze-yev/Usogui_Maze_yev.html)** — or download [`Usogui_Maze_yev.html`](Usogui_Maze_yev.html) and open it by double click.

One HTML file. No server, no network, no accounts, no install. Works offline.

---

## What it is

Each player builds a secret 6 × 6 maze and tells the other only where its entrance and exit are. Then you walk through each other's maze blind: you name a step, your opponent says whether it is open or a wall, and you map their maze as you go. Getting your pawn from their entrance to their exit before they do the same in yours wins the game.

The two devices never talk to each other. Everything travels between the players — by voice, by call, by messenger, across the same table.

## The honest part

Nothing stops a player from inventing a wall that isn't there. So before the first move, each device hashes the maze together with a random salt and hands you a short **commit** code to send your opponent. It gives nothing away about your maze, and it makes changing that maze afterwards impossible to hide.

After the game the two of you swap **reveal** strings. Each device re-hashes the revealed maze, checks it against the commit it was given at the start, and replays every answer your opponent gave against their real walls. An invented wall shows up as a mismatch on a named edge, with the move it happened on.

A commit is a hash, not a cipher. A cipher can be re-keyed to decrypt to any maze the cheater likes; a hash cannot.

## How to play

1. Open the page on both devices.
2. Agree on the settings. One player creates a settings code and sends it over.
3. Build a maze each, exchange commit codes, and save the reveal file the application asks for.
4. Play. Steps and answers are spoken out loud.
5. Exchange reveal strings at the end and read the report.

Full rules live inside the application, under **Rules** in the header, in all three languages.

## What's in it

- 6 × 6 board, walls on the edges between cells, one entrance and one exit
- Hash commitment over the whole setup: maze, settings and a random salt
- Seven verification checks and a verdict computed from the revealed mazes
- Move-by-move replay of a finished game
- Rules and guide built in, in English, Russian and Ukrainian
- Five themes, per-role palettes, and a separate panel for the colours of the board
- Freehand drawing over the boards
- Four short generated tones — a step, a wall, the turn changing hands, the exit. Off by default
- Saving a finished game: both boards as one PNG, and the whole game as a JSON archive
- Everything is remembered in the browser; the reveal file is the only thing you have to keep yourself

A verification report never accuses anyone of cheating over a typo: a damaged code and a substituted maze are told apart and worded differently.

## Development

Node 18 or newer. The only dependency is `esbuild`, and only for building.

```bash
npm install
node build.mjs                      # → Usogui_Maze_yev.html
node build.mjs --watch              # rebuild on every change

node --test "tests/**/*.test.mjs"   # the test suite
node tools/check-i18n.mjs           # dictionary parity across the languages
node tools/serve.mjs                # serve the built page over http://localhost
node examples/roundtrip.mjs         # the commit cycle, in the console
```

On Windows, `npm` is a PowerShell script and will not run under the `Restricted` execution policy — call `npm.cmd`, or allow scripts for one window. `node` itself always works. Note also that on Node 24, `node --test tests/` does not work; the quoted glob above does.

### Layout

```
src/core/      rules and the commitment protocol. No DOM, no languages, no colours
src/ui/        screens, state, board, themes, drawing
src/i18n/      one flat dictionary per language, identical key sets
src/styles/    tokens and rules; every colour comes from a token
tests/         node:test, no browser and no test framework
tools/         dictionary check, fixture builder, static server
examples/      the commit cycle end to end
index.html     the shell the build inlines the script and styles into
build.mjs      the build
```

`src/core/` knows nothing about the interface, and the interface never re-implements a rule.

`Usogui_Maze_yev.html` in the repository root is the build output. It is committed on purpose — that file *is* the deliverable — but it is generated: edit the sources and rebuild, never the file itself.

## Author

Bohdan Yevtushenko

## Licence

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE).

## Disclaimer

An unofficial, non-commercial fan project. Not affiliated with, endorsed by, or connected to the creators, publishers, or rights holders of *Usogui*. All trademarks belong to their respective owners.

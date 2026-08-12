# Usogui Maze yev

A two-device board game of hidden mazes, played over voice, with a hash that keeps both players honest.

Inspired by the Labyrinth game from the manga *Usogui*.

**[▶ Play it here](https://YOUR-USERNAME.github.io/usogui-maze-yev/Usogui_Maze_yev.html)** — or download `Usogui_Maze_yev.html` and open it. One file, no install, works offline.

---

## What it is

Two players. Each builds a secret 6×6 maze and tells the other only where its entrance and exit are. Then you take turns walking blind through each other's maze, calling out directions and answering "you passed" or "wall". First one to reach the exit wins.

The two devices never talk to each other. Everything travels between the players — by voice, by chat, however you like.

## The honest part

Nothing stops a player from inventing a wall that isn't there. So before the first move, each device hashes your maze together with a random salt and gives you a short **commit** code to send your opponent. It gives nothing away about your maze, and it makes changing that maze afterwards impossible to hide.

After the game you swap **reveal** strings. Each device then re-hashes the revealed maze, checks it against the commit it was given at the start, and replays every answer your opponent gave against their real walls. Any invented wall shows up with the move number and the edge it was on.

A commit is a hash, not a cipher — a cipher can be re-keyed to decrypt to any maze the cheater likes, a hash cannot.

## What's in it

- Five themes, three languages (English, Русский, Українська)
- Full rules built in, no manual needed
- Freehand drawing over the boards for working things out
- Step-by-step replay of a finished game
- Verification report that never accuses anyone of cheating on a typo

## Building from source

Node 18+. No runtime dependencies; `esbuild` is the only dev dependency.

```bash
npm install
node build.mjs          # → Usogui_Maze_yev.html
node build.mjs --watch

node --test "tests/**/*.test.mjs"
node tools/check-i18n.mjs
node tools/serve.mjs    # local server, for testing with real localStorage
```

On Windows PowerShell, `npm` may be blocked by execution policy — use `npm.cmd`.

## Layout

```
src/core/     game rules and the commit protocol — no DOM, no languages
src/ui/       screens, board, state
src/i18n/     dictionaries
tests/        Node tests, no browser needed
docs/         handover notes, decisions, glossary
SPEC.md       the single source of truth for rules and protocol
```

`src/core/` knows nothing about the interface, and the interface never re-implements a rule.

## Author

Bohdan Yevtushenko

## License

MIT — see [LICENSE](LICENSE).

## Disclaimer

An unofficial, non-commercial fan project. Not affiliated with, endorsed by, or connected to the creators, publishers, or rights holders of *Usogui*. All trademarks belong to their respective owners.

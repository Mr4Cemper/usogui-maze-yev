/**
 * en.js - the English dictionary, and in this part the only one.
 *
 * Flat dotted keys so that `tools/check-i18n.mjs` can compare them with the
 * `t('...')` literals it finds in the sources. Part 4 adds `ru.js` and `uk.js`
 * with exactly the same key set; a missing key is a build error, never a
 * silently English line in the middle of a Russian screen (SPEC 5.4).
 *
 * Wording rule from SPEC 4.8: a code that fails to parse is a damaged code, a
 * mistyped code or a code from another program. Never an accusation.
 */

export default {
  // The name of this language, in this language: the picker reads it out of
  // each dictionary, so a new language is a new file and nothing else.
  'lang.name': 'English',

  'app.title': 'Usogui Maze yev',
  'app.subtitle': 'Two devices, one maze each, and a hash that keeps everyone honest.',
  'app.stepSetup': 'Settings',
  'app.stepBuild': 'Build',
  'app.stepPlay': 'Game',
  'app.stepVerify': 'Verify',
  'app.stages': 'Stages of the game',
  'app.interfaceTitle': 'Interface',
  'app.rainToggle': 'Falling code',
  'app.rainHint': 'The rain behind everything. It stops on its own when the tab is hidden.',
  'app.crtToggle': 'Screen effects',
  'app.crtHint': 'Scan lines and the darkened corners. Switch them off if text is hard to read.',
  'app.soundToggle': 'Sound',
  'app.soundHint': 'Four short tones: a step, a wall, the turn changing hands, the exit. Off by default, because you are talking to each other.',
  'ink.toggle': 'Drawing',
  'ink.hint':
    'Draw over the boards with a finger or the mouse. The game underneath is paused while this is on, and the drawings stay when it is off.',
  'ink.colour': 'Brush',
  'ink.width': 'Width',
  'ink.undo': 'Undo stroke',
  'ink.clear': 'Clear drawings',
  'ink.full': 'No more room for drawings. Undo a stroke or clear them.',
  'colours.title': 'Board colours',
  'colours.hint':
    'Your colours, not the theme\u2019s: they stay as you set them when you switch themes, and they survive Refresh fields. Empty fields follow the theme.',
  'colours.resetAll': 'Back to the theme colours',
  'colours.resetField': 'Reset',
  'colours.themeChanged':
    'These colours were picked for another theme and may not suit this one. Reset them, or leave them if they still read well.',
  'colours.lowContrast': '{name}: {ratio}:1 against the board — hard to make out.',
  'colours.wallsAlike':
    'Your own walls and the walls you ran into now look the same. They mean different things: one is your maze, the other is where you lost a turn.',
  'colours.entrance': 'Entrance',
  'colours.exit': 'Exit',
  'colours.tokenMe': 'My pawn',
  'colours.tokenOpponent': 'Opponent pawn',
  'colours.wall': 'My wall',
  'colours.wallFound': 'Found wall',
  'colours.passage': 'Trail',
  'colours.grid': 'Grid',
  'colours.label': 'Coordinates',
  'colours.boardBg': 'Board background',
  'app.theme': 'Theme',
  'theme.xp-cyber': 'XP cyber',
  'theme.dark': 'Dark',
  'theme.light': 'Light',
  'theme.paper': 'Paper and ink',
  'theme.amber': 'Amber monitor',
  'app.language': 'Language',
  'app.languageHint': 'Switches at once, across the whole interface. The choice survives Refresh fields.',
  'app.autoEndToggle': 'Hand the turn over by itself',
  'app.autoEndHint':
    'When a step ends the turn - a wall, or the third new cell - pass it on without another click. This is your decision given in advance; the rules do not change, and your opponent may have it set differently.',
  'export.title': 'Save this game',
  'export.hint': 'The picture is both boards as they stand, drawings included. The archive is the whole game as text, for reading — this application never loads one back.',
  'export.png': 'Save the boards (PNG)',
  'export.json': 'Save the archive (JSON)',
  'export.failed': 'The picture could not be made: {message}',
  'app.repository': 'Source code on GitHub',
  'app.rules': 'Rules',
  'app.reset': 'Refresh fields',
  'app.resetConfirm': 'Erase everything',
  'app.resetWhat':
    'This erases both mazes, every wall, the entrances and exits, the whole game with its history and counters, the commit, the salt, your opponent’s commit and the fact that you saved a reveal file. Your role, language and interface switches stay.',
  'app.resetFile':
    'The reveal file already on your disk stays there, but it belongs to the game you are erasing and will not fit the next one.',
  'app.storageNotice':
    'This device remembers your setup in the browser. On a file:// page that storage can be shared with every other local page, so the reveal file you save is the only carrier you should rely on.',
  'app.storageUnavailable':
    'This browser refuses local storage here, so nothing is remembered between reloads. Save the reveal file: it is the only carrier that survives a closed tab.',

  'board.label': 'Maze board',
  'board.cellLabel': 'Cell {cell}',
  'board.edgeLabel': 'Wall between {from} and {to}',

  'code.copy': 'Copy',
  'code.copied': 'Copied.',
  'code.copyManually': 'Copying is not allowed here. The code is selected — press Ctrl+C.',
  'code.empty': 'Not created yet',
  'code.accepted': 'Code accepted.',

  'error.BAD_FORMAT': 'This is not that kind of code, or it was not pasted in full.',
  'error.BAD_CHECKSUM': 'The code was damaged while copying. Ask for it to be sent again.',
  'error.OUT_OF_RANGE':
    'The code holds a value outside the allowed range. It was built by a program that does not follow the specification.',
  'error.UNKNOWN': 'The code could not be read.',
  'error.WRONG_KIND_SETTINGS': 'That is a settings code, not a reveal string. It starts with YM1.',
  'error.WRONG_KIND_COMMIT': 'That is a commit code, not a reveal string. It starts with YMC1.',
  'error.OWN_REVEAL':
    'This is your own reveal string, not your opponent’s. Nothing was checked. Paste the string they sent you — yours is the one you send to them.',

  'validate.title': 'Maze validity',
  'validate.pending': 'Nothing to check yet.',
  'validate.ok': 'The maze is valid.',
  'validate.failed': 'The maze is not valid.',
  'validate.ENTRANCE_MISSING': 'The entrance is not placed.',
  'validate.EXIT_MISSING': 'The exit is not placed.',
  'validate.ENTRANCE_EQUALS_EXIT': 'The entrance and the exit are the same cell.',
  'validate.WALL_LIMIT_EXCEEDED': 'There are more walls than the limit allows.',
  'validate.ENTRANCE_SEALED': 'The entrance has no open side left.',
  'validate.EXIT_SEALED': 'The exit has no open side left.',
  'validate.NO_PATH': 'There is no way from the entrance to the exit.',
  'validate.NO_PATH_consequence':
    'There is no way from the entrance to the exit — a consequence of the sealed cell above.',
  'validate.UNKNOWN': 'The core reported a problem this version does not know about.',

  'settings.range': 'allowed {min}…{max}',
  'settings.outOfRange': 'Must be a whole number between {min} and {max}.',
  'settings.wall_limit': 'Wall limit',
  'settings.new_cells_per_turn': 'New cells per turn',
  'settings.move_limit_total': 'Total move limit',
  'settings.allow_pass': 'Passing a turn is allowed',
  'settings.play_after_exit': 'Play continues after the exit is reached',
  'settings.timers_visible': 'Show timers',
  'settings.build_timer_sec': 'Build timer, seconds',
  'settings.turn_timer_sec': 'Turn timer, seconds',
  'settings.first_move': 'First move',
  'settings.grid_w': 'Board width',
  'settings.grid_h': 'Board height',
  'settings.exits_count': 'Exits',
  'settings.hint.wall_limit': 'How many walls each player may place. Spending them all is optional.',
  'settings.hint.new_cells_per_turn':
    'A turn ends technically once this many never visited cells have been opened.',
  'settings.hint.move_limit_total': 'Counted across both players. 0 means no limit.',
  'settings.hint.allow_pass':
    'Off by default: a player who is behind could otherwise pass until the move limit runs out.',
  'settings.hint.play_after_exit':
    'On: both players finish the round and the same round is a draw. Off: the earlier move wins outright.',
  'settings.hint.timers_visible': 'Timers are decoration. They never block anything.',
  'settings.hint.build_timer_sec': 'Counts down on the build screen. 0 switches it off.',
  'settings.hint.turn_timer_sec': 'One shared clock during the game. 0 switches it off.',
  'settings.hint.first_move': 'Which player takes global move 1.',

  'setup.title': 'Settings of this game',
  'setup.intro':
    'Agree on the settings, then one of you creates the code and the other pastes it. Both devices must end up with the very same block, the game number included — that is what makes the two commits comparable at the end.',
  'setup.roleTitle': 'My role',
  'setup.rolePlayer1': 'I am Player 1',
  'setup.rolePlayer2': 'I am Player 2',
  'setup.roleWarning':
    'This choice is local to this device. It is not part of the settings code and not part of the hash. Agree out loud who is Player 1: if you both pick the same role, neither application will notice.',
  'setup.settingsTitle': 'Rules of the game',
  'setup.settingsHint': 'Ranges come from the core. A value outside its range is marked at once.',
  'setup.referenceValues': 'Fixed in this version: {fields}.',
  'setup.createTitle': 'Create the settings code',
  'setup.createHint': 'Creating a code also draws a fresh game number, so every game gets its own.',
  'setup.createCode': 'Create code',
  'setup.editImported': 'Change the settings anyway',
  'setup.myCodeLabel': 'Settings code to send',
  'setup.myCodeHint': 'Send this to your opponent. 24 characters.',
  'setup.codeReady': 'Code created. Send it to your opponent.',
  'setup.codeStale': 'A setting changed, so the old code no longer describes it. Create a new one.',
  'setup.fixFields': 'Some fields are outside their range.',
  'setup.importTitle': 'Paste the settings code',
  'setup.importLabel': "Opponent's settings code",
  'setup.importHint': 'Pasting a code replaces every field, including the game number.',
  'setup.importAccepted': 'Code accepted. The fields below now match your opponent.',
  'setup.lockedByGame':
    'The game has started, so the settings are frozen. This screen is here to look at them, not to change them.',
  'setup.lockedByImport':
    'The fields are locked because they came from a pasted code. Changing them would make your game differ from your opponent’s.',
  'setup.unlockedWarning':
    'You are editing settings that came from a pasted code. Your two devices no longer agree — paste the code again to get back in step.',
  'setup.continue': 'Continue to building',
  'setup.readyToBuild': 'Settings are ready.',
  'setup.needSettings': 'Create a settings code or paste the one your opponent sent.',
  'setup.firstMovePlayer1': 'Player 1',
  'setup.firstMovePlayer2': 'Player 2',

  'build.myBoardTitle': 'My maze',
  'build.myBoardLabel': 'My maze, the one my opponent walks through',
  'build.myBoardHint':
    'Click an edge to raise a wall, click it again to take it down. Your opponent walks this maze.',
  'build.modeWalls': 'Walls',
  'build.modeEntrance': 'Place entrance',
  'build.modeExit': 'Place exit',
  'build.wallCounter': 'Walls {count} / {limit}',
  'build.undo': 'Undo',
  'build.reset': 'Clear the maze',
  'build.timerLeft': 'Build time left {clock}',
  'build.timerExpired': 'Build time is up. Nothing is blocked.',
  'build.timerOff': 'Build timer is off.',
  'build.opponentBoardTitle': "Opponent's maze",
  'build.opponentBoardLabel': "The opponent's maze, walls unknown",
  'build.opponentBoardHint':
    'Mark the entrance and the exit your opponent announced. The walls stay hidden until the reveal.',
  'build.opponentEnds': 'Entrance {entrance}, exit {exit}',
  'build.commitTitle': 'Commit',
  'build.commitExplain':
    'Freezing takes a random salt, hashes it together with your maze and produces a commit. The commit gives nothing away, and it makes changing the maze afterwards impossible to hide. The code goes to your opponent; the file below stays with you.',
  'build.freeze': 'Freeze the maze',
  'build.unfreeze': 'Change the maze',
  'build.commitPending': 'The maze must be valid before it can be frozen.',
  'build.commitDone': 'The maze is frozen. Send the commit code to your opponent.',
  'build.unfrozen': 'The commit and the salt are gone. Any reveal file you saved is now useless.',
  'build.commitLabel': 'Commit code to send',
  'build.commitHint': '74 characters, checksum included.',
  'build.revealTitle': 'Reveal file',
  'build.revealExplain':
    'The file holds your maze, the salt and the settings. You will need it after the game to prove your walls were the ones you committed to.',
  'build.revealWarning':
    'Save it now. Losing this file means you cannot reveal, and a player who cannot reveal loses by the rules.',
  'build.saveReveal': 'Save the reveal file',
  'build.revealNeedsCommit': 'Freeze the maze first.',
  'build.revealSaved': 'The reveal file has been saved.',
  'build.revealFailed': 'The browser refused to save the file. Try again or use another browser.',
  'build.noSettingsCode': '(no settings code on this device)',
  'build.opponentCommitTitle': "Opponent's commit",
  'build.opponentCommitLabel': 'Paste the commit code you were sent',
  'build.opponentCommitHint':
    'It is checked the moment you paste it. Catching a typo now costs a minute; catching it after the game looks like an accusation.',
  'build.opponentCommitAccepted': 'The commit code is intact and has been stored.',
  'build.startTitle': 'Start the game',
  'build.checkMaze': 'My maze is valid and frozen',
  'build.checkOpponentEnds': "The opponent's entrance and exit are marked and differ",
  'build.checkReveal': 'The reveal file is saved',
  'build.checkOpponentCommit': "The opponent's commit code is accepted",
  'build.start': 'Start the game',
  'build.back': 'Back to settings',

  'reveal.fileTitle': 'Usogui Maze yev — reveal file. Keep it until the game is over.',
  'reveal.fileReveal': 'Reveal string',
  'reveal.fileCommit': 'Commit code sent to the opponent',
  'reveal.fileSettings': 'Settings code',
  'reveal.fileEnds': 'Entrance / exit',
  'reveal.fileSaved': 'Saved at',
  'reveal.fileWhy':
    'After the game you paste the reveal string to your opponent. It proves the maze you played with is the one you committed to before the first move.',
  'reveal.fileLost':
    'If you lose this file you cannot reveal, and a player who cannot reveal loses by the rules.',

  'build.gameStarted':
    'The game has started, so the maze is frozen for good. Changing a wall now would rewrite a game that is already being played.',
  'build.backToGame': 'Back to the game',

  'play.yourTurn': 'Your move',
  'play.theirTurn': "Opponent's move",
  'play.statusOut': 'You are out',
  'play.status': '{turn} · move {move} · round {round} · new cells {cells}/{limit}',
  'play.myMazeTitle': 'My maze · opponent walks here',
  'play.opponentMazeTitle': "Opponent's maze · you walk here",
  'play.helpSummary': 'How a turn is entered',
  'play.helpMine':
    'Your move: click one of the highlighted neighbouring cells on the right board, then say what your opponent answered.',
  'play.helpTheirs':
    "Opponent's move: click the cell they named on the left board. The answer comes from your own walls, and the line to read out loud appears above.",
  'play.helpAuto':
    'An edge you have already walked through is answered from your own map: your opponent said it once and is not asked again. A wall you already know is never assumed - it is offered for confirmation, because such a step ends your turn.',
  'play.helpKeys':
    'Keys: arrows or WASD to step, P or 1 for passed, B or 2 for wall, Escape to choose another step. Enter is not bound to any answer on purpose.',
  'play.chooseYourStep': 'Choose your step',
  'play.chooseTheirStep': 'Enter the step your opponent named',
  'play.askAnswer': 'You step {from} → {to}. What did your opponent answer?',
  'play.askAnswerHint':
    'P or 1 for passed, B or 2 for wall. Enter is deliberately not bound: an answer goes into the journal and cannot be argued away later.',
  'play.answerPassed': 'Passed (P)',
  'play.answerWalled': 'Wall (B)',
  'play.cancelStep': 'Choose another step (Esc)',
  'play.undoStepMine': 'Take my step back',
  'play.undoStepTheirs': "Take opponent's step back",
  'play.confirmWall': 'Yes, it is a wall (B)',
  'play.confirmWallQuestion': 'You already know {from} → {to} is a wall. The turn would end there.',
  'play.confirmWallHint':
    'Nothing is blocked, but nothing is assumed either: a step into a wall you already found ends your turn, so it is only made on purpose.',
  'play.fromMap': 'From your map: {from} → {to} is open',
  'play.fromMapHint':
    'Your opponent answered about this edge earlier, so they were not asked again. Such a step can never open a new cell, and it spends nothing.',
  'play.overrideAuto': 'My opponent answered otherwise',
  'play.timerOver': 'Turn clock +{clock}',
  'play.finishGame': 'End the game',
  'play.finishWhy':
    'A resignation has to be recorded here, whoever made it. Without it the verification step judges the game as if nobody had given up, and gets the wrong result.',
  'play.finished': 'You have resigned',
  'play.finishedHint':
    'This device is out of the game. The verdict, yours or your opponent’s, is computed at the verification step, and you still have to exchange reveals.',
  'play.passMine': 'Pass my turn',
  'play.passTheirs': "Pass opponent's turn",
  'play.sayPass': 'SAY: PASSED',
  'play.sayWall': 'SAY: WALL {from}-{to}',
  'play.endTurn': 'End the turn',
  'play.undo': 'Take the turn back',
  'play.resign': 'Resign',
  'play.resignThem': 'Opponent resigned',
  'play.resignThemConfirm': 'Yes, they resigned',
  'play.resignThemWarning':
    'Press again to record that your opponent resigned. It goes into the game and decides it in your favour.',
  'play.theyResigned': 'Your opponent resigned. The verdict is computed at the verification step.',
  'play.finishedThem': 'Your opponent resigned',
  'play.finishedThemHint':
    'The game is over. You still exchange reveals: the verdict is computed at the verification step.',
  'play.handedOverWall': 'Turn handed over: wall {from}-{to}',
  'play.handedOverCells': 'Turn handed over: the new cells for this turn are used up',
  'play.resignConfirm': 'Resign for real',
  'play.resignWarning': 'Press again to resign. This is recorded and decides the game against you.',
  'play.resigned': 'You have resigned. The verdict is computed at the verification step.',
  'play.toVerify': 'To verification',
  'play.counters': 'Me: {mine} | Opponent: {theirs}',
  'play.limit': 'Moves used {total} of {limit}.',
  'play.noLimit': 'Moves used {total}. This game has no move limit.',
  'play.timerLeft': 'Turn clock {clock}',
  'play.historyMine': 'My moves',
  'play.historyTheirs': "Opponent's moves",
  'play.historyEmpty': 'Nothing yet.',
  'play.problemTitle': 'The game could not be restored',
  'play.journalBroken':
    'The stored game could not be replayed and was left untouched. You can start the game again from move one. Details: {message}',
  'play.journalDropped':
    'The stored game was damaged and had to be dropped. The setup is intact, so the game can start again from move one.',
  'play.actionRefused':
    'The core refused that action, which means this screen offered something it should not have. Nothing was recorded. Details: {message}',
  'play.setupMissing':
    'The settings, your maze or the announced ends are missing, so there is no game to play. Go back to building.',
  'play.restart': 'Start the game again',

  'history.step': '{from}-{to}',
  'history.wallStep': 'wall {from}-{to}',
  'history.pass': 'PASSED',
  'history.undo': 'TURN TAKEN BACK',
  'history.stepTakenBack': 'STEP TAKEN BACK: {from}-{to}',
  'history.resign': 'RESIGNED',
  'history.noSteps': 'no steps',

  'hint.TURN_OVER_WALL': 'A wall. The turn is over and the pawn stays where it was.',
  'hint.TURN_OVER_NEW_CELLS': 'The allowance of new cells for this turn is used up. The turn is over.',
  'hint.REACHED_EXIT': 'The exit has been reached. The game does not stop here.',
  'hint.KNOWN_WALL_WARNING': 'This wall is already known. The step is allowed anyway.',
  'hint.MOVE_LIMIT_REACHED': 'The move limit of this game has been reached. Nothing is blocked.',
  'hint.PASS_NOT_ALLOWED': 'Passing a turn is switched off in the settings of this game.',
  'hint.EMPTY_TURN_WARNING': 'A turn without a single step is against the rules, but it was recorded.',
  'hint.UNKNOWN': 'The core returned a hint this version does not know about.',

  'verify.myRevealTitle': 'Your reveal',
  'verify.myRevealExplain':
    'Send this string to your opponent. It proves the maze you played with is the one you committed to before the first move.',
  'verify.myRevealLabel': 'Your reveal string',
  'verify.myRevealHint': '68 characters, checksum included.',
  'verify.myRevealLost':
    'This device can no longer rebuild your reveal string ({message}). Take it from the file you saved before the game and paste it below.',
  'verify.myRevealPasteLabel': 'Paste your reveal from the saved file',
  'verify.myRevealPasteHint': 'The file is plain text; the line that starts with YMR1 is the one.',
  'verify.myRevealPasteAccepted': 'That is a valid reveal string. Send it to your opponent.',
  'verify.saveAgain': 'Save the file again',
  'verify.noRevealRule':
    'A player who cannot reveal loses by the rules, so do not lose that file before the exchange.',
  'verify.theirRevealTitle': "Opponent's reveal",
  'verify.theirRevealLabel': 'Paste the reveal string you were sent',
  'verify.theirRevealHint': 'It is checked the moment you paste it.',
  'verify.theirRevealAccepted': 'The reveal string is intact. The report is below.',
  'verify.noReveal': 'My opponent sent nothing',
  'verify.noRevealConfirm': 'Record that nothing arrived',
  'verify.noRevealWarning':
    'Press again to record it. Make sure you have actually waited - nobody else can check this.',
  'verify.noRevealDeclared': 'You recorded that no reveal arrived.',
  'verify.noRevealNotProof':
    'This is your statement, not a check. The application cannot see whether a reveal was sent; by the rules a player who does not reveal loses, and that is what the line above says.',
  'verify.noCommitTitle': 'There is nothing to check against',
  'verify.noCommitText':
    'This device never received your opponent’s commit code, so a reveal cannot be compared with anything. The commit is the YMC1 code they sent before the first move; enter it on the building screen and come back.',
  'verify.subject':
    'Checking commit {commit} · they announced entrance {entrance} and exit {exit} · settings {settings}',
  'verify.gameRunning':
    'This game is still being played — nobody has resigned. Everything below is counted from the moves made so far, and the verdict will change as the game goes on. Checking now proves nothing about the rest of it.',
  'verify.passedSummary': '{count} checks passed',
  'verify.reviewedTitle': 'This game has been reviewed',
  'verify.reviewedText':
    'The report is above. There is nothing else to do with this game: keep the reveal file until you both agree on the result.',
  'verify.nextGame': 'New game, same rules',
  'verify.nextGameWarning':
    'The new game gets a new game number, which means a new settings code — send it to your opponent before you build. Skip that and the third check will not match at the end, and you will both have played a game for nothing.',
  'verify.reportTitle': 'Report',
  'verify.reportEmpty': 'Paste the reveal string your opponent sent, and the seven checks run here.',
  'verify.mismatchLine':
    '{from}-{to}: said {declared}, the revealed maze says {actual}. {count} time(s).',
  'verify.mismatchMoves': 'moves ({count})',
  'verify.wordWall': 'wall',
  'verify.wordPass': 'open',
  'verify.myBoardTitle': 'My maze',
  'verify.theirBoardTitle': "Opponent's maze",
  'verify.theirBoardHint':
    'After a successful check the whole maze is drawn, with what you scouted during the game on top. Edges where an answer did not match are highlighted.',
  'verify.replayTitle': 'Replay',
  'verify.replayHint': 'Step through the finished game. Nothing here changes it.',
  'verify.replayStart': 'Start',
  'verify.replayBack': 'Back',
  'verify.replayForward': 'Forward',
  'verify.replayPlay': 'Play',
  'verify.replayPause': 'Pause',
  'verify.replayEnd': 'End',
  'verify.replayAt': 'action {at} of {total}',
  'verify.noGameTitle': 'There is no finished game on this device',
  'verify.noGameText':
    'The report needs the game it is about. Play a game first, or restore this device from the setup screen.',

  'check.CODE_INTEGRITY': 'The reveal code itself',
  'check.COMMIT_MATCH': 'The commit',
  'check.SETTINGS_MATCH': 'The settings',
  'check.ENDPOINTS_MATCH': 'The announced entrance and exit',
  'check.MAZE_VALID': 'The maze is a legal maze',
  'check.LOG_REPLAY': 'Every answer, replayed',
  'check.VERDICT': 'The verdict',
  'check.ok': 'Matches.',
  'check.computed': 'computed',
  'check.skipped.EARLIER_CHECK':
    'Skipped: an earlier check did not pass, so this one would prove nothing.',
  'check.skipped.NO_GAME': 'Skipped: this device has no finished game to judge.',
  'check.fail.DAMAGED': 'The code was damaged while copying. Ask for it to be sent again.',
  'check.fail.NOT_A_REVEAL': 'This is not a reveal string, or it was not pasted in full.',
  'check.fail.COMMIT':
    'The commit does not match: either the code was entered with a mistake, or the maze is not the one that was committed to.',
  'check.fail.SETTINGS':
    'The settings inside the reveal are not the ones this game was played under.',
  'check.fail.ENDS':
    'The announced ends were {declaredEntrance} and {declaredExit}; the reveal carries {revealedEntrance} and {revealedExit}.',
  'check.fail.MAZE': 'The revealed maze breaks the rules a maze has to follow.',
  'check.fail.ANSWERS': 'Answers that do not match the revealed maze: {count}.',
  'check.fail.UNKNOWN': 'This check did not pass.',

  'status.ok': 'ok',
  'status.fail': 'failed',
  'status.skipped': 'skipped',

  'verdict.win': 'You win',
  'verdict.loss': 'You lose',
  'verdict.draw': 'A draw',
  'verdict.bothLose': 'Both lose',
  'verdict.none': 'No verdict',
  'verdict.reason.VIOLATION': 'A check did not pass, which decides the game by the rules.',
  'verdict.reason.BOTH_VIOLATED': 'Neither reveal held up.',
  'verdict.reason.RESIGN': 'By resignation.',
  'verdict.reason.BOTH_RESIGNED': 'Both players resigned.',
  'verdict.reason.NO_EXIT_REACHED': 'Nobody reached the exit.',
  'verdict.reason.ONLY_ONE_REACHED_EXIT': 'Only one pawn reached its exit.',
  'verdict.reason.SAME_ROUND': 'Both reached the exit in the same round.',
  'verdict.reason.EARLIER_ROUND': 'The exit was reached in an earlier round.',
  'verdict.reason.EARLIER_MOVE': 'The exit was reached on an earlier move.',
  'verdict.reason.UNKNOWN': 'The core gave a reason this version does not know about.',

  // The rules, written for the two people playing. Every line is meant to be
  // read out of order: someone opens this in the middle of a turn, reads one
  // paragraph and goes back to the game.
  'rules.title': 'Rules',
  'rules.close': 'Back',
  'rules.intro':
    'Each of you builds a maze and then walks the other one blind: you name a step, your opponent says whether it is open or a wall, and you map their maze as you go. Getting your piece from their entrance to their exit, before they do the same in yours, is what wins the game. One rule matters above the rest: you may not lie about your walls. The application is a helper, not a referee — it warns you, it never stops you. Nothing is judged while you play. Before the first move each of you seals a maze; when the game is over you show each other what was inside, and the seals are checked.',

  'rules.quickStart.title': 'How a game goes',
  'rules.quickStart.intro': 'The whole game, from sitting down to knowing who won.',
  'rules.quickStart.step1':
    'Agree on the settings. One of you creates a settings code and sends it over; the other pastes it in.',
  'rules.quickStart.step2':
    'Build your own maze on the left board: an entrance, an exit, and walls between the cells.',
  'rules.quickStart.step3':
    'Tell each other where your entrance and exit are, and mark your opponent’s on the right board. Those two cells are not a secret; the walls are.',
  'rules.quickStart.step4':
    'Lock your maze in. The application seals it, gives you a commit code, and asks you to save a reveal file. Save it.',
  'rules.quickStart.step5':
    'Send your commit code, paste the one you were sent. It is checked the moment it arrives.',
  'rules.quickStart.step6':
    'Play. You say your step out loud; your opponent tells you whether the way is open or a wall stands there.',
  'rules.quickStart.step7':
    'When the game is over, send each other the reveal string from the file you saved.',
  'rules.quickStart.step8':
    'Paste the reveal you were sent. The report replays the whole game against the maze that was sealed and tells you what it found.',
  'rules.quickStart.codes':
    'Nothing here talks to a network. Every code you "send" you send yourself — in a messenger, in a chat, read out over a call. The application only makes those codes and checks the ones you paste back in.',

  'rules.board.title': 'The board and your maze',
  'rules.board.grid':
    'The board is six cells by six. Rows are lettered A to F from the top, columns numbered 1 to 6 from the left, so C3 is the third row and the third column. Pieces move up, down, left and right — never diagonally.',
  'rules.board.walls':
    'A wall stands on the edge between two neighbouring cells, not inside a cell, and it blocks the way in both directions. There are sixty such edges. The outer border is solid everywhere: nothing ever leaves the board, and no wall is placed there.',
  'rules.board.limit':
    'You have a wall budget — twenty by default, and one of the settings you agree on. You do not have to spend all of it.',
  'rules.board.ends':
    'Your maze has exactly one entrance and one exit, and they are different cells. You choose both, and you say them out loud before the game: your opponent needs them to know where their piece starts and where it is going.',
  'rules.board.path':
    'There has to be at least one way from your entrance to your exit. Dead ends and pockets nobody can reach are fine. A maze with no way through is not a maze, it is a wall with decorations.',
  'rules.board.invalid':
    'A game cannot start on a maze that breaks one of those rules: no entrance or no exit, both on the same cell, more walls than the budget, an entrance or an exit shut in on every side, or no path from one to the other. Everything wrong is listed at once, so it can be fixed in one pass.',

  'rules.turn.title': 'Your turn',
  'rules.turn.first':
    'The settings decide who moves first. Your piece starts on your opponent’s entrance and is making for their exit; theirs starts on yours and is making for your exit. Nobody walks their own maze — you already know where your walls are.',
  'rules.turn.step':
    'A step is one move into a neighbouring cell. You say it out loud, and your opponent answers with what is there: the way is open, or a wall. Both of you write down both sides — your own steps on the right board, your opponent’s on the left — so each device carries the whole game.',
  'rules.turn.clock':
    'The clocks are there to be looked at. Neither the one on the building screen nor the one on a turn blocks anything or ends anything: running out of time costs you nothing at all.',
  'rules.turn.rightBoard':
    'The right board starts empty and fills in as you go: it shows only what you have found out yourself — the cells you have stood on, the ways you have walked through, the walls you have run into. That slow uncovering is the game.',
  'rules.turn.theirTurn':
    'On your opponent’s turn they name their step and you answer it: you are the only one who can see your maze. On your device you enter the direction they took and nothing else — your walls are already in there, so the answer follows by itself.',
  'rules.turn.end':
    'A turn does not end on its own. When you have gone as far as you want, or the application says the turn is technically over, you hand it over — that is what writes the turn into the record and passes the move on. There is a switch that hands it over by itself once the turn is technically over; it is a convenience of your device alone and changes nothing about the game.',
  'rules.turn.newCells':
    'A turn gives you three new cells by default. Stepping onto a cell you have never stood on spends one of them; when they are gone, the turn is over.',
  'rules.turn.wall':
    'A wall ends the turn on the spot. Your piece stays where it was, the wall is marked on the board for both of you, and it costs none of your new cells. Learning where a wall is, is what a turn is for.',
  'rules.turn.visited':
    'Walking back over cells you have already stood on costs nothing at all. Only new ground is rationed, so there is no reason to be afraid of retracing your way.',
  'rules.turn.known':
    'The application remembers every answer, so your opponent is never asked the same thing twice. A way you have already walked through is simply taken. A wall you have already found needs one confirmation before you walk into it, because that step ends your turn and a slip of the mouse should not cost a turn.',
  'rules.turn.override':
    'If your opponent says something different this time — people misremember — there is a small way to ask the question again next to any step that was answered from memory. The earlier step is taken back and both the step and the correction stay in the record.',
  'rules.turn.pass':
    'Skipping a turn is not allowed unless the settings say it is. A skip still counts as a turn: it raises your count and it comes out of the total the game is capped at.',
  'rules.turn.undo':
    'A step can be taken back while the turn is still open; once a turn is handed over, only the whole turn can be taken back. Nothing is ever erased — the record keeps the move and the taking back side by side, so the two of you can always see what really happened.',

  'rules.end.title': 'How a game ends',
  'rules.end.exit':
    'Reaching the exit does not end the game. The move you first stood on it is written down, and that number is what decides the result later.',
  'rules.end.limit':
    'The game is capped at 150 moves by both players together, by default. The application says when the cap is reached.',
  'rules.end.afterExit':
    'One setting decides how two finishes are compared. With "Play continues after the exit is reached" on, what counts is the round each of you reached it in — a round is one move by each player — and the same round is a draw. With it off, the exact move number decides and a draw is impossible.',
  'rules.end.resign':
    'You can resign. It takes two presses and it cannot be taken back: a resignation is a statement, not a move.',
  'rules.end.resignThem':
    'If your opponent resigns out loud, record it on your device too. A resignation nobody wrote down is a resignation the check never sees, and the verdict comes out as if the game had just stopped in the middle.',
  'rules.end.again':
    'After the report there is a way to start another game under the same settings. Take it: it draws a new game number, and with it a new settings code that has to be sent to your opponent before either of you builds anything. Play a rematch on the old code and the third check will not match at the end — a whole game played for nothing.',
  'rules.end.verdict':
    'Nothing is judged while you play. The result is worked out at the verification step, from the sealed mazes and the answers that were given.',

  'rules.commit.title': 'Sealing your maze, and showing it afterwards',
  'rules.commit.why':
    'You may not lie about your walls, and the game would be unplayable if nobody could tell whether you did. So before the first move each of you seals their maze: the application takes your maze, your settings and a random number, and boils them down to one short code — the commit.',
  'rules.commit.nothing':
    'The commit gives nothing away: nobody can read your walls out of it. What it does is tie you to the maze you have. There is no maze you can invent afterwards that fits the code you already sent.',
  'rules.commit.envelope':
    'Think of an envelope. The commit is the wax seal on the outside: you send your opponent a picture of the seal, it tells them nothing about the letter, and swapping the letter afterwards would break it. The reveal is the letter itself. Two different things, made in the same moment on the same screen — one is sent, one is saved.',
  'rules.commit.which':
    'The commit code goes to your opponent before the first move, and theirs comes to you. The reveal file goes onto your own disk and stays there until the game has been checked: it is not sent anywhere and nobody but you ever sees it during the game.',
  'rules.commit.exchange':
    'You exchange commits before the first move, and each one is checked the moment it is pasted. A code with a character lost on the way is caught right then, while you can still ask for it again — not at the end of the game, when a broken code looks like something far worse.',
  'rules.commit.file':
    'The reveal is your maze and that random number written out in full. The application makes you save it as a file before the game starts, because the random number exists nowhere else: not on a server, not in the code you sent, only in that file and in this browser.',
  'rules.commit.lost':
    'Lose the file and clear the page, and you cannot reveal at all. By the rules, a player who cannot reveal loses. Keep the file until the game has been checked and you both agree on the result.',
  'rules.commit.after':
    'When the game is over, send each other the reveal string. Then either of you can check the other, and neither can change anything.',

  'rules.verify.title': 'The check at the end',
  'rules.verify.intro':
    'Paste the reveal you were sent, and seven things are checked in order. Each one is shown with what it found.',
  'rules.verify.check1': 'the string arrived whole: nothing is missing and its checksum agrees.',
  'rules.verify.check2':
    'the maze in the reveal is the maze that was sealed before the first move.',
  'rules.verify.check3':
    'you both played under the same agreed settings, and under the same game number.',
  'rules.verify.check4': 'the entrance and the exit are the ones that were announced out loud.',
  'rules.verify.check5': 'the revealed maze obeys the rules: the wall budget, open ends, a way through.',
  'rules.verify.check6':
    'every answer given during the game is replayed against the revealed maze, move by move.',
  'rules.verify.check7': 'the result of the game, worked out from everything above.',
  'rules.verify.damaged':
    'A string that fails the first check was damaged on the way: copied short, folded by a messenger, a character dropped. That is not an accusation and it is not treated as one — ask for the string again.',
  'rules.verify.commitFailed':
    'If the seal does not match, the application says only that: either the string was entered wrong, or the maze that was revealed is not the maze that was sealed. Which of the two it is, nobody can tell from here.',
  'rules.verify.mismatch':
    'A mismatch in the sixth check means an answer given during the game does not agree with the revealed maze — a wall where the maze is open, or an open way where the maze has a wall. Repeats on the same edge are gathered into one line, because one wrong answer about a busy edge shows up every time anyone walks there. By the rules, a player caught this way loses the game.',
  'rules.verify.replay':
    'Under the report the whole game can be stepped through, move by move, on the maze as it really was.',

  'rules.limits.title': 'What this cannot do',
  'rules.limits.intro':
    'The seal makes one particular lie impossible. It does not make the game unbreakable, and it is worth knowing where it stops.',
  'rules.limits.noReveal':
    'If your opponent never sends a reveal, nothing can be proved. The application sees an empty field and nothing more. The rules say a player who does not reveal loses, and there is a button to record that — clearly marked as your statement rather than as a computed result.',
  'rules.limits.dispute':
    'Everything said during the game is written down on your own device only. If you disagree afterwards about who said what, no amount of checking will settle it: there is no server and no shared record.',
  'rules.limits.lostFile':
    'A lost reveal file cannot be rebuilt from anything. The random number in it is not stored anywhere else.',

  'rules.glossary.title': 'The four words',
  'rules.glossary.settingsCodeTerm': 'Settings code',
  'rules.glossary.settingsCode':
    'The short code carrying the settings you agreed on and the number of this particular game. Both of you must be playing under the same one.',
  'rules.glossary.commitTerm': 'Commit',
  'rules.glossary.commit':
    'The seal of your maze, sent before the first move. It says nothing about your walls and cannot be made to fit another maze.',
  'rules.glossary.revealTerm': 'Reveal',
  'rules.glossary.reveal':
    'Your maze and its random number written out in full, sent after the game. This is what the seal is checked against.',
  'rules.glossary.saltTerm': 'Salt',
  'rules.glossary.salt':
    'The random number that goes into the seal. Without it, two identical mazes would give the same commit, and anyone could find a maze by trying them all.',
};

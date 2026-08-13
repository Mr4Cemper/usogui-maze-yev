/**
 * The four tones (SPEC 5.10).
 *
 * The engine needs a browser, so what is checked here is the decision: which
 * action makes which sound, and - the one that matters - that replaying a
 * journal makes none at all. A game restored from storage replays every action
 * it holds; a screen that sounded on each of them would open with a burst of
 * machine gun fire, and that is exactly the kind of thing nobody notices while
 * developing, because the journal is short and the sound is off.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PEAK_GAIN, SOUNDS, VOICES, createSound, soundForAction } from '../src/ui/sound.js';

/**
 * What the core hands back for a step.
 *
 * @param {'pass'|'wall'} result What happened.
 * @param {string[]} [hints] Hints from the core.
 * @returns {object} A step result.
 */
function stepResult(result, hints = []) {
  return { result, isNewCell: true, hints, edge: 'V1,1', from: { r: 1, c: 1 }, to: { r: 1, c: 2 } };
}

test('replaying a journal makes no sound at all', () => {
  const journal = [
    { type: 'START_TURN' },
    { type: 'STEP', side: 'me', direction: 'down', answer: 'pass', auto: false },
    { type: 'STEP', side: 'me', direction: 'up', answer: 'wall', auto: false },
    { type: 'END_TURN' },
    { type: 'PASS' },
  ];
  for (const action of journal) {
    assert.equal(
      soundForAction({ action, result: stepResult('pass', ['REACHED_EXIT']), live: false }),
      null,
      `${action.type} sounded during a replay`,
    );
  }
});

test('the four live events each get their own sound', () => {
  assert.equal(
    soundForAction({ action: { type: 'STEP', side: 'me' }, result: stepResult('pass') }),
    'step',
  );
  assert.equal(
    soundForAction({ action: { type: 'STEP', side: 'me' }, result: stepResult('wall') }),
    'wall',
  );
  assert.equal(soundForAction({ action: { type: 'END_TURN' }, result: { ok: true } }), 'turn');
  assert.equal(
    soundForAction({
      action: { type: 'STEP', side: 'opponent' },
      result: stepResult('pass', ['REACHED_EXIT']),
    }),
    'exit',
  );
});

test('nothing else sounds', () => {
  // Four is the whole set. Undo, resignation and opening a turn are silent on
  // purpose: every extra sound wears out faster than it helps.
  for (const type of ['START_TURN', 'UNDO_STEP', 'UNDO', 'RESIGN']) {
    assert.equal(soundForAction({ action: { type } }), null, type);
  }
  // A pass the core refused is not a hand-over.
  assert.equal(soundForAction({ action: { type: 'PASS' }, result: { ok: false } }), null);
  // Junk in, silence out.
  assert.equal(soundForAction({ action: null }), null);
  assert.equal(soundForAction({ action: { type: 'STEP' }, result: null }), null);
});

test('the exit outranks the wall it may arrive with', () => {
  // A step can be the last one of a turn and the winning one at once; the
  // player must hear the exit, not the end of the turn.
  assert.equal(
    soundForAction({
      action: { type: 'STEP', side: 'me' },
      result: stepResult('pass', ['TURN_OVER_NEW_CELLS', 'REACHED_EXIT']),
    }),
    'exit',
  );
});

test('the voices are short, audible and named the same as the sounds', () => {
  assert.deepEqual(Object.keys(VOICES).sort(), [...SOUNDS].sort());
  for (const [name, tones] of Object.entries(VOICES)) {
    assert.equal(tones.length >= 1 && tones.length <= 2, true, `${name} is a tone, not a tune`);
    let total = 0;
    for (const tone of tones) {
      assert.equal(tone.hz > 80 && tone.hz < 4000, true, `${name}: ${tone.hz} Hz`);
      total += tone.seconds;
    }
    assert.equal(total <= 0.3, true, `${name} lasts ${total}s`);
  }
  // Quiet by default and not adjustable: the players are talking over this.
  assert.equal(PEAK_GAIN > 0 && PEAK_GAIN <= 0.1, true);
});

test('a switched off sound never opens the audio device', () => {
  // Building an AudioContext outside a user gesture is how a page ends up with
  // one that is suspended forever.
  let built = 0;
  const Context = class {
    constructor() {
      built += 1;
      this.state = 'running';
      this.currentTime = 0;
      this.destination = {};
    }
  };
  const off = createSound({ isOn: () => false, Context });
  assert.equal(off.play('step'), false);
  off.unlock();
  assert.equal(built, 0);
});

test('a sound that is on builds the device once and plays', () => {
  const started = [];
  const Context = class {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.destination = { name: 'out' };
    }

    createOscillator() {
      const node = {
        frequency: { setValueAtTime: () => {} },
        connect: (next) => next,
        start: (at) => started.push(at),
        stop: () => {},
      };
      return node;
    }

    createGain() {
      return {
        gain: {
          setValueAtTime: () => {},
          linearRampToValueAtTime: () => {},
          exponentialRampToValueAtTime: () => {},
        },
        connect: (next) => next,
      };
    }
  };
  const sound = createSound({ isOn: () => true, Context });
  assert.equal(sound.play('exit'), true);
  assert.equal(started.length, VOICES.exit.length);
  // A name nobody defined is silence, not a crash.
  assert.equal(sound.play('fanfare'), false);
});

test('no Web Audio means silence, not a broken screen', () => {
  const sound = createSound({ isOn: () => true, Context: null });
  const saved = globalThis.AudioContext;
  delete globalThis.AudioContext;
  try {
    assert.equal(sound.play('step'), false);
  } finally {
    if (saved !== undefined) {
      globalThis.AudioContext = saved;
    }
  }
});

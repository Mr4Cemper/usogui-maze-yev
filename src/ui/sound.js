/**
 * sound.js - four short tones, generated, never loaded (SPEC 5.10).
 *
 * No files: the application is one self contained page, and a sound file would
 * either bloat it or hang off the network. Web Audio makes the four tones out
 * of an oscillator and a gain ramp, which costs a few hundred bytes of code.
 *
 * Two things here are worth reading before changing anything.
 *
 * `soundForAction` is pure and decides *whether* an action makes a noise. It
 * takes `live`, and answers null for everything that is not a live action:
 * restoring a game replays its whole journal at load, and a screen that sounded
 * on every replayed step would greet the player with a burst of machine gun
 * fire. The engine below is the only thing that talks to the browser.
 *
 * The `AudioContext` is built on the first sound and not before. A context
 * created outside a user gesture starts suspended and, in some browsers, stays
 * that way for the life of the page - a failure that never shows up while
 * developing, because the developer has clicked something long before.
 */

/** The four events that make a sound. Nothing else does (SPEC 5.10). */
export const SOUNDS = Object.freeze(['step', 'wall', 'turn', 'exit']);

/**
 * What each sound is made of.
 *
 * Every voice is a list of tones: frequency in hertz, length in seconds, and
 * the wave. Short and dry on purpose - this is a terminal, not an instrument.
 * The wall is low and blunt, the exit rises, the hand-over falls: three shapes
 * a player can tell apart without looking at the screen.
 */
export const VOICES = Object.freeze({
  // A step that went through: one clean blip, quiet enough to hear a hundred
  // times in a game.
  step: Object.freeze([Object.freeze({ hz: 720, seconds: 0.05, wave: 'triangle' })]),
  // A step that hit a wall: low, blunt and a little longer.
  wall: Object.freeze([Object.freeze({ hz: 150, seconds: 0.16, wave: 'square' })]),
  // The turn changing hands: two notes down.
  turn: Object.freeze([
    Object.freeze({ hz: 520, seconds: 0.06, wave: 'triangle' }),
    Object.freeze({ hz: 390, seconds: 0.08, wave: 'triangle' }),
  ]),
  // The exit: two notes up, the only sound in the set that is allowed to ring.
  exit: Object.freeze([
    Object.freeze({ hz: 660, seconds: 0.07, wave: 'triangle' }),
    Object.freeze({ hz: 990, seconds: 0.18, wave: 'triangle' }),
  ]),
});

/**
 * How loud a tone peaks.
 *
 * Fixed rather than adjustable, and deliberately low: two people playing this
 * game are talking to each other, and the sounds have to fit under a
 * conversation. A slider would be another stored key, another migration and
 * another thing to get wrong, for something the volume control of the device
 * already does.
 */
export const PEAK_GAIN = 0.07;

/**
 * Whether an action makes a sound, and which one.
 *
 * @param {object} options What happened.
 * @param {object} options.action The journal action.
 * @param {object|null} [options.result=null] What the core returned for it.
 * @param {boolean} [options.live=true] False while a journal is being replayed
 *   - restoring a game, or stepping through a finished one.
 * @returns {string|null} A name from {@link SOUNDS}, or null for silence.
 */
export function soundForAction({ action, result = null, live = true }) {
  if (live !== true || action === null || typeof action !== 'object') {
    return null;
  }
  if (action.type === 'STEP') {
    if (result === null) {
      return null;
    }
    // Reaching the exit outranks everything: it is the moment of the game.
    if (Array.isArray(result.hints) && result.hints.includes('REACHED_EXIT')) {
      return 'exit';
    }
    return result.result === 'wall' ? 'wall' : 'step';
  }
  if (action.type === 'END_TURN' || action.type === 'PASS') {
    // A pass the core refused is not a hand-over and must not sound like one.
    return result !== null && result.ok === false ? null : 'turn';
  }
  // Starting a turn, taking one back, resigning: either silent by nature or
  // deliberately left silent. Four sounds is the whole set (SPEC 5.10).
  return null;
}

/**
 * The thing that actually makes noise.
 *
 * @param {object} [options] Wiring.
 * @param {() => boolean} [options.isOn] Whether sound is switched on right now.
 *   Asked at every sound rather than stored, so the switch takes effect at once.
 * @param {typeof AudioContext} [options.Context] For tests and for browsers
 *   that only have the prefixed constructor.
 * @returns {{play: (name: string) => boolean, unlock: () => void, close: () => void}}
 *   `play` returns whether anything was made.
 */
export function createSound({ isOn = () => false, Context = null } = {}) {
  const Ctor =
    Context ??
    (typeof globalThis.AudioContext === 'function'
      ? globalThis.AudioContext
      : globalThis.webkitAudioContext ?? null);
  let context = null;

  /**
   * Hands back the context, building it the first time.
   *
   * @returns {object|null} The context, or null where Web Audio is missing.
   */
  function ensureContext() {
    if (Ctor === null) {
      return null;
    }
    if (context === null) {
      try {
        context = new Ctor();
      } catch (error) {
        // No Web Audio, or the browser refused to give a context. The game is
        // played by voice anyway; silence is a fine outcome.
        console.warn('sound is unavailable:', error.message);
        return null;
      }
    }
    if (context.state === 'suspended') {
      // Only ever called from inside a click or a key press, which is the one
      // moment a browser allows this.
      context.resume?.().catch(() => {});
    }
    return context;
  }

  return {
    /**
     * Opens the audio device on a user gesture, so the first real sound is not
     * the one that gets swallowed.
     *
     * @returns {void}
     */
    unlock() {
      if (isOn()) {
        ensureContext();
      }
    },

    /**
     * Plays one of the four sounds.
     *
     * @param {string} name A name from {@link SOUNDS}.
     * @returns {boolean} True when something was scheduled.
     */
    play(name) {
      if (!isOn() || !Object.prototype.hasOwnProperty.call(VOICES, name)) {
        return false;
      }
      const audio = ensureContext();
      if (audio === null) {
        return false;
      }
      let at = audio.currentTime;
      for (const tone of VOICES[name]) {
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(tone.hz, at);
        // A tone that starts and stops at full volume clicks. The ramps are
        // what make four bare oscillators sound like an instrument panel
        // rather than like a fault.
        gain.gain.setValueAtTime(0, at);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + tone.seconds);
        oscillator.connect(gain).connect(audio.destination);
        oscillator.start(at);
        oscillator.stop(at + tone.seconds + 0.02);
        at += tone.seconds;
      }
      return true;
    },

    /**
     * Lets go of the audio device.
     *
     * @returns {void}
     */
    close() {
      context?.close?.();
      context = null;
    },
  };
}

/**
 * rain.js - the falling code behind everything (SPEC 5.13).
 *
 * It is decoration, so it is not allowed to cost anything:
 *   - about twenty frames a second, driven by requestAnimationFrame rather
 *     than a timer, so the browser can throttle it like any other animation;
 *   - completely stopped while the tab is hidden;
 *   - never started when the system asks for reduced motion;
 *   - fewer columns on a narrow screen, where a phone would feel the heat;
 *   - and a switch in the interface for whoever finds it distracting.
 *
 * The colour is read from the theme, so the rain follows the role palette
 * without knowing anything about roles.
 */

/** Katakana plus hex digits, as in the prototype. */
const GLYPHS = 'アィウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF';

/** Milliseconds between frames: 20 fps is plenty for falling glyphs. */
const FRAME_MS = 50;

/** Cell size in pixels; the wider one thins the rain out on small screens. */
const GLYPH_SIZE = 14;
const GLYPH_SIZE_NARROW = 20;
const NARROW_WIDTH = 700;

/**
 * Tells whether the system asked for less movement.
 *
 * @returns {boolean} True when reduced motion is requested.
 */
export function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * Starts the rain on a canvas.
 *
 * @param {HTMLCanvasElement} canvas Canvas that covers the viewport.
 * @param {object} [options={}] Options.
 * @param {boolean} [options.enabled=true] Whether it runs from the start.
 * @returns {{setEnabled: (on: boolean) => void, isRunning: () => boolean, refreshColour: () => void, destroy: () => void}}
 *   Controls. `setEnabled(true)` is ignored while reduced motion is on.
 * @throws {Error} If the canvas cannot give a 2d context.
 */
export function createRain(canvas, options = {}) {
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('the rain canvas has no 2d context');
  }

  let enabled = options.enabled !== false;
  let frame = null;
  let lastDraw = 0;
  let drops = [];
  let glyphSize = GLYPH_SIZE;
  // Filled in from the tokens before the first frame: a colour written here
  // would be one theme's accent showing through every other theme.
  let colour = 'transparent';

  /**
   * Reads the accent colour of the current theme.
   *
   * @returns {void}
   */
  function refreshColour() {
    const value = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    if (value !== '') {
      colour = value;
    }
  }

  /**
   * Sizes the canvas to the window and lays out the columns.
   *
   * @returns {void}
   */
  function resize() {
    canvas.width = globalThis.innerWidth;
    canvas.height = globalThis.innerHeight;
    glyphSize = canvas.width < NARROW_WIDTH ? GLYPH_SIZE_NARROW : GLYPH_SIZE;
    const columns = Math.ceil(canvas.width / glyphSize);
    drops = Array.from({ length: columns }, () => Math.random() * -100);
  }

  /**
   * Draws one frame: fade what is there, then one glyph per column.
   *
   * @returns {void}
   */
  function draw() {
    context.globalCompositeOperation = 'destination-out';
    // Not a colour: with 'destination-out' only the alpha matters, and this
    // is what fades the older glyphs out.
    context.fillStyle = 'rgba(0,0,0,.1)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.globalCompositeOperation = 'source-over';
    context.fillStyle = colour;
    context.font = `${glyphSize}px monospace`;
    for (let i = 0; i < drops.length; i += 1) {
      const glyph = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      context.fillText(glyph, i * glyphSize, drops[i] * glyphSize);
      if (drops[i] * glyphSize > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += 1;
    }
  }

  /**
   * The animation loop, throttled to {@link FRAME_MS}.
   *
   * @param {number} now Timestamp from requestAnimationFrame.
   * @returns {void}
   */
  function step(now) {
    frame = requestAnimationFrame(step);
    if (now - lastDraw < FRAME_MS) {
      return;
    }
    lastDraw = now;
    draw();
  }

  /**
   * Whether the rain may run right now.
   *
   * @returns {boolean} True when it should be animating.
   */
  function shouldRun() {
    return enabled && !prefersReducedMotion() && document.visibilityState !== 'hidden';
  }

  /**
   * Starts or stops the loop to match {@link shouldRun}.
   *
   * @returns {void}
   */
  function sync() {
    if (shouldRun()) {
      if (frame === null) {
        refreshColour();
        resize();
        frame = requestAnimationFrame(step);
      }
      canvas.hidden = false;
      return;
    }
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.hidden = !enabled || prefersReducedMotion();
  }

  const handleResize = () => {
    if (frame !== null) {
      resize();
    }
  };
  const handleVisibility = () => sync();

  globalThis.addEventListener('resize', handleResize);
  document.addEventListener('visibilitychange', handleVisibility);
  sync();

  return {
    setEnabled(on) {
      enabled = Boolean(on);
      sync();
    },
    isRunning() {
      return frame !== null;
    },
    refreshColour() {
      refreshColour();
    },
    destroy() {
      enabled = false;
      sync();
      globalThis.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
    },
  };
}

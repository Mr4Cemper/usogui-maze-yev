/**
 * build.mjs - bundles the interface into one self contained
 * `Usogui_Maze_yev.html`.
 *
 * The single file is not a nicety: ES modules do not load over `file://`
 * because of CORS, so a page opened by double click has to carry its script
 * and its styles inline (SPEC 5.1). The result must work with no server, no
 * network and no runtime.
 *
 *   node build.mjs            build once
 *   node build.mjs --watch    rebuild on every change
 *   node build.mjs --no-minify
 *
 * The i18n check runs first. A missing key stops the build (SPEC 5.4); in
 * watch mode it is reported and the loop keeps going.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

import { checkI18n } from './tools/check-i18n.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const TEMPLATE = join(ROOT, 'index.html');
const OUTPUT = join(ROOT, 'Usogui_Maze_yev.html');
const STYLE_ENTRY = join(ROOT, 'src', 'styles', 'app.css');
const APP_ENTRY = './src/ui/app.js';

const STYLE_MARK = '/* UMY:STYLES */';
const SCRIPT_MARK = '/* UMY:SCRIPT */';

/**
 * Bundles the interface into one script.
 *
 * @param {boolean} minify Whether to minify.
 * @returns {Promise<string>} The bundled script.
 */
async function bundleScript(minify) {
  const result = await esbuild.build({
    stdin: {
      // The entry only starts the application; everything else is imported.
      contents: `import { main } from '${APP_ENTRY}';\nmain();\n`,
      resolveDir: ROOT,
      sourcefile: 'entry.js',
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    minify,
    // esbuild defaults to an ASCII output, where every Cyrillic letter is
    // written as a six byte escape instead of the two bytes UTF-8 needs. Most
    // of this application is now dictionaries, so that default costs about a
    // third of the file. The page declares UTF-8 in its <meta> (SPEC 5.1).
    charset: 'utf8',
    legalComments: 'none',
    write: false,
  });
  return result.outputFiles[0].text;
}

/**
 * Bundles the stylesheets, following the `@import` chain.
 *
 * @param {boolean} minify Whether to minify.
 * @returns {Promise<string>} The bundled css.
 */
async function bundleStyles(minify) {
  const result = await esbuild.build({
    entryPoints: [STYLE_ENTRY],
    bundle: true,
    minify,
    charset: 'utf8',
    legalComments: 'none',
    write: false,
  });
  return result.outputFiles[0].text;
}

/**
 * Makes a script safe to inline inside a `<script>` element.
 *
 * A literal `</script` anywhere in the bundle would close the tag early; the
 * escape is invisible to JavaScript.
 *
 * @param {string} code Bundled script.
 * @returns {string} The same script, safe to inline.
 */
function escapeForInlineScript(code) {
  return code.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Builds the single file application.
 *
 * @param {object} [options={}] Build options.
 * @param {boolean} [options.minify=true] Whether to minify the bundles.
 * @param {boolean} [options.strictI18n=true] Whether a missing key stops the
 *   build.
 * @returns {Promise<boolean>} True when the file was written.
 * @throws {Error} If bundling fails or a key is missing in a strict build.
 */
export async function build({ minify = true, strictI18n = true } = {}) {
  const report = await checkI18n();
  if (!report.ok) {
    for (const problem of report.problems) {
      console.error(`i18n: ${problem}`);
    }
    if (strictI18n) {
      throw new Error(`build stopped: ${report.problems.length} i18n problem(s)`);
    }
    return false;
  }

  const [script, styles, template] = await Promise.all([
    bundleScript(minify),
    bundleStyles(minify),
    readFile(TEMPLATE, 'utf8'),
  ]);

  if (!template.includes(STYLE_MARK) || !template.includes(SCRIPT_MARK)) {
    throw new Error('index.html lost one of its build marks');
  }

  const html = template
    .replace(STYLE_MARK, () => styles.trim())
    .replace(SCRIPT_MARK, () => escapeForInlineScript(script).trim());

  await writeFile(OUTPUT, html, 'utf8');
  const kilobytes = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`built Usogui_Maze_yev.html (${kilobytes} kB, ${report.used} i18n keys)`);
  return true;
}

/**
 * Rebuilds on every change under src/ and on the template.
 *
 * @param {object} options Build options passed through to {@link build}.
 * @returns {Promise<void>} Never resolves; stop it with Ctrl+C.
 */
async function startWatch(options) {
  /**
   * Runs one build and keeps the loop alive when it fails.
   *
   * @returns {Promise<void>} Resolves when the attempt is over.
   */
  const rebuild = async () => {
    try {
      await build({ ...options, strictI18n: false });
    } catch (error) {
      // In watch mode a broken build is a step in the work, not the end of it.
      console.error(`build failed: ${error.message}`);
    }
  };

  await rebuild();

  let pending = null;
  const schedule = () => {
    if (pending !== null) {
      clearTimeout(pending);
    }
    pending = setTimeout(() => {
      pending = null;
      void rebuild();
    }, 120);
  };

  watch(join(ROOT, 'src'), { recursive: true }, schedule);
  watch(TEMPLATE, schedule);
  console.log('watching src/ and index.html, press Ctrl+C to stop');
  await new Promise(() => {});
}

const args = new Set(process.argv.slice(2));
const options = { minify: !args.has('--no-minify') };

if (args.has('--watch')) {
  await startWatch(options);
} else {
  await build(options);
}

/**
 * pack-public.mjs - collects the set of files that goes into the public
 * repository, into a folder of its own.
 *
 * The job is "gather what belongs there", not "remove what does not". The
 * difference matters: forgetting a file in a white list means it is missing
 * from the publication, and somebody notices. Forgetting one in a black list
 * means it leaked, and nobody notices. So everything here is a white list, and
 * anything not named is not copied.
 *
 * The working repository is private and stays as it is. This script never
 * touches git and never deletes anything outside its own output folder.
 *
 *   node tools/pack-public.mjs              build the set in ./publish
 *   node tools/pack-public.mjs --out=where  somewhere else
 *   node tools/pack-public.mjs --keep       do not clear the folder first
 *
 * Before copying it runs the tests and the dictionary check, and rebuilds the
 * page: a red suite means no set, and a set must never carry yesterday's
 * build. Zero dependencies, like every tool here.
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[/\\]$/, '');
const DEFAULT_OUT = 'publish';

/**
 * Everything the public repository gets, and why.
 *
 * A directory entry copies the whole directory; the extension filter keeps
 * editor leftovers out even when they sit next to sources.
 */
export const WHITE_LIST = Object.freeze([
  // The deliverable itself. An artefact of the build, committed on purpose:
  // downloading this one file is the whole point of the project.
  { path: 'Usogui_Maze_yev.html', why: 'the game: one file, downloaded and opened' },

  // The face of the repository.
  { path: 'README.md', why: 'what it is, how to play, how to build' },
  { path: 'LICENSE', why: 'the terms the game is published under' },
  { path: 'SPEC.md', why: 'the specification: the single source of truth' },

  // Sources.
  { path: 'src', why: 'core, interface, dictionaries and styles', extensions: ['.js', '.css'] },
  { path: 'index.html', why: 'the shell the build inlines script and styles into' },
  { path: 'build.mjs', why: 'the build: sources into the one file' },
  { path: 'package.json', why: 'scripts and the one dev dependency' },
  { path: 'package-lock.json', why: 'the exact version of that dependency' },

  // Everything needed to check the sources are what they claim.
  { path: 'tests', why: 'the suite: it is the argument that the protocol works', extensions: ['.mjs'] },
  { path: 'tools/check-i18n.mjs', why: 'dictionary parity, run by the build' },
  { path: 'tools/serve.mjs', why: 'looking at the built page over http, for storage' },
  { path: 'tools/make-fixture.mjs', why: 'putting the application into a state to look at' },
  { path: 'tools/pack-public.mjs', why: 'this script: the set describes itself' },
  { path: 'examples/roundtrip.mjs', why: 'the crypto cycle end to end, in the console' },

  // The documents a person needs to pick the project up.
  { path: 'docs/HANDOVER.md', why: 'map, state, rakes, manual checks' },
  { path: 'docs/DECISIONS.md', why: 'why things are the way they are' },
  { path: 'docs/GLOSSARY.md', why: 'terms in three languages, fixed once' },
  { path: 'docs/PUBLISH.md', why: 'how this set is made and what never goes in it' },

  // Repository hygiene for the public side.
  { path: '.gitignore', why: 'keeps dependencies and reveal files out of the public repository' },
  { path: '.gitattributes', why: 'line endings, so diffs stay readable' },
]);

/**
 * Things that must never reach the public repository, by shape rather than by
 * name. Checked over the finished set, after copying: a rule that is only
 * applied while copying is a rule that a future white list entry can slip past.
 */
export const FORBIDDEN = Object.freeze([
  { pattern: /(^|[/\\])node_modules([/\\]|$)/i, why: 'dependencies belong to npm, not to a repository' },
  { pattern: /-output\.txt$/i, why: 'output of a run, not a source' },
  { pattern: /reveal/i, why: 'a reveal file carries the salt of a real game (SPEC 4.2)' },
  { pattern: /(^|[/\\])\.(claude|remember|vscode|idea)([/\\]|$)/i, why: 'working directory of a tool' },
  { pattern: /(^|[/\\])fixture/i, why: 'a fixture is a state of somebody’s game' },
  { pattern: /(^|[/\\])preview-/i, why: 'a scratch copy of the built page' },
  { pattern: /\.(env|pem|key|p12)$/i, why: 'secrets have no business here at all' },
]);

/**
 * Reads the command line.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {{out: string, keep: boolean}} The options.
 * @throws {Error} If an argument is not understood.
 */
export function parseArgs(argv) {
  const options = { out: DEFAULT_OUT, keep: false };
  for (const argument of argv) {
    if (argument.startsWith('--out=')) {
      options.out = argument.slice('--out='.length);
    } else if (argument === '--keep') {
      options.keep = true;
    } else {
      throw new Error(`unknown argument ${JSON.stringify(argument)}`);
    }
  }
  return options;
}

/**
 * Runs a command and stops everything when it fails.
 *
 * @param {string} what Human readable name for the step.
 * @param {string[]} args Arguments for node.
 * @returns {void}
 * @throws {Error} If the command did not exit with 0.
 */
function runNode(what, args) {
  process.stdout.write(`  ${what}… `);
  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    process.stdout.write('failed\n\n');
    process.stdout.write((result.stdout ?? '') + (result.stderr ?? ''));
    throw new Error(`${what} failed: the set was not built`);
  }
  process.stdout.write('ok\n');
}

/**
 * Every file inside a directory, as paths relative to the root.
 *
 * @param {string} directory Absolute path.
 * @returns {Promise<string[]>} Relative paths.
 */
async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else {
      files.push(relative(ROOT, full));
    }
  }
  return files;
}

/**
 * Checks a set of paths against {@link FORBIDDEN}.
 *
 * @param {string[]} paths Paths to check.
 * @returns {Array<{path: string, why: string}>} What must not be there.
 */
export function forbiddenIn(paths) {
  const found = [];
  for (const path of paths) {
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(path)) {
        found.push({ path, why: rule.why });
        break;
      }
    }
  }
  return found;
}

/**
 * Builds the set.
 *
 * @param {{out: string, keep: boolean}} options Where to put it.
 * @returns {Promise<{files: number, bytes: number, out: string}>} What was made.
 * @throws {Error} If a check fails or something forbidden reached the set.
 */
export async function pack(options) {
  const out = join(ROOT, options.out);
  if (!out.startsWith(ROOT + sep)) {
    throw new Error('the output folder has to be inside the project');
  }

  process.stdout.write('checks:\n');
  runNode('tests', ['--test', 'tests/**/*.test.mjs']);
  runNode('dictionaries', ['tools/check-i18n.mjs']);
  // Never the page that happens to be lying there: the set carries the build
  // made from the sources it carries.
  runNode('build', ['build.mjs']);

  if (!options.keep && existsSync(out)) {
    await rm(out, { recursive: true });
  }
  await mkdir(out, { recursive: true });

  process.stdout.write('\ncopying:\n');
  for (const entry of WHITE_LIST) {
    const source = join(ROOT, entry.path);
    if (!existsSync(source)) {
      throw new Error(`the white list names ${entry.path}, which is not there`);
    }
    const target = join(out, entry.path);
    await mkdir(dirname(target), { recursive: true });
    const info = await stat(source);
    if (info.isDirectory()) {
      const keep = entry.extensions ?? null;
      await cp(source, target, {
        recursive: true,
        filter: (from) => {
          if (keep === null) {
            return true;
          }
          const name = from.split(/[/\\]/).pop();
          return !name.includes('.') || keep.some((extension) => name.endsWith(extension));
        },
      });
    } else {
      await cp(source, target);
    }
    process.stdout.write(`  ${entry.path}\n`);
  }

  const files = await listFiles(out);
  const forbidden = forbiddenIn(files.map((path) => relative(options.out, path)));
  if (forbidden.length > 0) {
    for (const item of forbidden) {
      process.stderr.write(`  ${item.path} — ${item.why}\n`);
    }
    throw new Error(`${forbidden.length} file(s) must not be published; the set is not usable`);
  }

  let bytes = 0;
  for (const path of files) {
    bytes += (await stat(join(ROOT, path))).size;
  }
  return { files: files.length, bytes, out };
}

if (process.argv[1]?.endsWith('pack-public.mjs')) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await pack(options);
    process.stdout.write(
      `\nset ready: ${result.files} files, ${(result.bytes / 1024).toFixed(1)} kB in ${options.out}/\n` +
        'nothing matching a reveal file, a dependency or a working directory is in it.\n' +
        'next: docs/PUBLISH.md\n',
    );
  } catch (error) {
    process.stderr.write(`\n${error.message}\n`);
    process.exitCode = 1;
  }
}

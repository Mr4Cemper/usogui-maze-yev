/**
 * What a code field does with what a player pastes, before any parser sees it,
 * and how the three parse codes of SPEC 4.6 are told apart on screen.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { describeCodeError, normalizeCodeInput } from '../src/ui/components/codeField.js';
import { MAX_CODE_LENGTH } from '../src/ui/store.js';
import { encodeSettingsCode, decodeSettingsCode } from '../src/core/settings.js';
import { t } from '../src/i18n/index.js';

test('pasted text is trimmed before anything else happens', () => {
  assert.deepEqual(normalizeCodeInput('  YM1-AAAAAAAAAAAAAAA-0000\n'), {
    value: 'YM1-AAAAAAAAAAAAAAA-0000',
    empty: false,
    tooLong: false,
  });
  assert.equal(normalizeCodeInput('   ').empty, true);
  assert.equal(normalizeCodeInput('').empty, true);
  assert.equal(normalizeCodeInput(null).empty, true, 'a missing value is simply empty');
  assert.equal(normalizeCodeInput(undefined).value, '');
});

test('an absurdly long paste is refused before the parser', () => {
  const long = 'A'.repeat(MAX_CODE_LENGTH + 1);
  assert.equal(normalizeCodeInput(long).tooLong, true);
  assert.equal(normalizeCodeInput('A'.repeat(MAX_CODE_LENGTH)).tooLong, false);
  assert.equal(normalizeCodeInput(long, 10).tooLong, true);
});

test('each parse code gets its own line, and none of them says "cheat"', async () => {
  const code = await encodeSettingsCode({});
  const errors = {};
  for (const [name, broken] of [
    ['BAD_FORMAT', 'not a code at all'],
    ['BAD_CHECKSUM', `${code.slice(0, 20)}${code.slice(20) === '0000' ? '1111' : '0000'}`],
  ]) {
    errors[name] = await decodeSettingsCode(broken).then(() => null, (error) => error);
    assert.equal(errors[name].code, name);
  }

  assert.equal(describeCodeError(errors.BAD_FORMAT), t('error.BAD_FORMAT'));
  assert.equal(describeCodeError(errors.BAD_CHECKSUM), t('error.BAD_CHECKSUM'));
  assert.equal(describeCodeError({ code: 'OUT_OF_RANGE' }), t('error.OUT_OF_RANGE'));
  assert.equal(describeCodeError(new Error('something else')), t('error.UNKNOWN'));
  assert.equal(describeCodeError(undefined), t('error.UNKNOWN'));

  const messages = [
    describeCodeError(errors.BAD_FORMAT),
    describeCodeError(errors.BAD_CHECKSUM),
    describeCodeError({ code: 'OUT_OF_RANGE' }),
  ];
  assert.equal(new Set(messages).size, 3, 'three causes, three different messages');
  for (const message of messages) {
    assert.equal(/cheat|lie|liar/i.test(message), false, `an accusation slipped into: ${message}`);
  }
});

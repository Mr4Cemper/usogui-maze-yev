/**
 * screens/setup.js - screen 1: the settings of the game (SPEC 5.3).
 *
 * Two ways through it: one player builds a settings code and sends it, the
 * other pastes it. Either way the whole nine byte block, `game_nonce`
 * included, ends up identical on both devices, which is what makes the commits
 * comparable later.
 *
 * The screen never assembles settings by hand: ranges come from
 * `SETTINGS_FIELDS`, the object comes from `createGameSettings`, the code from
 * `encodeSettingsCode`.
 */

import {
  DEFAULT_SETTINGS,
  SETTINGS_FIELDS,
  createGameSettings,
  decodeSettingsCode,
  encodeSettingsCode,
} from '../../core/settings.js';
import { el, setText, toggleClass } from '../dom.js';
import { createCodeField, createCodeOutput } from '../components/codeField.js';
import { t } from '../../i18n/index.js';

/** Fields the players may change in v1. */
const EDITABLE_FIELDS = Object.freeze([
  'wall_limit',
  'new_cells_per_turn',
  'move_limit_total',
  'allow_pass',
  'play_after_exit',
  'timers_visible',
  'build_timer_sec',
  'turn_timer_sec',
  'first_move',
]);

/** Fields fixed in v1 and shown for reference only. */
const REFERENCE_FIELDS = Object.freeze(['grid_w', 'grid_h', 'exits_count']);

const BOOLEAN_FIELDS = Object.freeze(['allow_pass', 'play_after_exit', 'timers_visible']);

/**
 * Label of a settings field.
 *
 * @param {string} name Field name.
 * @returns {string} Label text.
 */
function fieldLabel(name) {
  switch (name) {
    case 'wall_limit':
      return t('settings.wall_limit');
    case 'new_cells_per_turn':
      return t('settings.new_cells_per_turn');
    case 'move_limit_total':
      return t('settings.move_limit_total');
    case 'allow_pass':
      return t('settings.allow_pass');
    case 'play_after_exit':
      return t('settings.play_after_exit');
    case 'timers_visible':
      return t('settings.timers_visible');
    case 'build_timer_sec':
      return t('settings.build_timer_sec');
    case 'turn_timer_sec':
      return t('settings.turn_timer_sec');
    case 'first_move':
      return t('settings.first_move');
    case 'grid_w':
      return t('settings.grid_w');
    case 'grid_h':
      return t('settings.grid_h');
    case 'exits_count':
      return t('settings.exits_count');
    default:
      return name;
  }
}

/**
 * One line explaining what a field does.
 *
 * @param {string} name Field name.
 * @returns {string} Hint text.
 */
function fieldHint(name) {
  switch (name) {
    case 'wall_limit':
      return t('settings.hint.wall_limit');
    case 'new_cells_per_turn':
      return t('settings.hint.new_cells_per_turn');
    case 'move_limit_total':
      return t('settings.hint.move_limit_total');
    case 'allow_pass':
      return t('settings.hint.allow_pass');
    case 'play_after_exit':
      return t('settings.hint.play_after_exit');
    case 'timers_visible':
      return t('settings.hint.timers_visible');
    case 'build_timer_sec':
      return t('settings.hint.build_timer_sec');
    case 'turn_timer_sec':
      return t('settings.hint.turn_timer_sec');
    case 'first_move':
      return t('settings.hint.first_move');
    default:
      return '';
  }
}

/**
 * Looks a field up in the core table.
 *
 * @param {string} name Field name.
 * @returns {{name: string, bits: number, min: number, max: number}} The field.
 * @throws {Error} If the core does not know the field.
 */
function fieldSpec(name) {
  const found = SETTINGS_FIELDS.find((field) => field.name === name);
  if (found === undefined) {
    throw new Error(`the core has no setting called ${JSON.stringify(name)}`);
  }
  return found;
}

/**
 * Builds screen 1.
 *
 * @param {object} options Screen options.
 * @param {object} options.store The application store.
 * @returns {{root: HTMLElement, update: (state: object) => void, destroy: () => void}}
 *   The screen element, its updater and a cleanup hook.
 */
export function createSetupScreen({ store }) {
  const controls = new Map();
  const errors = new Map();
  // Which settings object the form currently shows. Unsaved edits must survive
  // an unrelated state change, so the form is only rewritten when the settings
  // themselves were replaced.
  let shownSettings = null;

  const roleInputs = [1, 2].map((player) =>
    el('label', { class: 'checkbox' }, [
      el('input', {
        attrs: { type: 'radio', name: 'my-player', value: String(player) },
        on: {
          change: () => store.setState({ myPlayer: player }),
        },
      }),
      el('span', { text: player === 1 ? t('setup.rolePlayer1') : t('setup.rolePlayer2') }),
    ]),
  );

  const rolePanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('setup.roleTitle') }),
    el('div', { class: 'button-row' }, roleInputs),
    el('p', { class: 'panel__hint', text: t('setup.roleWarning') }),
  ]);

  const fieldGrid = el('div', { class: 'field-grid' });
  for (const name of EDITABLE_FIELDS) {
    const spec = fieldSpec(name);
    const error = el('div', { class: 'field__error' });
    let control;

    if (BOOLEAN_FIELDS.includes(name)) {
      control = el('input', { attrs: { type: 'checkbox' } });
      fieldGrid.appendChild(
        el('div', { class: 'field' }, [
          el('label', { class: 'checkbox' }, [control, el('span', { text: fieldLabel(name) })]),
          el('p', { class: 'panel__hint', text: fieldHint(name) }),
          error,
        ]),
      );
    } else if (name === 'first_move') {
      control = el('select', {}, [
        el('option', { attrs: { value: '0' }, text: t('setup.firstMovePlayer1') }),
        el('option', { attrs: { value: '1' }, text: t('setup.firstMovePlayer2') }),
      ]);
      fieldGrid.appendChild(
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: fieldLabel(name) }),
          control,
          el('p', { class: 'panel__hint', text: fieldHint(name) }),
          error,
        ]),
      );
    } else {
      control = el('input', {
        attrs: { type: 'number', min: String(spec.min), max: String(spec.max), step: '1' },
      });
      fieldGrid.appendChild(
        el('div', { class: 'field' }, [
          el('label', { class: 'field__label', text: fieldLabel(name) }),
          control,
          el('span', {
            class: 'field__range',
            text: t('settings.range', { min: spec.min, max: spec.max }),
          }),
          el('p', { class: 'panel__hint', text: fieldHint(name) }),
          error,
        ]),
      );
    }

    control.addEventListener('input', handleFieldInput);
    control.addEventListener('change', handleFieldInput);
    controls.set(name, control);
    errors.set(name, error);
  }

  const referenceLine = el('p', { class: 'panel__hint' });
  const settingsPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('setup.settingsTitle') }),
    el('p', { class: 'panel__hint', text: t('setup.settingsHint') }),
    fieldGrid,
    referenceLine,
  ]);

  const lockNotice = el('p', { class: 'status is-warn' });
  const editButton = el('button', {
    text: t('setup.editImported'),
    attrs: { type: 'button' },
    on: { click: () => store.setState({ settingsLocked: false }) },
  });

  const codeOutput = createCodeOutput({
    label: t('setup.myCodeLabel'),
    hint: t('setup.myCodeHint'),
  });
  const createButton = el('button', {
    class: 'is-primary',
    text: t('setup.createCode'),
    attrs: { type: 'button' },
    on: { click: () => void createCode() },
  });
  const createStatus = el('div', { class: 'status', attrs: { role: 'status' } });

  const createPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('setup.createTitle') }),
    el('p', { class: 'panel__hint', text: t('setup.createHint') }),
    el('div', { class: 'button-row' }, [createButton, editButton]),
    createStatus,
    lockNotice,
    codeOutput.root,
  ]);

  const importField = createCodeField({
    label: t('setup.importLabel'),
    hint: t('setup.importHint'),
    placeholder: 'YM1-XXXXXXXXXXXXXXX-XXXX',
    acceptedText: t('setup.importAccepted'),
    decode: (value) => decodeSettingsCode(value),
    onAccepted: (settings, value) => {
      store.setState({
        settings,
        settingsCode: value,
        settingsOrigin: 'imported',
        settingsLocked: true,
      });
      writeForm(settings);
    },
  });

  const importPanel = el('section', { class: 'panel' }, [
    el('h2', { class: 'panel__title', text: t('setup.importTitle') }),
    importField.root,
  ]);

  const continueStatus = el('div', { class: 'status' });
  const continueButton = el('button', {
    class: 'is-primary',
    text: t('setup.continue'),
    attrs: { type: 'button' },
    on: { click: () => store.setState({ screen: 'build' }) },
  });
  const continuePanel = el('section', { class: 'panel' }, [
    el('div', { class: 'button-row' }, [continueButton]),
    continueStatus,
  ]);

  const root = el('div', { class: 'screen' }, [
    el('section', { class: 'panel' }, [
      el('h2', { class: 'panel__title', text: t('setup.title') }),
      el('p', { class: 'panel__hint', text: t('setup.intro') }),
    ]),
    rolePanel,
    settingsPanel,
    el('div', { class: 'columns' }, [createPanel, importPanel]),
    continuePanel,
  ]);

  /**
   * Reads one field and reports whether it is inside its range.
   *
   * @param {string} name Field name.
   * @returns {{value: number, valid: boolean}} The value and its verdict.
   */
  function readField(name) {
    const spec = fieldSpec(name);
    const control = controls.get(name);
    if (BOOLEAN_FIELDS.includes(name)) {
      return { value: control.checked ? 1 : 0, valid: true };
    }
    if (name === 'first_move') {
      return { value: Number(control.value), valid: true };
    }
    const raw = control.value.trim();
    const value = Number(raw);
    const valid =
      raw.length > 0 && Number.isInteger(value) && value >= spec.min && value <= spec.max;
    return { value, valid };
  }

  /**
   * Reads the whole form.
   *
   * @returns {{values: object, valid: boolean}} Field values and whether every
   *   one of them is inside its range.
   */
  function readForm() {
    const values = {};
    let valid = true;
    for (const name of EDITABLE_FIELDS) {
      const field = readField(name);
      values[name] = field.value;
      if (!field.valid) {
        valid = false;
      }
    }
    return { values, valid };
  }

  /**
   * Writes settings into the form.
   *
   * @param {object} settings Settings object.
   * @returns {void}
   */
  function writeForm(settings) {
    for (const name of EDITABLE_FIELDS) {
      const control = controls.get(name);
      if (control === document.activeElement) {
        continue;
      }
      if (BOOLEAN_FIELDS.includes(name)) {
        control.checked = settings[name] === 1;
      } else {
        control.value = String(settings[name]);
      }
    }
    markInvalidFields();
  }

  /**
   * Paints the fields that are outside their range. Immediate, before any
   * attempt to build a code.
   *
   * @returns {void}
   */
  function markInvalidFields() {
    for (const name of EDITABLE_FIELDS) {
      const spec = fieldSpec(name);
      const { valid } = readField(name);
      toggleClass(controls.get(name), 'is-invalid', !valid);
      setText(
        errors.get(name),
        valid ? '' : t('settings.outOfRange', { min: spec.min, max: spec.max }),
      );
    }
  }

  /**
   * Reacts to any edit of the form.
   *
   * @returns {void}
   */
  function handleFieldInput() {
    markInvalidFields();
    const state = store.getState();
    // A code describes the settings it was made from. As soon as a field
    // moves, the code on screen is stale and is taken away rather than left
    // there to be sent by mistake.
    if (state.settingsOrigin === 'created' && state.settingsCode !== null) {
      store.setState({ settingsCode: null });
      setText(createStatus, t('setup.codeStale'));
      toggleClass(createStatus, 'is-warn', true);
    }
    updateContinue(store.getState());
  }

  /**
   * Builds the settings and their code.
   *
   * @returns {Promise<void>} Resolves once the code is on screen.
   */
  async function createCode() {
    const { values, valid } = readForm();
    if (!valid) {
      setText(createStatus, t('setup.fixFields'));
      toggleClass(createStatus, 'is-error', true);
      return;
    }
    try {
      // createGameSettings draws the nonce itself; the screen must not.
      const settings = createGameSettings(values);
      const code = await encodeSettingsCode(settings);
      store.setState({
        settings,
        settingsCode: code,
        settingsOrigin: 'created',
        settingsLocked: false,
      });
      toggleClass(createStatus, 'is-error', false);
      toggleClass(createStatus, 'is-warn', false);
      setText(createStatus, t('setup.codeReady'));
    } catch (error) {
      // The core refused the values. It knows the rules, the screen does not,
      // so its message is what the player sees.
      toggleClass(createStatus, 'is-error', true);
      setText(createStatus, error.message);
    }
  }

  /**
   * Enables the way forward and says what is missing when it is disabled.
   *
   * @param {object} state Application state.
   * @returns {void}
   */
  function updateContinue(state) {
    const ready = state.settings !== null;
    continueButton.disabled = !ready;
    setText(continueStatus, ready ? t('setup.readyToBuild') : t('setup.needSettings'));
    toggleClass(continueStatus, 'is-ok', ready);
  }

  return {
    root,

    update(state) {
      for (const label of roleInputs) {
        const input = label.querySelector('input');
        input.checked = Number(input.value) === state.myPlayer;
      }

      const settings = state.settings ?? DEFAULT_SETTINGS;
      if (settings !== shownSettings) {
        writeForm(settings);
        shownSettings = settings;
      }

      // A game freezes the settings for good: the journal is replayed against
      // them, so the screen becomes a place to look, not to edit (SPEC 2.1).
      const started = state.gameStarted === true;
      const locked = state.settingsLocked || started;
      for (const control of controls.values()) {
        control.disabled = locked;
      }
      createButton.disabled = locked;
      editButton.hidden = started || !(state.settingsOrigin === 'imported' && locked);
      setText(
        lockNotice,
        started
          ? t('setup.lockedByGame')
          : state.settingsOrigin === 'imported'
            ? locked
              ? t('setup.lockedByImport')
              : t('setup.unlockedWarning')
            : '',
      );

      setText(
        referenceLine,
        t('setup.referenceValues', {
          fields: REFERENCE_FIELDS.map(
            (name) => `${fieldLabel(name)} ${settings[name]}`,
          ).join(', '),
        }),
      );

      codeOutput.setCode(state.settingsOrigin === 'created' ? state.settingsCode : null);
      importField.setDisabled(locked);
      updateContinue(state);
    },

    destroy() {
      root.remove();
    },
  };
}

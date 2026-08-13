/**
 * dom.js - the only place allowed to create elements.
 *
 * Everything goes through `createElement` and `textContent`. `innerHTML` is
 * never used anywhere in the interface: pasted codes, file contents and cell
 * labels all end up on screen, and a single innerHTML would turn one of them
 * into a script (SPEC 5.2).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Applies a property bag to an element.
 *
 * @param {Element} node Element to configure.
 * @param {object} props Supported keys: `class` (string), `text` (string),
 *   `attrs` (object of attributes), `dataset` (object), `on` (event handlers),
 *   `props` (direct DOM properties such as value, checked, disabled).
 * @returns {void}
 * @throws {Error} If a handler is not a function.
 */
function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (key === 'class') {
      node.setAttribute('class', String(value));
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'attrs') {
      for (const [name, attribute] of Object.entries(value)) {
        if (attribute !== undefined && attribute !== null && attribute !== false) {
          node.setAttribute(name, String(attribute));
        }
      }
    } else if (key === 'dataset') {
      for (const [name, item] of Object.entries(value)) {
        node.dataset[name] = String(item);
      }
    } else if (key === 'on') {
      for (const [type, handler] of Object.entries(value)) {
        if (typeof handler !== 'function') {
          throw new Error(`handler for "${type}" must be a function`);
        }
        node.addEventListener(type, handler);
      }
    } else if (key === 'props') {
      Object.assign(node, value);
    } else {
      throw new Error(`unknown element option ${JSON.stringify(key)}`);
    }
  }
}

/**
 * Creates an HTML element.
 *
 * @param {string} tag Tag name.
 * @param {object} [props={}] See {@link applyProps}.
 * @param {Array<Node|string|null|undefined>} [children=[]] Children; strings
 *   become text nodes, empty values are skipped.
 * @returns {HTMLElement} The element.
 * @throws {Error} If an option key is unknown or a handler is not a function.
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

/**
 * Creates an SVG element.
 *
 * @param {string} tag Tag name inside the SVG namespace.
 * @param {object} [props={}] See {@link applyProps}.
 * @param {Array<Node|string|null|undefined>} [children=[]] Children.
 * @returns {SVGElement} The element.
 * @throws {Error} If an option key is unknown or a handler is not a function.
 */
export function svgEl(tag, props = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

/**
 * Appends children to a node.
 *
 * @param {Node} node Parent.
 * @param {Array<Node|string|null|undefined>|Node|string} children What to add.
 * @returns {Node} The parent.
 */
export function append(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Removes every child of a node.
 *
 * @param {Node} node Node to empty.
 * @returns {Node} The node.
 */
export function clear(node) {
  while (node.firstChild !== null) {
    node.removeChild(node.firstChild);
  }
  return node;
}

/**
 * Writes text into a node. The only way user supplied strings reach the
 * screen.
 *
 * @param {Node} node Target node.
 * @param {string} text Text to show.
 * @returns {void}
 */
export function setText(node, text) {
  node.textContent = text === null || text === undefined ? '' : String(text);
}

/**
 * Adds or removes a class.
 *
 * @param {Element} node Target element.
 * @param {string} className Class to toggle.
 * @param {boolean} on Whether the class should be present.
 * @returns {void}
 */
export function toggleClass(node, className, on) {
  node.classList.toggle(className, Boolean(on));
}

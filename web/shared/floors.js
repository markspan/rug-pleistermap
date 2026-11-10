/**
 * Floor state and the floor switcher UI.
 *
 * Floor codes are opaque strings ("00", "0T", "-S") taken from RUG Maps,
 * so they are compared exactly and ordered by the configured list.
 */

export class FloorState extends EventTarget {
  #current;
  /** @type {readonly string[]} */
  floors;

  /**
   * @param {readonly string[]} floors Floor codes, top floor first.
   * @param {string} initial
   */
  constructor(floors, initial) {
    super();
    this.floors = floors;
    this.#current = floors.includes(initial) ? initial : floors.at(-1);
  }

  get current() {
    return this.#current;
  }

  set(code) {
    if (code === this.#current || !this.floors.includes(code)) return;
    this.#current = code;
    this.dispatchEvent(new Event('change'));
  }

  /** Features without a floor (outdoor items) are visible on every floor. */
  isVisible(code) {
    return code === undefined || code === null || code === '' || String(code) === this.#current;
  }
}

/**
 * Render a lift-panel style button stack.
 * @param {HTMLElement} container
 * @param {FloorState} state
 */
export function mountFloorSwitcher(container, state) {
  const buttons = state.floors.map((code) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = code;
    button.addEventListener('click', () => state.set(code));
    return button;
  });
  const sync = () => {
    for (const button of buttons) {
      const active = button.textContent === state.current;
      button.setAttribute('aria-pressed', String(active));
      // The panel scrolls (19 floors); keep the active floor in view.
      if (active) button.scrollIntoView({ block: 'nearest' });
    }
  };

  container.replaceChildren(...buttons);
  container.hidden = false;
  state.addEventListener('change', sync);
  sync();
}

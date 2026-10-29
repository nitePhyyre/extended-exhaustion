import { MODULE_ID, TRACKS, TRACK_IDS, emptyMarks } from "../constants.mjs";
import {
  formatPenalty, getMarks, penaltiesFromMarks, rowsPerTrack, speedStep, total, zeroAtMarks
} from "../exhaustion.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Asks which columns newly gained levels of exhaustion should be marked against.
 *
 * Used under Method B, where the document leaves the choice to the player. Several levels can be
 * placed in one sitting &mdash; entering a Rage costs two, an upcast costs one per spell level
 * &mdash; so the prompt stays open, counting down, until every level has a home.
 */
export default class PlaceDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "extended-exhaustion-place-{id}",
    classes: ["extended-exhaustion", "ee-place"],
    tag: "div",
    window: {
      title: "EXTENDED_EXHAUSTION.Place.Title",
      icon: "fa-solid fa-bed"
    },
    position: { width: 460, height: "auto" },
    actions: {
      place: PlaceDialog.#onPlace,
      auto: PlaceDialog.#onAuto
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/place.hbs`, scrollable: [".ee-place-options"] }
  };

  /* -------------------------------------------- */

  /** @type {Actor} */
  #actor;

  /** Localized sentence explaining why the levels were gained. @type {string|null} */
  #reason;

  /** How many levels still need a column. @type {number} */
  #remaining;

  /** Total levels this prompt is placing. @type {number} */
  #count;

  /** Levels assigned so far, as a marks delta. @type {object} */
  #assigned = emptyMarks();

  /** Resolver for the promise handed back by {@link prompt}. @type {Function|null} */
  #resolve = null;

  /** Whether the promise has already been settled. @type {boolean} */
  #settled = false;

  /* -------------------------------------------- */

  /**
   * @param {object} options
   * @param {Actor} options.actor
   * @param {number} [options.count]
   * @param {string} [options.reason]
   * @param {Function} [options.resolve]
   */
  constructor({ actor, count = 1, reason = null, resolve = null, ...options } = {}) {
    super(options);
    this.#actor = actor;
    this.#count = count;
    this.#remaining = count;
    this.#reason = reason;
    this.#resolve = resolve;
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    return game.i18n.format("EXTENDED_EXHAUSTION.Place.TitleFor", { name: this.#actor?.name ?? "" });
  }

  /* -------------------------------------------- */

  /**
   * Ask the player where to put some newly gained levels.
   * @param {Actor} actor
   * @param {object} [options]
   * @param {number} [options.count=1]   How many levels to place.
   * @param {string} [options.reason]    Localized explanation shown at the top.
   * @returns {Promise<object|null>}     A marks delta to apply, or null to place automatically.
   */
  static async prompt(actor, { count = 1, reason = null } = {}) {
    const marks = getMarks(actor);
    const cap = rowsPerTrack();
    // Nothing meaningful to choose between if the table has no room left anywhere.
    const room = TRACK_IDS.reduce((sum, id) => sum + Math.max(0, cap - marks[id]), 0);
    if ( (count < 1) || (room < 1) ) return null;

    return new Promise(resolve => {
      new this({ actor, count, reason, resolve }).render({ force: true });
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const current = getMarks(this.#actor);
    const cap = rowsPerTrack();

    // What the actor would look like with everything assigned so far already applied.
    const projected = {};
    for ( const id of TRACK_IDS ) projected[id] = current[id] + this.#assigned[id];

    Object.assign(context, {
      reason: this.#reason,
      count: this.#count,
      remaining: this.#remaining,
      multiple: this.#count > 1,
      rows: cap,
      speedStep: speedStep(),
      zeroAt: zeroAtMarks(),
      level: total(projected),
      tracks: TRACKS.map(track => {
        const marks = projected[track.id];
        const full = marks >= cap;
        return {
          id: track.id,
          icon: track.icon,
          label: game.i18n.localize(track.label),
          hint: game.i18n.localize(track.hint),
          marks,
          assigned: this.#assigned[track.id],
          full,
          // What this column would cost if the next level went here.
          penalty: formatPenalty(track.id, penaltiesFromMarks({
            ...projected, [track.id]: Math.min(cap, marks + 1)
          }))
        };
      })
    });
    return context;
  }

  /* -------------------------------------------- */
  /*  Event handlers                              */
  /* -------------------------------------------- */

  /**
   * Assign one level to a column, closing once every level has been placed.
   * @this {PlaceDialog}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onPlace(event, target) {
    const id = target.dataset.track;
    if ( !TRACK_IDS.includes(id) || (this.#remaining < 1) ) return;

    const current = getMarks(this.#actor);
    if ( (current[id] + this.#assigned[id]) >= rowsPerTrack() ) return;

    this.#assigned[id] += 1;
    this.#remaining -= 1;

    // Stop early if the table filled up before every level could be placed.
    const cap = rowsPerTrack();
    const room = TRACK_IDS.reduce((sum, t) => sum + Math.max(0, cap - current[t] - this.#assigned[t]), 0);
    if ( (this.#remaining < 1) || (room < 1) ) {
      this.#settle(this.#assigned);
      this.close();
      return;
    }
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Hand the remaining levels back to the caller to place automatically.
   * @this {PlaceDialog}
   */
  static #onAuto() {
    this.#settle(total(this.#assigned) ? this.#assigned : null);
    this.close();
  }

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    // Dismissed without finishing: hand back whatever was chosen so the rest can be auto-placed.
    this.#settle(total(this.#assigned) ? this.#assigned : null);
  }

  /* -------------------------------------------- */

  /**
   * Resolve the pending promise exactly once.
   * @param {object|null} value
   */
  #settle(value) {
    if ( this.#settled ) return;
    this.#settled = true;
    this.#resolve?.(value);
    this.#resolve = null;
  }
}

/* -------------------------------------------- */

/**
 * Convenience wrapper around {@link PlaceDialog.prompt}.
 * @param {Actor} actor
 * @param {object} [options]
 * @returns {Promise<object|null>}
 */
export async function promptPlacement(actor, options = {}) {
  return PlaceDialog.prompt(actor, options);
}

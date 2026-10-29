import { MODULE_ID, TRACKS, TRACK_IDS } from "../constants.mjs";
import {
  clampMarks, formatPenalty, getLevel, getMarks, isImmune, maxLevel, penaltiesFromMarks,
  postChangeCard, redistribute, rowsPerTrack, setLevel, setMarks, speedStep, total, zeroAtMarks
} from "../exhaustion.mjs";
import { recoverOnLongRest } from "../recovery.mjs";
import { setting } from "../settings.mjs";
import SpendDialog from "./spend-dialog.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The Extended Exhaustion table for a single actor: its current level, how that level is
 * distributed across the six penalty tracks, and what each track is costing it.
 */
export default class ExhaustionTracker extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "extended-exhaustion-tracker-{id}",
    classes: ["extended-exhaustion", "ee-tracker"],
    tag: "form",
    window: {
      title: "EXTENDED_EXHAUSTION.Tracker.Title",
      icon: "fa-solid fa-bed"
    },
    position: { width: 580, height: "auto" },
    form: {
      handler: ExhaustionTracker.#onSubmitForm,
      submitOnChange: true,
      closeOnSubmit: false
    },
    actions: {
      adjustLevel: ExhaustionTracker.#onAdjustLevel,
      adjustTrack: ExhaustionTracker.#onAdjustTrack,
      clear: ExhaustionTracker.#onClear,
      longRest: ExhaustionTracker.#onLongRest,
      spend: ExhaustionTracker.#onSpend
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/tracker.hbs`, scrollable: [".ee-tracks"] }
  };

  /* -------------------------------------------- */

  /** The tracked actor. @type {Actor} */
  #actor;

  /** Hook registration used to follow changes made elsewhere. @type {number|null} */
  #hookId = null;

  /**
   * Optimistic marks shown while a burst of edits is still being written out, or null when the
   * display is in step with the actor.
   * @type {object|null}
   */
  #pending = null;

  /** Level at the start of the current burst of edits, for the summary card. @type {number|null} */
  #burstFrom = null;

  /* -------------------------------------------- */

  /**
   * @param {object} options
   * @param {Actor} options.actor  The actor whose exhaustion is being tracked.
   */
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
  }

  /* -------------------------------------------- */

  /** The tracked actor. @type {Actor} */
  get actor() {
    return this.#actor;
  }

  /** @override */
  get title() {
    return game.i18n.format("EXTENDED_EXHAUSTION.Tracker.TitleFor", { name: this.#actor?.name ?? "" });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.#actor;
    const marks = this.#pending ?? getMarks(actor);
    const penalties = penaltiesFromMarks(marks);
    const level = total(marks);
    const max = maxLevel();
    const choice = setting("method") === "choice";

    Object.assign(context, {
      actor,
      level,
      max,
      rows: rowsPerTrack(),
      speedStep: speedStep(),
      zeroAt: zeroAtMarks(),
      choice,
      atMax: level >= max,
      dead: level > max,
      immune: isImmune(actor),
      editable: actor.isOwner,
      spending: setting("enableSpending") && actor.isOwner,
      isGM: game.user.isGM,
      methodLabel: game.i18n.localize(choice
        ? "EXTENDED_EXHAUSTION.Settings.Method.Choice"
        : "EXTENDED_EXHAUSTION.Settings.Method.Sequential"),
      recoveryDC: level > 0 ? setting("recoveryBaseDC") - Math.max(0, level - 1) : null,
      tracks: TRACKS.map(track => ({
        id: track.id,
        icon: track.icon,
        label: game.i18n.localize(track.label),
        hint: game.i18n.localize(track.hint),
        marks: marks[track.id],
        full: marks[track.id] >= rowsPerTrack(),
        penalty: formatPenalty(track.id, penalties)
      }))
    });
    return context;
  }

  /* -------------------------------------------- */
  /*  Event handlers                              */
  /* -------------------------------------------- */

  /**
   * Change the overall level, letting the configured method decide where the marks land. Applied
   * immediately; there is no separate confirmation step.
   * @this {ExhaustionTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onAdjustLevel(event, target) {
    const delta = Number(target.dataset.delta) || 0;
    if ( !delta ) return;
    this.#commit(marks => {
      const level = Math.clamp(total(marks) + delta, 0, maxLevel());
      return redistribute(marks, level);
    });
  }

  /* -------------------------------------------- */

  /**
   * Move a single mark into or out of one track. Method B only, applied immediately.
   * @this {ExhaustionTracker}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static #onAdjustTrack(event, target) {
    if ( setting("method") !== "choice" ) return;
    const id = target.dataset.track;
    const delta = Number(target.dataset.delta) || 0;
    if ( !TRACK_IDS.includes(id) || !delta ) return;
    this.#commit(marks => {
      if ( delta > 0 ) {
        if ( total(marks) >= maxLevel() ) return null;
        if ( marks[id] >= rowsPerTrack() ) return null;
      }
      marks[id] = Math.max(0, marks[id] + delta);
      return marks;
    });
  }

  /* -------------------------------------------- */

  /**
   * Remove all exhaustion. GM only.
   * @this {ExhaustionTracker}
   */
  static #onClear() {
    this.#commit(marks => redistribute(marks, 0));
  }

  /* -------------------------------------------- */

  /**
   * Run the long rest recovery sequence on demand.
   * @this {ExhaustionTracker}
   */
  static async #onLongRest() {
    await recoverOnLongRest(this.#actor);
    this.render();
  }

  /* -------------------------------------------- */

  /**
   * Open the spending dialog.
   * @this {ExhaustionTracker}
   */
  static #onSpend() {
    new SpendDialog({ actor: this.#actor }).render({ force: true });
  }

  /* -------------------------------------------- */

  /**
   * Apply a typed distribution. Fires on change rather than on submit, so editing a field and
   * tabbing away is enough to commit it.
   * @this {ExhaustionTracker}
   * @param {SubmitEvent} event
   * @param {HTMLFormElement} form
   * @param {FormDataExtended} formData
   */
  static async #onSubmitForm(event, form, formData) {
    const submitted = foundry.utils.expandObject(formData.object ?? {})?.marks;
    if ( !submitted ) return;
    this.#commit(() => clampMarks(submitted));
  }

  /* -------------------------------------------- */
  /*  Writing                                     */
  /* -------------------------------------------- */

  /**
   * Apply a change to the actor.
   *
   * The display updates immediately from an optimistic copy, and the write itself is coalesced:
   * a burst of stepper clicks becomes one actor update rather than one per click. That keeps the
   * exhaustion condition effect from being created and destroyed repeatedly underneath us.
   * Returning null from the mutator cancels the change, which is how the caps decline a step.
   * @param {(marks: object) => (object|null)} mutator  Receives the current marks, returns the new set.
   */
  #commit(mutator) {
    const actor = this.#actor;
    if ( !actor?.isOwner ) return;
    const result = mutator(this.#pending ?? getMarks(actor));
    if ( !result ) return;

    this.#burstFrom ??= getLevel(actor);
    this.#pending = result;
    this.render();
    this.#flush();
  }

  /* -------------------------------------------- */

  /**
   * Write the pending marks to the actor once edits have settled.
   * @type {Function}
   */
  #flush = foundry.utils.debounce(async () => {
    const marks = this.#pending;
    if ( !marks ) return;
    try {
      if ( setting("method") === "choice" ) await setMarks(this.#actor, marks);
      else await setLevel(this.#actor, total(marks), { reason: "manual", chat: false });
    } catch(err) {
      console.error(`${MODULE_ID} | Failed to apply an exhaustion change`, err);
    } finally {
      this.#pending = null;
      this.render();
      this.#summarize();
    }
  }, 250);

  /* -------------------------------------------- */

  /**
   * Post one chat card covering a whole burst of edits, rather than one per click.
   * @type {Function}
   */
  #summarize = foundry.utils.debounce(() => {
    const from = this.#burstFrom;
    this.#burstFrom = null;
    const to = getLevel(this.#actor);
    if ( (from === null) || (from === to) ) return;
    postChangeCard(this.#actor, { from, to, reason: "manual" });
  }, 1500);

  /* -------------------------------------------- */
  /*  Lifecycle                                   */
  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#hookId ??= Hooks.on("updateActor", actor => {
      if ( (actor !== this.#actor) || this.#pending ) return;
      this.render();
    });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  _onClose(options) {
    super._onClose(options);
    if ( this.#hookId !== null ) Hooks.off("updateActor", this.#hookId);
    this.#hookId = null;
  }

  /* -------------------------------------------- */

  /**
   * Show (or bring forward) the tracker for an actor.
   * @param {Actor} actor
   * @returns {ExhaustionTracker}
   */
  static open(actor) {
    const id = `extended-exhaustion-tracker-${actor.uuid.replaceAll(".", "-")}`;
    const existing = foundry.applications.instances.get(id);
    if ( existing ) {
      existing.bringToFront();
      return existing;
    }
    const app = new this({ actor, id });
    app.render({ force: true });
    return app;
  }
}

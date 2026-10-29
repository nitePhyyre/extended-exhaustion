import { MODULE_ID } from "../constants.mjs";
import { getLevel, maxLevel } from "../exhaustion.mjs";
import { isUnconscious, prepareOptions, spend } from "../spending.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Lets a player trade exhaustion for one of the homebrew's "Spending Exhaustion" options.
 */
export default class SpendDialog extends HandlebarsApplicationMixin(ApplicationV2) {

  /** @override */
  static DEFAULT_OPTIONS = {
    id: "extended-exhaustion-spend-{id}",
    classes: ["extended-exhaustion", "ee-spend"],
    tag: "div",
    window: {
      title: "EXTENDED_EXHAUSTION.Spend.Title",
      icon: "fa-solid fa-fire-flame-curved"
    },
    position: { width: 600, height: 640 },
    actions: {
      spend: SpendDialog.#onSpend,
      toggleAll: SpendDialog.#onToggleAll
    }
  };

  /** @override */
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/spend.hbs`, scrollable: [".ee-options"] }
  };

  /* -------------------------------------------- */

  /** @type {Actor} */
  #actor;

  /** Whether options irrelevant to this actor's class are shown. @type {boolean} */
  #showAll = false;

  /** @type {number|null} */
  #hookId = null;

  /* -------------------------------------------- */

  /**
   * @param {object} options
   * @param {Actor} options.actor
   */
  constructor({ actor, ...options } = {}) {
    super(options);
    this.#actor = actor;
  }

  /* -------------------------------------------- */

  /** @override */
  get title() {
    return game.i18n.format("EXTENDED_EXHAUSTION.Spend.TitleFor", { name: this.#actor?.name ?? "" });
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const all = prepareOptions(this.#actor);
    Object.assign(context, {
      actor: this.#actor,
      level: getLevel(this.#actor),
      max: maxLevel(),
      unconscious: isUnconscious(this.#actor),
      showAll: this.#showAll,
      hidden: all.filter(o => !o.relevant).length,
      options: this.#showAll ? all : all.filter(o => o.relevant)
    });
    return context;
  }

  /* -------------------------------------------- */

  /**
   * @this {SpendDialog}
   * @param {PointerEvent} event
   * @param {HTMLElement} target
   */
  static async #onSpend(event, target) {
    const row = target.closest("[data-option]");
    const optionId = row?.dataset.option;
    if ( !optionId ) return;
    const spellLevel = Number(row.querySelector('[name="spellLevel"]')?.value) || 1;
    const beyondMax = row.querySelector('[name="beyondMax"]')?.checked ?? false;
    const kaioken = row.querySelector('[name="kaioken"]')?.checked ?? false;
    target.disabled = true;
    try {
      await spend(this.#actor, optionId, { spellLevel, beyondMax, kaioken });
    } finally {
      this.render();
    }
  }

  /* -------------------------------------------- */

  /**
   * @this {SpendDialog}
   */
  static #onToggleAll() {
    this.#showAll = !this.#showAll;
    this.render();
  }

  /* -------------------------------------------- */

  /** @inheritDoc */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.#hookId ??= Hooks.on("updateActor", actor => {
      if ( actor === this.#actor ) this.render();
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
   * Show (or bring forward) the spending dialog for an actor.
   * @param {Actor} actor
   * @returns {SpendDialog}
   */
  static open(actor) {
    const id = `extended-exhaustion-spend-${actor.uuid.replaceAll(".", "-")}`;
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


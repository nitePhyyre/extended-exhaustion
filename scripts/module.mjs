import { EFFECT_ID, GAIN_REASONS, MODULE_ID, SPEND_OPTIONS, TRACKS } from "./constants.mjs";
import * as exhaustion from "./exhaustion.mjs";
import * as spending from "./spending.mjs";
import { gainOneLevel, registerAutomation } from "./automation.mjs";
import { patchDerivedData, registerMinimumResult } from "./penalties.mjs";
import { recoverOnLongRest, registerRecovery } from "./recovery.mjs";
import { registerSettings, setting } from "./settings.mjs";
import { registerSheetIntegration } from "./sheet.mjs";
import { registerTokenHUD } from "./token-hud.mjs";
import { registerSpendCleanup } from "./spend-effects.mjs";
import ExhaustionTracker from "./apps/tracker.mjs";

/* -------------------------------------------- */
/*  Initialization                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  if ( game.system.id !== "dnd5e" ) {
    console.warn(`${MODULE_ID} | Requires the dnd5e system; exhaustion handling will not be installed.`);
    return;
  }

  registerSettings();
  configureSystem();
  patchDerivedData();
  registerMinimumResult();
  registerRecovery();
  registerAutomation();
  registerSheetIntegration();
  registerTokenHUD();
  registerSpendCleanup();

  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/tracker.hbs`,
    `modules/${MODULE_ID}/templates/place.hbs`,
    `modules/${MODULE_ID}/templates/chat/change.hbs`,
    `modules/${MODULE_ID}/templates/chat/recovery.hbs`,
    `modules/${MODULE_ID}/templates/chat/spend.hbs`
  ]);

  const api = {
    EFFECT_ID,
    GAIN_REASONS,
    SPEND_OPTIONS,
    TRACKS,
    ExhaustionTracker,
    ...exhaustion,
    ...spending,
    recoverOnLongRest,
    gainOneLevel,
    /**
     * Open the exhaustion tracker for an actor or token.
     * @param {Actor|Token|TokenDocument} [target]  Defaults to the selected token or assigned character.
     * @returns {ExhaustionTracker|null}
     */
    track(target) {
      const actor = resolveActor(target);
      return actor ? ExhaustionTracker.open(actor) : null;
    },
    /**
     * Open the exhaustion tracker, which carries the spending options alongside the table.
     * @param {Actor|Token|TokenDocument} [target]
     * @returns {ExhaustionTracker|null}
     */
    spendDialog(target) {
      const actor = resolveActor(target);
      return actor ? ExhaustionTracker.open(actor) : null;
    }
  };

  game.modules.get(MODULE_ID).api = api;
  dnd5e.extendedExhaustion = api;
});

/* -------------------------------------------- */

Hooks.once("ready", async () => {
  if ( game.system.id !== "dnd5e" ) return;
  // One primary GM brings existing exhaustion in line with the module's penalty effect.
  if ( game.users.activeGM !== game.user ) return;
  for ( const actor of game.actors ) {
    try {
      if ( exhaustion.getLevel(actor) ) await exhaustion.syncEffect(actor);
    } catch(err) {
      console.error(`${MODULE_ID} | Could not initialize exhaustion for ${actor.name}`, err);
    }
  }
});

/* -------------------------------------------- */

/**
 * Retune the dnd5e system's exhaustion handling for the homebrew.
 *
 * dnd5e 6 drives exhaustion from a typed condition effect, and layers several automations on top
 * of it: a flat per-level reduction to d20 tests and speed under the modern rules, graded
 * condition effects under the legacy rules, death at the top level, and removing a level on a long
 * rest. All of those are replaced by this module, so they are stripped first and the level ceiling
 * plus the death threshold are then set to the homebrew's values.
 *
 * This mirrors the system's own `disableExhaustionAutomation()`, which is not reachable from a
 * module. Enabling dnd5e's "Disable Exhaustion Automation" setting does the same work earlier, and
 * this remains correct either way because every step is idempotent.
 */
function configureSystem() {
  const DND5E = CONFIG.DND5E;
  const config = DND5E.conditionTypes?.exhaustion;
  if ( !config ) return;

  // Modern-rules flat reductions to d20 tests and speed.
  delete config.reduction;

  // Legacy graded condition effects: half speed at 2, disadvantage at 1/3, half health at 4, and
  // so on. These are keyed "exhaustion-<level>" across every condition effect bucket.
  for ( const effects of Object.values(DND5E.conditionEffects ?? {}) ) {
    if ( !(effects instanceof Set) ) continue;
    for ( const key of [...effects] ) {
      if ( String(key).startsWith("exhaustion-") ) effects.delete(key);
    }
  }

  // The system removes one level on a long rest; this module runs the homebrew's own recovery,
  // which starts with that same step, so leaving this in place would remove two.
  delete DND5E.restTypes?.long?.exhaustionDelta;

  // Raise the ceiling, and put death back at one level past the maximum. The condition data model
  // clamps an effect's level to `levels` and applies the statuses listed in `conditions` for every
  // level up to the current one, so this is exactly "a creature dies at 31".
  const max = setting("maxLevel");
  config.levels = max + 1;
  config.conditions = { [max + 1]: ["dead"] };

  clampExhaustionArtwork();
}

/* -------------------------------------------- */

/** The highest numbered exhaustion icon the dnd5e system ships artwork for. */
const MAX_EXHAUSTION_ICON = 6;

/**
 * dnd5e names its condition artwork after the level and only ships exhaustion icons 1 through 6.
 * Clamp the lookup so higher levels reuse the sixth icon instead of requesting a file that is not
 * there, which would otherwise show a broken image on the token HUD and in the effects list.
 */
function clampExhaustionArtwork() {
  const cls = dnd5e?.dataModels?.activeEffect?.ConditionData;
  if ( (typeof cls?.getIconByLevel !== "function") || cls[`__${MODULE_ID}Clamped`] ) return;
  const original = cls.getIconByLevel;
  cls.getIconByLevel = function(type, level) {
    const clamped = (type === "exhaustion") ? Math.clamp(level ?? 1, 1, MAX_EXHAUSTION_ICON) : level;
    return original.call(this, type, clamped);
  };
  cls[`__${MODULE_ID}Clamped`] = true;
}

/* -------------------------------------------- */

/**
 * Resolve a loose target into an actor, defaulting to the controlled token or assigned character.
 * @param {Actor|Token|TokenDocument|string} [target]
 * @returns {Actor|null}
 */
function resolveActor(target) {
  if ( target instanceof Actor ) return target;
  if ( target?.actor instanceof Actor ) return target.actor;
  if ( typeof target === "string" ) {
    const doc = fromUuidSync(target);
    if ( doc instanceof Actor ) return doc;
    if ( doc?.actor instanceof Actor ) return doc.actor;
  }
  const controlled = canvas?.tokens?.controlled ?? [];
  if ( controlled.length === 1 ) return controlled[0].actor;
  return game.user.character ?? null;
}

import { MODULE_ID, TRACKS } from "./constants.mjs";

/**
 * Selectable maximum levels: every multiple of the six penalty columns up to ten full rows.
 * @type {Record<number, string>}
 */
const MAX_LEVEL_CHOICES = (() => {
  const choices = {};
  for ( let rows = 1; rows <= 10; rows++ ) {
    const level = rows * TRACKS.length;
    choices[level] = `${level}`;
  }
  return choices;
})();

/**
 * Convenience accessor for this module's settings.
 * @param {string} key  Setting key.
 * @returns {*}
 */
export function setting(key) {
  return game.settings.get(MODULE_ID, key);
}

/* -------------------------------------------- */

/**
 * Register all world and client settings.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, "method", {
    name: "EXTENDED_EXHAUSTION.Settings.Method.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.Method.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      sequential: "EXTENDED_EXHAUSTION.Settings.Method.Sequential",
      choice: "EXTENDED_EXHAUSTION.Settings.Method.Choice"
    },
    default: "sequential",
    requiresReload: false,
    onChange: () => redrawAll()
  });

  game.settings.register(MODULE_ID, "maxLevel", {
    name: "EXTENDED_EXHAUSTION.Settings.MaxLevel.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.MaxLevel.Hint",
    scope: "world",
    config: true,
    type: Number,
    // Restricted to multiples of six so the table is always a whole number of rows across its six
    // columns. The speed and hit point penalties scale from this.
    choices: MAX_LEVEL_CHOICES,
    default: 30,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "recoveryBaseDC", {
    name: "EXTENDED_EXHAUSTION.Settings.RecoveryBaseDC.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.RecoveryBaseDC.Hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ integer: true, min: 1, max: 60, initial: 30, nullable: false }),
    default: 30
  });

  game.settings.register(MODULE_ID, "longRestRecovery", {
    name: "EXTENDED_EXHAUSTION.Settings.LongRestRecovery.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.LongRestRecovery.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "zeroHPExhaustion", {
    name: "EXTENDED_EXHAUSTION.Settings.ZeroHPExhaustion.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.ZeroHPExhaustion.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      none: "EXTENDED_EXHAUSTION.Settings.ZeroHPExhaustion.None",
      pcs: "EXTENDED_EXHAUSTION.Settings.ZeroHPExhaustion.PCs",
      all: "EXTENDED_EXHAUSTION.Settings.ZeroHPExhaustion.All"
    },
    default: "pcs"
  });

  game.settings.register(MODULE_ID, "minimumRollResult", {
    name: "EXTENDED_EXHAUSTION.Settings.MinimumRollResult.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.MinimumRollResult.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "minimumSpeed", {
    name: "EXTENDED_EXHAUSTION.Settings.MinimumSpeed.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.MinimumSpeed.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => redrawAll()
  });

  game.settings.register(MODULE_ID, "applySpeedToAllTypes", {
    name: "EXTENDED_EXHAUSTION.Settings.ApplySpeedToAllTypes.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.ApplySpeedToAllTypes.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => redrawAll()
  });

  game.settings.register(MODULE_ID, "enableSpending", {
    name: "EXTENDED_EXHAUSTION.Settings.EnableSpending.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.EnableSpending.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => redrawAll()
  });

  game.settings.register(MODULE_ID, "sheetTracker", {
    name: "EXTENDED_EXHAUSTION.Settings.SheetTracker.Name",
    hint: "EXTENDED_EXHAUSTION.Settings.SheetTracker.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => redrawAll()
  });
}

/* -------------------------------------------- */

/**
 * Re-render every actor sheet and refresh derived data after a setting that changes the maths.
 */
function redrawAll() {
  for ( const actor of game.actors ?? [] ) actor.reset();
  for ( const app of foundry.applications.instances?.values() ?? [] ) {
    if ( app.document instanceof Actor ) app.render();
  }
}

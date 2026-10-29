import { GAIN_REASONS, MODULE_ID } from "./constants.mjs";
import {
  addLevels, applyPlacement, getLevel, isImmune, maxLevel, reconcile, syncEffect
} from "./exhaustion.mjs";
import { setting } from "./settings.mjs";
import { refreshTokenHUD } from "./token-hud.mjs";
import { promptPlacement } from "./apps/place-dialog.mjs";

/**
 * Register the hooks that keep actor state consistent and that apply exhaustion automatically.
 */
export function registerAutomation() {
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("createActor", actor => { if ( getLevel(actor) ) syncEffect(actor); });
}

/* -------------------------------------------- */

/**
 * @param {Actor} actor
 * @param {object} changed
 * @param {object} options
 * @param {string} userId
 */
function onUpdateActor(actor, changed, options, userId) {
  // Keeping the marks, the system's level and the penalty effect in step is the job of whichever
  // client made the change.
  if ( userId === game.userId ) {
    const marksChanged = foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.marks`)
      || foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.-=marks`);
    const levelChanged = foundry.utils.hasProperty(changed, "system.attributes.exhaustion");

    if ( levelChanged || marksChanged ) {
      // An external change to the system's level needs the marks brought back in line first. The
      // level is read from the update delta because dnd5e re-derives `attributes.exhaustion` from
      // its own condition effect, which it has not finished updating yet at this point.
      const promise = (levelChanged && !marksChanged)
        ? reconcile(actor, foundry.utils.getProperty(changed, "system.attributes.exhaustion"))
        : Promise.resolve();
      promise.then(() => syncEffect(actor)).then(() => refreshTokenHUD(actor)).catch(err => {
        console.error(`${MODULE_ID} | Failed to synchronize exhaustion`, err);
      });
    }
  }

  // Exhaustion from dropping to 0 hit points is handled by the actor's own player instead, so that
  // under Method B they are the one asked where the level goes rather than whoever dealt the
  // damage. Every client sees this update and all of them agree on who that is.
  if ( foundry.utils.hasProperty(changed, "system.attributes.hp.value") ) onHitPointChange(actor, options);
}

/* -------------------------------------------- */

/**
 * The single client responsible for acting on an actor's behalf: its player if one is connected,
 * otherwise a GM. Every client computes the same answer, so exactly one of them acts.
 * @param {Actor} actor
 * @returns {User|null}
 */
function responsibleUser(actor) {
  const owners = game.users.filter(u => u.active && actor.testUserPermission(u, "OWNER"));
  const players = owners.filter(u => !u.isGM);
  const pool = players.length ? players : owners;
  return pool.sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
}

/* -------------------------------------------- */

/**
 * "A creature gains 1 level of exhaustion when it drops to 0 hit points."
 * @param {Actor} actor
 * @param {object} options  Update options; dnd5e records the pre-update hit points here.
 */
function onHitPointChange(actor, options) {
  const mode = setting("zeroHPExhaustion");
  if ( mode === "none" ) return;
  if ( (mode === "pcs") && (actor.type !== "character") ) return;
  if ( isImmune(actor) ) return;
  if ( actor.system.attributes?.hp?.value > 0 ) return;
  if ( responsibleUser(actor)?.id !== game.userId ) return;

  // Only treat this as a drop if the actor had hit points a moment ago.
  const previous = options.dnd5e?.hp?.value;
  if ( !Number.isFinite(previous) || (previous <= 0) ) return;

  gainOneLevel(actor, "zeroHP").catch(err => {
    console.error(`${MODULE_ID} | Failed to apply exhaustion at 0 hit points`, err);
  });
}

/* -------------------------------------------- */

/**
 * Apply a single involuntary level of exhaustion.
 *
 * Under Method A the table decides where the mark goes. Under Method B the document leaves that to
 * the player, so they are asked rather than having a column chosen for them. Dismissing the prompt
 * falls back to the automatic placement, so the level is never silently skipped.
 * @param {Actor} actor
 * @param {string} [reason]  A key of {@link GAIN_REASONS}.
 * @returns {Promise<void>}
 */
export async function gainOneLevel(actor, reason = "manual") {
  const from = getLevel(actor);
  if ( from >= (maxLevel() + 1) ) return;

  if ( setting("method") !== "choice" ) {
    await addLevels(actor, 1, { reason });
    return;
  }

  const delta = await promptPlacement(actor, {
    count: 1,
    reason: GAIN_REASONS[reason] ? game.i18n.localize(GAIN_REASONS[reason]) : null
  });

  if ( !(await applyPlacement(actor, delta, 1, reason, from)) ) {
    // Dismissed without choosing. The level still has to land, so it is placed automatically, but
    // never silently: say so, since under Method B the placement was meant to be a decision.
    await addLevels(actor, 1, { reason });
    ui.notifications?.warn?.(game.i18n.format("EXTENDED_EXHAUSTION.Place.AutoPlaced", { name: actor.name }));
  }
}



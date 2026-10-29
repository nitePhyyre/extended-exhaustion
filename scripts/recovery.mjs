import { MODULE_ID } from "./constants.mjs";
import { getLevel, isImmune, redistribute, getMarks } from "./exhaustion.mjs";
import { setting } from "./settings.mjs";

/**
 * Register the long rest recovery hook.
 */
export function registerRecovery() {
  Hooks.on("dnd5e.restCompleted", (actor, result, config) => {
    if ( config?.type !== "long" ) return;
    if ( !setting("longRestRecovery") ) return;
    // The rest has already topped hit points up to the exhausted maximum, so top them up again
    // once recovery has raised that maximum back.
    recoverOnLongRest(actor, { restoreHitPoints: true });
  });
}

/* -------------------------------------------- */

/**
 * Run the homebrew's long rest recovery: remove one level automatically, then keep making
 * Constitution saving throws against a DC of (base DC - current exhaustion level), removing one
 * further level per success, until a save fails or exhaustion reaches 0.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.restoreHitPoints=false]  Top hit points back up to the recovered
 *                                                    maximum once levels have been removed.
 * @returns {Promise<ChatMessage|null>}
 */
export async function recoverOnLongRest(actor, { restoreHitPoints = false } = {}) {
  if ( !actor?.isOwner || isImmune(actor) ) return null;
  const start = getLevel(actor);
  if ( start < 1 ) return null;

  // dnd5e withholds a long rest's exhaustion recovery from a creature that is starving or
  // parched. Honour that here, since this module has taken over the recovery step.
  if ( actor.hasConditionEffect?.("malnourished") || actor.hasConditionEffect?.("dehydrated") ) {
    return postDeprivedCard(actor, start);
  }

  const baseDC = setting("recoveryBaseDC");
  const steps = [];
  let level = start;

  // "At the end of a long rest, you remove 1 level of exhaustion."
  level -= 1;
  await writeLevel(actor, level);
  steps.push({ automatic: true, level });

  // "Then, make a Constitution saving throw with a DC equal to 30 minus your current exhaustion level."
  while ( level > 0 ) {
    const dc = baseDC - level;
    const rolls = await actor.rollSavingThrow({
      ability: "con",
      rolls: [{ options: { target: dc } }]
    }, { configure: false }, { create: false });
    const roll = rolls?.[0];
    if ( !roll ) break;
    const success = roll.total >= dc;
    if ( success ) {
      level -= 1;
      await writeLevel(actor, level);
    }
    steps.push({ dc, roll, success, level, html: await roll.render() });
    if ( !success ) break;
  }

  if ( restoreHitPoints && (level < start) ) {
    const hp = actor.system.attributes?.hp;
    if ( hp && (hp.value > 0) && (hp.value < hp.effectiveMax) ) {
      await actor.update({ "system.attributes.hp.value": hp.effectiveMax }, { isRest: true });
    }
  }

  return postRecoveryCard(actor, { start, end: level, baseDC, steps });
}

/* -------------------------------------------- */

/**
 * Write a new exhaustion level without posting the standard change card, since the recovery card
 * already reports the whole sequence.
 * @param {Actor} actor
 * @param {number} level
 * @returns {Promise<Actor>}
 */
async function writeLevel(actor, level) {
  return actor.update({
    "system.attributes.exhaustion": level,
    [`flags.${MODULE_ID}.marks`]: redistribute(getMarks(actor), level)
  });
}

/* -------------------------------------------- */

/**
 * Report that recovery was withheld because the creature is starving or parched.
 * @param {Actor} actor
 * @param {number} level
 * @returns {Promise<ChatMessage>}
 */
async function postDeprivedCard(actor, level) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/recovery.hbs`, {
      actor, start: level, end: level, deprived: true, steps: [], removed: 0, cleared: false
    });
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.localize("EXTENDED_EXHAUSTION.Recovery.Flavor"),
    flags: { [MODULE_ID]: { type: "recovery", deprived: true } }
  });
}

/* -------------------------------------------- */

/**
 * Post a single chat card summarizing the whole recovery sequence.
 * @param {Actor} actor
 * @param {object} data
 * @param {number} data.start
 * @param {number} data.end
 * @param {number} data.baseDC
 * @param {object[]} data.steps
 * @returns {Promise<ChatMessage>}
 */
async function postRecoveryCard(actor, { start, end, baseDC, steps }) {
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/recovery.hbs`, {
      actor, start, end, baseDC, steps,
      removed: start - end,
      cleared: end === 0
    });
  return ChatMessage.implementation.create({
    content,
    rolls: steps.filter(s => s.roll).map(s => s.roll),
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flavor: game.i18n.localize("EXTENDED_EXHAUSTION.Recovery.Flavor"),
    flags: { [MODULE_ID]: { type: "recovery" } }
  });
}

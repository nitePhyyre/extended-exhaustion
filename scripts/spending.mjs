import { MODULE_ID, SPEND_OPTIONS, SPEND_OPTIONS_BY_ID } from "./constants.mjs";
import { addLevels, applyPlacement, getLevel, isImmune, maxLevel } from "./exhaustion.mjs";
import { promptPlacement } from "./apps/place-dialog.mjs";
import { applySpendEffect } from "./spend-effects.mjs";
import { setting } from "./settings.mjs";

/**
 * Is this creature currently unconscious? "Except for the Reroll Death Save, unconscious creatures
 * cannot voluntarily spend exhaustion."
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isUnconscious(actor) {
  return actor?.statuses?.has("unconscious") ?? false;
}

/* -------------------------------------------- */

/**
 * Build the list of spending options as presented to a given actor.
 * @param {Actor} actor
 * @returns {object[]}
 */
export function prepareOptions(actor) {
  const level = getLevel(actor);
  const headroom = maxLevel() - level;
  const unconscious = isUnconscious(actor);
  return SPEND_OPTIONS.map(option => {
    const blocked = [];
    if ( unconscious && !option.allowUnconscious ) blocked.push("EXTENDED_EXHAUSTION.Spend.Blocked.Unconscious");
    if ( option.value > headroom ) blocked.push("EXTENDED_EXHAUSTION.Spend.Blocked.Lethal");
    return {
      ...option,
      name: game.i18n.localize(option.label),
      text: game.i18n.localize(option.description),
      costLabel: option.variable
        ? game.i18n.format("EXTENDED_EXHAUSTION.Spend.CostVariable", { value: option.value })
        : game.i18n.format("EXTENDED_EXHAUSTION.Spend.Cost", { value: option.value }),
      relevant: option.relevant ? option.relevant(actor) : true,
      disabled: blocked.length > 0,
      blocked: blocked.map(k => game.i18n.localize(k))
    };
  });
}

/* -------------------------------------------- */

/**
 * Spend exhaustion on one of the homebrew's options: apply the cost and announce it in chat.
 * @param {Actor} actor
 * @param {string} optionId          Key from {@link SPEND_OPTIONS}.
 * @param {object} [data]
 * @param {number} [data.spellLevel] Spell level, for the Upcast option.
 * @param {boolean} [data.beyondMax] Whether the spell is cast beyond the actor's highest slot level.
 * @returns {Promise<ChatMessage|null>}
 */
export async function spend(actor, optionId, { spellLevel = 1, beyondMax = false, kaioken = false } = {}) {
  const option = SPEND_OPTIONS_BY_ID[optionId];
  if ( !actor || !option ) return null;
  if ( !setting("enableSpending") ) return null;

  if ( isImmune(actor) ) {
    ui.notifications.warn(game.i18n.format("EXTENDED_EXHAUSTION.Notification.Immune", { name: actor.name }));
    return null;
  }
  if ( isUnconscious(actor) && !option.allowUnconscious ) {
    ui.notifications.warn(game.i18n.localize("EXTENDED_EXHAUSTION.Notification.Unconscious"));
    return null;
  }

  const cost = costOf(option, { spellLevel, beyondMax });
  const level = getLevel(actor);
  if ( (level + cost) > maxLevel() ) {
    ui.notifications.warn(game.i18n.format("EXTENDED_EXHAUSTION.Notification.Lethal", {
      cost, max: maxLevel(), level
    }));
    return null;
  }

  // Under Method B the player chooses which penalties this cost is marked against, exactly as
  // they would for an involuntary level. The cost can be several levels at once, so the prompt
  // places them one at a time until the whole cost is accounted for.
  const from = getLevel(actor);
  let placed = false;
  if ( setting("method") === "choice" ) {
    const delta = await promptPlacement(actor, {
      count: cost,
      reason: game.i18n.format("EXTENDED_EXHAUSTION.Place.SpentOn", {
        option: game.i18n.localize(option.label)
      })
    });
    placed = await applyPlacement(actor, delta, cost, "spent", from);
  }
  if ( !placed ) await addLevels(actor, cost, { reason: "spent", chat: false });

  // Crucial Save is resolved against the roll that already happened; everything else with a
  // mechanical consequence is realized by its handler.
  const applied = (option.id === "crucialSave") ? await applyCrucialSave(actor) : false;
  const effect = await applySpendEffect(actor, option.id, { spellLevel, beyondMax, kaioken });

  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/spend.hbs`, {
      actor,
      name: game.i18n.localize(option.label),
      text: game.i18n.localize(option.description),
      cost,
      reaction: !!option.reaction,
      level: getLevel(actor),
      applied: applied ? game.i18n.localize("EXTENDED_EXHAUSTION.Spend.crucialSave.Applied") : null,
      effect: effect?.summary ?? null,
      effectFailed: effect ? !effect.ok : false,
      detail: option.id === "upcast"
        ? game.i18n.format("EXTENDED_EXHAUSTION.Spend.upcast.Detail", {
          level: spellLevel,
          suffix: beyondMax ? game.i18n.localize("EXTENDED_EXHAUSTION.Spend.upcast.BeyondMax") : ""
        })
        : null
    });

  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flags: { [MODULE_ID]: { type: "spend", option: option.id, cost } }
  });
}

/* -------------------------------------------- */

/**
 * The exhaustion cost of an option. Upcasting costs one level per spell level, or two per spell
 * level when the spell is cast beyond the highest slot level normally available.
 * @param {SpendOption} option
 * @param {object} [data]
 * @param {number} [data.spellLevel]
 * @param {boolean} [data.beyondMax]
 * @returns {number}
 */
export function costOf(option, { spellLevel = 1, beyondMax = false } = {}) {
  if ( option.id !== "upcast" ) return option.value;
  return Math.max(1, spellLevel) * (beyondMax ? 2 : 1);
}

/* -------------------------------------------- */

/** How recently a saving throw must have been rolled for Crucial Save to reach it, in ms. */
const CRUCIAL_SAVE_WINDOW = 120_000;

/** How many recent chat messages to search for that saving throw. */
const CRUCIAL_SAVE_DEPTH = 20;

/**
 * Add the Crucial Save bonus to the actor's most recent saving throw, in place. The homebrew lets
 * this be declared after the d20 is rolled but before the DM calls the result, which is exactly
 * what updating the existing roll models.
 * @param {Actor} actor
 * @returns {Promise<boolean>}  Whether a roll was found and amended.
 */
async function applyCrucialSave(actor) {
  try {
    const message = findRecentSave(actor);
    const roll = message?.rolls?.[0];
    if ( !roll?._evaluated ) return false;

    const { NumericTerm, OperatorTerm } = foundry.dice.terms;
    const operator = new OperatorTerm({ operator: "+" });
    const term = new NumericTerm({
      number: 5,
      options: { flavor: game.i18n.localize("EXTENDED_EXHAUSTION.Spend.crucialSave.Label") }
    });
    operator._evaluated = true;
    term._evaluated = true;
    roll.terms.push(operator, term);
    roll.resetFormula();
    roll._total = roll.total + 5;

    await message.update({ rolls: message.rolls.map(r => JSON.stringify(r.toJSON())) });
    return true;
  } catch(err) {
    console.warn(`${MODULE_ID} | Could not apply the Crucial Save bonus to an existing roll`, err);
    return false;
  }
}

/* -------------------------------------------- */

/**
 * Find this actor's most recent saving throw message, if it is recent enough to still be in play.
 * @param {Actor} actor
 * @returns {ChatMessage|null}
 */
function findRecentSave(actor) {
  const messages = game.messages.contents;
  const cutoff = Date.now() - CRUCIAL_SAVE_WINDOW;
  for ( let i = messages.length - 1; i >= Math.max(0, messages.length - CRUCIAL_SAVE_DEPTH); i-- ) {
    const message = messages[i];
    if ( message.timestamp < cutoff ) break;
    if ( message.speaker?.actor !== actor.id ) continue;
    // dnd5e 6 uses typed chat messages, so a saving throw is the "save" message subtype.
    if ( message.type !== "save" ) continue;
    if ( !message.rolls?.length ) continue;
    return message;
  }
  return null;
}

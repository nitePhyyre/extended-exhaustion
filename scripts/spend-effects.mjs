import { MODULE_ID } from "./constants.mjs";

/**
 * Makes the "Spending Exhaustion" options actually do something.
 *
 * Three mechanisms are used, in order of preference:
 *
 * 1. Write the resource directly, so it shows on the sheet and the player uses it normally. Spell
 *    slot counts have no maximum in the schema, and feature uses are `max - spent`, so both can be
 *    handed back cleanly.
 * 2. Register a rule through a short-lived Active Effect. dnd5e 6 collects `dnd5e.advantage` and
 *    friends into its own rules engine, so the system grants the advantage itself rather than this
 *    module intercepting a roll, which is also why it survives MidiQOL.
 * 3. A one-shot state edit for corrections, such as rerolling a death save.
 *
 * Options with no entry here keep their announce-only behaviour.
 * @module
 */

/** Flag holding grants awaiting revocation at the end of the actor's turn. */
const GRANTS_FLAG = "grants";

/* -------------------------------------------- */

/**
 * Apply the mechanical effect of a spend option.
 * @param {Actor} actor
 * @param {string} optionId
 * @param {object} [context]  Extra input from the spend dialog.
 * @returns {Promise<{ok: boolean, summary: string}|null>}  Null when the option has no handler.
 */
export async function applySpendEffect(actor, optionId, context = {}) {
  const handler = HANDLERS[optionId];
  if ( !handler ) return null;
  try {
    return await handler(actor, context);
  } catch(err) {
    console.error(`${MODULE_ID} | Failed to apply the effect of "${optionId}"`, err);
    return { ok: false, summary: game.i18n.localize("EXTENDED_EXHAUSTION.Effect.Failed") };
  }
}

/* -------------------------------------------- */

/** @type {Record<string, (actor: Actor, context: object) => Promise<object>>} */
const HANDLERS = {
  spellSlot1: actor => grantSpellSlot(actor, 1),
  upcast: (actor, ctx) => grantSpellSlot(actor, Math.clamp(ctx.spellLevel ?? 1, 1, 9)),
  rage: actor => restoreUses(actor, ["rage"], 1),
  kiPoints: (actor, ctx) => restoreUses(actor, ["ki", "kipoints", "ki-points", "discipline"],
    ctx.kaioken ? 3 : 2),
  recklessAttack: actor => grantRule(actor, {
    name: "EXTENDED_EXHAUSTION.Spend.recklessAttack.Label",
    img: "icons/svg/sword.svg",
    changes: [{ key: "attack", type: "dnd5e.advantage", value: "1" }]
  }, "EXTENDED_EXHAUSTION.Effect.AdvantageGranted"),
  brutalCritical: actor => grantRule(actor, {
    name: "EXTENDED_EXHAUSTION.Spend.brutalCritical.Label",
    img: "icons/svg/explosion.svg",
    changes: [{ key: "flags.dnd5e.meleeCriticalDamageDice", type: "add", value: "1" }]
  }, "EXTENDED_EXHAUSTION.Effect.CritDieGranted"),
  perfectTiming,
  rerollDeathSave
};

/* -------------------------------------------- */
/*  Resource grants                             */
/* -------------------------------------------- */

/**
 * Hand the actor a spell slot of the given level. The slot is real: it appears in the spellbook
 * and is spent by casting as normal.
 * @param {Actor} actor
 * @param {number} level
 * @returns {Promise<object>}
 */
async function grantSpellSlot(actor, level) {
  const key = `spell${level}`;
  const slot = actor.system.spells?.[key];
  if ( !slot ) {
    return { ok: false, summary: game.i18n.format("EXTENDED_EXHAUSTION.Effect.NoSlotLevel", { level }) };
  }
  const before = slot.value ?? 0;
  await actor.update({ [`system.spells.${key}.value`]: before + 1 });
  await registerGrant(actor, { kind: "slot", key, before });
  return { ok: true, summary: game.i18n.format("EXTENDED_EXHAUSTION.Effect.SlotGranted", { level }) };
}

/* -------------------------------------------- */

/**
 * Give back uses of a feature, such as Rage or Ki. Uses are stored as `spent` against a maximum,
 * so recovering means spending less; it is clamped so nothing can be stockpiled past the maximum.
 * @param {Actor} actor
 * @param {string[]} identifiers  Candidate identifiers or slugified names.
 * @param {number} amount
 * @returns {Promise<object>}
 */
async function restoreUses(actor, identifiers, amount) {
  const item = findFeature(actor, identifiers);
  if ( !item ) {
    return { ok: false, summary: game.i18n.format("EXTENDED_EXHAUSTION.Effect.NoFeature", {
      name: identifiers[0]
    }) };
  }
  const spent = item.system.uses?.spent ?? 0;
  const restored = Math.min(amount, spent);
  if ( restored < 1 ) {
    return { ok: false, summary: game.i18n.format("EXTENDED_EXHAUSTION.Effect.FeatureFull", {
      name: item.name
    }) };
  }
  await item.update({ "system.uses.spent": spent - restored });
  return { ok: true, summary: game.i18n.format("EXTENDED_EXHAUSTION.Effect.UsesRestored", {
    amount: restored, name: item.name
  }) };
}

/* -------------------------------------------- */

/**
 * Locate a feature with limited uses by identifier or name.
 * @param {Actor} actor
 * @param {string[]} identifiers
 * @returns {Item|null}
 */
function findFeature(actor, identifiers) {
  const wanted = identifiers.map(i => i.toLowerCase());
  const candidates = actor.items.filter(i => !!i.system.uses?.max);
  const match = candidates.find(i => {
    const id = String(i.system.identifier ?? "").toLowerCase();
    const slug = i.name.slugify({ strict: true });
    return wanted.includes(id) || wanted.includes(slug) || wanted.some(w => slug.includes(w));
  });
  return match ?? null;
}

/* -------------------------------------------- */
/*  Rule effects                                */
/* -------------------------------------------- */

/**
 * Apply a short-lived Active Effect carrying a dnd5e rule, lasting until the end of the actor's
 * current turn.
 * @param {Actor} actor
 * @param {object} data        Effect name, image and changes.
 * @param {string} summaryKey  Localization key describing what was granted.
 * @returns {Promise<object>}
 */
async function grantRule(actor, data, summaryKey) {
  const [effect] = await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: game.i18n.localize(data.name),
    img: data.img,
    disabled: false,
    duration: game.combat ? { combat: game.combat.id, rounds: 0, turns: 1 } : {},
    system: { changes: data.changes },
    flags: { [MODULE_ID]: { temporary: true } }
  }]);
  await registerGrant(actor, { kind: "effect", effectId: effect.id });
  return { ok: true, summary: game.i18n.localize(summaryKey) };
}

/* -------------------------------------------- */
/*  One-shot edits                              */
/* -------------------------------------------- */

/**
 * Move the actor to the top of the initiative order and make it their turn.
 * @param {Actor} actor
 * @returns {Promise<object>}
 */
async function perfectTiming(actor) {
  const combat = game.combat;
  const combatant = combat?.combatants.find(c => c.actor?.id === actor.id);
  if ( !combat || !combatant ) {
    return { ok: false, summary: game.i18n.localize("EXTENDED_EXHAUSTION.Effect.NotInCombat") };
  }
  const highest = combat.combatants.reduce((max, c) => Math.max(max, c.initiative ?? 0), 0);
  await combat.setInitiative(combatant.id, highest + 1);
  const index = combat.turns.findIndex(c => c.id === combatant.id);
  if ( index >= 0 ) await combat.update({ turn: index });
  return { ok: true, summary: game.i18n.localize("EXTENDED_EXHAUSTION.Effect.MovedToTop") };
}

/* -------------------------------------------- */

/**
 * Undo the most recent failed death save and roll a fresh one. A critical failure counts twice but
 * only one failure is taken back, matching "reroll the saving throw" rather than undoing the whole
 * result.
 * @param {Actor} actor
 * @returns {Promise<object>}
 */
async function rerollDeathSave(actor) {
  const death = actor.system.attributes?.death;
  if ( !death || ((death.failure ?? 0) < 1) ) {
    return { ok: false, summary: game.i18n.localize("EXTENDED_EXHAUSTION.Effect.NoFailedDeathSave") };
  }

  // Roll first. The system applies the new result to the counters itself, so the failure being
  // rerolled is only taken back once a replacement actually exists; cancelling changes nothing.
  const rolls = await actor.rollDeathSave();
  if ( !rolls?.length ) {
    return { ok: false, summary: game.i18n.localize("EXTENDED_EXHAUSTION.Effect.DeathSaveCancelled") };
  }
  const current = actor.system.attributes.death.failure ?? 0;
  await actor.update({ "system.attributes.death.failure": Math.max(0, current - 1) });
  return { ok: true, summary: game.i18n.localize("EXTENDED_EXHAUSTION.Effect.DeathSaveRerolled") };
}

/* -------------------------------------------- */
/*  Expiry                                      */
/* -------------------------------------------- */

/**
 * Record something that should be taken back at the end of the actor's turn. Outside combat there
 * is no turn to expire on, so grants are left in place for the player to use.
 * @param {Actor} actor
 * @param {object} grant
 * @returns {Promise<void>}
 */
async function registerGrant(actor, grant) {
  const combat = game.combat;
  if ( !combat ) return;
  const grants = foundry.utils.deepClone(actor.getFlag(MODULE_ID, GRANTS_FLAG) ?? []);
  grants.push({ ...grant, combat: combat.id, round: combat.round, turn: combat.turn });
  await actor.setFlag(MODULE_ID, GRANTS_FLAG, grants);
}

/* -------------------------------------------- */

/**
 * Watch for the turn moving on, and take back anything that was granted for that turn only.
 */
export function registerSpendCleanup() {
  Hooks.on("updateCombat", (combat, changed) => {
    if ( !("turn" in changed) && !("round" in changed) ) return;
    if ( game.users.activeGM !== game.user ) return;
    for ( const actor of grantHolders(combat) ) revokeGrants(actor, combat);
  });
  Hooks.on("deleteCombat", combat => {
    if ( game.users.activeGM !== game.user ) return;
    for ( const actor of grantHolders(combat) ) revokeGrants(actor, combat, true);
  });
}

/* -------------------------------------------- */

/**
 * Every actor in a combat that is holding grants.
 *
 * A combatant placed from an unlinked token exposes a synthetic actor that is a different document
 * from the one in the directory, and a spend may have been made against either &mdash; from the
 * token HUD or from the sheet. Both are checked, deduplicated by uuid.
 * @param {Combat} combat
 * @yields {Actor}
 */
function* grantHolders(combat) {
  const seen = new Set();
  for ( const combatant of combat.combatants ) {
    for ( const actor of [combatant.actor, game.actors.get(combatant.actorId)] ) {
      if ( !actor || seen.has(actor.uuid) ) continue;
      seen.add(actor.uuid);
      if ( actor.getFlag(MODULE_ID, GRANTS_FLAG)?.length ) yield actor;
    }
  }
}

/* -------------------------------------------- */

/**
 * Take back grants whose turn has passed.
 * @param {Actor} actor
 * @param {Combat} combat
 * @param {boolean} [all=false]  Revoke regardless of whose turn it is.
 * @returns {Promise<void>}
 */
async function revokeGrants(actor, combat, all = false) {
  const grants = actor.getFlag(MODULE_ID, GRANTS_FLAG) ?? [];
  const keep = [];
  const effectIds = [];
  const updates = {};

  for ( const grant of grants ) {
    const expired = all || (grant.combat !== combat.id) || (combat.round > grant.round)
      || ((combat.round === grant.round) && (combat.turn !== grant.turn));
    if ( !expired ) {
      keep.push(grant);
      continue;
    }
    if ( grant.kind === "effect" ) {
      if ( actor.effects.has(grant.effectId) ) effectIds.push(grant.effectId);
    } else if ( grant.kind === "slot" ) {
      // Only take the slot back if it went unused: if the count is still above what it was before
      // the grant, nothing was cast with it.
      const current = actor.system.spells?.[grant.key]?.value ?? 0;
      if ( current > grant.before ) updates[`system.spells.${grant.key}.value`] = current - 1;
    }
  }

  try {
    if ( effectIds.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", effectIds);
    updates[`flags.${MODULE_ID}.${GRANTS_FLAG}`] = keep;
    await actor.update(updates);
  } catch(err) {
    console.error(`${MODULE_ID} | Failed to revoke expired spend grants`, err);
  }
}

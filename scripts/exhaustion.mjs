import {
  BASE_SPEED_FT, EFFECT_ID, GAIN_REASONS, MODULE_ID, TRACKS, TRACK_IDS, TRACKS_BY_ID, emptyMarks
} from "./constants.mjs";
import { setting } from "./settings.mjs";

/**
 * The marks object: how many levels of exhaustion are assigned to each of the six penalty tracks.
 * @typedef {Record<string, number>} ExhaustionMarks
 */

/**
 * @typedef {object} ExhaustionPenalties
 * @property {number} mentalSkills      Penalty to Int/Wis/Cha ability checks (a positive magnitude).
 * @property {number} physicalSkills    Penalty to Str/Dex/Con ability checks.
 * @property {number} mentalSaves       Penalty to Int/Wis/Cha saving throws.
 * @property {number} physicalSaves     Penalty to Str/Dex/Con saving throws.
 * @property {number} speed             Speed reduction in feet.
 * @property {number} hpFraction        Fraction of hit point maximum lost, 0 to 1.
 * @property {number} hpMarks           Raw number of hit point maximum marks.
 */

/* -------------------------------------------- */
/*  Reading state                               */
/* -------------------------------------------- */

/**
 * The configured maximum survivable exhaustion level. Always a multiple of six, so that the table
 * is a whole number of rows across its six columns.
 * @returns {number}
 */
export function maxLevel() {
  return setting("maxLevel");
}

/* -------------------------------------------- */

/**
 * How many marks one column holds when the table is completely full, i.e. the number of rows.
 * @returns {number}
 */
export function rowsPerTrack() {
  return Math.max(1, Math.floor(maxLevel() / TRACKS.length));
}

/* -------------------------------------------- */

/**
 * The number of marks in a single column that would reduce that statistic to nothing: one row
 * beyond a full table, which is exactly the level at which the creature dies.
 *
 * Everything scales from this. At the homebrew's maximum of 30 the table is five rows deep, so a
 * sixth mark would zero a column out, giving the document's -1/6 hit point maximum and -5 ft. of
 * speed per mark.
 * @returns {number}
 */
export function zeroAtMarks() {
  return rowsPerTrack() + 1;
}

/* -------------------------------------------- */

/**
 * Feet of speed lost per mark in the Speed column, derived from the maximum level.
 * @returns {number}
 */
export function speedStep() {
  return Math.max(1, Math.round(BASE_SPEED_FT / zeroAtMarks()));
}

/* -------------------------------------------- */

/**
 * Is this actor immune to exhaustion?
 * @param {Actor} actor
 * @returns {boolean}
 */
export function isImmune(actor) {
  return actor?.system?.traits?.ci?.value?.has?.("exhaustion") ?? false;
}

/* -------------------------------------------- */

/**
 * An actor's marks. The marks flag is the module's source of truth; the system's exhaustion level
 * is kept in sync alongside it so the condition icon, death at the maximum level, and other
 * modules all keep working. Actors this module has never touched fall back to whatever level the
 * system already has, distributed per the configured method.
 * @param {Actor} actor
 * @returns {ExhaustionMarks}
 */
export function getMarks(actor) {
  const raw = actor?.getFlag(MODULE_ID, "marks");
  if ( raw ) return normalizeMarks(raw);
  return redistribute(emptyMarks(), systemLevel(actor));
}

/* -------------------------------------------- */

/**
 * An actor's current exhaustion level.
 * @param {Actor} actor
 * @returns {number}
 */
export function getLevel(actor) {
  const raw = actor?.getFlag(MODULE_ID, "marks");
  if ( raw ) return total(normalizeMarks(raw));
  return systemLevel(actor);
}

/* -------------------------------------------- */

/**
 * The exhaustion level recorded by the dnd5e system itself.
 * @param {Actor} actor
 * @returns {number}
 */
export function systemLevel(actor) {
  return actor?.system?.attributes?.exhaustion ?? 0;
}

/* -------------------------------------------- */

/**
 * Coerce arbitrary stored data into a well-formed marks object.
 * @param {object} [raw]
 * @returns {ExhaustionMarks}
 */
export function normalizeMarks(raw) {
  const marks = emptyMarks();
  for ( const id of TRACK_IDS ) {
    const n = Number(raw?.[id]);
    marks[id] = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }
  return marks;
}

/* -------------------------------------------- */

/**
 * Sum of all marks.
 * @param {ExhaustionMarks} marks
 * @returns {number}
 */
export function total(marks) {
  return TRACK_IDS.reduce((sum, id) => sum + (marks[id] ?? 0), 0);
}

/* -------------------------------------------- */
/*  Distributing levels across tracks           */
/* -------------------------------------------- */

/**
 * Marks for a given level under Method A (Sequential Progression): the table is filled left to
 * right, completing each row before moving to the next.
 * @param {number} level
 * @returns {ExhaustionMarks}
 */
export function sequentialMarks(level) {
  const marks = emptyMarks();
  const count = TRACKS.length;
  TRACKS.forEach((track, i) => {
    marks[track.id] = level > i ? Math.floor((level - i - 1) / count) + 1 : 0;
  });
  return marks;
}

/* -------------------------------------------- */

/**
 * Add `n` marks by always filling the least-marked track, breaking ties in table order. Starting
 * from zero this reproduces Method A exactly, so it doubles as the auto-fill for Method B.
 *
 * No column takes more than one row's worth of marks while any other column has room. Once the
 * whole table is full the cap is ignored, so the fatal level one past the maximum can still be
 * represented.
 * @param {ExhaustionMarks} marks  Mutated in place.
 * @param {number} n
 * @returns {ExhaustionMarks}
 */
export function addMarks(marks, n) {
  const cap = rowsPerTrack();
  for ( let i = 0; i < n; i++ ) {
    const open = TRACK_IDS.filter(id => marks[id] < cap);
    const candidates = open.length ? open : TRACK_IDS;
    let best = candidates[0];
    for ( const id of candidates ) if ( marks[id] < marks[best] ) best = id;
    marks[best] += 1;
  }
  return marks;
}

/* -------------------------------------------- */

/**
 * Remove `n` marks, always taking from the most-marked track and breaking ties in reverse table
 * order. This is the exact inverse of {@link addMarks}.
 * @param {ExhaustionMarks} marks  Mutated in place.
 * @param {number} n
 * @returns {ExhaustionMarks}
 */
export function removeMarks(marks, n) {
  for ( let i = 0; i < n; i++ ) {
    if ( total(marks) <= 0 ) break;
    let best = null;
    for ( const id of TRACK_IDS ) {
      if ( (marks[id] > 0) && ((best === null) || (marks[id] >= marks[best])) ) best = id;
    }
    marks[best] -= 1;
  }
  return marks;
}

/* -------------------------------------------- */

/**
 * Produce a marks object whose total equals `level`, preserving the existing distribution as far
 * as the configured method allows.
 * @param {ExhaustionMarks} marks  Current marks (not mutated).
 * @param {number} level           Target total.
 * @returns {ExhaustionMarks}
 */
export function redistribute(marks, level) {
  if ( setting("method") === "sequential" ) return sequentialMarks(level);
  const next = normalizeMarks(marks);
  const delta = level - total(next);
  if ( delta > 0 ) addMarks(next, delta);
  else if ( delta < 0 ) removeMarks(next, -delta);
  return next;
}

/* -------------------------------------------- */
/*  Penalties                                   */
/* -------------------------------------------- */

/**
 * The mechanical penalties an actor currently suffers.
 * @param {Actor} actor
 * @returns {ExhaustionPenalties}
 */
export function getPenalties(actor) {
  if ( isImmune(actor) ) return penaltiesFromMarks(emptyMarks());
  return penaltiesFromMarks(getMarks(actor));
}

/* -------------------------------------------- */

/**
 * Convert marks into penalty magnitudes.
 * @param {ExhaustionMarks} marks
 * @returns {ExhaustionPenalties}
 */
export function penaltiesFromMarks(marks) {
  return {
    mentalSkills: marks.mentalSkills,
    physicalSkills: marks.physicalSkills,
    mentalSaves: marks.mentalSaves,
    physicalSaves: marks.physicalSaves,
    speed: marks.speed * speedStep(),
    hpMarks: marks.hpMax,
    hpFraction: Math.min(1, marks.hpMax / zeroAtMarks())
  };
}

/* -------------------------------------------- */

/**
 * The exhaustion penalty that applies to a d20 test of the given kind, as a positive magnitude.
 * @param {Actor} actor
 * @param {"check"|"save"} type
 * @param {string} ability       Ability key.
 * @returns {number}
 */
export function penaltyFor(actor, type, ability) {
  const penalties = getPenalties(actor);
  for ( const track of TRACKS ) {
    if ( (track.kind === type) && track.abilities?.includes(ability) ) return penalties[track.id];
  }
  return 0;
}

/* -------------------------------------------- */
/*  Writing state                               */
/* -------------------------------------------- */

/**
 * Set an actor's exhaustion level, redistributing marks as the configured method requires.
 * @param {Actor} actor
 * @param {number} level                 New exhaustion level.
 * @param {object} [options]
 * @param {string} [options.reason]      A key of {@link GAIN_REASONS}, used for the chat card.
 * @param {boolean} [options.chat=true]  Post a chat card summarizing the change.
 * @returns {Promise<Actor|null>}
 */
export async function setLevel(actor, level, { reason = "manual", chat = true } = {}) {
  if ( !actor ) return null;
  if ( isImmune(actor) && (level > 0) ) {
    ui.notifications.info(game.i18n.format("EXTENDED_EXHAUSTION.Notification.Immune", { name: actor.name }));
    return null;
  }
  const from = getLevel(actor);
  const to = Math.clamp(Math.floor(level), 0, maxLevel() + 1);
  if ( from === to ) return actor;
  const marks = redistribute(getMarks(actor), to);
  await actor.update({
    "system.attributes.exhaustion": to,
    [`flags.${MODULE_ID}.marks`]: marks
  });
  if ( chat ) await postChangeCard(actor, { from, to, reason });
  return actor;
}

/* -------------------------------------------- */

/**
 * Add (or, with a negative value, remove) levels of exhaustion.
 * @param {Actor} actor
 * @param {number} [delta=1]
 * @param {object} [options]             Passed through to {@link setLevel}.
 * @returns {Promise<Actor|null>}
 */
export async function addLevels(actor, delta = 1, options = {}) {
  return setLevel(actor, getLevel(actor) + delta, options);
}

/* -------------------------------------------- */

/**
 * Overwrite an actor's distribution of marks. Only meaningful under Method B.
 * @param {Actor} actor
 * @param {ExhaustionMarks} marks
 * @returns {Promise<Actor|null>}
 */
export async function setMarks(actor, marks) {
  if ( !actor ) return null;
  const next = clampMarks(marks);
  const level = total(next);
  return actor.update({
    "system.attributes.exhaustion": level,
    [`flags.${MODULE_ID}.marks`]: next
  });
}

/* -------------------------------------------- */

/**
 * Clamp a distribution to the shape of the table: no column deeper than the configured number of
 * rows, and no more marks in total than the maximum level. Surplus marks are discarded from the
 * fullest columns first.
 * @param {ExhaustionMarks} marks
 * @returns {ExhaustionMarks}
 */
export function clampMarks(marks) {
  const next = normalizeMarks(marks);
  const cap = rowsPerTrack();
  for ( const id of TRACK_IDS ) next[id] = Math.min(next[id], cap);
  const excess = total(next) - maxLevel();
  if ( excess > 0 ) removeMarks(next, excess);
  return next;
}

/* -------------------------------------------- */

/**
 * Bring the marks flag and the system's exhaustion level back into agreement. Used when something
 * other than this module changes `system.attributes.exhaustion` &mdash; the token HUD, a macro, or
 * another module.
 * @param {Actor} actor
 * @param {number} [target]  The level to reconcile to. Defaults to the actor's current level, but
 *                           callers reacting to an update should pass the value from the delta.
 * @returns {Promise<Actor|null>}
 */
export async function reconcile(actor, target) {
  if ( !actor?.isOwner ) return null;
  const marks = normalizeMarks(actor.getFlag(MODULE_ID, "marks"));
  const raw = Number.isFinite(target) ? target : systemLevel(actor);
  const level = Math.clamp(raw, 0, maxLevel() + 1);
  if ( total(marks) === level ) return null;
  const next = redistribute(marks, level);
  const update = { [`flags.${MODULE_ID}.marks`]: next };
  if ( systemLevel(actor) !== level ) update["system.attributes.exhaustion"] = level;
  return actor.update(update);
}

/* -------------------------------------------- */

/**
 * Apply a chosen distribution, topping up automatically if the player placed only some of the
 * levels before dismissing the prompt.
 * @param {Actor} actor
 * @param {object|null} delta   Marks delta chosen in the prompt.
 * @param {number} count        How many levels were being placed.
 * @param {string} reason       A key of the gain-reason enum.
 * @param {number} from         Level before the gain, for the chat card.
 * @returns {Promise<boolean>}  Whether anything was applied.
 */
export async function applyPlacement(actor, delta, count, reason, from) {
  if ( !delta ) return false;
  const placed = Object.values(delta).reduce((sum, n) => sum + n, 0);
  if ( placed < 1 ) return false;

  const marks = getMarks(actor);
  for ( const [id, n] of Object.entries(delta) ) marks[id] = (marks[id] ?? 0) + n;
  await setMarks(actor, marks);

  // Any levels the player did not place still have to land somewhere.
  const outstanding = count - placed;
  if ( outstanding > 0 ) {
    await addLevels(actor, outstanding, { reason, chat: false });
    ui.notifications?.warn?.(game.i18n.format("EXTENDED_EXHAUSTION.Place.AutoPlaced", { name: actor.name }));
  }

  if ( reason !== "spent" ) await postChangeCard(actor, { from, to: getLevel(actor), reason });
  return true;
}

/* -------------------------------------------- */
/*  Active Effect synchronization               */
/* -------------------------------------------- */

/**
 * Build the Active Effect changes that carry an actor's check and save penalties. Speed and hit
 * point maximum are applied in {@link module:scripts/penalties} instead, because both need the
 * fully derived values in order to respect the homebrew's minimum-value rules.
 *
 * Changes use dnd5e 6's roll modification paths (`abilities.<abl>.check.roll.bonus`) and Foundry
 * v14's string change types. The value is a signed string because the target is a formula field,
 * where "add" concatenates: an existing "1d4" becomes "1d4-3", which still evaluates correctly.
 * @param {ExhaustionPenalties} penalties
 * @returns {object[]}
 */
export function buildChanges(penalties) {
  const changes = [];
  for ( const track of TRACKS ) {
    if ( !["check", "save"].includes(track.kind) ) continue;
    const value = penalties[track.id];
    if ( !value ) continue;
    for ( const ability of track.abilities ) {
      changes.push({
        key: `system.abilities.${ability}.${track.kind}.roll.bonus`,
        type: "add",
        value: `-${value}`,
        priority: 20
      });
    }
  }
  return changes;
}

/* -------------------------------------------- */

/**
 * In-flight effect synchronizations, keyed by actor id.
 * @type {Map<string, Promise>}
 */
const syncQueues = new Map();

/**
 * Create, update, or delete the module's penalty Active Effect so that it matches the actor's
 * current marks.
 *
 * Synchronizations are serialized per actor. Several exhaustion changes can land in quick
 * succession &mdash; holding down a stepper, taking damage mid-edit &mdash; and two overlapping
 * runs would each see no effect present and both try to create one, which fails on the duplicate
 * id. Queueing keeps each run working from the result of the last.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
export function syncEffect(actor) {
  if ( !actor?.id ) return Promise.resolve();
  const previous = syncQueues.get(actor.id) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => applyEffectSync(actor));
  syncQueues.set(actor.id, next);
  next.catch(() => {}).then(() => {
    if ( syncQueues.get(actor.id) === next ) syncQueues.delete(actor.id);
  });
  return next;
}

/* -------------------------------------------- */

/**
 * The body of {@link syncEffect}, run one at a time per actor.
 * @param {Actor} actor
 * @returns {Promise<void>}
 */
async function applyEffectSync(actor) {
  if ( !actor?.isOwner ) return;
  const existing = actor.effects.get(EFFECT_ID);
  const level = getLevel(actor);
  const changes = isImmune(actor) ? [] : buildChanges(penaltiesFromMarks(getMarks(actor)));

  if ( !level || !changes.length ) {
    if ( existing ) await existing.delete();
    return;
  }

  const name = game.i18n.format("EXTENDED_EXHAUSTION.Effect.Name", { level });
  if ( !existing ) {
    await actor.createEmbeddedDocuments("ActiveEffect", [{
      _id: EFFECT_ID,
      name,
      img: "icons/svg/unconscious.svg",
      disabled: false,
      description: game.i18n.localize("EXTENDED_EXHAUSTION.Effect.Description"),
      system: { changes },
      flags: { [MODULE_ID]: { penalties: true } }
    }], { keepId: true, render: false });
    return;
  }

  if ( (existing.name === name) && sameChanges(existing.system?.changes ?? [], changes) ) return;
  await existing.update({ name, "system.changes": changes }, { render: false });
}

/* -------------------------------------------- */

/**
 * Compare two change lists on the fields this module controls, ignoring per-change IDs.
 * @param {object[]} a
 * @param {object[]} b
 * @returns {boolean}
 */
function sameChanges(a, b) {
  const strip = list => JSON.stringify(list.map(c => [c.key, c.type, c.value]));
  return strip(a) === strip(b);
}

/* -------------------------------------------- */
/*  Chat                                        */
/* -------------------------------------------- */

/**
 * Post a chat card describing a change in exhaustion level.
 * @param {Actor} actor
 * @param {object} data
 * @param {number} data.from
 * @param {number} data.to
 * @param {string} data.reason
 * @returns {Promise<ChatMessage|void>}
 */
export async function postChangeCard(actor, { from, to, reason }) {
  const delta = to - from;
  if ( !delta ) return;
  const marks = getMarks(actor);
  const penalties = penaltiesFromMarks(marks);
  const content = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/chat/change.hbs`, {
      actor,
      from,
      to,
      delta,
      gained: delta > 0,
      dead: to > maxLevel(),
      reason: GAIN_REASONS[reason] ? game.i18n.localize(GAIN_REASONS[reason]) : null,
      tracks: TRACKS.map(track => ({
        ...track,
        marks: marks[track.id],
        display: formatPenalty(track.id, penalties)
      })).filter(t => t.marks > 0)
    });
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    flags: { [MODULE_ID]: { type: "change", from, to } }
  });
}

/* -------------------------------------------- */

/**
 * A human-readable penalty for one track.
 * @param {string} trackId
 * @param {ExhaustionPenalties} penalties
 * @returns {string}
 */
export function formatPenalty(trackId, penalties) {
  const track = TRACKS_BY_ID[trackId];
  switch ( track?.kind ) {
    case "speed":
      return penalties.speed
        ? game.i18n.format("EXTENDED_EXHAUSTION.Penalty.Speed", { value: penalties.speed })
        : "—";
    case "hp":
      return penalties.hpMarks
        ? game.i18n.format("EXTENDED_EXHAUSTION.Penalty.HitPoints", {
          numerator: penalties.hpMarks, denominator: zeroAtMarks()
        })
        : "—";
    default: {
      const value = penalties[trackId] ?? 0;
      return value ? `-${value}` : "—";
    }
  }
}

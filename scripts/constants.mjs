/**
 * Static configuration for the Extended Exhaustion module.
 * @module
 */

export const MODULE_ID = "extended-exhaustion";

/**
 * Pad a short string out to a valid 16-character document ID so the module's Active Effect
 * can always be found by a known ID (mirrors dnd5e's own `staticID` helper).
 * @param {string} id  A short identifier.
 * @returns {string}   A 16-character document ID.
 */
export function staticID(id) {
  if ( id.length >= 16 ) return id.substring(0, 16);
  return id.padEnd(16, "0");
}

/** ID of the Active Effect that carries the ability check & saving throw penalties. */
export const EFFECT_ID = staticID("extexhaustion");

/**
 * Reference walking speed, in feet, that the speed penalty is derived from. The homebrew's
 * -5 ft. per mark is this divided by the six marks that would reduce a speed to zero.
 */
export const BASE_SPEED_FT = 30;

/** Mental abilities, per the homebrew's definition of "mental" skills and saves. */
export const MENTAL_ABILITIES = ["int", "wis", "cha"];

/** Physical abilities, per the homebrew's definition of "physical" skills and saves. */
export const PHYSICAL_ABILITIES = ["str", "dex", "con"];

/**
 * @typedef {object} ExhaustionTrack
 * @property {string} id              Key within the marks object.
 * @property {string} label           Localization key for the column heading.
 * @property {string} hint            Localization key for the column's rules text.
 * @property {string} icon            Font Awesome icon classes.
 * @property {string} kind            How the penalty applies: "check", "save", "speed" or "hp".
 * @property {string[]} [abilities]   Abilities affected, for "check" and "save" tracks.
 */

/**
 * The six penalty columns of the Extended Exhaustion table, in table order. Method A fills them
 * left to right, so this ordering is load-bearing.
 * @type {ExhaustionTrack[]}
 */
export const TRACKS = [
  {
    id: "mentalSkills",
    label: "EXTENDED_EXHAUSTION.Track.mentalSkills.Label",
    hint: "EXTENDED_EXHAUSTION.Track.mentalSkills.Hint",
    icon: "fa-solid fa-brain",
    kind: "check",
    abilities: MENTAL_ABILITIES
  },
  {
    id: "physicalSkills",
    label: "EXTENDED_EXHAUSTION.Track.physicalSkills.Label",
    hint: "EXTENDED_EXHAUSTION.Track.physicalSkills.Hint",
    icon: "fa-solid fa-hand-fist",
    kind: "check",
    abilities: PHYSICAL_ABILITIES
  },
  {
    id: "mentalSaves",
    label: "EXTENDED_EXHAUSTION.Track.mentalSaves.Label",
    hint: "EXTENDED_EXHAUSTION.Track.mentalSaves.Hint",
    icon: "fa-solid fa-book-skull",
    kind: "save",
    abilities: MENTAL_ABILITIES
  },
  {
    id: "physicalSaves",
    label: "EXTENDED_EXHAUSTION.Track.physicalSaves.Label",
    hint: "EXTENDED_EXHAUSTION.Track.physicalSaves.Hint",
    icon: "fa-solid fa-shield-heart",
    kind: "save",
    abilities: PHYSICAL_ABILITIES
  },
  {
    id: "speed",
    label: "EXTENDED_EXHAUSTION.Track.speed.Label",
    hint: "EXTENDED_EXHAUSTION.Track.speed.Hint",
    icon: "fa-solid fa-person-running",
    kind: "speed"
  },
  {
    id: "hpMax",
    label: "EXTENDED_EXHAUSTION.Track.hpMax.Label",
    hint: "EXTENDED_EXHAUSTION.Track.hpMax.Hint",
    icon: "fa-solid fa-heart-crack",
    kind: "hp"
  }
];

/** Track definitions keyed by ID. */
export const TRACKS_BY_ID = TRACKS.reduce((obj, t) => Object.assign(obj, { [t.id]: t }), {});

/** Ordered list of track IDs. */
export const TRACK_IDS = TRACKS.map(t => t.id);

/**
 * An all-zero marks object.
 * @returns {Record<string, number>}
 */
export function emptyMarks() {
  return TRACKS.reduce((obj, t) => Object.assign(obj, { [t.id]: 0 }), {});
}

/**
 * Reasons a creature gains exhaustion, used for chat card flavor.
 * @enum {string}
 */
export const GAIN_REASONS = {
  zeroHP: "EXTENDED_EXHAUSTION.Reason.ZeroHP",
  travel: "EXTENDED_EXHAUSTION.Reason.Travel",
  deprivation: "EXTENDED_EXHAUSTION.Reason.Deprivation",
  effect: "EXTENDED_EXHAUSTION.Reason.Effect",
  harsh: "EXTENDED_EXHAUSTION.Reason.Harsh",
  spent: "EXTENDED_EXHAUSTION.Reason.Spent",
  manual: "EXTENDED_EXHAUSTION.Reason.Manual"
};

/**
 * @typedef {object} SpendOption
 * @property {string} id                     Unique key.
 * @property {string} label                  Localization key for the option's name.
 * @property {string} description            Localization key for the rules text.
 * @property {number} value                  Levels of exhaustion gained (base cost).
 * @property {boolean} [reaction]            Whether the option also costs a reaction.
 * @property {boolean} [variable]            Whether the cost is chosen at use time.
 * @property {boolean} [allowUnconscious]    Usable while unconscious.
 * @property {(actor: Actor) => boolean} [relevant]  Whether the option is likely relevant to this actor.
 */

/**
 * The "Spending Exhaustion" options from the homebrew document.
 * @type {SpendOption[]}
 */
export const SPEND_OPTIONS = [
  {
    id: "spellSlot1",
    label: "EXTENDED_EXHAUSTION.Spend.spellSlot1.Label",
    description: "EXTENDED_EXHAUSTION.Spend.spellSlot1.Description",
    value: 1,
    relevant: hasSpellcasting
  },
  {
    id: "upcast",
    label: "EXTENDED_EXHAUSTION.Spend.upcast.Label",
    description: "EXTENDED_EXHAUSTION.Spend.upcast.Description",
    value: 1,
    variable: true,
    relevant: hasSpellcasting
  },
  {
    id: "extraAttack",
    label: "EXTENDED_EXHAUSTION.Spend.extraAttack.Label",
    description: "EXTENDED_EXHAUSTION.Spend.extraAttack.Description",
    value: 1
  },
  {
    id: "rage",
    label: "EXTENDED_EXHAUSTION.Spend.rage.Label",
    description: "EXTENDED_EXHAUSTION.Spend.rage.Description",
    value: 2,
    relevant: actor => hasClass(actor, "barbarian")
  },
  {
    id: "recklessAttack",
    label: "EXTENDED_EXHAUSTION.Spend.recklessAttack.Label",
    description: "EXTENDED_EXHAUSTION.Spend.recklessAttack.Description",
    value: 1,
    relevant: actor => hasClass(actor, "barbarian")
  },
  {
    id: "brutalCritical",
    label: "EXTENDED_EXHAUSTION.Spend.brutalCritical.Label",
    description: "EXTENDED_EXHAUSTION.Spend.brutalCritical.Description",
    value: 1
  },
  {
    id: "kiPoints",
    label: "EXTENDED_EXHAUSTION.Spend.kiPoints.Label",
    description: "EXTENDED_EXHAUSTION.Spend.kiPoints.Description",
    value: 1,
    kaioken: true,
    relevant: actor => hasClass(actor, "monk")
  },
  {
    id: "negateCritical",
    label: "EXTENDED_EXHAUSTION.Spend.negateCritical.Label",
    description: "EXTENDED_EXHAUSTION.Spend.negateCritical.Description",
    value: 1,
    reaction: true
  },
  {
    id: "extraReaction",
    label: "EXTENDED_EXHAUSTION.Spend.extraReaction.Label",
    description: "EXTENDED_EXHAUSTION.Spend.extraReaction.Description",
    value: 1
  },
  {
    id: "crucialSave",
    label: "EXTENDED_EXHAUSTION.Spend.crucialSave.Label",
    description: "EXTENDED_EXHAUSTION.Spend.crucialSave.Description",
    value: 1
  },
  {
    id: "perfectTiming",
    label: "EXTENDED_EXHAUSTION.Spend.perfectTiming.Label",
    description: "EXTENDED_EXHAUSTION.Spend.perfectTiming.Description",
    value: 1
  },
  {
    id: "rerollDeathSave",
    label: "EXTENDED_EXHAUSTION.Spend.rerollDeathSave.Label",
    description: "EXTENDED_EXHAUSTION.Spend.rerollDeathSave.Description",
    value: 2,
    reaction: true,
    allowUnconscious: true
  }
];

/** Spend option definitions keyed by ID. */
export const SPEND_OPTIONS_BY_ID = SPEND_OPTIONS.reduce((obj, o) => Object.assign(obj, { [o.id]: o }), {});

/* -------------------------------------------- */

/**
 * Does this actor have any spellcasting progression or spell slots?
 * @param {Actor} actor
 * @returns {boolean}
 */
function hasSpellcasting(actor) {
  const spells = actor.system.spells ?? {};
  if ( Object.values(spells).some(s => (s?.max ?? 0) > 0) ) return true;
  return !!actor.system.attributes?.spellcasting;
}

/* -------------------------------------------- */

/**
 * Does this actor have a class item whose identifier matches the given value?
 * @param {Actor} actor
 * @param {string} identifier
 * @returns {boolean}
 */
function hasClass(actor, identifier) {
  return Object.keys(actor.classes ?? {}).includes(identifier);
}

import { MODULE_ID } from "./constants.mjs";
import { getLevel, getPenalties, isImmune, penaltyFor } from "./exhaustion.mjs";
import { setting } from "./settings.mjs";

/** Marker used to avoid double-wrapping a Roll instance. */
const FLOORED = Symbol("extended-exhaustion.floored");

/** Ability keys in the order dnd5e defines them. */
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

/* -------------------------------------------- */
/*  Derived data                                */
/* -------------------------------------------- */

/**
 * Patch the Actor document so the speed and hit point maximum penalties are applied after the
 * system has finished deriving data. Both need the final values: the homebrew floors speed at one
 * foot rather than zero, and the hit point penalty is a fraction of the maximum.
 */
export function patchDerivedData() {
  const cls = CONFIG.Actor.documentClass;
  if ( cls.prototype[`__${MODULE_ID}Patched`] ) return;
  const original = cls.prototype.prepareDerivedData;
  cls.prototype.prepareDerivedData = function(...args) {
    original.apply(this, args);
    try {
      applyDerivedPenalties(this);
    } catch(err) {
      console.error(`${MODULE_ID} | Failed to apply derived exhaustion penalties`, err);
    }
  };
  cls.prototype[`__${MODULE_ID}Patched`] = true;
}

/* -------------------------------------------- */

/**
 * Apply the speed and hit point maximum penalties to an actor's derived data.
 * @param {Actor} actor
 */
export function applyDerivedPenalties(actor) {
  if ( !getLevel(actor) || isImmune(actor) ) return;
  const penalties = getPenalties(actor);
  applySpeedPenalty(actor, penalties);
  applyHitPointPenalty(actor, penalties);
}

/* -------------------------------------------- */

/**
 * Reduce the actor's movement speeds. A speed the creature does not have stays at zero, and a
 * speed reduced to zero or less by exhaustion becomes one foot instead.
 *
 * dnd5e 6 keeps per-type speeds in `movement.speeds` and derives `movement.speed` (walking),
 * `movement.max` and `movement.slowed` from them, so all four are refreshed here.
 * @param {Actor} actor
 * @param {ExhaustionPenalties} penalties
 */
function applySpeedPenalty(actor, penalties) {
  const movement = actor.system.attributes?.movement;
  const speeds = movement?.speeds;
  if ( !speeds || !penalties.speed ) return;

  const units = movement.units ?? CONFIG.DND5E.defaultUnits.length.imperial;
  const reduction = toUnits(penalties.speed, units);
  const floor = setting("minimumSpeed") ? toUnits(1, units) : 0;
  const types = setting("applySpeedToAllTypes") ? Object.keys(CONFIG.DND5E.movementTypes) : ["walk"];

  for ( const type of types ) {
    const current = speeds[type];
    if ( !Number.isFinite(current) || (current <= 0) ) continue;
    speeds[type] = Math.max(floor, current - reduction);
  }

  movement.speed = speeds.walk ?? movement.speed;
  movement.max = Object.keys(CONFIG.DND5E.movementTypes)
    .reduce((max, type) => Math.max(max, Number.isFinite(speeds[type]) ? speeds[type] : 0), 0);
  const base = actor.system._source?.attributes?.movement?.speeds?.walk;
  const baseWalk = Number(base);
  if ( Number.isFinite(baseWalk) && (baseWalk > 0) ) movement.slowed = speeds.walk <= (baseWalk / 2);
}

/* -------------------------------------------- */

/**
 * Reduce the actor's hit point maximum by the marked fraction, never below one, and bring current
 * hit points down with it. A creature the reduction would take to 0 hit points drops to 1 instead;
 * a creature already at 0 stays there, since exhaustion is not what put it down.
 * @param {Actor} actor
 * @param {ExhaustionPenalties} penalties
 */
function applyHitPointPenalty(actor, penalties) {
  const hp = actor.system.attributes?.hp;
  if ( !hp || !penalties.hpFraction || !Number.isFinite(hp.max) ) return;
  const loss = Math.floor(hp.max * penalties.hpFraction);
  if ( loss <= 0 ) return;

  hp[`${MODULE_ID}-unreducedMax`] = hp.max;
  hp.max = Math.max(1, hp.max - loss);
  hp.effectiveMax = Math.max(hp.max + (hp.tempmax ?? 0), 0);

  const before = hp.value;
  hp.value = Math.min(hp.value, hp.effectiveMax);
  if ( (hp.value <= 0) && (before > 0) ) hp.value = 1;

  hp.damage = Math.max(0, hp.effectiveMax - hp.value);
  hp.pct = Math.clamp(hp.effectiveMax ? (hp.value / hp.effectiveMax) * 100 : 0, 0, 100);
}

/* -------------------------------------------- */

/**
 * Convert a value in feet into the given movement unit, falling back to the raw value.
 * @param {number} value
 * @param {string} units
 * @returns {number}
 */
function toUnits(value, units) {
  const imperial = CONFIG.DND5E.defaultUnits?.length?.imperial ?? "ft";
  if ( units === imperial ) return value;
  try {
    return dnd5e.utils.convertLength(value, imperial, units, { strict: false });
  } catch {
    return value;
  }
}

/* -------------------------------------------- */
/*  Minimum roll result                         */
/* -------------------------------------------- */

/**
 * Register the hooks that enforce "Exhaustion cannot reduce an ability check or saving throw
 * below 1". Both hooks fire after the roll has been configured but before it is evaluated, so the
 * floor can be installed on the roll itself and applied the moment the dice land.
 */
export function registerMinimumResult() {
  Hooks.on("dnd5e.postAbilityCheckRollConfiguration", (rolls, config) => installFloor(rolls, config, "check"));
  Hooks.on("dnd5e.postSavingThrowRollConfiguration", (rolls, config) => installFloor(rolls, config, "save"));
}

/* -------------------------------------------- */

/**
 * Wrap each roll's evaluation so its total cannot be dragged below 1 by exhaustion.
 * @param {Roll[]} rolls
 * @param {object} config          Roll process configuration.
 * @param {"check"|"save"} type
 */
function installFloor(rolls, config, type) {
  if ( !setting("minimumRollResult") ) return;
  const actor = config.subject;
  if ( !actor || !getLevel(actor) || isImmune(actor) ) return;
  for ( const roll of rolls ) {
    if ( roll[FLOORED] ) continue;
    const penalty = detectPenalty(actor, roll, config, type);
    if ( !penalty ) continue;
    roll[FLOORED] = true;
    const original = roll.evaluate;
    roll.evaluate = async function(...args) {
      const result = await original.apply(this, args);
      applyFloor(this, penalty);
      return result;
    };
  }
}

/* -------------------------------------------- */

/**
 * Work out how much of an exhaustion penalty is baked into a pending roll.
 *
 * dnd5e 6 collapses every bonus into a single `ruleBonus` part, so the ability can no longer be
 * inferred from the roll data's keys. It does however record the resolved ability on the roll's
 * own data, which is set from the dialog's selection, so an ability swapped in the roll prompt is
 * still honored. The process config is only a fallback.
 * @param {Actor} actor
 * @param {Roll} roll
 * @param {object} config
 * @param {"check"|"save"} type
 * @returns {number}
 */
function detectPenalty(actor, roll, config, type) {
  const ability = roll.data?.roll?.ability ?? roll.data?.abilityId ?? config.ability;
  if ( !ABILITIES.includes(ability) ) return 0;
  return penaltyFor(actor, type, ability);
}

/* -------------------------------------------- */

/**
 * Nudge an evaluated roll back up to the floor, appending a visible term so the adjustment shows
 * in the roll breakdown.
 * @param {Roll} roll
 * @param {number} penalty  Magnitude of the exhaustion penalty included in the roll.
 */
function applyFloor(roll, penalty) {
  if ( !roll._evaluated ) return;
  const floor = Math.min(1, roll.total + penalty);
  const diff = floor - roll.total;
  if ( diff <= 0 ) return;
  const { NumericTerm, OperatorTerm } = foundry.dice.terms;
  const operator = new OperatorTerm({ operator: "+" });
  const term = new NumericTerm({
    number: diff,
    options: { flavor: game.i18n.localize("EXTENDED_EXHAUSTION.MinimumResultFlavor") }
  });
  operator._evaluated = true;
  term._evaluated = true;
  roll.terms.push(operator, term);
  roll.resetFormula();
  roll._total = floor;
}

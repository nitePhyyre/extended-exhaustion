import { MODULE_ID, TRACKS } from "./constants.mjs";
import { formatPenalty, getLevel, getMarks, isImmune, maxLevel, penaltiesFromMarks } from "./exhaustion.mjs";
import { setting } from "./settings.mjs";
import ExhaustionTracker from "./apps/tracker.mjs";

/**
 * Wire the tracker into actor sheets.
 */
export function registerSheetIntegration() {
  Hooks.on("renderActorSheetV2", onRenderActorSheet);
  Hooks.on("getHeaderControlsActorSheetV2", onGetHeaderControls);
}

/* -------------------------------------------- */

/**
 * Add an "Extended Exhaustion" entry to every actor sheet's header menu.
 * @param {ApplicationV2} app
 * @param {object[]} controls
 */
function onGetHeaderControls(app, controls) {
  const actor = app.document;
  if ( !(actor instanceof Actor) || !("exhaustion" in (actor.system.attributes ?? {})) ) return;
  controls.push({
    icon: "fa-solid fa-bed",
    label: "EXTENDED_EXHAUSTION.Tracker.Title",
    action: `${MODULE_ID}-tracker`,
    onClick: () => ExhaustionTracker.open(actor)
  });
}

/* -------------------------------------------- */

/**
 * Replace the dnd5e exhaustion pips &mdash; which only go up to six &mdash; with a badge showing
 * the extended level, and hang the tooltip of current penalties off it.
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function onRenderActorSheet(app, element) {
  const actor = app.document;
  if ( !(actor instanceof Actor) || !("exhaustion" in (actor.system.attributes ?? {})) ) return;

  const pips = element.querySelectorAll('.pips[data-prop="system.attributes.exhaustion"]');
  if ( !setting("sheetTracker") ) {
    // Still remove the pip strips, which are meaningless at these level counts.
    pips.forEach(el => el.remove());
    element.querySelectorAll(".ee-badge").forEach(el => el.remove());
    return;
  }

  const anchor = pips[0]?.parentElement ?? element.querySelector(".stats .top");
  pips.forEach(el => el.remove());

  // Parts render independently, so a badge from an earlier pass may still be in place.
  element.querySelectorAll(".ee-badge").forEach(el => el.remove());

  if ( anchor ) {
    anchor.prepend(buildBadge(actor));
    return;
  }

  // Replacement sheets such as Tidy5e lay things out their own way and already show the level as
  // a plain number, which copes with 0-30 perfectly well. Rather than inject a competing badge,
  // hang this module's penalty breakdown and tracker shortcut off the display they already have.
  enhanceExternalDisplay(actor, element);
}

/* -------------------------------------------- */

/**
 * Attach the penalty tooltip and a tracker shortcut to a third-party sheet's own exhaustion
 * display. The sheet's own controls inside it are left strictly alone.
 * @param {Actor} actor
 * @param {HTMLElement} element
 */
function enhanceExternalDisplay(actor, element) {
  const box = element.querySelector(".exhaustion");
  if ( !box || box.classList.contains("ee-enhanced") ) return;
  box.classList.add("ee-enhanced");
  box.dataset.tooltipHtml = buildTooltip(actor);
  box.dataset.tooltipDirection ??= "DOWN";
  box.addEventListener("click", event => {
    // Never swallow a click meant for the host sheet's own button.
    if ( event.target.closest("button, a, input") ) return;
    event.preventDefault();
    ExhaustionTracker.open(actor);
  });
}

/* -------------------------------------------- */

/**
 * Build the sheet badge.
 * @param {Actor} actor
 * @returns {HTMLElement}
 */
function buildBadge(actor) {
  const level = getLevel(actor);
  const max = maxLevel();
  const immune = isImmune(actor);

  const badge = document.createElement("button");
  badge.type = "button";
  // Shaped like the sheet's own initiative/speed/proficiency lozenges so it reads as part of the
  // character sheet rather than a module bolted onto it.
  badge.classList.add("ee-badge", "lozenge", "unbutton");
  if ( immune ) badge.classList.add("immune");
  else if ( level > max ) badge.classList.add("dead");
  else if ( level > 0 ) badge.classList.add("exhausted");
  badge.dataset.tooltipDirection = "DOWN";
  badge.dataset.tooltipHtml = buildTooltip(actor);
  badge.ariaLabel = game.i18n.localize("EXTENDED_EXHAUSTION.Tracker.Title");
  badge.innerHTML = `
    <i class="fa-solid fa-bed" inert></i>
    <span class="value">${immune ? "—" : level}</span>
  `;
  badge.addEventListener("click", event => {
    event.preventDefault();
    ExhaustionTracker.open(actor);
  });
  return badge;
}

/* -------------------------------------------- */

/**
 * The HTML tooltip listing an actor's current exhaustion penalties.
 * @param {Actor} actor
 * @returns {string}
 */
function buildTooltip(actor) {
  const level = getLevel(actor);
  if ( isImmune(actor) ) {
    return `<strong>${game.i18n.localize("EXTENDED_EXHAUSTION.Tooltip.Immune")}</strong>`;
  }
  const header = `<strong>${game.i18n.format("EXTENDED_EXHAUSTION.Tooltip.Level", {
    level, max: maxLevel()
  })}</strong>`;
  if ( !level ) return header;

  const marks = getMarks(actor);
  const penalties = penaltiesFromMarks(marks);
  const rows = TRACKS.filter(t => marks[t.id] > 0).map(track => {
    const label = foundry.utils.escapeHTML(game.i18n.localize(track.label));
    return `<li>${label}: <strong>${formatPenalty(track.id, penalties)}</strong></li>`;
  }).join("");
  return `${header}<ul class="ee-tooltip-list">${rows}</ul>`;
}

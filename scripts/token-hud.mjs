import { getLevel, isImmune, maxLevel } from "./exhaustion.mjs";
import ExhaustionTracker from "./apps/tracker.mjs";

/** Marker class for the button this module adds, used to find and replace it on re-render. */
const BUTTON_CLASS = "ee-hud-control";

/**
 * Add an Extended Exhaustion button to the token HUD, the panel that appears when a token is
 * right-clicked. dnd5e substitutes its own TokenHUD subclass, but ApplicationV2 fires render hooks
 * for every class in the inheritance chain, so hooking the core class covers both.
 */
export function registerTokenHUD() {
  Hooks.on("renderTokenHUD", onRenderTokenHUD);
}

/* -------------------------------------------- */

/**
 * @param {ApplicationV2} app
 * @param {HTMLElement} element
 */
function onRenderTokenHUD(app, element) {
  const actor = app.document?.actor;
  if ( !actor || !("exhaustion" in (actor.system?.attributes ?? {})) ) return;
  if ( !actor.isOwner ) return;

  const column = element.querySelector(".col.left");
  if ( !column ) return;

  // The HUD can re-render in place; never stack duplicates.
  element.querySelectorAll(`.${BUTTON_CLASS}`).forEach(el => el.remove());
  column.append(buildButton(actor));
}

/* -------------------------------------------- */

/**
 * Build the HUD control.
 * @param {Actor} actor
 * @returns {HTMLButtonElement}
 */
function buildButton(actor) {
  const level = getLevel(actor);
  const immune = isImmune(actor);

  const button = document.createElement("button");
  button.type = "button";
  // No data-action: ApplicationV2 dispatches those through the HUD's own action registry, which
  // has no entry for this module. A direct listener keeps it out of that lookup entirely.
  button.classList.add("control-icon", BUTTON_CLASS);
  if ( !immune && (level > 0) ) button.classList.add("active");
  button.dataset.tooltipDirection = "LEFT";
  button.dataset.tooltipHtml = buildTooltip(actor, level, immune);
  button.ariaLabel = game.i18n.localize("EXTENDED_EXHAUSTION.Tracker.Title");
  button.innerHTML = `<i class="fa-solid fa-bed" inert></i>`;

  if ( !immune && (level > 0) ) {
    const count = document.createElement("span");
    count.classList.add("ee-hud-level");
    count.textContent = level;
    count.setAttribute("inert", "");
    button.append(count);
  }

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    ExhaustionTracker.open(actor);
  });

  return button;
}

/* -------------------------------------------- */

/**
 * Tooltip text for the HUD control.
 * @param {Actor} actor
 * @param {number} level
 * @param {boolean} immune
 * @returns {string}
 */
function buildTooltip(actor, level, immune) {
  const title = foundry.utils.escapeHTML(game.i18n.localize("EXTENDED_EXHAUSTION.Tracker.Title"));
  if ( immune ) {
    return `<strong>${title}</strong><br>${foundry.utils.escapeHTML(
      game.i18n.localize("EXTENDED_EXHAUSTION.Tooltip.Immune"))}`;
  }
  const line = foundry.utils.escapeHTML(game.i18n.format("EXTENDED_EXHAUSTION.Tooltip.Level", {
    level, max: maxLevel()
  }));
  return `<strong>${title}</strong><br>${line}`;
}

/* -------------------------------------------- */

/**
 * Re-render the token HUD if it is currently showing the given actor, so the button's level badge
 * keeps up with changes made elsewhere.
 * @param {Actor} actor
 */
export function refreshTokenHUD(actor) {
  const hud = canvas?.hud?.token;
  if ( !hud?.rendered ) return;
  if ( hud.document?.actor?.id !== actor?.id ) return;
  hud.render();
}


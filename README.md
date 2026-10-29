# Extended Exhaustion

A Foundry VTT module implementing the **Extended Exhaustion** homebrew for the D&D 5e system:
exhaustion measured from 0 to 30 across six independent penalty tracks, escalating long-rest
recovery saves, and the option to voluntarily spend exhaustion to fuel desperate actions.

The rules implemented here come from the `Extended Exhaustion.pdf` document in this repository.

- **Foundry VTT:** v14 (verified 14.369)
- **System:** `dnd5e` 6.0.0+ (verified 6.0.6)

## Installation

Copy this folder into your Foundry data directory as
`Data/modules/extended-exhaustion`, or install from the manifest URL in `module.json`. Enable it
in **Manage Modules**.

## The table

Exhaustion runs from 0 to 30. A creature dies when it reaches 31. Each level is a *mark* in one of
six columns, and each mark is cumulative:

| Column | Penalty per mark | Applies to |
| --- | --- | --- |
| Mental Skills | −1 | Intelligence-, Wisdom- and Charisma-based ability checks |
| Physical Skills | −1 | Strength-, Dexterity- and Constitution-based ability checks |
| Mental Saves | −1 | Intelligence, Wisdom and Charisma saving throws |
| Physical Saves | −1 | Strength, Dexterity and Constitution saving throws |
| Speed | −5 ft. | Every movement speed the creature has |
| Hit Point Maximum | −1/6 | Hit point maximum |

The table is six columns wide, so the maximum level is always a multiple of six and the table is a
whole number of rows deep. At the default maximum of 30 it is five rows deep, meaning each column
holds at most five marks.

The speed and hit point penalties are **derived** from the maximum rather than configured. A sixth
mark in a column — one row past a full table, which is the level a creature dies at — is the point
at which that statistic would reach zero. So each mark costs one sixth of the hit point maximum and
one sixth of a 30 ft. speed, giving the document's −1/6 and −5 ft. Raise the maximum and the table
gets deeper, so each individual mark costs proportionally less:

| Maximum | Rows | Per mark |
| --- | --- | --- |
| 6 | 1 | −1/2 HP, −15 ft. |
| 12 | 2 | −1/3 HP, −10 ft. |
| 30 (default) | 5 | −1/6 HP, −5 ft. |
| 60 | 10 | −1/11 HP, −3 ft. |

A full table therefore always leaves exactly one row's worth of hit points and speed, whatever the
maximum.

### Assignment methods

Both methods from the document are supported, chosen in module settings:

- **Method A — Sequential Progression.** The table fills left to right, completing each row before
  moving to the next. Levels 1–6 introduce each penalty type, 7–12 increase each by 1, 13–18 by 2,
  and so on.
- **Method B — Player Choice.** Levels are distributed across the six columns however the player
  likes. New levels auto-fill sequentially so the distribution is always valid, and the owner can
  redistribute them freely in the tracker. No column can be filled deeper than the table has rows,
  so the total can never exceed the maximum.

### Special rules

All three minimum-value rules are enforced:

- Exhaustion cannot reduce an ability check or saving throw below **1**. When it would, a visible
  "Exhaustion minimum" term is appended to the roll bringing the total back to 1. Rolls that were
  already below 1 before exhaustion are left alone — exhaustion is not what put them there.
- A speed reduced to 0 feet or less by exhaustion becomes **1 foot** instead. A speed the creature
  does not have (a 0 fly speed, say) stays at 0, and a speed zeroed by another condition such as
  paralysis is left at 0.
- A hit point maximum reduction brings current hit points down with it, to a minimum of **1**. A
  creature already at 0 hit points stays at 0.

## Gaining and removing exhaustion

**Automatic:** dropping to 0 hit points applies one level (configurable: never, player characters
only, or all creatures). Under Method B the level is not placed for you &mdash; the actor's own
player is asked which column it is marked against, with each option showing what that column would
cost. Columns already filled to the table's depth are shown but disabled. Dismissing the prompt
places the level automatically and says so, so the rule is never silently skipped.

**Manual:** travel beyond 8 hours, going without food or water, other effects, and harsh
conditions are GM calls. Use the tracker's **+** button, the token HUD's exhaustion icon, or the
API.

**Long rest recovery** runs automatically when a long rest completes: one level is removed, then
Constitution saving throws are rolled against a DC of **30 minus the creature's current exhaustion
level**, removing one further level per success until a save fails or exhaustion reaches 0. The
whole sequence is posted as a single chat card. Because the DC rises as the level falls, deep
exhaustion takes many rests to shake off.

Each save uses the actor's real Constitution save, so the Physical Saves penalty from exhaustion
applies to the recovery rolls — and the minimum-of-1 rule applies to them too.

Hit points are topped back up after recovery, since the rest itself restored them to the lower,
still-exhausted maximum.

## Spending exhaustion

All twelve options from the document are available from the tracker's **Spend Exhaustion** button:
1st-Level Spell Slot, Upcast, Extra Attack, Rage, Reckless Attack Enhancement, Brutal Critical, Ki
Points, Negate Critical Hit, Extra Reaction, Crucial Save, Perfect Timing and Reroll Death Save.

Under Method B you choose where the cost lands, the same as for an involuntary level. A cost of
several levels &mdash; Rage is two, an upcast is one per spell level &mdash; is placed one at a
time in a single prompt that counts down, so a four-level upcast can be spread across four
different columns or stacked into one. **Place the rest automatically** fills in whatever is left.

Spending applies the cost, posts a chat card with the rules text so the table knows what happened,
and enforces the document's restrictions:

- Unconscious creatures can only use Reroll Death Save.
- A cost that would push exhaustion past the maximum is refused rather than silently killing the
  character.
- Upcast costs one level per spell level, doubled when the spell is cast beyond the highest slot
  level normally available.

Nine of the twelve options are mechanically realized rather than merely announced:

| Option | What actually happens |
| --- | --- |
| 1st-Level Spell Slot | A real 1st-level slot is added to the spellbook |
| Upcast | A real slot of the chosen level is added |
| Rage / Ki Points | Uses are given back on the feature ("Kaioken!" returns 3 ki instead of 2) |
| Reckless Attack | Advantage on attack rolls, registered as a dnd5e rule |
| Brutal Critical | +1 melee critical damage die |
| Crucial Save | +5 added to the saving throw already rolled |
| Perfect Timing | Moved to the top of initiative, and it becomes their turn |
| Reroll Death Save | The failure is taken back and a fresh save rolled |

Resources are written directly, so they appear on the sheet and are spent by playing normally.
Advantage and the critical die are registered through dnd5e's own rules engine rather than by
intercepting rolls, which is why they survive MidiQOL.

Slots and rule effects granted **during combat expire at the end of that turn**, so nothing can be
banked; a slot that was actually cast is not clawed back. Outside combat there is no turn to expire
on, so grants simply stand. The death save reroll rolls first and only takes the failure back once
a replacement exists, so cancelling the roll changes nothing.

**Extra Attack**, **Extra Reaction** and **Negate Critical Hit** stay announce-only. The first is
pure table permission with nothing to write; the other two depend on reacting to another creature's
roll, which core dnd5e does not expose.

Options irrelevant to a character (Rage for a wizard, Ki Points for a paladin) are hidden behind a
**Show all options** toggle rather than removed, since multiclassing and homebrew make class
inference unreliable.

## Interface

- **Actor sheets** get a badge in place of the dnd5e exhaustion pips, which only run to six. It
  shows the current level and lists the active penalties on hover; clicking it opens the tracker.
- **The tracker** shows the level, the six columns with their current penalties, the DC of the next
  long rest recovery save, and buttons to spend exhaustion, run recovery, and (for GMs) clear. It
  will not let you push a column past the number of rows, or the total past the maximum. Edits
  apply the moment you make them &mdash; there is no confirmation step &mdash; and a burst of
  changes is summarized as a single chat card once you stop adjusting.
- **Every actor sheet's header menu** has an **Extended Exhaustion** entry, so NPCs and other
  sheet layouts can reach the tracker too.
- **Right-clicking a token** adds a bed button to the HUD's left column, showing the current level
  on a badge and opening the tracker when clicked. It appears only for tokens whose actor you own.
- **The token HUD** exhaustion status icon still cycles levels the way the system does.

## Settings

| Setting | Scope | Default | Notes |
| --- | --- | --- | --- |
| Penalty Assignment | World | Method A | Sequential progression or player choice |
| Maximum Exhaustion Level | World | 30 | Multiples of six, 6–60. Death occurs one level past this. Speed and hit point penalties scale from it. Requires a reload |
| Recovery Save Base DC | World | 30 | DC is this minus the current level |
| Automate Long Rest Recovery | World | on | Replaces the system's own one-level removal |
| Exhaustion At 0 Hit Points | World | PCs only | Never / player characters / all creatures |
| Minimum Roll Result Of 1 | World | on | |
| Minimum Speed Of 1 Foot | World | on | |
| Reduce All Movement Types | World | on | Off reduces only walking speed |
| Allow Spending Exhaustion | World | on | |
| Show Badge On Actor Sheets | Client | on | |

## API

Available as `game.modules.get("extended-exhaustion").api` and as `dnd5e.extendedExhaustion`.

```js
const ee = dnd5e.extendedExhaustion;
const actor = game.actors.getName("Vax");

ee.getLevel(actor);                             // 12
ee.getMarks(actor);                             // { mentalSkills: 2, physicalSkills: 2, ... }
ee.getPenalties(actor);                         // { ..., speed: 10, hpFraction: 0.333 }

await ee.addLevels(actor, 1, { reason: "travel" });   // posts a chat card
await ee.setLevel(actor, 0);
await ee.setMarks(actor, { speed: 4, hpMax: 2 });     // Method B only
await ee.recoverOnLongRest(actor);

ee.track(actor);                                // open the tracker (defaults to the selected token)
ee.spendDialog(actor);                          // open the spending dialog
await ee.spend(actor, "upcast", { spellLevel: 5, beyondMax: true });  // costs 10
```

`reason` accepts any key of `ee.GAIN_REASONS`: `zeroHP`, `travel`, `deprivation`, `effect`,
`harsh`, `spent`, `manual`.

A handy GM macro:

```js
for ( const token of canvas.tokens.controlled ) {
  await dnd5e.extendedExhaustion.addLevels(token.actor, 1, { reason: "travel" });
}
```

## How it works

The marks flag (`flags.extended-exhaustion.marks`) is the module's source of truth, and
`system.attributes.exhaustion` is kept in step with it so the condition icon, death at the maximum
level, and other modules all keep working. If something else changes the system's level — the token
HUD, a macro, another module — the marks are redistributed to match on the next update.

Check and save penalties are applied through a module-owned Active Effect that adds to
`system.abilities.<ability>.bonuses.check` and `.save`, so they appear in sheet totals and in roll
breakdowns. Speed and hit point maximum are applied after the system finishes deriving data
instead, because the homebrew's minimum-value rules need the final numbers — a fraction of the
computed maximum, and a floor of one foot rather than zero.

The hit point reduction is applied to derived data rather than written to the actor, so removing
exhaustion restores the maximum (and any current hit points that were sitting above it) rather than
losing them permanently.

Check and save penalties go through dnd5e 6's roll modification fields
(`system.abilities.<ability>.check.roll.bonus` and `.save.roll.bonus`) as Foundry v14 string-typed
`add` changes stored on `system.changes`. The value is a signed string because the target is a
formula field, where `add` concatenates — an existing `1d4` becomes `1d4-3`, which still evaluates
correctly. (`subtract` would be wrong here: on a string it removes matching text rather than
subtracting.)

The module also retunes the system's own exhaustion handling so nothing is applied twice. dnd5e 6
drives exhaustion from a typed condition effect with several automations layered on top, and all of
them are replaced here: the modern rules' flat per-level reduction to d20 tests and speed, the
legacy graded condition effects (half speed at 2, disadvantage at 1 and 3, half health at 4, no
movement at 5), death at the top level, and the level removed automatically on a long rest. The
level ceiling is then raised to 30 and death is put back at 31 via the condition's `conditions`
map. This mirrors the system's own `disableExhaustionAutomation()`, which a module cannot reach;
turning on dnd5e's **Disable Exhaustion Automation** setting does the same work earlier and is
equally fine, since every step is idempotent.

Exhaustion artwork, which the system only ships for levels 1–6, is clamped so higher levels reuse
the sixth icon.

Long rest recovery honours dnd5e 6's rule that a creature which is starving or parched recovers no
exhaustion at all; the chat card says so rather than silently skipping.

## Module compatibility

Tested alongside a 98-module live stack. Verified working with **DAE**, **MidiQOL**, **Automated
Conditions 5e**, **Convenient Effects**, **libWrapper** and **StatusCounter**: the system retuning
survives, penalties apply, the minimum-of-1 roll floor still engages through MidiQOL's roll
pipeline, and only one exhaustion condition effect is ever created.

**Tidy5e Sheet** lays the sheet out its own way and already shows the exhaustion level as a plain
number, which handles 0&ndash;30 correctly. Rather than inject a competing badge, this module
adopts that display: it attaches the penalty breakdown tooltip to it and makes the number open the
tracker, leaving Tidy's own controls alone. The header-menu entry and the token HUD button work on
any sheet regardless.

**A note on a deprecation warning.** With DAE enabled, changing exhaustion logs
`bonuses.abilities.check has moved to "rolls.ability.check.bonus"`. The stack trace passes through
this module, but the deprecated read is inside DAE itself &mdash; this module writes only the
current dnd5e 6 path (`abilities.<ability>.check.roll.bonus`) and never touches the old one. It is
harmless today and is DAE's to fix before dnd5e 7.0 removes the shim.

## Known limits

- Creatures with exhaustion immunity (`traits.ci` containing `exhaustion`) take no penalties and
  cannot gain or spend exhaustion.
- Travel and food-and-water exhaustion are not tracked automatically; there is no in-system notion
  of a travel day.
- Extra Attack, Extra Reaction and Negate Critical Hit announce and charge, but do not drive the
  mechanic itself; the other nine options are fully automated.

# DDB-Importer parser fixes — design spec

- **Date:** 2026-06-04
- **Fork / branch:** `vittorio-prodomo/ddb-importer` @ `fix/import-quirks` (off `v7.1.x`, the Foundry v13 line)
- **Target:** Foundry v13.351, dnd5e 5.3.x, DDB-Importer 7.1.20 (built from source, symlinked into `dev-sandbox-v13`)
- **Policy:** fixes live in our private fork; upstream PRs are optional & case-by-case (see `feedback_ddb_importer_fork_strategy`).

## Goal

Fix, at the parser source, four catalogued D&D Beyond → Foundry import quirks so corrected items are produced on every import (no per-actor post-processing, no re-application after re-import). Quirks come from the `ddb-importer-quirks` catalogue. Quirk #1 ("empty activities") is a confirmed non-bug and is out of scope.

## Approach

Fix at the idiomatic extension points, not core parsing:
- **Per-spell / per-feature behavior → enrichers.** `DDBSpellEnricher` / `DDBClassFeatureEnricher` auto-dispatch by pascal-cased name to override classes under `src/parser/enrichers/`. New behavior = a small new override class, auto-registered by export.
- **Spell-list assembly logic → targeted edits** in `CharacterSpellFactory` / `DDBSpell`.

This keeps each fix isolated and testable, mirrors how upstream models every special case, and keeps three of the four clean enough to offer upstream later.

---

## Fix #5 — Magic Missile (single dart → correct darts + scaling)

**Root cause.** There is no `src/parser/enrichers/spell/MagicMissile.ts`, so Magic Missile falls through to generic parsing in `src/parser/spells/DDBSpell.ts`. `_getTargetValue()` (≈L503) returns `null` (its regex doesn't pick "three darts"), so `DDBSpell._generateTarget()` leaves `affects.count = ""`; the built activity then inherits the dnd5e **default `count: "1"`**. DDB's upcast data for MM carries a target-count increase (not a damage die), so generic scaling yields an empty `scaling.formula` → no upcast.

**Fix.** Add a `MagicMissile` spell enricher overriding the activity to set the dart count formula + force damage, and model the spell as **auto-hit** (Magic Missile has no attack roll in RAW). Auto-registers via `_module.ts` export (pascalCase `"Magic Missile"` → `MagicMissile`); no `ENRICHERS`-map entry needed.

Proposed `src/parser/enrichers/spell/MagicMissile.ts`:

```ts
import DDBEnricherData from "../data/DDBEnricherData";

export default class MagicMissile extends DDBEnricherData {
  // Magic Missile auto-hits → model as a damage activity (no attack roll).
  // VERIFY the exact activity type against the official dnd5e.spells24 build
  // `phbsplMagicMissi` during testing (damage vs no-roll attack).
  get type() {
    return DDBEnricherData.ACTIVITY_TYPES.DAMAGE;
  }

  get activity(): IDDBActivityData {
    return {
      targetType: "creature",
      targetCount: "2 + @item.level", // 3 darts at L1, +1 per upcast level
      targetChoice: true,             // distribute darts among targets
      data: {
        damage: {
          parts: [
            DDBEnricherData.basicDamagePart({
              number: 1, denomination: 4, type: "force", bonus: "1",
              scalingMode: "none", // dart COUNT scales (targetCount), not per-dart damage
            }),
          ],
        },
      },
    };
  }
}
```

Register in `src/parser/enrichers/spell/_module.ts` (alphabetical, between `MagicWeapon` and `MajorImage`):
```ts
export { default as MagicMissile } from "./MagicMissile";
```

**Expected result (activity.system):** `target.affects = { count: "2 + @item.level", type: "creature", choice: true }`, one `1d4 + 1` force damage part, no per-dart scaling, no attack roll.

**Edition note:** no 2014/2024 mechanical difference for MM; single return covers both. If a future DDB 2024 variant differs, branch on `this.is2014`.

**PR-worthy:** yes — clean addition of a missing enricher.

---

## Fix #3 — Ranger free Hunter's Mark (junk damage activity → working free cast)

**Root cause.** The 2024 Ranger "Favored Enemy" feature (grants Hunter's Mark always-prepared, free casts/long-rest) has **no enricher**. Generic feature parsing (`DDBFeatureMixin._getActivitiesType()`, ≈L1116) sees the DDB action's `dice` (the `@scale.ranger.favored-enemy` scale value) + a force damage type and emits a **junk `damage` activity** that never casts the spell. The free-cast **uses pool** lands correctly on the feature.

Upstream **already ships the linking machinery** — `CONSUMPTION_SPELL_LINKS["Favored Enemy"]` (with `forceInnate: true`) in `src/config/dictionary/actor/consumptionLinking.ts`, and `"Hunter's Mark"` in `CharacterSpellFactory.CLASS_GRANTED_SPELLS_2024`. The `autoLinkConsumption` post-pass is meant to point Hunter's Mark's consumption at the feature's uses pool and set it innate/always-prepared. The only thing missing is **suppressing the junk activity**.

**Fix.** Add a `FavoredEnemy` ranger-feature enricher that emits **no primary activity** and strips the leaked damage, leaving `system.uses` intact so the existing post-pass wires everything up.

Proposed `src/parser/enrichers/class/ranger/FavoredEnemy.ts`:
```ts
import DDBEnricherData from "../../data/DDBEnricherData";

export default class FavoredEnemy extends DDBEnricherData {
  get type() { return null; }            // suppress the auto-built damage activity
  get activity(): IDDBActivityData { return null; }
  get override(): IDDBOverrideData {
    if (this.is2014) return null;        // 2014 Favored Enemy = languages/proficiencies; no junk activity
    return { removeDamage: true };       // strip leaked system.damage; keep system.uses
  }
}
```
Register in `src/parser/enrichers/class/ranger/_module.ts`:
```ts
export { default as FavoredEnemy } from "./FavoredEnemy";
```
(Verify dispatch: `DDBClassFeatureEnricher` resolves ranger features via the class loader; confirm `"Favored Enemy"` → `FavoredEnemy` needs only the export, or add a `NAME_HINTS` entry if the DDB name has punctuation/variants.)

**Expected before/after.** Before: feature has a `damage` activity (`@scale.ranger.favored-enemy` force) + uses pool. After: feature has **no activities**, damage zeroed, uses pool intact; Hunter's Mark spell becomes `method: "innate"`, `prepared: "always"`, consumption → the feature's uses pool (1/cast), falling back to slots when exhausted.

**Edition note:** `is2014` guard makes the enricher a no-op for 2014 Favored Enemy (which legitimately has no free-cast).

**PR-worthy:** strongly — it completes upstream's own half-built feature. **Caveat to verify on test:** confirm the `autoLinkConsumption` post-pass actually fires and links HM to the feature uses once the junk activity is gone.

---

## Fix #4 — Longstrider redundant entry (cross-bucket dedup)

**Root cause.** A spell granted by **both** lineage and the class list produces three items in `CharacterSpellFactory`:
1. **innate** entry (`_granted.race`) — correct.
2. **`Gr`-prefixed always-prepared slot copy** (`_generated.race`, from `handleGrantedSpells`) — the canonical slot version.
3. **redundant unprepared slot entry** (`_generated.class`, from `generateClassSpells`) — the duplicate.

The dedup in `_processClassSpell` only checks **within `_generated.class`**, so it never sees item 2 (in `_generated.race`).

**Fix.** Add a **cross-bucket** check in `_processClassSpell`, just before the existing intra-class dedup/push: if **any** `_generated` bucket already holds the same spell as an always-prepared slot copy, skip adding the class entry.

Match key: `flags.ddbimporter.originalName` (fallback `name`) **AND** legacy match (`is2014`) **AND** `system.method === "spell"` **AND** `system.prepared === CONFIG.DND5E.spellPreparationStates.always.value`.

```ts
const parsedOriginalName = parsedSpell.flags.ddbimporter.originalName ?? parsedSpell.name;
const crossBucketDuplicate = Object.values(this._generated).some((bucket) =>
  bucket.some((existing) =>
    (existing.flags.ddbimporter.originalName ?? existing.name) === parsedOriginalName
    && (existing.flags.ddbimporter.is2014 ?? true) === (parsedSpell.flags.ddbimporter.is2014 ?? true)
    && existing.system.method === "spell"
    && existing.system.prepared === CONFIG.DND5E.spellPreparationStates.always.value));
if (crossBucketDuplicate) {
  logger.debug(`Skipping redundant class spell ${parsedOriginalName}: always-prepared slot copy already exists.`);
} else {
  /* existing intra-class dedup + push, unchanged */
}
```

**Edge cases (safe):** legitimate double-grants are already guarded in `handleGrantedSpells` (`dups` check); Cleric domain spells hit the existing always-prepared overwrite branch (different path); Warlock pact copies carry `method: "pact"` not `"spell"`, so they won't match.

**PR-worthy:** plausibly — a real dedup bug; the key is conservative.

---

## Fix #2 — free-spell method consistency (feat/background `atwill` → `innate`)

**Decision:** normalize **feat + background** granted free-cast spells to `innate` (matches race grants). This is an **intentional, undocumented divergence** from upstream: the `atwill` choice has only a terse code comment (`// this was changed to "atwill"`, maintainer, 2024-08-19, during the activities-model migration) — no CHANGELOG entry, no issue/PR. The same function already sets race grants to `innate`, so feat→atwill reads as an internal inconsistency. Purely cosmetic (changes spellbook section only; both keep `itemUses:1`/no-slot). → **keep private, do not PR.**

**Root cause.** `DDBSpell._generateSpellPreparationMode()`: race path sets `innate` (≈L390); the generic `else` block sets `atwill` for `!usesSpellSlot && !isCantrip` free-casts (≈L418), and again for `feat`/`classFeature`/`subclassFeature` always-prepared (≈L426).

**Fix.** At both sites, choose `innate` for `["feat", "background"]` lookups; leave `classFeature`/`subclassFeature` as `atwill` (Warlock invocations rely on it).
```ts
// site 1 (~L418):
const method = ["feat", "background"].includes(this.lookup) ? "innate" : "atwill";
this.data.system.method = method;
this.data.system.prepared = CONFIG.DND5E.spellPreparationStates.always.value;

// site 2 (~L426), inside the feat/classFeature/subclassFeature block:
const method = this.lookup === "feat" ? "innate" : "atwill";
```

**Edge cases (safe):** Warlock invocations are `classFeature`/`subclassFeature` → untouched (stay `atwill`). Monk free-casts route through `_generateClassPreparationMode` (never reach this block). Magic Initiate (`lookup: "feat"`) → `innate` (correct: 1/LR free cast = limited use).

**PR-worthy:** no — deliberate divergence from an (undocumented) upstream choice.

---

## Files changed

| File | Change |
|---|---|
| `src/parser/enrichers/spell/MagicMissile.ts` | **new** — Fix #5 enricher |
| `src/parser/enrichers/spell/_module.ts` | export `MagicMissile` |
| `src/parser/enrichers/class/ranger/FavoredEnemy.ts` | **new** — Fix #3 enricher |
| `src/parser/enrichers/class/ranger/_module.ts` | export `FavoredEnemy` |
| `src/parser/enrichers/DDBClassFeatureEnricher.ts` | (only if a name hint is needed for dispatch) |
| `src/parser/spells/CharacterSpellFactory.ts` | Fix #4 — cross-bucket dedup in `_processClassSpell` |
| `src/parser/spells/DDBSpell.ts` | Fix #2 — method normalization in `_generateSpellPreparationMode` |

Suggested commit granularity: one clean commit per fix (so PR-worthy ones — #5, #3, #4 — can be cherry-picked onto fresh `upstream/v7.1.x`-based branches independently; #2 stays private).

## Build & verification plan

Build is offline (`nvm use 25.9.0; npm run build` → `dist/main.mjs`; symlink already deployed). Functional verification is **gated on being back online** (Foundry v13 running + SSH tunnel + MCP bridge):
1. Build the fork.
2. Re-import the relevant PCs into `dev-sandbox-v13` (wizards w/ Magic Missile; Warpey the Wood-Elf Ranger for #3 + #4 Longstrider; a Magic-Initiate feat-holder for #2).
3. Inspect each via `get-character-entity`:
   - #5: Magic Missile activity `affects.count == "2 + @item.level"`, 1d4+1 force, no attack roll, upcast adds darts.
   - #3: Favored Enemy feature has **no** damage activity; Hunter's Mark is `innate`/`always`, consumption → feature uses; casting drains the pool then falls back to slots.
   - #4: exactly two Longstrider entries (innate + always-prepared slot); no redundant unprepared copy.
   - #2: feat/background free-casts report `method: "innate"`.
4. **Visual spot-check** the `innate` rendering for a PC feat spell (formality — the quirk catalogue already confirms both render fine).

## Risks / open items

- **#5 activity type:** confirm "auto-hit" is modeled as a `damage` activity (vs a no-roll attack) by checking the official `dnd5e.spells24` `phbsplMagicMissi` build during test; adjust `type` if needed.
- **#3 post-pass:** confirm `autoLinkConsumption` links HM to the feature's uses once the junk activity is suppressed (the wiring exists upstream but is currently untested with the fix).
- **#3 dispatch:** confirm `"Favored Enemy"` resolves to the new enricher via the class loader (export-only) or whether a `NAME_HINTS` entry is required.
- **Re-import dependency:** all four only take effect on (re)import; existing imported actors must be re-imported after the build.

## Out of scope

- Quirk #1 ("empty `system.activities`") — confirmed non-bug (an `ActivityCollection` display artifact).

# DDB-Importer Parser Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four D&D Beyond → Foundry import quirks at the parser source in our fork, so corrected items are produced on every import.

**Architecture:** Two fixes add per-name override classes to DDB-Importer's *enricher* system (auto-dispatched by pascal-cased name); two are surgical edits to the spell-list/preparation logic in `CharacterSpellFactory` / `DDBSpell`. Each fix is one focused commit so the three PR-worthy ones can be cherry-picked upstream independently.

**Tech Stack:** TypeScript, webpack/esbuild build, FoundryVTT v13 + dnd5e 5.3.x. Source in `src/parser/`; build emits `dist/main.mjs`.

**Spec:** `docs/superpowers/specs/2026-06-04-ddb-importer-parser-fixes-design.md` (read it for full root-cause rationale).

---

## Conventions (read once)

- **Repo / branch:** `~/dev/foundry-modules/modules/ddb-importer`, branch `fix/import-quirks` (off `v7.1.x`).
- **Node for build/typecheck (every shell):** `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0` (the `.nvmrc` pin). Each Bash call is a fresh shell — source it each time.
- **Offline verification gate per task:**
  - `npm run typecheck`  → Expected: no errors (`tsc --noEmit`).
  - `npx eslint <changed-file>`  → Expected: no errors.
  - `npm run build`  → Expected: `webpack ... compiled` with only the known 3 bundle-size warnings; `dist/main.mjs` regenerated.
- **No unit tests:** the repo has no test harness (`test` script is a stub) and these fixes produce Foundry-runtime data. Functional verification is the in-Foundry acceptance check in Task 5, deferred until Foundry/the MCP bridge are online.
- **The symlink** (`foundrydata-v13/Data/modules/ddb-importer` → repo root) is already live; a rebuild + Foundry reload is all that's needed to test later.
- Run all `git`/`npm` from the repo root (`cd ~/dev/foundry-modules/modules/ddb-importer`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/parser/enrichers/spell/MagicMissile.ts` | Magic Missile activity override (dart count + force damage) | **create** |
| `src/parser/enrichers/spell/_module.ts` | spell-enricher barrel | add 1 export |
| `src/parser/enrichers/class/ranger/FavoredEnemy.ts` | suppress junk activity on the Ranger free-HM feature | **create** |
| `src/parser/enrichers/class/ranger/_module.ts` | ranger class-enricher barrel | add 1 export |
| `src/parser/spells/CharacterSpellFactory.ts` | cross-bucket spell dedup | edit `_processClassSpell` (~L289) |
| `src/parser/spells/DDBSpell.ts` | free-cast preparation method | edit `_generateSpellPreparationMode` (L418, L426) |

---

## Task 1: Magic Missile enricher (Fix #5)

**Files:**
- Create: `src/parser/enrichers/spell/MagicMissile.ts`
- Modify: `src/parser/enrichers/spell/_module.ts` (after line 137, `MagicWeapon`)

- [ ] **Step 1: Create the enricher**

Create `src/parser/enrichers/spell/MagicMissile.ts`:

```ts
import DDBEnricherData from "../data/DDBEnricherData";

export default class MagicMissile extends DDBEnricherData {

  // Magic Missile auto-hits (no attack roll) → model as a damage activity.
  // The dart COUNT scales with slot level via target.affects.count; the per-dart
  // damage is a flat 1d4+1 force (no damage scaling).
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
              number: 1,
              denomination: 4,
              type: "force",
              bonus: "1",
              scalingMode: "none",
            }),
          ],
        },
      },
    };
  }
}
```

- [ ] **Step 2: Register it in the barrel** (alphabetical, between `MagicWeapon` and `MajorImage`)

In `src/parser/enrichers/spell/_module.ts`, add after the `MagicWeapon` line:

```ts
export { default as MagicMissile } from "./MagicMissile";
```

(No `ENRICHERS`-map entry needed — `DDBSpellEnricher._defaultNameLoader()` resolves `pascalCase("Magic Missile") = "MagicMissile"` automatically.)

- [ ] **Step 3: Typecheck**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run typecheck`
Expected: no errors. *If it flags missing `basicDamagePart` params, add `scalingNumber: null, scalingFormula: ""`.* *If `targetChoice`/`targetType` are not on `IDDBActivityData`, check `ChromaticOrb.ts`/`IceKnife.ts` for the exact accepted keys and match them.*

- [ ] **Step 4: Lint**

Run: `npx eslint src/parser/enrichers/spell/MagicMissile.ts`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run build`
Expected: `webpack ... compiled with 3 warnings` (the bundle-size warnings); `dist/main.mjs` regenerated.

- [ ] **Step 6: Commit**

```bash
git add src/parser/enrichers/spell/MagicMissile.ts src/parser/enrichers/spell/_module.ts
git commit -m "Add Magic Missile enricher: correct dart count and upcast scaling

Magic Missile fell through to generic parsing and inherited the dnd5e
attack-activity default count of 1 with no scaling. Add an enricher that
auto-hits (damage activity), sets target.affects.count = '2 + @item.level'
(3 darts at L1, +1/upcast level), and a flat 1d4+1 force damage part."
```

---

## Task 2: Ranger Favored Enemy enricher (Fix #3)

Suppresses the junk `damage` activity DDB-Importer auto-builds on the 2024 Ranger "Favored Enemy" feature, leaving the free-cast uses pool intact so the existing `CONSUMPTION_SPELL_LINKS["Favored Enemy"]` post-pass wires Hunter's Mark's free casts to it.

**Files:**
- Create: `src/parser/enrichers/class/ranger/FavoredEnemy.ts`
- Modify: `src/parser/enrichers/class/ranger/_module.ts` (between `ExceptionalTraining` and `FoeSlayer`)

- [ ] **Step 1: Create the enricher**

Create `src/parser/enrichers/class/ranger/FavoredEnemy.ts`:

```ts
import DDBEnricherData from "../../data/DDBEnricherData";

export default class FavoredEnemy extends DDBEnricherData {

  // 2024 Ranger "Favored Enemy" grants Hunter's Mark always-prepared with free
  // casts/long-rest. DDB encodes a scale-value table that generic parsing turns
  // into a junk force-damage activity. Suppress that activity but KEEP system.uses
  // so the CONSUMPTION_SPELL_LINKS["Favored Enemy"] post-pass can link Hunter's
  // Mark's free casts to this feature's uses pool.
  get type() {
    return null; // no primary activity → nothing auto-built
  }

  get override(): IDDBOverrideData | null {
    if (this.is2014) return null; // 2014 Favored Enemy = languages/proficiencies; no junk activity
    return { removeDamage: true };
  }
}
```

- [ ] **Step 2: Register it in the barrel**

In `src/parser/enrichers/class/ranger/_module.ts`, add (alphabetical, after `ExceptionalTraining`, before `FoeSlayer`):

```ts
export { default as FavoredEnemy } from "./FavoredEnemy";
```

(Dispatch: `DDBClassFeatureEnricher`'s ranger loader resolves `pascalCase("Favored Enemy") = "FavoredEnemy"`. If a later in-Foundry test shows the feature isn't being matched, add a `NAME_HINTS`/`NAME_HINTS_2014` entry mapping the exact DDB feature name to `"FavoredEnemy"` in `src/parser/enrichers/DDBClassFeatureEnricher.ts`.)

- [ ] **Step 3: Typecheck**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run typecheck`
Expected: no errors. *If `get type()` returning `null` errors, match the base signature in `DDBEnricherData.ts` (it declares `type(): IDDBActivityType | null`).*

- [ ] **Step 4: Lint**

Run: `npx eslint src/parser/enrichers/class/ranger/FavoredEnemy.ts`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run build`
Expected: `webpack ... compiled` (3 size warnings).

- [ ] **Step 6: Commit**

```bash
git add src/parser/enrichers/class/ranger/FavoredEnemy.ts src/parser/enrichers/class/ranger/_module.ts
git commit -m "Add Ranger Favored Enemy enricher: suppress junk activity for free Hunter's Mark

The 2024 Ranger 'Favored Enemy' feature had no enricher, so generic parsing
turned its DDB scale-value data into a junk force-damage activity. Suppress
the activity (type=null + removeDamage) while keeping system.uses, so the
existing CONSUMPTION_SPELL_LINKS post-pass links Hunter's Mark's free casts
to the feature's uses pool. is2014-guarded (2014 Favored Enemy is unaffected)."
```

> **Deferred functional check (Task 5):** confirm in Foundry that the feature has no damage activity and that Hunter's Mark becomes innate/always-prepared with consumption pointing at the feature's uses. If the activity is still present, the suppression hook needs adjusting (e.g. also stripping activities via the override) — investigate `DDBFeatureMixin._generateActivity` / `_getActivitiesType` at that point.

---

## Task 3: Cross-bucket spell dedup (Fix #4 — Longstrider)

**Files:**
- Modify: `src/parser/spells/CharacterSpellFactory.ts`, `_processClassSpell`, the `!duplicateItem` branch (currently lines 289-290).

- [ ] **Step 1: Replace the `!duplicateItem` push with a cross-bucket guard**

In `src/parser/spells/CharacterSpellFactory.ts`, the current code at lines 288-290 is:

```ts
    const duplicateItem = this._generated.class[duplicateSpell];
    if (!duplicateItem) {
      this._generated.class.push(parsedSpell);
    } else if (spell.alwaysPrepared || parsedSpell.system.method === "always"
```

Replace **only** the `if (!duplicateItem) { ... }` block (lines 289-291) with:

```ts
    if (!duplicateItem) {
      // Cross-bucket dedup: when a spell is granted by both a lineage/feat AND the
      // class list, handleGrantedSpells already created an always-prepared slot copy
      // (e.g. "GrLongstrider" in _generated.race). Skip adding the redundant class
      // copy in that case rather than leaving a duplicate unprepared entry.
      const parsedOriginalName = parsedSpell.flags.ddbimporter.originalName ?? parsedSpell.name;
      const crossBucketSlotCopy = Object.entries(this._generated).some(([bucket, spells]) =>
        bucket !== "class"
        && Array.isArray(spells)
        && spells.some((existingSpell) => {
          const existingOriginalName = existingSpell.flags.ddbimporter.originalName ?? existingSpell.name;
          const legacyMatch = (parsedSpell.flags.ddbimporter.is2014 ?? true) === (existingSpell.flags.ddbimporter.is2014 ?? true);
          return existingOriginalName === parsedOriginalName
            && legacyMatch
            && existingSpell.system.method === "spell"
            && existingSpell.system.prepared === CONFIG.DND5E.spellPreparationStates.always.value;
        }));
      if (crossBucketSlotCopy) {
        logger.debug(`Skipping redundant class spell ${parsedOriginalName}: an always-prepared slot copy already exists from another source.`);
      } else {
        this._generated.class.push(parsedSpell);
      }
    } else if (spell.alwaysPrepared || parsedSpell.system.method === "always"
```

> Leave the rest of the `else if (...)` / `else` chain (lines 291-302) exactly as-is — this only nests the cross-bucket guard inside the existing `!duplicateItem` path, preserving the domain-spell overwrite logic.

- [ ] **Step 2: Typecheck**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run typecheck`
Expected: no errors. *If `Object.entries(this._generated)` types `spells` as `unknown`, the `Array.isArray(spells)` guard narrows it; if the linter still complains, type the callback param as `([bucket, spells]: [string, any[]])`.*

- [ ] **Step 3: Lint**

Run: `npx eslint src/parser/spells/CharacterSpellFactory.ts`
Expected: no errors.

- [ ] **Step 4: Build**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run build`
Expected: `webpack ... compiled` (3 size warnings).

- [ ] **Step 5: Commit**

```bash
git add src/parser/spells/CharacterSpellFactory.ts
git commit -m "Dedup redundant class spell when an always-prepared slot copy exists elsewhere

A spell granted by both a lineage and the class list produced three items: the
innate entry, an always-prepared slot copy (from handleGrantedSpells, e.g. in
_generated.race), and a redundant unprepared class entry. The existing dedup in
_processClassSpell only checked _generated.class. Add a cross-bucket check so the
redundant class copy is skipped when an always-prepared slot copy already exists."
```

---

## Task 4: Normalize free-cast method to innate (Fix #2)

Make feat- and background-granted free-cast spells use `method: "innate"` (matching race grants) instead of `"atwill"`. Leaves class/subclass features (Warlock invocations) as `"atwill"`.

**Files:**
- Modify: `src/parser/spells/DDBSpell.ts`, `_generateSpellPreparationMode`, lines 418 and 426.

- [ ] **Step 1: Edit the `else if (always)` branch (line ~414-419)**

Current:

```ts
      } else if (always) {
        // these spells are always prepared, and have a limited use that's
        // picked up by getUses() later
        // this was changed to "atwill"
        this.data.system.method = "atwill";
        this.data.system.prepared = CONFIG.DND5E.spellPreparationStates.always.value;
```

Replace the two body lines (the comment + the `method =` assignment) so it reads:

```ts
      } else if (always) {
        // these spells are always prepared, and have a limited use that's
        // picked up by getUses() later.
        // Normalize feat/background grants to "innate" (consistent with race grants);
        // leave other sources (e.g. Warlock invocations) as "atwill".
        this.data.system.method = ["feat", "background"].includes(this.lookup) ? "innate" : "atwill";
        this.data.system.prepared = CONFIG.DND5E.spellPreparationStates.always.value;
```

- [ ] **Step 2: Edit the feat/classFeature/subclassFeature block (line ~424-428)**

Current:

```ts
      if (!this.spellData.usesSpellSlot && ["classFeature", "subclassFeature", "feat"].includes(this.lookup)) {
        if (this.spellData.alwaysPrepared) {
          this.data.system.method = "atwill";
          this.data.system.prepared = CONFIG.DND5E.spellPreparationStates.always.value;
        }
      }
```

Replace the inner `method =` line so it reads:

```ts
      if (!this.spellData.usesSpellSlot && ["classFeature", "subclassFeature", "feat"].includes(this.lookup)) {
        if (this.spellData.alwaysPrepared) {
          this.data.system.method = this.lookup === "feat" ? "innate" : "atwill";
          this.data.system.prepared = CONFIG.DND5E.spellPreparationStates.always.value;
        }
      }
```

- [ ] **Step 3: Typecheck**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `npx eslint src/parser/spells/DDBSpell.ts`
Expected: no errors.

- [ ] **Step 5: Build**

Run: `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 25.9.0; npm run build`
Expected: `webpack ... compiled` (3 size warnings).

- [ ] **Step 6: Commit**

```bash
git add src/parser/spells/DDBSpell.ts
git commit -m "Normalize feat/background free-cast spells to innate method

_generateSpellPreparationMode set race-granted free spells to 'innate' but
feat/background ones to 'atwill' (an undocumented choice; same mechanics, only a
different spellbook section). Normalize feat and background grants to 'innate'
for consistency; class/subclass features (Warlock invocations) stay 'atwill'."
```

---

## Task 5: In-Foundry acceptance verification (deferred — run when online)

Not a code task. Run when Foundry v13 + the MCP bridge are online. Prereqs: build is current (`npm run build`), Foundry reloaded, the relevant PCs (re-)imported into `dev-sandbox-v13`.

- [ ] **#5 Magic Missile** — `get-character-entity` on a wizard's Magic Missile: activity `target.affects.count === "2 + @item.level"`, one `1d4+1` force part, no attack roll. Cast at L1 → 3 darts; upcast L2 → 4. (Cross-check shape against `dnd5e.spells24` `phbsplMagicMissi`; if the official build uses a no-roll attack rather than a damage activity, adjust `MagicMissile.ts` `type`.)
- [ ] **#3 Favored Enemy / Hunter's Mark** — on a 2024 Ranger (Warpey): Favored Enemy feature has **no** damage activity; Hunter's Mark is `method: "innate"`, `prepared: "always"`, consumption targets the feature's uses; casting drains a use, then falls back to slots. *If the junk activity persists, revisit Task 2's suppression hook.*
- [ ] **#4 Longstrider** — on a Wood-Elf Ranger: exactly two Longstrider entries (innate + always-prepared slot), no redundant unprepared copy.
- [ ] **#2 method** — a Magic-Initiate (feat) free spell reports `method: "innate"`; confirm it renders in the innate spellbook section.

- [ ] **After verification:** update memory (`reference_ddb_importer_quirks` — note these are now fixed at source in the fork) and decide per-fix on upstream PRs (#5/#3/#4 candidates; #2 stays private) per `feedback_ddb_importer_fork_strategy`.

---

## Self-review notes

- **Spec coverage:** all four in-scope quirks (#5, #3, #4, #2) have a task; #1 is explicitly out of scope (non-bug). Acceptance for each is in Task 5.
- **Offline reality:** every code task is gated by typecheck + lint + build; functional behavior is deferred to Task 5 (documented, not hand-waved).
- **Riskiest fix:** #3's runtime suppression — concrete code is provided, with an explicit fallback note and a deferred check.

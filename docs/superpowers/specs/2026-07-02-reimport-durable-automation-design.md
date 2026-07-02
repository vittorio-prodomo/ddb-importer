# Re-import-durable automation — design spec

**Date:** 2026-07-02 · **Status: PARKED** — design sections approved by Vittorio in discussion, implementation deferred in favor of the Foundry-autonomy tooling project. Re-review at resume, then run writing-plans.

## Problem

A DDB-Importer re-import of a PC rewrites the actor document (items + all actor-level effects) from a fresh parse. The parser-source quirk fixes (branch `fix/import-quirks`) survive by construction, but hand-applied per-actor automation is wiped:

- CPR Magic Missile swap (Nahuel + Nigel) — reverts to DDB-parsed MM (correct darts thanks to fix #5, but no CPR auto-distribute/cancel-refund, no BG3 picker flag)
- GPS Portent premade (Nahuel) — reverts to inert DDB shell
- CPR Protection premade (Xender) — reverts to inert DDB shell
- Custom 2024 Lucky (Nigel) — the two transfer effects on the feat are wiped; `LuckyDisadvantage` world macro survives but is orphaned

## Key facts (verified in source, 2026-07-02)

- The importer ships a premade-at-import integration, default OFF: setting `character-update-policy-use-chris-premades` (player-scoped Boolean, `src/config/settings/settings.ts:684`; not Patreon-gated). During character import, `ExternalAutomations.addChrisEffectsToActorDocuments` (`src/effects/external/ExternalAutomations.ts:84`, invoked at `DDBCharacterImporter.ts:1058–1061`) swaps parsed items for premade versions (delete+recreate with `keepId`). Per-item opt-out: `flags.ddbimporter.ignoreItemForChrisPremades`.
- Matching calls `chrisPremades.integration.ddbi(name, {rules, itemType, …})` (`ChrisPremadesHelper.getDocumentFromName`). CPR's `ddbi` searches **CPR, gambits-premades, and midi-item-showcase-community** packs by priority (`chris-premades/scripts/integrations/ddbi.js`; GPS packs enumerated in `gambitsPremades.js`, including `gps-class-features` where Portent's automation lives — GPS ships `scripts/automations/classFeatures/wizard/schoolOfDivination/portent.js`).
- `ChrisPremadesHelper.updateOriginalDocument` merges the premade's **flags wholesale** (line 231) before copying `CP_FIELDS_TO_COPY` (effects, activities, damage/target/…, `flags.chris-premades`) → our baked `flags.enhancedcombathud.stackTargets` on the CPR-fork MM compendium item (CPR commit `17d4af5ef`) survives the swap.
- Re-import's item wipe honors `flags.ddbimporter.ignoreItemImport` (`DDBCharacterImporter.ts:246, 573`) — a per-item freeze. Deliberately NOT used here: frozen items stop receiving DDB updates (Lucky's 2024 uses max is `@prof` → would go stale at level 5).
- The importer already has a Lucky enricher: `src/parser/enrichers/generic/Lucky.ts` (feat path builds the "Spend Luck Point" utility activity + uses pool `@prof` (2024) / `3` (2014); its `effects` getter is currently race-only / Halfling).
- MidiQoL v13 supports self-contained item macros: `resolveItemMacro` reads `item.flags.dae.macro ?? item.flags.itemacro.macro`, accepts `"ItemMacro"` / `"ItemMacro.<name>"` / `"ItemMacro.<uuid>"` (midi-qol v13 `src/module/utils.ts` ~1305–1360); flag-change values of `"ItemMacro"` on **transfer effects** are auto-rewritten to `ItemMacro.<parent item uuid>` (`utils.ts:1057–1058`).
- Headless re-import API exists: `api.importCharacter({actor})` / `api.importCharacterById` (`src/api.ts:201–202`) — useful for verification tooling.

## Workstream 1 — enable + verify premade-at-import

Configuration, no code expected. Enable `character-update-policy-use-chris-premades` (checkbox in the import window) for the GM user in `dev-sandbox-v13`.

Expected coverage on re-import: MM → CPR fork version incl. `stackTargets`; Protection → CPR `CPRFeats2024`; Portent → GPS via the same channel. Collateral: every premade-covered item on all PCs gets swapped — accepted by design; spot-check the majors; per-item opt-out where a premade misbehaves.

**Contingency:** if name/rules matching misses one of the three (e.g. "Fighting Style: Protection" naming), wire a name override in our fork (the `chrisNameOverride` pathway / CPR's renamed-items config — investigate at implementation).

## Workstream 2 — Lucky enricher extension (fork)

Extend `src/parser/enrichers/generic/Lucky.ts` (feat path, **2024 rules only** — 2014 Lucky differs semantically and is unused at the table) to emit two transfer effects, reproducing the live-verified hand build (as-built reference: `notes/macros/2026-06-30_lucky_disadvantage_isPreAttacked.js`; note the spec/plan under `notes/{specs,plans}/2026-06-30-lucky-2024-automation*` describe the abandoned reaction design — the target-macro as-built is authoritative):

1. **Advantage** — MidiQoL optional-bonus flags: `flags.midi-qol.optional.Lucky.{label, count=ItemUses.Lucky, attack.all/check.all/save.all="reroll-kh"}`.
2. **Disadvantage** — `flags.midi-qol.onUseMacroName = "ItemMacro,isPreAttacked"` + the macro source embedded at `flags.dae.macro` on the feat (port of the world macro). Fully self-contained item: no per-world macro setup.

Migration: once verified, retire the `LuckyDisadvantage` world macro in `dev-sandbox-v13`.

**Risk to verify at implementation:** the `ItemMacro` auto-rewrite for **target-side** onUse macros aggregated from actor flags (expected OK via the `change.effect.transfer` branch at `utils.ts:1057`). Fallback: keep the world-macro pointer form and ensure the macro exists per world.

## Verification

Rebuild fork (`npm run build`, node 25) → Empty-Cache-Hard-Reload → **delete + recreate** each PC (update-mode import may not re-parse; known gotcha). Then:

- Structural (bridge `get-character-entity`): wizards' MM = CPR + `stackTargets`; Nahuel's Portent = GPS automation; Xender's Protection = CPR; Nigel's Lucky = 2 transfer effects + `flags.dae.macro`.
- Functional: Lucky advantage prompt + disadvantage fires via ItemMacro; MM BG3 picker + auto-distribute; Portent/Protection in-play checks — **absorbs the standing "#1 NEXT" live-test** rather than postponing it.
- Regression: Warpey (HM feat structure, exactly two Longstriders — quirk fixes intact).

## Out of scope

Generic snapshot/restore and the re-apply-registry approach (rejected for now; revisit only for a future build not expressible at parse time). Polish-backlog cosmetics (e.g. "DIS: workflowOptions" label). Real-campaign rollout = enabling the same setting there (runbook line, not work).

## Branch

`feat/reimport-durable-automation` off `fix/import-quirks` (ddb-importer fork). CPR / GPS / Argon forks unchanged.

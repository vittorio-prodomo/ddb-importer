# Re-import-durable automation — design spec

**Date:** 2026-07-02 · **Status: IMPLEMENTED 2026-07-02** — executed via `docs/superpowers/plans/2026-07-02-reimport-durable-automation.md`; verification evidence summarized at the end of this doc. Two design-premise corrections discovered live: CPR ships a *non-automated* Lucky shell (opted out per-item at parse), and Portent arrives via a CPR-fork GPS-registry alias, not directly (CPR 1.5.35's registry predates GPS Portent and GPS never ported it to the `*-2024` packs).

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

`feat/reimport-durable-automation` off `fix/import-quirks` (ddb-importer fork). ~~CPR / GPS / Argon forks unchanged.~~ **As-built correction:** the CPR fork gained one data-registry commit (`feat/gps-registry-modern-aliases`, 586dba8) — see Rollout/Evidence below. GPS / Argon untouched.

## Rollout (real campaign world)

Per-world/per-user config only — no code. In the campaign world:
- For EVERY user who runs imports (client-scoped settings): enable
  `character-update-policy-use-chris-premades` + `character-update-policy-add-midi-effects`
  (the import-window checkboxes set them).
- Once (world-scoped): `no-item-macros = false`, `embed-macros = true`.
- Recreate the **"Portent Refresh"** world macro there (bridge `create-macro` upsert; source in
  the dev world) — click after the Diviner's long rest (GPS's DAE-off refresh linkage doesn't
  fire under DAE v13).
- Then re-import each PC once. The `LuckyDisadvantage` world macro is retired (the feat is
  self-contained); do not recreate it.
- The agent client's DDB cobalt cookie lives in `~/.config/foundry-claude/agent.env`
  (`DDB_COBALT_COOKIE`) — refresh it when the DDB session rotates.

## Verification evidence (2026-07-02, executed via the autonomy stack, agent as sole GM)

- **WS1:** fresh imports of all 4 PCs with premade-at-import on. MM = CPR fork item incl.
  `flags.enhancedcombathud.stackTargets` (survived the wholesale flag merge as predicted);
  Protection = CPR `identifier: "protection"` (DDB parses the style as plain "Protection" —
  no name-override contingency needed); Portent = GPS via the registry alias. Collateral swaps
  sane (Nigel 43 / Xender 21 / Nahuel 40 / Warpey 45 items).
- **WS2:** Lucky enricher output exact on import (2 transfer effects; 5 `optional.Lucky.*`
  changes; `onUseMacroName = "ItemMacro,isPreAttacked"`; macro source embedded at
  `flags.dae.macro`; uses `@prof` → 2/2 lr). Functional with the world macro DELETED:
  advantage reroll-kh prompt (points 2→1), disadvantage DialogV2 via the embedded ItemMacro →
  `2d20dis` kept-lower + `advantageMode: -1` (points 1→0), no prompt at 0 points — the
  flagged target-side ItemMacro-rewrite risk is CONFIRMED resolved.
- **MM functional:** auto-distribute path (3 targets = 3 darts → one bolt each, no dialog,
  slot consumed). The BG3 on-canvas picker is the Argon-HUD-click flow (not reachable from a
  bare API cast) — already live-verified in the BG3 project; the re-import-relevant item
  wiring is what this spec covers, and it's green.
- **Portent functional (absorbed live-test):** roll+store (whispered pair written into the item
  description), consume dialog (picked a die, it burned). Finding: the refresh-at-long-rest
  linkage (DAE "off" pass on the item-owned transfer effect) does NOT fire under DAE v13 —
  pre-existing GPS×DAE gap, worked around with the "Portent Refresh" world macro (re-import-safe).
- **Protection functional (absorbed live-test):** adjacent-ally attack → CPR reaction dialog →
  `2d20dis` [19 discarded, 11 kept], attribution "Protection: Protected - Grants Disadvantage
  Attack (All) (Warpey)", "Reaction used" marker on Xender.
- **Durability acceptance:** UPDATE-mode re-import of Nigel → every WS2/WS1 assert still green.
  Zero hand-fixing.
- **Regression:** Warpey HM dual-mode + clean Favored Enemy intact. **Open finding:** Longstrider
  count is 3 (expected 2) — the unprepared class copy survives the quirk-#4 dedup; reproduced
  with premades OFF (parser-side, not the CPR pass); cosmetic; debug separately.

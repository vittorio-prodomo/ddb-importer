# Re-import-durable Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four hand-applied PC automations (CPR Magic Missile, GPS Portent, CPR Protection, custom 2024 Lucky) survive DDB-Importer re-imports — the first three via the importer's built-in premade-at-import integration (config only), Lucky via a fork enricher that regenerates the two transfer effects + an embedded ItemMacro on every parse.

**Architecture:** Workstream 1 enables `character-update-policy-use-chris-premades` so `ExternalAutomations.addChrisEffectsToActorDocuments` (invoked at `src/muncher/DDBCharacterImporter.ts:1061`) swaps parsed items for CPR/GPS premades during every import. Workstream 2 extends `src/parser/enrichers/generic/Lucky.ts` (feat path, 2024 only) to emit the live-verified advantage optional-bonus effect and the `isPreAttacked` target-macro disadvantage effect, with the macro source shipped at `macros/feats/lucky2024Disadvantage.js` and embedded via the framework's `itemMacro` hook. Verification runs the autonomy stack end-to-end: bridge `delete-actor` + `ddb-import-character` + `get-character-entity` for structure, the agent GM client (Playwright) for functional play-tests — absorbing the standing Portent/Protection live-test.

**Tech Stack:** TypeScript (ddb-importer fork, webpack via `npm run build`, node 25.9.0), Foundry v13.351 / dnd5e 5.3.3 / MidiQoL 13.0.63, MCP bridge tools (`mcp__foundry-mcp__*`), agent GM client (`mcp__playwright__browser_*`).

**Spec:** `docs/superpowers/specs/2026-07-02-reimport-durable-automation-design.md` (this repo).

## Global Constraints

- **Repo:** `~/dev/foundry-modules/modules/ddb-importer` (our fork). Branch: `feat/reimport-durable-automation` off `fix/import-quirks`. CPR / GPS / Argon forks and the bridge are NOT touched.
- **World:** all live work in `dev-sandbox-v13` ONLY. PCs: Nahuel, Nigel, Warpey, Xender (all level 3).
- **Build:** `export NVM_DIR=~/.nvm; . $NVM_DIR/nvm.sh; nvm use 25.9.0; npm run build` → regenerates `dist/main.mjs`. Static assets (`macros/` etc.) are served from the repo root via the symlink — no build step for them.
- **Reload:** plain **F5** in the agent client reloads fresh parser code (dev-loader cache-buster, shipped 2026-07-02). The spec's "Empty-Cache-Hard-Reload" line predates this — F5 is sufficient. No service restart needed (no manifest/compendium changes in this plan).
- **Re-parse gotcha:** "update"-mode re-import may not re-parse unchanged items. All parser-output verification uses **delete + fresh import** (`delete-actor` → `ddb-import-character {ddbCharacterId}`). Update-mode is exercised once, deliberately, in Task 10 (it's the real-world flow being made durable).
- **Import executor:** `ddb-import-character` runs the import inside the socket-holding GM client — keep the **agent client as the sole logged-in GM** so player-scoped import settings are read from the "Claude" user. Probe transport liveness with `list-characters` (never `get-world-info`).
- **No unit-test infra in this repo** (`"test": "echo \"Error: no test specified\""`). Fork convention (see `docs/superpowers/plans/2026-06-04-ddb-importer-parser-fixes.md`): verification is the live structural + functional loop below. TDD here means: write the assertion list before the import, then run the import and check.
- **2024 rules only** for Lucky (`this.is2014` guard) — 2014 Lucky differs semantically and is unused at the table.
- **Rules reference for functional checks:** 2024 Lucky = Advantage on your own d20 test / Disadvantage on an attack against you, `@prof` points per long rest, **not** a reaction. Portent (Diviner) = 2 stored d20s after long rest, substitute onto any visible creature's attack/save/check. Protection (fighting style) = reaction, requires shield, impose disadvantage on an attack against an ally within 5 ft.

---

### Task 1: Branch + baseline capture

**Files:**
- Create: `/tmp/claude-1002/-home-vittorio-dev-foundry-modules/920c5638-2438-49b8-b72c-28e8eb35142a/scratchpad/reimport-baseline.md` (scratch evidence file)

**Interfaces:**
- Produces: branch `feat/reimport-durable-automation`; the four PCs' DDB character ids + current setting values recorded in the scratch file (later tasks read ids from there).

- [ ] **Step 1: Verify clean state and cut the branch**

```bash
cd ~/dev/foundry-modules/modules/ddb-importer
git status --short          # expect: empty
git branch --show-current   # expect: fix/import-quirks
git checkout -b feat/reimport-durable-automation
```

Expected: new branch created, no errors.

- [ ] **Step 2: Confirm the agent client is logged in and the bridge is live**

Call `mcp__foundry-mcp__list-characters`. Expected: the 4 PCs listed within ~2s. If it times out, follow the recovery recipe in `_tools/foundry-vtt-mcp-v13/docs/runbooks/agent-client-login.md` (login the agent client, sole GM), then re-probe.

- [ ] **Step 3: Capture DDB ids, module state, and current settings**

Call `mcp__playwright__browser_evaluate` in the agent client:

```js
() => {
  const pcs = ["Nahuel", "Nigel", "Warpey", "Xender"];
  const ids = Object.fromEntries(pcs.map((n) => [
    n, game.actors.getName(n)?.flags?.ddbimporter?.dndbeyond?.characterId ?? "MISSING",
  ]));
  const settingInfo = (k) => {
    const def = game.settings.settings.get(`ddb-importer.${k}`);
    return { scope: def?.scope, value: game.settings.get("ddb-importer", k) };
  };
  return {
    ids,
    modules: {
      cpr: game.modules.get("chris-premades")?.active,
      gps: game.modules.get("gambits-premades")?.active,
    },
    settings: {
      useChrisPremades: settingInfo("character-update-policy-use-chris-premades"),
      addMidiEffects: settingInfo("character-update-policy-add-midi-effects"),
      noItemMacros: settingInfo("no-item-macros"),
      embedMacros: settingInfo("embed-macros"),
    },
  };
}
```

Expected: 4 numeric ids (no "MISSING"), `cpr: true`, `gps: true`, plus each setting's scope + current value.

- [ ] **Step 4: Write the scratch evidence file**

Write the returned JSON to `/tmp/claude-1002/-home-vittorio-dev-foundry-modules/920c5638-2438-49b8-b72c-28e8eb35142a/scratchpad/reimport-baseline.md` under headings `## DDB ids` and `## Settings before`. If any id is MISSING or a module is inactive, STOP and report — do not proceed to imports.

No commit (no repo changes).

---

### Task 2: Configure the import settings

**Files:** none (world/user config via the agent client).

**Interfaces:**
- Consumes: setting scopes recorded in Task 1.
- Produces: the four settings in their target state for every later import in this plan.

Why each setting (source-verified):
- `character-update-policy-use-chris-premades` → gates `addChrisEffectsToActorDocuments` (`src/muncher/DDBCharacterImporter.ts:857,1058-1061`). Player-scoped.
- `character-update-policy-add-midi-effects` → feeds `useMidiAutomations` (`src/parser/features/DDBFeatureMixin.ts:324-325`) → `_canApplyMidiEffects` (`DDBEnricherFactoryMixin.ts:683-686`), which gates **all** `midiOnly` effect hints AND the `itemMacro`/`onUseMacroChanges` machinery. Player-scoped, default false. **If this is off for the importing user, Task 6's enricher output silently never appears.**
- `no-item-macros` → when **true** (the default), `setItemMacroFlag` skips embedding `flags.dae.macro` and `generateItemMacroValue` emits the `function.DDBImporter...` call form instead of `ItemMacro` (`src/lib/DDBMacros.ts:138-145,212-225`). The spec mandates the embedded ItemMacro form → must be **false**.
- `embed-macros` → when false, `loadMacroFile` embeds a dynamic-execute stub instead of the macro source (`src/lib/DDBMacros.ts:103-118`). For a self-contained item → **true**.

- [ ] **Step 1: Set all four settings in the agent client**

`mcp__playwright__browser_evaluate`:

```js
async () => {
  await game.settings.set("ddb-importer", "character-update-policy-use-chris-premades", true);
  await game.settings.set("ddb-importer", "character-update-policy-add-midi-effects", true);
  await game.settings.set("ddb-importer", "no-item-macros", false);
  await game.settings.set("ddb-importer", "embed-macros", true);
  return ["character-update-policy-use-chris-premades", "character-update-policy-add-midi-effects",
          "no-item-macros", "embed-macros"]
    .map((k) => `${k} = ${game.settings.get("ddb-importer", k)}`);
}
```

Expected: `[..."use-chris-premades = true", ..."add-midi-effects = true", "no-item-macros = false", "embed-macros = true"]`.

- [ ] **Step 2: Record scope caveat in the scratch file**

Append to the scratch file: for every setting whose Task-1 scope was `player`/`client`, note "must also be set for Vittorio's user before HE runs imports (the import-window checkboxes cover the two policy settings)". World-scoped ones are done once. This becomes the Task 11 rollout note.

No commit.

---

### Task 3: WS1 verification — Nahuel (Magic Missile + Portent)

**Files:** none (live verification).

**Interfaces:**
- Consumes: Nahuel's `ddbCharacterId` from the scratch file.
- Produces: pass/fail per assertion, appended to the scratch file. On Portent-miss → Task 3b.

- [ ] **Step 1: Write the assertion list (before importing)**

Append to the scratch file:

```
## Nahuel fresh-import asserts
A1 Magic Missile: flags.ddbimporter.chrisEffectsApplied === true
A2 Magic Missile: flags["chris-premades"] present (macro-driven CPR item)
A3 Magic Missile: flags.enhancedcombathud.stackTargets === true (survives via wholesale flag merge, ChrisPremadesHelper.ts:231)
A4 Portent: flags.ddbimporter.chrisEffectsApplied === true (GPS swap via CPR ddbi channel)
A5 Portent: item is not the inert DDB shell (has effects and/or non-empty activities)
```

- [ ] **Step 2: Delete + fresh-import Nahuel**

1. `mcp__foundry-mcp__delete-actor` `{actorIdentifier: "Nahuel"}` → expect `success: true`.
2. `mcp__foundry-mcp__ddb-import-character` `{ddbCharacterId: "<Nahuel id from scratch>"}` → expect `{started: true, actorId, mode: "fresh"}`.
3. Poll `mcp__foundry-mcp__get-character` `{characterIdentifier: "Nahuel"}` every ~10s (fresh actor is named "New Actor" until the import lands — poll by the returned `actorId` if name lookup fails, or re-try by name). Done when the name is "Nahuel" and the item count is stable across two polls (~10-40s total).
4. If it never lands: check `mcp__foundry-mcp__read-chat-messages` `{limit: 5}` for the GM-whispered failure breadcrumb + the agent client console (`mcp__playwright__browser_console_messages`). Fix cause, delete the shell actor, retry once.

- [ ] **Step 3: Run the structural assertions**

`mcp__foundry-mcp__get-character-entity` `{characterIdentifier: "Nahuel", entityIdentifier: "Magic Missile"}` → check A1-A3 against the returned flags.
`mcp__foundry-mcp__get-character-entity` `{characterIdentifier: "Nahuel", entityIdentifier: "Portent"}` → check A4-A5.

Record each assert PASS/FAIL in the scratch file. A1-A3 failing = premade-at-import isn't firing at all → re-check Task 2 settings before anything else (the setting is read from the importing user = the agent client's "Claude" user). A4/A5 failing alone = name-matching miss → Task 3b.

---

### Task 3b: CONTINGENCY — premade name-override patch (run only if a Task 3/4 assert shows a name-matching miss)

**Files:**
- Modify: `src/effects/external/ChrisPremadesHelper.ts:148`

**Interfaces:**
- Produces: fork-side DDB-name → premade-name override map used by all premade lookups.

- [ ] **Step 1: Diagnose — is it naming?**

`mcp__playwright__browser_evaluate`:

```js
async () => {
  const item = game.actors.getName("Nahuel").items.getName("Portent"); // or the miss in question
  const renamed = CONFIG.chrisPremades?.renamedItems ?? {};
  const hit = await chrisPremades.integration.ddbi(item.name, { rules: item.system?.source?.rules ?? "2024", itemType: item.type });
  return { itemName: item.name, rulesVersion: item.system?.source?.rules, renamedEntry: renamed[item.name] ?? null, ddbiFound: !!hit, ddbiName: hit?.name ?? null };
}
```

If `ddbiFound: true` the problem is not naming — stop, investigate the import-log path instead (`mcp__playwright__browser_console_messages`, filter "Cauldron"). If false, try the obvious premade name variants (e.g. `"Fighting Style: Protection"` → `"Protection"`) in the same call until one returns a hit; that pair is the override.

- [ ] **Step 2: Apply the override map patch**

In `src/effects/external/ChrisPremadesHelper.ts`, replace (line ~148):

```ts
    this.chrisName = chrisNameOverride ?? CONFIG.chrisPremades?.renamedItems[this.ddbName] ?? this.ddbName;
```

with:

```ts
    this.chrisName = chrisNameOverride
      ?? ChrisPremadesHelper.DDB_NAME_OVERRIDES[this.ddbName]
      ?? CONFIG.chrisPremades?.renamedItems[this.ddbName]
      ?? this.ddbName;
```

and add inside the class (near the top, after the existing static members):

```ts
  // Fork addition: DDB parsed names that CPR's ddbi/renamedItems doesn't map to
  // the premade compendium name. Checked before CPR's own renamedItems.
  static DDB_NAME_OVERRIDES: Record<string, string> = {
    // "<DDB parsed name>": "<premade compendium item name>",  ← fill with the pair found in Step 1
  };
```

- [ ] **Step 3: Rebuild + reload + re-verify**

```bash
cd ~/dev/foundry-modules/modules/ddb-importer
export NVM_DIR=~/.nvm; . $NVM_DIR/nvm.sh; nvm use 25.9.0; npm run build
```

Expected: webpack completes, `dist/main.mjs` regenerated. Then F5 the agent client (`mcp__playwright__browser_press_key` `{key: "F5"}`, wait for the world to load), re-probe `list-characters`, re-run the failed PC's delete + fresh-import loop, re-check the failed assert.

- [ ] **Step 4: Commit**

```bash
git add src/effects/external/ChrisPremadesHelper.ts
git commit -m "feat: fork-side DDB->premade name override map for premade-at-import misses"
```

---

### Task 4: WS1 verification — Xender (Protection) + collateral spot-check

**Files:** none (live verification).

**Interfaces:**
- Consumes: Xender's `ddbCharacterId` from the scratch file.
- Produces: pass/fail appended to the scratch file; collateral-swap inventory.

- [ ] **Step 1: Write the assertion list**

Append to the scratch file:

```
## Xender fresh-import asserts
B1 Protection (fighting style): flags.ddbimporter.chrisEffectsApplied === true
B2 Protection: flags["chris-premades"] present (CPR macro-driven)
B3 Collateral: list of all chrisEffectsApplied items on Xender looks sane (no nonsense swaps)
```

- [ ] **Step 2: Delete + fresh-import Xender**

Same loop as Task 3 Step 2 with Xender's id. Same failure handling.

- [ ] **Step 3: Run the assertions**

`mcp__foundry-mcp__get-character-entity` `{characterIdentifier: "Xender", entityIdentifier: "Protection"}` → B1, B2. If the item isn't found under "Protection", search variants via `mcp__foundry-mcp__search-character-items` `{characterIdentifier: "Xender", query: "Protection"}` (DDB may parse it as "Fighting Style: Protection") — a hit under a variant name that lacks `chrisEffectsApplied` = name-matching miss → run Task 3b for this item.

Collateral inventory (B3), `mcp__playwright__browser_evaluate`:

```js
() => game.actors.getName("Xender").items
  .filter((i) => i.flags?.ddbimporter?.chrisEffectsApplied === true)
  .map((i) => `${i.type}: ${i.name}`)
```

Eyeball the list (expect maneuvers/feats/weapons with CPR versions). Record it. Anything misbehaving later gets the per-item opt-out `flags.ddbimporter.ignoreItemForChrisPremades` — note, don't act now.

- [ ] **Step 4: Re-check Portent asserts on Nahuel are still the plan of record**

No action if Task 3 passed. If Task 3b was exercised, confirm its commit exists (`git log --oneline -1`).

---

### Task 5: WS2 — ship the Lucky disadvantage macro file

**Files:**
- Create: `macros/feats/lucky2024Disadvantage.js`

**Interfaces:**
- Produces: macro file loaded by `DDBMacros.loadMacroFile("feat", "lucky2024Disadvantage.js")` → embedded at `flags.dae.macro` by Task 6's `itemMacro` getter. The filename string must match Task 6 exactly.

- [ ] **Step 1: Create the macro file**

Port of the live-verified world macro (`~/dev/foundry-modules/notes/macros/2026-06-30_lucky_disadvantage_isPreAttacked.js`) — logic byte-identical, header rewritten for the shipped context:

```js
// Lucky (2024) — disadvantage half. Shipped by our ddb-importer fork and wired by
// the Lucky enricher as an isPreAttacked TARGET onUse macro: a transfer effect on
// the feat sets flags.midi-qol.onUseMacroName = "ItemMacro,isPreAttacked" (midi
// rewrites bare ItemMacro to this feat's uuid for transfer effects,
// midi-qol utils.ts:1057), with this source embedded at flags.dae.macro.
//
// MidiQoL fires this when the feat's owner is about to be attacked, BEFORE the
// attacker's d20 (workflow.triggerTargetMacros(["isPreAttacked"]), just before
// checkAttackAdvantage()). checkAttackAdvantage() does tracker.reset() then reads
// workflowOptions.disadvantage, so setting it here sticks and self-cleans
// (workflowOptions is per-attack). Deliberately NOT a reaction — 2024 Lucky's
// disadvantage costs no reaction, so the reaction economy is untouched.

const md = args?.[0];
if (!md || md.macroPass !== "isPreAttacked") return;

const wf = md.workflow;   // the ATTACKER's attack workflow
const me = md.actor;      // the feat's owner (the target being attacked)
if (!wf || !me) return;

const lucky = me.items.find((i) => i.type === "feat" && i.system?.identifier === "lucky");
const remaining = lucky?.system?.uses?.value ?? 0;
if (!lucky || remaining <= 0) return; // out of Luck Points -> no prompt

const attacker = wf.actor?.name ?? "the attacker";
const ok = await foundry.applications.api.DialogV2.confirm({
  window: { title: "Lucky" },
  content:
    `<p><b>${me.name}</b>: spend 1 Luck Point to impose <b>Disadvantage</b> on ` +
    `${attacker}'s attack roll?</p><p><i>${remaining} Luck Point(s) remaining.</i></p>`,
  modal: true,
  rejectClose: false,
});
if (!ok) return;

// Impose disadvantage on the pending attack (read by checkAttackAdvantage, post-reset).
wf.workflowOptions = wf.workflowOptions ?? {};
wf.workflowOptions.disadvantage = true;

// Spend one Luck Point.
await lucky.update({ "system.uses.spent": (lucky.system?.uses?.spent ?? 0) + 1 });
```

- [ ] **Step 2: Verify Foundry can serve the file (it's a runtime fetch, not a build artifact)**

```bash
ls -l ~/foundrydata-v13/Data/modules/ddb-importer/macros/feats/lucky2024Disadvantage.js
```

Expected: the file, via the repo-root symlink.

- [ ] **Step 3: Commit**

```bash
git add macros/feats/lucky2024Disadvantage.js
git commit -m "feat: ship 2024 Lucky disadvantage macro (isPreAttacked target pass)"
```

---

### Task 6: WS2 — extend the Lucky enricher

**Files:**
- Modify: `src/parser/enrichers/generic/Lucky.ts` (full replacement below)

**Interfaces:**
- Consumes: `macros/feats/lucky2024Disadvantage.js` (Task 5 — name must match).
- Produces, on every fresh parse of the 2024 Lucky feat (given Task 2's settings):
  - transfer effect "Lucky: Advantage" with changes `flags.midi-qol.optional.Lucky.{label="Lucky", count="ItemUses.Lucky", attack.all/check.all/save.all="reroll-kh"}` (generated by the mixin's `midiOptionalChanges` handler, `DDBEnricherFactoryMixin.ts:880-888`)
  - transfer effect "Lucky: Disadvantage (when attacked)" with one change `flags.midi-qol.onUseMacroName = "ItemMacro,isPreAttacked"` (CUSTOM mode; generated by `DDBMacros.generateOnUseMacroChange` — comma form, per the CLAUDE.md landmine)
  - `flags.dae.macro.command` on the feat = the Task 5 macro source (via `DDBMacros.setItemMacroFlag`, `DDBEnricherFactoryMixin.ts:695-700`)

- [ ] **Step 1: Replace the file content**

`src/parser/enrichers/generic/Lucky.ts`:

```ts
import DDBEnricherData from "../data/DDBEnricherData";

export default class Lucky extends DDBEnricherData {

  get type() {
    if (this.featureType !== "feat") return null;
    return DDBEnricherData.ACTIVITY_TYPES.UTILITY;
  }

  get activity(): IDDBActivityData {
    if (this.featureType !== "feat") return null;
    return {
      name: "Spend Luck Point",
      activationType: "special",
      addItemConsume: true,
    };
  }

  get override(): IDDBOverrideData {
    if (this.featureType !== "feat") return null;
    const uses = this._getUsesWithSpent({
      type: "feat",
      name: "Luck Points",
      max: this.is2014 ? "3" : "@prof",
      period: "lr",
    });
    return {
      uses,
    };
  }

  get itemMacro(): IDDBItemMacro | null {
    // 2024 feat only — the disadvantage half fires as an isPreAttacked TARGET
    // onUse macro; 2014 Lucky is semantically different and stays manual.
    if (this.featureType !== "feat" || this.is2014) return null;
    return {
      type: "feat",
      name: "lucky2024Disadvantage.js",
    };
  }

  get effects(): IDDBEffectHint[] {
    if (this.featureType === "race") {
      return [
        {
          options: {
            transfer: true,
          },
          changes: [
            DDBEnricherData.ChangeHelper.overrideChange("true", 20, "flags.dnd5e.halflingLucky"),
          ],
        },
      ];
    }

    if (this.featureType !== "feat" || this.is2014) return [];

    return [
      {
        name: "Lucky: Advantage",
        midiOnly: true,
        options: {
          transfer: true,
        },
        midiOptionalChanges: [
          {
            name: "Lucky",
            data: {
              label: "Lucky",
              count: "ItemUses.Lucky",
              "attack.all": "reroll-kh",
              "check.all": "reroll-kh",
              "save.all": "reroll-kh",
            },
          },
        ],
      },
      {
        // Bare "ItemMacro" (no document passed): midi rewrites it to this feat's
        // uuid for transfer effects (utils.ts:1057) — uuid-robust across renames.
        name: "Lucky: Disadvantage (when attacked)",
        midiOnly: true,
        options: {
          transfer: true,
        },
        onUseMacroChanges: [
          { macroPass: "isPreAttacked", macroType: "feat", macroName: "lucky2024Disadvantage.js" },
        ],
      },
    ];
  }

}
```

- [ ] **Step 2: Build**

```bash
cd ~/dev/foundry-modules/modules/ddb-importer
export NVM_DIR=~/.nvm; . $NVM_DIR/nvm.sh; nvm use 25.9.0; npm run build
```

Expected: webpack completes with exit 0, `dist/main.mjs` regenerated (~2.8 MB). A TS error naming `IDDBItemMacro`/`IDDBEffectHint` means a type drifted — fix against `src/parser/enrichers/data/types.d.ts:160-290`, do not cast to `any`.

- [ ] **Step 3: Commit**

```bash
git add src/parser/enrichers/generic/Lucky.ts
git commit -m "feat: 2024 Lucky enricher — advantage optional-bonus + isPreAttacked disadvantage effects"
```

---

### Task 7: WS2 structural verification — Nigel

**Files:** none (live verification).

**Interfaces:**
- Consumes: Nigel's `ddbCharacterId`; Task 6 build deployed.
- Produces: pass/fail per assert in the scratch file. Nigel's actor is freshly imported (old hand-built Lucky effects + CPR MM swap are gone by construction — the enricher/premades must recreate everything).

- [ ] **Step 1: Reload the agent client onto the new build**

`mcp__playwright__browser_press_key` `{key: "F5"}` → wait for the world (`mcp__playwright__browser_wait_for` `{text: "Nigel", time: 30}` or a snapshot showing the sidebar) → probe `mcp__foundry-mcp__list-characters` (module socket re-established).

- [ ] **Step 2: Write the assertion list**

Append to the scratch file:

```
## Nigel fresh-import asserts (WS2 + wizard #2 WS1)
C1 Lucky feat: exactly 2 transfer effects named "Lucky: Advantage" and "Lucky: Disadvantage (when attacked)"
C2 Advantage effect changes: flags.midi-qol.optional.Lucky.label="Lucky", .count="ItemUses.Lucky", .attack.all/.check.all/.save.all="reroll-kh"
C3 Disadvantage effect: single change key flags.midi-qol.onUseMacroName, value "ItemMacro,isPreAttacked" (comma form)
C4 Lucky feat: flags.dae.macro.command contains "isPreAttacked" and "Luck Point" (embedded source, not the dynamic stub or "Unable to load")
C5 Lucky feat: uses max resolves to 2 (@prof at level 3), period lr
C6 Magic Missile: chrisEffectsApplied === true AND flags.enhancedcombathud.stackTargets (wizard #2 premade coverage)
```

- [ ] **Step 3: Delete + fresh-import Nigel, then assert**

Same import loop as Task 3 Step 2 with Nigel's id. Then `mcp__foundry-mcp__get-character-entity` `{characterIdentifier: "Nigel", entityIdentifier: "Lucky"}` → C1-C5; `{entityIdentifier: "Magic Missile"}` → C6. Record results.

C4 showing the dynamic-execute stub (`api.macros.executeMacro(...)`) means `embed-macros` was false at import time; C4 missing entirely means `no-item-macros` was true — both are Task 2 regressions for the importing user: fix, re-import, re-assert. C1/C2 missing entirely → `character-update-policy-add-midi-effects` off for the importing user (the `_canApplyMidiEffects` gate) — same remedy.

---

### Task 8: WS2 functional verification — Lucky in play (agent client)

**Files:** none (live verification).

**Interfaces:**
- Consumes: Nigel freshly imported (Task 7); a goblin NPC with tokens on the sandbox scene.
- Produces: functional PASS/FAIL evidence in the scratch file; the orphaned `LuckyDisadvantage` world macro retired.

- [ ] **Step 1: Retire the world macro FIRST (proves the item is self-contained)**

`mcp__foundry-mcp__delete-macro` `{macroIdentifier: "LuckyDisadvantage"}`. Expected: success. Recovery if Step 4 later fails: recreate it from `notes/macros/2026-06-30_lucky_disadvantage_isPreAttacked.js` via `create-macro` while debugging — but a working ItemMacro is the exit criterion, not the world macro.

- [ ] **Step 2: Re-place tokens**

Fresh imports created new actor ids — scene tokens for Nahuel/Xender/Nigel are stale. In the agent client: `mcp__foundry-mcp__get-current-scene` → `mcp__foundry-mcp__delete-tokens` for the stale PC tokens → drag Nigel, Nahuel, Xender from the Actors sidebar onto the canvas (`mcp__playwright__browser_drag` from each sidebar entry to open canvas spots; snapshot first to get element refs). Verify via `get-current-scene`: all 4 PCs + at least one goblin token present (if no goblin: `mcp__foundry-mcp__create-actor-from-compendium` with `addToScene: true`).

- [ ] **Step 3: Advantage — Nigel attacks, spends a point, keeps the higher roll**

1. Target a goblin + fire an attack: `mcp__foundry-mcp__use-item` `{actorIdentifier: "Nigel", itemIdentifier: <an attack cantrip/weapon from get-character, e.g. a damage cantrip>, targets: [<goblin tokenId>]}` (add `activityId` if a picker would pop — multi-activity landmine).
2. The MidiQoL optional-bonus prompt ("Lucky") appears — click it in the agent client (`browser_snapshot` → find the Lucky button → `browser_click`).
3. Verify via `mcp__foundry-mcp__read-chat-messages` `{limit: 5}`: a reroll happened, the kept result is the higher one.
4. Verify the counter: `get-character-entity` Nigel/Lucky → `uses` spent went 0→1.

- [ ] **Step 4: Disadvantage — goblin attacks Nigel, dialog fires from the ItemMacro**

1. `mcp__foundry-mcp__use-item` `{actorIdentifier: <goblin>, tokenId: <goblin tokenId>, activityId: <base attack from get-character-entity>, targets: [<Nigel tokenId>]}`.
2. The DialogV2 "Lucky — spend 1 Luck Point to impose Disadvantage?" pops in the agent client → click **Yes**.
3. `read-chat-messages`: the attack rolled with disadvantage (2d20kl / "DIS" marker). Counter 1→2 spent.
4. This step passing = the spec's flagged risk (ItemMacro rewrite on target-side actor-flag aggregation) is CONFIRMED resolved. If the dialog never fires: check the agent-client console for a midi macro-resolution warning; fallback per spec = switch the enricher's `onUseMacroChanges` entry to `{macroPass: "isPreAttacked", functionCall: "DDBImporter.lib.DDBMacros.macroFunction.feat(\"lucky2024Disadvantage.js\")"}`-style world-macro/function pointer — but investigate the rewrite first and record findings.

- [ ] **Step 5: Exhaustion edge + restore**

1. With 2/2 spent, repeat a goblin attack on Nigel: NO dialog (out of points).
2. Restore: `mcp__foundry-mcp__update-actor-item` `{actorIdentifier: "Nigel", itemIdentifier: "Lucky", updates: {"system.uses.spent": 0}}`.
3. Record PASS/FAIL lines in the scratch file.

- [ ] **Step 6: Magic Missile functional — BG3 picker + auto-distribute (spec's WS1 functional check for MM)**

1. Target ONE goblin, then `mcp__foundry-mcp__use-item` `{actorIdentifier: "Nigel", itemIdentifier: "Magic Missile", targets: [<goblin tokenId>]}` → dnd5e level dialog (cast at 1) → the on-canvas BG3 picker appears at exactly **3 darts** with count badges (Argon stacking picker reads the CPR item's `flags.enhancedcombathud.stackTargets` — C6 must be green).
2. In the agent client, click the goblin 3× in the picker → fire → `read-chat-messages`: 3 dart damage rolls against that goblin; a level-1 slot consumed.
3. Auto-distribute spot-check (CPR fix): pre-target 3 goblin tokens (if fewer on scene, skip and note) → cast MM at level 1 → no picker, one dart each.
4. Record PASS/FAIL.

---

### Task 9: Portent + Protection functional verification (absorbs the standing "#1 NEXT" live-test)

**Files:** none (live verification).

**Interfaces:**
- Consumes: Nahuel + Xender freshly imported with GPS/CPR premades (Tasks 3-4), tokens placed (Task 8 Step 2).
- Produces: the pending Portent/Protection live-test evidence, in the scratch file.

- [ ] **Step 1: Portent — long rest, then substitute a die**

1. Long rest Nahuel: `mcp__playwright__browser_evaluate` → `async () => { const r = await game.actors.getName("Nahuel").longRest({ dialog: false, chat: true }); return !!r; }` (GPS hooks the rest to roll + store the 2 portent d20s — a GPS chat card/dialog may appear; snapshot and handle).
2. Confirm the dice are stored: `mcp__foundry-mcp__list-actor-effects` `{actorIdentifier: "Nahuel"}` and/or `read-chat-messages` — expect a GPS Portent effect/card naming two d20 values. Record them.
3. Trigger a substitution: goblin attacks Xender (visible to Nahuel) via `use-item` as in Task 8 Step 4 — the GPS Portent prompt should offer Nahuel's stored dice in the agent client → accept one → `read-chat-messages`: the attack's d20 equals the substituted portent value, and the stored-dice pool decremented.
4. If no prompt fires, check GPS's Portent requirements before debugging code (combat active? visibility? GPS setting scope) — `mcp__foundry-mcp__begin-combat` with the two tokens and retry once inside combat.

- [ ] **Step 2: Protection — adjacent ally attacked, reaction imposes disadvantage**

1. Adjacency: `mcp__foundry-mcp__move-token` Xender next to Warpey (≤5 ft). Confirm Xender's shield is equipped (`get-character-entity` Xender/Shield → `system.equipped: true`; if not, `update-actor-item` to equip).
2. Goblin attacks **Warpey** via `use-item` (targets Warpey's tokenId).
3. CPR's Protection reaction prompt appears (Xender's reaction) in the agent client → accept → `read-chat-messages`: attack has disadvantage; Xender's reaction is consumed (check via `list-actor-effects` Xender — a reaction-used marker effect).
4. Record PASS/FAIL. If no prompt: CPR Protection is macro-driven via `flags.chris-premades` — confirm B1/B2 flags on the fresh import first, then check combat state (CPR reactions typically need an active combat — reuse Step 1's combat), then the agent-client console.
5. `mcp__foundry-mcp__end-combat` + restore token positions if moved.

---

### Task 10: Durability + regression sweep

**Files:** none (live verification).

**Interfaces:**
- Consumes: everything above green.
- Produces: the actual acceptance evidence — automation surviving the real-world re-import path — plus the quirk-fix regression check.

- [ ] **Step 1: Update-mode re-import (the real-world flow) on Nigel**

1. `mcp__foundry-mcp__ddb-import-character` `{actorIdentifier: "Nigel"}` (re-import mode — REWRITES the PC; that's the point). Poll `get-character` until stable.
2. Re-run Task 7's C1-C6 asserts verbatim. ALL must still pass — this is the plan's core acceptance: the automation now survives a re-import with zero hand-fixing.

- [ ] **Step 2: Warpey regression (quirk fixes intact through the new pipeline)**

1. Delete + fresh-import Warpey (id from scratch file, same loop as Task 3 Step 2).
2. Asserts (from the spec + `project_ddb_quirk_fixes.md`), via `get-character-entity` / `search-character-items`:
   - Hunter's Mark present and castable (quirk fix #2 shape — Favored Enemy carries no junk damage activity).
   - Longstrider count is exactly the post-dedup expected count (spec: **two** entries — the legitimate pair, not the pre-fix triple; if the live count differs from the spec's "two", verify against `search-character-items` before calling it a failure and record what you found).
   - Free-cast spells (`method` quirk, fix #5) unchanged.
3. Record PASS/FAIL.

- [ ] **Step 3: Party-wide collateral inventory**

Run the Task 4 Step 3 `chrisEffectsApplied` inventory snippet for all 4 PCs; append the four lists to the scratch file. This is the baseline for future "a premade misbehaves at the table" triage (per-item opt-out flag is the remedy).

---

### Task 11: Docs + wrap

**Files:**
- Modify: `docs/superpowers/specs/2026-07-02-reimport-durable-automation-design.md:3` (status line)
- Modify: same file, end (rollout note)

**Interfaces:**
- Consumes: the scratch evidence file (summarize, don't paste wholesale).

- [ ] **Step 1: Update the spec status + add the rollout runbook note**

Change line 3's `**Status: PARKED**` clause to `**Status: IMPLEMENTED <today's date>** — see docs/superpowers/plans/2026-07-02-reimport-durable-automation.md; verification evidence summarized below.` Append at the end of the spec:

```markdown
## Rollout (real campaign world)

Per-world/per-user config only — no code. In the campaign world, for EVERY user who runs imports:
enable `character-update-policy-use-chris-premades` + `character-update-policy-add-midi-effects`
(both player-scoped; the import-window checkboxes set them), and set `no-item-macros = false`,
`embed-macros = true` (scopes as recorded at implementation). Then re-import each PC once.
The `LuckyDisadvantage` world macro is retired (the feat is self-contained); do not recreate it.
```

Also fill in a 5-10 line verification-evidence summary (which asserts ran, dates, any contingency taken) in place of "verification evidence summarized below" being a dangling promise.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-07-02-reimport-durable-automation-design.md
git commit -m "docs: mark re-import-durability spec implemented; add rollout runbook note"
```

- [ ] **Step 3: Finish the branch**

Use superpowers:finishing-a-development-branch — merge `feat/reimport-durable-automation` into `fix/import-quirks` (or as Vittorio prefers), push. Then run the sync-project-state skill (memory: close `project_reimport_clobber_open_problem.md`, update `project_v13_custom_features.md` Portent/Protection live-test status, CLAUDE.md Current focus).

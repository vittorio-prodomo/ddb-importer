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

// T61 — don't offer when the attack is ALREADY at disadvantage: the point would buy nothing.
// Under 2024 rules a roll has disadvantage or it doesn't, "no matter how many instances", and a
// roll where advantage and disadvantage already cancel stays cancelled if we add another
// disadvantage. Both cases are pointless, so the gate is simply "is disadvantage effective now".
// At isPreAttacked midi has NOT computed the tracker yet, so compute it here: checkAttackAdvantage()
// resets the tracker first and is explicitly built to be re-called (Workflow.ts:3698-3700), its body
// is mutation-free, and midi calls it again after this pass — which is what makes the
// workflowOptions.disadvantage set below still land.
// wf.disadvantage is the tracker's COMPUTED state (hasDisadvantage -> disadvantage.isActive), true
// only when a source is active AND unsuppressed — deliberately not the raw isAdded flag.
await wf.checkAttackAdvantage();
if (wf.disadvantage) return;

const esc = foundry.utils.escapeHTML;
const attacker = wf.actor?.name ?? "the attacker";
const weapon = wf.item?.name ?? null;
// T212 (2026-09-01): the prompt says WHAT is attacking, and EXPIRES after 30 s
// with no Luck Point spent (a dismissed dialog spends nothing either).
const TIMEOUT_MS = 30000;
// GPS's title-bar countdown (game.gps.attachCountdownChrome, our fork) when present;
// otherwise a text countdown. Either way the dialog closes itself on expiry, and a
// self-close reads as "no" (nothing spent) while a real X/Escape reads as "no" too.
const gpsChrome = typeof game.gps?.attachCountdownChrome === "function";
let dispose = null;
const why = weapon
  ? `<p><b>${esc(attacker)}</b> is attacking you with <b>${esc(weapon)}</b>.</p>`
  : `<p><b>${esc(attacker)}</b> is attacking you.</p>`;
const timeoutLine = gpsChrome
  ? `<p class="hint">If the time in the title bar runs out, no Luck Point is spent.</p>`
  : `<p class="hint">No answer within <span class="lucky-countdown">${Math.round(TIMEOUT_MS / 1000)}</span> s: no Luck Point is spent.</p>`;
const result = await foundry.applications.api.DialogV2.wait({
  window: { title: "Lucky" },
  content:
    why +
    `<p><b>${esc(me.name)}</b>: spend 1 Luck Point to impose <b>Disadvantage</b> on ` +
    `${esc(attacker)}'s attack roll?</p><p><i>${remaining} Luck Point(s) remaining.</i></p>` +
    timeoutLine,
  buttons: [
    { action: "yes", icon: "fa-solid fa-clover", label: "Spend a Luck Point — Disadvantage" },
    { action: "no", icon: "fa-solid fa-dice-d20", label: "Let them roll normally", default: true },
  ],
  modal: true,
  rejectClose: false,
  render: (_event, dialog) => {
    if (gpsChrome) {
      game.gps.attachCountdownChrome(dialog, { dialogTitle: "Lucky", initialTimeLeft: Math.round(TIMEOUT_MS / 1000) });
      dispose = () => game.gps.detachCountdownChrome?.(dialog);
      return;
    }
    const started = Date.now();
    const span = dialog.element?.querySelector?.(".lucky-countdown");
    const ticker = setInterval(() => {
      const left = Math.max(0, Math.ceil((TIMEOUT_MS - (Date.now() - started)) / 1000));
      if (span) span.textContent = String(left);
    }, 1000);
    const timer = setTimeout(() => dialog.close(), TIMEOUT_MS);
    dispose = () => { clearInterval(ticker); clearTimeout(timer); };
  },
  close: () => { dispose?.(); dispose = null; return "no"; },
});
dispose?.();
const ok = result === "yes";
if (!ok) return;

// Impose disadvantage on the pending attack (read by checkAttackAdvantage, post-reset).
// disadvantageReason gives the attack card a named attribution ("DIS: Lucky …") instead of
// the generic "Workflow Options"; it is honoured by our MidiQoL fork's checkAttackAdvantage
// (falls back to the generic label on stock MidiQoL, so this line is harmless there).
wf.workflowOptions = wf.workflowOptions ?? {};
wf.workflowOptions.disadvantage = true;
wf.workflowOptions.disadvantageReason = `Lucky — ${me.name} spent a Luck Point`;

// Spend one Luck Point.
await lucky.update({ "system.uses.spent": (lucky.system?.uses?.spent ?? 0) + 1 });

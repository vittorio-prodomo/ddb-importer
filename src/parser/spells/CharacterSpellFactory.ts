

import { utils, logger, CompendiumHelper } from "../../lib/_module";

// Import parsing functions
import { getSpellCastingAbility, hasSpellCastingAbility, convertSpellCastingAbilityId } from "./ability";
import DDBSpell from "./DDBSpell";
import { resolveRaceGrantingTrait, isCastActivityRacialTrait } from "./raceSpellLookup";
import { asDualPoolRowSpell, freeCastGrantStamp } from "./grantedSpellRows";
import { DICTIONARY, SETTINGS } from "../../config/_module";
import { DDBDataUtils, DDBModifiers } from "../lib/_module";
import DDBCharacter from "../DDBCharacter";

const SPELLIST_ADDITION_MATCHES = [
  "using any spell slots you have of the appropriate level",
  "using spell slots you have of the appropriate level",
  "using any spell slots you have",
];

export default class CharacterSpellFactory {

  processed = [];

  spellCounts = {};

  _generated = {
    class: [],
    feat: [],
    race: [],
    background: [],
    other: [],
  };

  _granted = {
    class: [],
    feat: [],
    race: [],
    background: [],
  };

  ddb: IDDBData;
  ddbCharacter: DDBCharacter;
  proficiencyModifier: number;
  healingBoost: number;
  levelSlots: boolean;
  pactSlots: boolean;
  hasSlots: boolean;
  generateSummons: boolean;
  character: I5ePCData;
  characterAbilities: I5eAbilities;
  slots: I5eSpellSlots;

  constructor(ddbCharacter: DDBCharacter) {
    this.ddbCharacter = ddbCharacter;
    this.ddb = ddbCharacter.source.ddb;
    this.character = ddbCharacter.raw.character;
    this.proficiencyModifier = this.character.flags.ddbimporter.dndbeyond.profBonus;
    this.characterAbilities = this.character.flags.ddbimporter.dndbeyond.effectAbilities;
    this.healingBoost = DDBModifiers
      .filterBaseModifiers(this.ddb, "bonus", { subType: "spell-group-healing" })
      .reduce((a, b) => a + parseInt(String(b.value)), 0);
    this.slots = foundry.utils.getProperty(this.character, "system.spells") as I5eSpellSlots;
    this.levelSlots = utils.arrayRange(9, 1, 1).some((i) => {
      return this.slots[`spell${i}`] && this.slots[`spell${i}`].max !== 0;
    });
    this.pactSlots = this.slots.pact?.max && parseInt(this.slots.pact.max) > 0;
    this.hasSlots = this.levelSlots || this.pactSlots;
    this.generateSummons = ddbCharacter.enableSummons;
  }

  static getDDBSpellLookup(ddb: IDDBData, type: string, id: number) {
    let lookup;

    switch (type) {
      case "race": {
        // Handles both the direct trait id and the 2024 lineage case, where the
        // spell points at the chosen lineage option instead of the trait itself.
        lookup = resolveRaceGrantingTrait(ddb, id) ?? undefined;
        break;
      }
      case "feat": {
        const match = ddb.character.feats.find((f) => {
          return f.definition.id === id;
        });
        if (match) {
          lookup = {
            id: match.definition.id,
            name: match.definition.name,
            componentId: match.componentId,
            data: match,
          };
        }
        break;
      }
      case "class": {
        const match1 = ddb.character.classes.find((c) => {
          return c.definition.id === id;
        });
        if (match1) {
          lookup = {
            id: match1.definition.id,
            name: match1.definition.name,
            data: match1,
          };
          break;
        }
        const match2 = ddb.character.classes.find((c) => {
          return c.subclassDefinition && c.subclassDefinition.id === id;
        });
        if (match2) {
          lookup = {
            id: match2.subclassDefinition.id,
            name: match2.subclassDefinition.name,
            data: match2.subclassDefinition,
          };
          break;
        }
        break;
      }
      case "classFeature": {
        for (const c of ddb.character.classes) {
          if (c.subclassDefinition && c.subclassDefinition.id === id) {
            for (const option of ddb.classOptions) {

              if (option.classId === c.subclassDefinition.id) {
                lookup = {
                  id: option.id,
                  name: option.name,
                  classId: c.subclassDefinition.id,
                  data: option,
                };
                break;
              }
            }
          }
          if (lookup) break;

          const match1 = c.classFeatures.find((f) => {
            return f.definition.id === id;
          });
          if (match1) {
            lookup = {
              id: match1.definition.id,
              name: match1.definition.name,
              classId: match1.definition.classId,
              componentId: match1.definition.componentId,
              data: match1,
            };
            break;
          }

          for (const option of ddb.classOptions) {
            if (option.classId === c.definition.id && option.id === id) {
              lookup = {
                id: option.id,
                name: option.name,
                classId: c.definition.id,
                data: option,
              };
              break;
            }
          }
        }
        if (lookup) break;
        const optionMatch = ddb.character.options.class.find((o) => {
          return o.definition.id === id;
        });
        if (optionMatch) {
          lookup = {
            id: optionMatch.definition.id,
            name: optionMatch.definition.name,
            componentId: optionMatch.componentId,
            data: optionMatch,
          };
        }
        break;
      }
      case "item": {
        const match = ddb.character.inventory.find((i) => {
          return i.definition.id === id;
        });
        if (match) {
          lookup = {
            id: match.definition.id,
            name: match.definition.name,
            limitedUse: match.limitedUse,
            equipped: match.equipped,
            isAttuned: match.isAttuned,
            canAttune: match.definition.canAttune,
            canEquip: match.definition.canEquip,
            data: match,
          };
        }
        break;
      }
      // no default
    }

    return lookup;
  }


  getLookup(type, id) {
    return CharacterSpellFactory.getDDBSpellLookup(this.ddb, type, id);
  }


  _getSpellCount(name) {
    if (!this.spellCounts[name]) {
      this.spellCounts[name] = 0;
    }
    return ++this.spellCounts[name];
  }

  async _processClassSpell({
    classInfo,
    is2014Class,
    playerClass,
    spell,
    spellCastingAbility,
    abilityModifier,
    cantripBoost,
    unPreparedCantrip = null,
  } = {}) {
    // add some data for the parsing of the spells into the data structure
    const flagData: IParseSpellFlagData = {
      ddbimporter: {
        dndbeyond: {
          lookup: "classSpell",
          class: classInfo.definition.name,
          is2014Class: classInfo.is2014Class ?? is2014Class,
          level: classInfo.level,
          characterClassId: playerClass.characterClassId,
          spellLevel: spell.definition.level,
          // spellSlots: character.system.spells,
          ability: spellCastingAbility,
          mod: abilityModifier,
          dc: 8 + this.proficiencyModifier + abilityModifier,
          cantripBoost,
          overrideDC: false,
          id: spell.id,
          entityTypeId: spell.entityTypeId,
          healingBoost: this.healingBoost,
          usesSpellSlot: spell.usesSpellSlot,
          forceMaterial: classInfo.definition.name === "Artificer",
          homebrew: spell.definition.isHomebrew,
          unPreparedCantrip,
        },
      },
      "spell-class-filter-for-5e": {
        parentClass: classInfo.definition.name.toLowerCase(),
      },
      "tidy5e-sheet": {
        parentClass: classInfo.definition.name.toLowerCase(),
      },
      // "spellbook-assistant-manager": {
      //   class: classInfo.definition.name.toLowerCase(),
      // }
    };

    // Check for duplicate spells, normally domain ones
    // We will import spells from a different class that are the same though
    // as they may come from with different spell casting mods
    const parsedSpell = await DDBSpell.parseSpell(spell, this.character, {
      ddbData: this.ddb,
      namePostfix: `${this._getSpellCount(spell.definition.name)}`,
      generateSummons: this.generateSummons,
      unPreparedCantrip,
      flagData,
    });
    foundry.utils.setProperty(parsedSpell, "system.sourceClass", DDBDataUtils.classIdentifierName(classInfo.definition.name));
    const duplicateSpell = this._generated.class.findIndex(
      (existingSpell) => {
        const existingName = (existingSpell.flags.ddbimporter.originalName ?? existingSpell.name);
        const parsedName = (parsedSpell.flags.ddbimporter.originalName ?? parsedSpell.name);
        // some spells come from different classes but end up having the same ddb id
        const classIdMatch = classInfo.definition.name === existingSpell.flags.ddbimporter.dndbeyond.class;
        const spellIdMatch = spell.id === existingSpell.flags.ddbimporter.dndbeyond.id;
        const legacyMatch = (parsedSpell.flags.ddbimporter.is2014 ?? true) === (existingSpell.flags.ddbimporter.is2014 ?? true)
          || (parsedSpell.flags.ddbimporter.is2024 ?? false) === (existingSpell.flags.ddbimporter.is2024 ?? false);
        return existingName === parsedName && (classIdMatch || spellIdMatch) && legacyMatch;
      });
    const duplicateItem = this._generated.class[duplicateSpell];
    if (!duplicateItem) {
      this._generated.class.push(parsedSpell);
    } else if (spell.alwaysPrepared || parsedSpell.system.method === "always"
      || (spell.alwaysPrepared === duplicateItem.alwaysPrepared
        && parsedSpell.system.method === duplicateItem.system.method
        && parsedSpell.system.prepared === CONFIG.DND5E.spellPreparationStates.always.value
        && duplicateItem.system.prepared === CONFIG.DND5E.spellPreparationStates.unprepared.value)) {
      // if our new spell is always known we overwrite!
      // it's probably domain
      this._generated.class[duplicateSpell] = parsedSpell;
    } else {
      // we'll emit a console message if it doesn't match this case for future debugging
      logger.info(`Duplicate Spell ${spell.definition.name} detected in class ${classInfo.definition.name}.`);
    }
  }

  // Cross-bucket dedup. A spell granted by a lineage/feat AND present on the class
  // list yields both an always-prepared slot copy and a redundant unprepared
  // class-list entry. This can't be decided inside _processClassSpell: that runs
  // during generateClassSpells(), BEFORE the race/feat grants exist, so the
  // non-class buckets are still empty there. Run it here, once every bucket is
  // populated, dropping the redundant unprepared class copy when an always-prepared
  // slot copy exists in another bucket. The slot copy can live in _generated
  // (synthesized Gr copy from handleGrantedSpells) OR in _granted: when DDB exports
  // the always-prepared copy as its own second race/feat entry (e.g. 2024 Wood Elf
  // Longstrider), the length===1 gate skips Gr-synthesis and only the natural
  // _granted entry exists — so both collections must be scanned.
  _dedupRedundantClassSpells() {
    const alwaysValue = CONFIG.DND5E.spellPreparationStates.always.value;
    const unpreparedValue = CONFIG.DND5E.spellPreparationStates.unprepared.value;

    const hasAlwaysPreparedSlotCopy = (target) => {
      const targetName = target.flags.ddbimporter.originalName ?? target.name;
      return [...Object.values(this._generated), ...Object.values(this._granted)].some((spells) =>
        Array.isArray(spells)
        && spells.some((other) => {
          if (other === target) return false;
          const otherName = other.flags.ddbimporter.originalName ?? other.name;
          const legacyMatch = (target.flags.ddbimporter.is2014 ?? true) === (other.flags.ddbimporter.is2014 ?? true);
          return otherName === targetName
            && legacyMatch
            && other.system.method === "spell"
            && other.system.prepared === alwaysValue;
        }),
      );
    };

    this._generated.class = this._generated.class.filter((spell) => {
      const redundant = spell.system.method === "spell"
        && spell.system.prepared === unpreparedValue
        && hasAlwaysPreparedSlotCopy(spell);
      if (redundant) {
        const name = spell.flags.ddbimporter.originalName ?? spell.name;
        logger.debug(`Removing redundant unprepared class spell ${name}: an always-prepared slot copy exists from another source.`);
      }
      return !redundant;
    });
  }

  filterSpellsByAllowedCategories(spells) {
    return spells.filter((s) => {
      const sourceIds = s.definition.sources.map((sm) => sm.sourceId);
      const hasActiveCategory = CONFIG.DDB.sources.some((ddbSource) =>
        sourceIds.includes(ddbSource.id)
        && this.ddb.character.activeSourceCategories.includes(ddbSource.sourceCategoryId),
      );
      return hasActiveCategory;
    });
  }


  removeSpellsBySourceCategoryIds(spells, ids = []) {
    return spells.filter((s) => {
      const sourceIds = s.definition.sources.map((sm) => sm.sourceId);
      const isInRestrictedCategory = CONFIG.DDB.sources.some((ddbSource) =>
        sourceIds.includes(ddbSource.id)
        && ids.includes(ddbSource.sourceCategoryId),
      );
      return !isInRestrictedCategory;
    });
  }

  async generateClassSpells() {
    for (const playerClass of this.ddb.character.classSpells) {
      const classInfo = this.ddb.character.classes.find((cls) => cls.id === playerClass.characterClassId);
      const spellCastingAbility = getSpellCastingAbility(classInfo);
      const abilityModifier = utils.calculateModifier(this.characterAbilities[spellCastingAbility].value);

      const is2014Class = classInfo.definition.sources.some((s) => Number.isInteger(s.sourceId) && s.sourceId < 145);
      const is2024NewKnownCaster = ["Ranger", "Paladin"].includes(classInfo.definition.name);
      if (!is2014Class && is2024NewKnownCaster) {
        playerClass.spells = playerClass.spells.map((spell) => {
          if (!spell.alwaysPrepared && spell.countsAsKnownSpell) spell.prepared = true;
          return spell;
        });
      }
      logger.debug("Spell parsing, class info", classInfo);

      const cantripBoost
        = DDBModifiers.getChosenClassModifiers(this.ddb).filter(
          (mod) =>
            mod.type === "bonus"
            && mod.subType === `${classInfo.definition.name.toLowerCase()}-cantrip-damage`
            && (mod.restriction === null || mod.restriction === ""),
        ).length > 0;

      const rawSpells = [
        ...playerClass.spells,
        ...(playerClass.alwaysPreparedSpells ?? []),
      ];
      if (game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-import-full-spell-list")) {
        const knownSpells = playerClass.alwaysKnownSpells ?? [];
        const filteredAlwaysKnownSpells = game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-use-active-sources")
          ? this.filterSpellsByAllowedCategories(knownSpells)
          : knownSpells;
        rawSpells.push(...filteredAlwaysKnownSpells);
      }

      const removeIds = [];

      if (game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-remove-2024"))
        removeIds.push(24);

      if (game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-remove-legacy"))
        removeIds.push(23, 26);

      const targetSpells = removeIds.length > 0
        ? this.removeSpellsBySourceCategoryIds(rawSpells, removeIds)
        : rawSpells;

      for (const spell of targetSpells) {
        if (!spell.definition) continue;
        await this._processClassSpell({
          classInfo,
          is2014Class,
          playerClass,
          spell,
          spellCastingAbility,
          abilityModifier,
          cantripBoost,
        });
      }
    }
  }

  async generateUnpreparedCantrips() {
    for (const playerClass of this.ddb.character.classSpells) {
      if (!playerClass.cantrips) continue;
      if (playerClass.cantrips.length === 0) continue;
      if (!game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-import-all-cantrips")) continue;

      const classInfo = this.ddb.character.classes.find((cls) => cls.id === playerClass.characterClassId);
      const spellCastingAbility = getSpellCastingAbility(classInfo);
      const abilityModifier = utils.calculateModifier(this.characterAbilities[spellCastingAbility].value);

      const is2014Class = classInfo.definition.sources.some((s) => Number.isInteger(s.sourceId) && s.sourceId < 145);
      const is2024NewKnownCaster = ["Ranger", "Paladin"].includes(classInfo.definition.name);
      if (!is2014Class && is2024NewKnownCaster) {
        playerClass.spells = playerClass.spells.map((spell) => {
          if (!spell.alwaysPrepared && spell.countsAsKnownSpell) spell.prepared = true;
          return spell;
        });
      }
      logger.debug("Spell parsing, class info", classInfo);

      const cantripBoost
        = DDBModifiers.getChosenClassModifiers(this.ddb).filter(
          (mod) =>
            mod.type === "bonus"
            && mod.subType === `${classInfo.definition.name.toLowerCase()}-cantrip-damage`
            && (mod.restriction === null || mod.restriction === ""),
        ).length > 0;

      const allCantrips = (playerClass.cantrips ?? []).map((cantrip) => {
        cantrip.unPreparedCantrip = true;
        return cantrip;
      });

      const filteredCantrips = game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-use-active-sources")
        ? this.filterSpellsByAllowedCategories(allCantrips)
        : allCantrips;

      const removeIds = [];

      if (game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-remove-2024"))
        removeIds.push(24);

      if (game.settings.get(SETTINGS.MODULE_ID, "character-update-policy-remove-legacy"))
        removeIds.push(23, 26);

      const targetSpells = removeIds.length > 0
        ? this.removeSpellsBySourceCategoryIds(filteredCantrips, removeIds)
        : filteredCantrips;

      for (const spell of targetSpells) {
        if (!spell.definition) continue;
        await this._processClassSpell({
          classInfo,
          is2014Class,
          playerClass,
          spell,
          spellCastingAbility,
          abilityModifier,
          cantripBoost,
          unPreparedCantrip: spell.unPreparedCantrip ?? null,
        });
      }
    }
  }


  async generateSpecialClassSpells() {
    for (const spell of this.ddb.character.spells.class) {
      if (!spell.definition) continue;

      // Skip feature-granted class spells the character already knows in their spellbook.
      // 2024 wizard "[School] Savant" features "add spells to your spellbook for free":
      // DDB lists those spells BOTH in classSpells (as known, prepared spellbook spells)
      // AND redundantly here as feature-granted, where the block below force-marks them
      // always-prepared (see ~40 lines down) — contradicting RAW. generateClassSpells has
      // already imported the authoritative spellbook copy (prepared normally), so drop
      // this redundant copy.
      //
      // ⚠️ Discriminate on the grant's own alwaysPrepared flag, NOT on
      // countsAsKnownSpell alone. A spell can be BOTH always-prepared by a feature
      // AND on the class's known list — 2024 Paladin's Smite grants Divine Smite
      // (alwaysPrepared: true) while every Paladin also knows it. Skipping those
      // threw the always-prepared marking away and left the spellbook copy merely
      // "prepared", so it silently consumed one of the character's prepared spells.
      // Savant spells, the case this skip exists for, report alwaysPrepared: false.
      const knownInSpellbook = !spell.alwaysPrepared
        && this.ddb.character.classSpells.some((cls) =>
          cls.spells?.some((known) =>
            known.definition?.id === spell.definition.id && known.countsAsKnownSpell),
        );
      if (knownInSpellbook) {
        logger.debug(`Skipping feature-granted ${spell.definition.name}: already a known spellbook spell; keeping the prepared spellbook copy.`);
        continue;
      }

      // If the spell has an ability attached, use that
      let spellCastingAbility;
      const featureId = DDBDataUtils.determineActualFeatureId(this.ddb, spell.componentId);
      const classInfo = this.getLookup("classFeature", featureId);

      logger.debug("Class spell parsing, class info", classInfo);
      // Sometimes there are spells here which don't have an class Info
      // this seems to be part of the optional tasha's rules, lets not parse for now
      // as ddb implementation is not yet finished
      // / options.class.[].definition.id
      if (!classInfo) {
        logger.warn(`Unable to add ${spell.definition.name}`);
      }
      if (!classInfo) continue;
      let klass = DDBDataUtils.getClassFromOptionID(this.ddb, spell.componentId);

      if (!klass) klass = DDBDataUtils.findClassByFeatureId(this.ddb, spell.componentId);

      logger.debug("Class spell, class found?", klass);

      if (DICTIONARY.parsing.featureSpellsIgnore.includes(classInfo.name)) {
        logger.debug(`Skipping ${spell.definition.name} for ${classInfo.name} as included in feature`);
        continue;
      }

      const featureName = classInfo.data?.definition?.name ?? classInfo.data?.name;
      if (featureName && DICTIONARY.parsing.ignoreSpellsGrantedByClassFeatures.includes(featureName)) {
        logger.debug(`Skipping ${spell.definition.name} for ${classInfo.name} as included in feature ignore list`, {
          featureName,
          classInfo,
        });
        continue;
      }

      if (hasSpellCastingAbility(spell.spellCastingAbilityId)) {
        spellCastingAbility = convertSpellCastingAbilityId(spell.spellCastingAbilityId);
      } else if (klass) {
        spellCastingAbility = getSpellCastingAbility(klass);
        // force these spells to always be prepared
        spell.alwaysPrepared = true;
      } else {
        // if there is no ability on spell, we default to wis
        spellCastingAbility = "wis";
      }

      if (!spell.alwaysPrepared && !spell.prepared && !spell.countsAsKnownSpell && spell.usesSpellSlot
        && !spell.limitedUse
      ) {
        spell.alwaysPrepared = true;
      }

      const abilityModifier = utils.calculateModifier(this.characterAbilities[spellCastingAbility].value);

      const klassName = klass?.definition?.name;
      const cantripBoost
        = DDBModifiers.getChosenClassModifiers(this.ddb).filter(
          (mod) =>
            mod.type === "bonus"
            && mod.subType === `${klassName.toLowerCase()}-cantrip-damage`
            && (mod.restriction === null || mod.restriction === ""),
        ).length > 0;

      // add some data for the parsing of the spells into the data structure
      const flagData: IParseSpellFlagData = {
        ddbimporter: {
          dndbeyond: {
            class: klassName,
            lookup: "classFeature",
            lookupName: classInfo.name,
            lookupId: classInfo.id,
            level: this.character.flags.ddbimporter.dndbeyond.totalLevels,
            ability: spellCastingAbility,
            mod: abilityModifier,
            dc: 8 + this.proficiencyModifier + abilityModifier,
            overrideDC: false,
            id: spell.id,
            entityTypeId: spell.entityTypeId,
            healingBoost: this.healingBoost,
            cantripBoost,
            usesSpellSlot: spell.usesSpellSlot,
            forceMaterial: klass?.definition?.name === "Artificer",
            homebrew: spell.definition.isHomebrew,
            forcePact: klass?.definition?.name === "Warlock",
          },
        },
        "tidy5e-sheet": {
          parentClass: (klass) ? klass.definition.name : undefined,
        },
      };

      // Check for duplicate spells, normally domain ones
      // We will import spells from a different class that are the same though
      // as they may come from with different spell casting mods
      const duplicateSpell = klass
        ? this._generated.class.findIndex((existingSpell) =>
          (existingSpell.flags.ddbimporter.originalName ?? existingSpell.name) === spell.definition.name
          && klass.definition.name === existingSpell.flags.ddbimporter.dndbeyond.class
          && spell.usesSpellSlot && existingSpell.flags.ddbimporter.dndbeyond.usesSpellSlot,
        )
        : -1;
      if (!this._generated.class[duplicateSpell]) {
        const parsedSpell = await DDBSpell.parseSpell(spell, this.character, {
          ddbData: this.ddb,
          namePostfix: `${this._getSpellCount(spell.definition.name)}`,
          generateSummons: this.generateSummons,
          flagData,
        });
        if (flagData.ddbimporter.dndbeyond.class) foundry.utils.setProperty(parsedSpell, "system.sourceClass", DDBDataUtils.classIdentifierName(flagData.ddbimporter.dndbeyond.class));
        this._granted.class.push(parsedSpell);

        // check for class granted spells here
        if (parsedSpell.flags.ddbimporter.is2024
          && CharacterSpellFactory.CLASS_GRANTED_SPELLS_2024.includes(parsedSpell.flags.ddbimporter.originalName)
        ) {
          await this.handleGrantedSpells(spell, "class", flagData, {
            forceCopy: true,
            flags: {
              lookup: "classFeature",
            },
          });
        }

      } else if (spell.alwaysPrepared) {
        // if our new spell is always known we overwrite!
        // it's probably domain
        const parsedSpell = await DDBSpell.parseSpell(spell, this.character, {
          ddbData: this.ddb,
          namePostfix: `${this._getSpellCount(spell.definition.name)}`,
          generateSummons: this.generateSummons,
        });
        if (flagData.ddbimporter.dndbeyond.class)
          foundry.utils.setProperty(parsedSpell, "system.sourceClass", DDBDataUtils.classIdentifierName(flagData.ddbimporter.dndbeyond.class));
        this._generated.class[duplicateSpell] = parsedSpell;
      } else {
        // we'll emit a console message if it doesn't match this case for future debugging
        logger.info(`Duplicate Spell ${spell.definition.name} detected in class ${classInfo.name}.`);
      }
    }
  }

  static CLASS_GRANTED_SPELLS_2024 = [
    "Hunter's Mark",
  ];

  canCast(spell: IDDBSpellEntry) {
    if (spell.limitedUse || spell.definition.level === 0) return true;
    if (!this.slots) return false;
    if (this.pactSlots) return true;
    const levelSlots = utils.arrayRange(9, 1, 1).some((i) => {
      if (spell.definition.level > i) return false;
      return this.slots[`spell${i}`] && this.slots[`spell${i}`].max !== 0;
    });
    return levelSlots;
  }

  async handleGrantedSpells(spell: IDDBSpellEntry, type: string, flagData: IParseSpellFlagData, { forceCopy = false, flags = {} } = {}) {
    if (spell.definition.level === 0) return;
    if (!forceCopy && !spell.limitedUse) return;
    if (!forceCopy && !this.slots) return;
    const levelSlots = utils.arrayRange(9, 1, 1).some((i) => {
      if (spell.definition.level > i) return false;
      return this.slots[`spell${i}`] && this.slots[`spell${i}`].max !== 0;
    });

    if (!levelSlots && !this.pactSlots) return;

    const dups = this.ddb.character.spells[type].filter((otherSpell) =>
      otherSpell.definition
      && otherSpell.definition.name === spell.definition.name).length > 1;

    if (dups) {
      for (const spells of Object.values(this._generated)) {
        const duplicateSpell = spells.some(
          (existingSpell) =>
            (existingSpell.flags.ddbimporter.originalName ?? existingSpell.name) === spell.definition.name
            && existingSpell.flags.ddbimporter.dndbeyond.usesSpellSlot,
        );
        if (duplicateSpell) {
          logger.debug(`Skipping duplicate granted spell ${spell.definition.name} as multiple instances exist`);
          return;
        }
      }
    }

    // also parse spell as non-limited use
    const unlimitedSpell = foundry.utils.duplicate(spell) as IDDBSpellEntry;
    const unlimitedFlags = foundry.utils.deepClone(flagData) as IParseSpellFlagData;
    unlimitedSpell.limitedUse = null;
    unlimitedSpell.usesSpellSlot = true;
    unlimitedSpell.alwaysPrepared = true;
    unlimitedFlags.ddbimporter.dndbeyond.usesSpellSlot = true;
    unlimitedFlags.ddbimporter.dndbeyond.granted = true;
    unlimitedFlags.ddbimporter.dndbeyond.lookup = flags.lookup ?? type;
    delete unlimitedSpell.id;
    delete unlimitedFlags.ddbimporter.dndbeyond.id;
    const parsedSpell = await DDBSpell.parseSpell(unlimitedSpell, this.character, {
      ddbData: this.ddb,
      namePrefix: `Gr`,
      namePostfix: `${this._getSpellCount(unlimitedSpell.definition.name)}`,
      generateSummons: this.generateSummons,
      flagData: unlimitedFlags,
    });

    if (parsedSpell.system.source.rules === "2014"
      && DICTIONARY.parsing.spellListGrantsIgnore["2014"].some((i) => unlimitedFlags.ddbimporter.dndbeyond.lookupName.includes(i))
    ) {
      logger.debug(`Ignoring 2014 granted spell as not a spell list grant ${parsedSpell.flags.ddbimporter.originalName}`);
      return;
    }
    this._generated[type].push(parsedSpell);
  }

  async generateRaceSpells() {
    for (const spell of this.ddb.character.spells.race) {
      if (!spell.definition) continue;
      // for race spells the spell spellCastingAbilityId is on the spell
      // if there is no ability on spell, we default to wis
      let spellCastingAbility = "wis";
      if (hasSpellCastingAbility(spell.spellCastingAbilityId)) {
        spellCastingAbility = convertSpellCastingAbilityId(spell.spellCastingAbilityId);
      }

      const abilityModifier = utils.calculateModifier(this.characterAbilities[spellCastingAbility].value);

      let raceInfo = this.getLookup("race", spell.componentId);

      if (!raceInfo) {
        // for some reason we haven't matched the race option id with the spell
        // this happens with at least the SCAG optional spells casting half elf
        raceInfo = {
          name: "Racial spell",
          id: spell.componentId,
        };
      }

      // ⚠️ Cantrips are NOT skipped (2026-08-31). The Lineage enricher no longer
      // emits a Cast activity for them, precisely so they arrive here and become
      // ordinary always-prepared cantrip rows — a cached row can never appear
      // under "Cantrips", since `_prepareSpellbook` pins anything carrying
      // `flags.dnd5e.cachedFor` into the "Additional Spells" section regardless
      // of level. Levelled grants still belong to the enricher.
      // ⚠️ A levelled grant with a FREE CAST is no longer skipped either
      // (2026-09-01). Same reasoning as the cantrips above, one step further: a
      // cached row can never leave "Additional Spells", so an off-list grant like
      // Nahuel's Faerie Fire has to become a real row to sit with its own level.
      // Its free cast is not lost — `_reconcileClassListGrants` stamps the row for
      // the dual-pool shape and removes the feature's Cast activity, so the pool
      // moves onto the spell instead of vanishing with the activity.
      if (spell.definition.level !== 0
        && !freeCastGrantStamp(spell, raceInfo.name)
        && isCastActivityRacialTrait(raceInfo.name)) {
        logger.debug(`Skipping ${spell.definition.name} for ${raceInfo.name}: the Lineage enricher grants it as a Cast activity`);
        continue;
      }

      // add some data for the parsing of the spells into the data structure
      const flagData: IParseSpellFlagData = {
        ddbimporter: {
          dndbeyond: {
            lookup: "race",
            lookupName: raceInfo.name,
            lookupId: raceInfo.id,
            race: this.ddb.character.race.fullName,
            level: spell.castAtLevel,
            ability: spellCastingAbility,
            mod: abilityModifier,
            dc: 8 + this.proficiencyModifier + abilityModifier,
            overrideDC: false,
            id: spell.id,
            entityTypeId: spell.entityTypeId,
            healingBoost: this.healingBoost,
            usesSpellSlot: spell.usesSpellSlot,
            homebrew: spell.definition.isHomebrew,
          },
        },
      };

      // ⚠️ A dual-pool grant gets ONE row and builds it itself. Skipping
      // `handleGrantedSpells` here is load-bearing: it would add the slot-castable
      // twin on top of the innate row this loop parses, which is two rows for one
      // spell. Parsing the unlimited variant instead makes that single row the
      // slot-castable one; the free cast returns as a pool + forward activity.
      const raceGrantStamp = freeCastGrantStamp(spell, raceInfo.name);
      if (raceGrantStamp) {
        flagData.ddbimporter.dndbeyond.usesSpellSlot = true;
      } else if (this.ddb.character.spells.race.filter((sp) =>
        sp.definition
        && sp.definition.name === spell.definition.name).length === 1
      ) {
        await this.handleGrantedSpells(spell, "race", flagData);
      }
      if (!this.canCast(spell)) continue;
      const parsedSpell = await DDBSpell.parseSpell(raceGrantStamp ? asDualPoolRowSpell(spell) : spell, this.character, {
        ddbData: this.ddb,
        namePostfix: `${this._getSpellCount(spell.definition.name)}`,
        generateSummons: this.generateSummons,
        flagData,
      });
      // this._generated.race.push(parsedSpell);
      this._granted.race.push(parsedSpell);
    }
  }

  async generateFeatSpells() {
    for (const spell of this.ddb.character.spells.feat) {
      if (!spell.definition) continue;
      // If the spell has an ability attached, use that
      // if there is no ability on spell, we default to wis
      let spellCastingAbility = "wis";
      if (hasSpellCastingAbility(spell.spellCastingAbilityId)) {
        spellCastingAbility = convertSpellCastingAbilityId(spell.spellCastingAbilityId);
      }

      const abilityModifier = utils.calculateModifier(this.characterAbilities[spellCastingAbility].value);

      let featInfo = this.getLookup("feat", spell.componentId);

      if (!featInfo) {
        // for some reason we haven't matched the feat option id with the spell
        // we fiddle the result
        featInfo = {
          name: "Feat option spell",
          id: spell.componentId,
        };
      }

      const featName = featInfo.data?.definition?.name ?? featInfo.data?.name;
      // Cantrips bypass the ignore list for the same reason as the lineage path
      // above: their Cast activity is gone, so this is the only way they reach
      // the sheet — and as a real row they sort under "Cantrips".
      // ⚠️ A levelled grant with a FREE CAST bypasses the ignore list too — see the
      // lineage path above. Magic Initiate's levelled pick (Nigel's Healing Word,
      // Victus's Shield) becomes a real row and carries its own pool.
      if (featName
        && spell.definition.level !== 0
        && !freeCastGrantStamp(spell, featName)
        && DICTIONARY.parsing.ignoreSpellsGrantedByFeats.includes(featName)) {
        logger.debug(`Skipping ${spell.definition.name} for ${featInfo.name} as included in feature ignore list`, {
          featName,
          featInfo,
        });
        continue;
      }

      // add some data for the parsing of the spells into the data structure
      const flagData: IParseSpellFlagData = {
        ddbimporter: {
          dndbeyond: {
            lookup: "feat",
            lookupName: featInfo.name,
            lookupId: featInfo.id,
            level: spell.castAtLevel,
            ability: spellCastingAbility,
            mod: abilityModifier,
            dc: 8 + this.proficiencyModifier + abilityModifier,
            overrideDC: false,
            id: spell.id,
            entityTypeId: spell.entityTypeId,
            healingBoost: this.healingBoost,
            usesSpellSlot: spell.usesSpellSlot,
            homebrew: spell.definition.isHomebrew,
          },
        },
      };

      // See the lineage path: a dual-pool grant gets exactly one, slot-castable row.
      const featGrantStamp = freeCastGrantStamp(spell, featName);
      if (featGrantStamp) {
        flagData.ddbimporter.dndbeyond.usesSpellSlot = true;
      } else if (this.ddb.character.spells.feat.filter((sp) =>
        sp.definition
        && sp.definition.name === spell.definition.name).length === 1
      ) {
        const forceCopy = SPELLIST_ADDITION_MATCHES.some((t) => (featInfo.data?.definition.description ?? "").toLowerCase().includes(t));
        if (forceCopy) {
          await this.handleGrantedSpells(spell, "feat", flagData, {
            forceCopy,
          });
        }
      }
      if (!this.canCast(spell)) continue;
      const parsedSpell = await DDBSpell.parseSpell(featGrantStamp ? asDualPoolRowSpell(spell) : spell, this.character, {
        ddbData: this.ddb,
        namePostfix: `${this._getSpellCount(spell.definition.name)}`,
        generateSummons: this.generateSummons,
        flagData,
      });
      // if (spell.definition.level === 0) {
      //   this._generated.feat.push(parsedSpell);
      // } else {
      //   this._granted.feat.push(parsedSpell);
      // }
      this._granted.feat.push(parsedSpell);
    }
  }

  async generateBackgroundSpells() {
    if (!this.ddb.character.spells.background) this.ddb.character.spells.background = [];
    for (const spell of this.ddb.character.spells.background) {
      if (!spell.definition) continue;
      // If the spell has an ability attached, use that
      // if there is no ability on spell, we default to wis
      let spellCastingAbility = "wis";
      if (hasSpellCastingAbility(spell.spellCastingAbilityId)) {
        spellCastingAbility = convertSpellCastingAbilityId(spell.spellCastingAbilityId);
      }

      const abilityModifier = utils.calculateModifier(this.characterAbilities[spellCastingAbility].value);

      // add some data for the parsing of the spells into the data structure
      const flagData: IParseSpellFlagData = {
        ddbimporter: {
          dndbeyond: {
            lookup: "background",
            lookupName: "Background",
            level: spell.castAtLevel,
            ability: spellCastingAbility,
            mod: abilityModifier,
            dc: 8 + this.proficiencyModifier + abilityModifier,
            overrideDC: false,
            id: spell.id,
            entityTypeId: spell.entityTypeId,
            healingBoost: this.healingBoost,
            usesSpellSlot: spell.usesSpellSlot,
            homebrew: spell.definition.isHomebrew,
          },
        },
      };

      if (this.ddb.character.spells.background.filter((sp) => sp.definition
        && sp.definition.name === spell.definition.name).length === 1
      ) {
        await this.handleGrantedSpells(spell, "background", flagData);
      }
      if (!this.canCast(spell)) continue;
      const parsedSpell = await DDBSpell.parseSpell(spell, this.character, {
        ddbData: this.ddb,
        namePostfix: `${this._getSpellCount(spell.definition.name)}`,
        generateSummons: this.generateSummons,
        flagData,
      });
      this._generated.background.push(parsedSpell);
    }
  }

  async _setCompendiumSource() {
    const spellCompendium = CompendiumHelper.getCompendiumType("spells", false);
    await CompendiumHelper.loadCompendiumIndex("spells", {
      fields: ["name", "flags.ddbimporter.definitionId"],
    });


    function setLink(spell) {
      if (!spell) return;
      const lookup = spellCompendium.index.find((s) => {
        if (!s.flags?.ddbimporter?.definitionId) return false;
        if (!spell.flags?.ddbimporter?.definitionId) return false;
        return s.flags.ddbimporter.definitionId === spell.flags.ddbimporter.definitionId;
      });

      if (lookup) foundry.utils.setProperty(spell, "_stats.compendiumSource", lookup.uuid);
      else {
        logger.warn(`Spell ${spell.name} not found in compendium for spell list linking`);
      }
    }

    for (const [key, spells] of Object.entries(this._generated)) {
      for (const spell of spells) {
        setLink(spell);
      }
      this._generated[key] = spells;
    }

    for (const [key, spells] of Object.entries(this._granted)) {
      for (const spell of spells) {
        setLink(spell);
      }
      this._granted[key] = spells;
    }
  }

  async generateCharacterSpells() {
    // each class has an entry here, each entry has spells
    // we loop through each class and process
    await this.generateClassSpells();

    // Parse any spells granted by class features, such as Barbarian Totem
    await this.generateSpecialClassSpells();

    // unprepared cantrips
    await this.generateUnpreparedCantrips();

    // Race spells are handled slightly differently
    await this.generateRaceSpells();

    // feat spells are handled slightly differently
    await this.generateFeatSpells();

    // background spells are handled slightly differently
    await this.generateBackgroundSpells();

    // Cross-bucket dedup must run AFTER every _generated bucket is populated (the
    // class list is processed before race/feat grants exist — see the method below).
    this._dedupRedundantClassSpells();

    await this._setCompendiumSource();

    this.processed = Object.values(this._generated).flat();

    return this.processed.sort((a, b) => a.name.localeCompare(b.name));
  }
}

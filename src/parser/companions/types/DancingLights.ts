import { utils } from "../../../lib/_module";
import { SUMMONS_ACTOR_STUB } from "./_data";

// Orb colour key -> the label used in the actor name; same seven as the orbs below.
const MEDIUM_COLOURS: Record<string, string> = {
  Yellow: "Yellow",
  BlueTeal: "Blue Teal",
  Green: "Green",
  BlueYellow: "Blue Yellow",
  Pink: "Pink",
  PurpleGreen: "Purple Green",
  Red: "Red",
};

const DANCING_LIGHTS_BASE = {
  "name": "Dancing Lights",
  "img": "modules/ddb-importer/img/jb2a/DancingLights_01_Yellow_Thumb.webp",
  "system": {
    "attributes": {
      "movement": {
        "fly": 60,
      },
    },
  },

  "prototypeToken": {
    "name": "Dancing Lights",
    "width": 0.5,
    "height": 0.5,
    "texture": {
      "src": "modules/ddb-importer/img/jb2a/DancingLights_01_Yellow_200x200.webm",
    },
    "light": {
      "negative": false,
      "priority": 0,
      "alpha": 0.5,
      "angle": 360,
      "bright": 0,
      "color": null,
      "coloration": 1,
      "dim": 10,
      "attenuation": 0.5,
      "luminosity": 0.5,
      "saturation": 0,
      "contrast": 0,
      "shadows": 0,
      "animation": {
        "type": "torch",
        "speed": 3,
        "intensity": 3,
        "reverse": false,
      },
      "darkness": {
        "min": 0,
        "max": 1,
      },
    },
  },
};


export function getDancingLights(): ICompanionResult {

  const dancingLightsBase = foundry.utils.mergeObject(foundry.utils.deepClone(SUMMONS_ACTOR_STUB()), foundry.utils.deepClone(DANCING_LIGHTS_BASE));
  const results: ICompanionResult = {
    DancingLightsYellow: {
      name: "Dancing Lights (Yellow)",
      version: "1",
      required: null,
      isJB2A: true,
      needsJB2A: false,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": "Dancing Lights (Yellow)",
        "prototypeToken.texture.src": "modules/ddb-importer/img/jb2a/DancingLights_01_Yellow_200x200.webm",
        "prototypeToken.light": {
          "color": "#ffed7a",
          "alpha": 0.25,
        },
        "img": "modules/ddb-importer/img/jb2a/DancingLights_01_Yellow_Thumb.webp",
      }),
    },
    DancingLightsGreen: {
      name: "Dancing Lights (Green)",
      version: "1",
      required: null,
      isJB2A: true,
      needsJB2A: true,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": "Dancing Lights (Green)",
        "prototypeToken.texture.src": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_Green_200x200.webm`,
        "prototypeToken.light": {
          "color": "#a7ff7a",
          "alpha": 0.25,
        },
        "img": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_Green_Thumb.webp`,
      }),
    },
    DancingLightsBlueTeal: {
      name: "Dancing Lights (Blue Teal)",
      version: "1",
      required: null,
      isJB2A: true,
      needsJB2A: true,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": "Dancing Lights (Blue Teal)",
        "prototypeToken.texture.src": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_BlueTeal_200x200.webm`,
        "prototypeToken.light": {
          "color": "#80ffff",
          "alpha": 0.25,
        },
        "img": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_BlueTeal_Thumb.webp`,
      }),
    },
    DancingLightsBlueYellow: {
      name: "Dancing Lights (Blue Yellow)",
      version: "1",
      required: null,
      isJB2A: true,
      needsJB2A: true,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": "Dancing Lights (Blue Yellow)",
        "prototypeToken.texture.src": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_BlueYellow_200x200.webm`,
        "prototypeToken.light": {
          "color": "#c1e6e6",
          "alpha": 0.25,
        },
        "img": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_BlueYellow_Thumb.webp`,
      }),
    },
    DancingLightsPink: {
      name: "Dancing Lights (Pink)",
      version: "1",
      required: null,
      isJB2A: true,
      needsJB2A: true,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": "Dancing Lights (Pink)",
        "prototypeToken.texture.src": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_Pink_200x200.webm`,
        "prototypeToken.light": {
          "color": "#f080ff",
          "alpha": 0.25,
        },
        "img": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_Pink_Thumb.webp`,
      }),
    },
    DancingLightsPurpleGreen: {
      name: "Dancing Lights (Purple Green)",
      version: "1",
      required: null,
      isJB2A: true,
      needsJB2A: true,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": "Dancing Lights (Purple Green)",
        "prototypeToken.texture.src": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_PurpleGreen_200x200.webm`,
        "prototypeToken.light": {
          "color": "#a66bff",
          "alpha": 0.25,
        },
        "img": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_PurpleGreen_Thumb.webp`,
      }),
    },
    DancingLightsRed: {
      name: "Dancing Lights (Red)",
      version: "1",
      required: null,
      isJB2A: true,
      needsJB2A: true,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": "Dancing Lights (Red)",
        "prototypeToken.texture.src": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_Red_200x200.webm`,
        "prototypeToken.light": {
          "color": "#ff817a",
          "alpha": 0.25,
        },
        "img": `${utils.getJB2APath()}/Library/Cantrip/Dancing_Lights/DancingLights_01_Red_Thumb.webp`,
      }),
    },
  };

  // FORK (T235): the 2024 spell also lets the caster "combine the four lights into one glowing
  // Medium form that is vaguely humanlike". JB2A ships no such asset, so the fork carries its
  // own art (procedural, tools/generate-dancing-lights-medium.py), one per orb colour. The
  // light it sheds is the orb's own: same colour, same 10 ft of Dim Light.
  for (const [colour, label] of Object.entries(MEDIUM_COLOURS)) {
    const orbLight = foundry.utils.getProperty(results[`DancingLights${colour}`].data, "prototypeToken.light") as Record<string, unknown>;
    const name = `Dancing Light, Medium (${label})`;
    results[`DancingLightsMedium${colour}`] = {
      name,
      version: "1",
      required: null,
      isJB2A: false,
      needsJB2A: false,
      folderName: "Dancing Lights",
      data: foundry.utils.mergeObject(foundry.utils.deepClone(dancingLightsBase), {
        "name": name,
        "system.traits.size": "med",
        "prototypeToken.name": "Dancing Light",
        "prototypeToken.width": 1,
        "prototypeToken.height": 1,
        "prototypeToken.texture.src": `modules/ddb-importer/img/dancing-lights/DancingLightsMedium_${colour}_400x400.webm`,
        "prototypeToken.light": {
          "color": orbLight.color,
          "alpha": orbLight.alpha,
        },
        "img": `modules/ddb-importer/img/dancing-lights/DancingLightsMedium_${colour}_Thumb.webp`,
      }),
    };
  }

  return results;
}

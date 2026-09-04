export type Faction = "Autobot" | "Decepticon" | "Predacon" | "Maximal";
export type Role = "Commander" | "Scout" | "Trooper" | "Tactician";
export type Unit = {
  id: string;
  name: string;
  faction: Faction;
  role: Role;
  max: number;
  hp: number;
  dmg: number;
  ability: string;
  image: string;
  abilityUses: number;
  canAttack: boolean;
  shield?: number;
  poison?: number;
  diveBonus?: boolean;
  frenzyBonus?: boolean;
  quickstrikeBonus?: boolean;
  ravageGuard?: boolean;
  timedShield?: boolean;
  shieldUntil?: number;
  copiedCommanderId?: string;
  dinobotBonus?: boolean;
  dinobotHitStreak?: number;
  optimalBoost?: boolean;
};
export type Slot = Unit | null;
export type BattleInfo = {
  rarity: "Common" | "Rare";
  effect: string;
  image: string;
};

const rows: Record<
  Faction,
  [string, string, Role, number, number, string, number][]
> = {
  Autobot: [
    [
      "optimus",
      "Optimus Prime",
      "Commander",
      100,
      15,
      "Move an Autobot about to die to another spot to avoid death. 1 use.",
      1,
    ],
    [
      "grimlock",
      "Grimlock",
      "Commander",
      80,
      20,
      "After defeating an enemy Commander, Grimlock may use all 3 attacks next turn. 1 use.",
      1,
    ],
    [
      "bee",
      "Bumblebee",
      "Scout",
      40,
      5,
      "While deployed with an Autobot Commander, Bumblebee gives himself and that Commander +5 Damage.",
      0,
    ],
    [
      "wheelie",
      "Wheelie",
      "Scout",
      50,
      10,
      "Cannot be revealed by abilities or Battle Cards.",
      0,
    ],
    [
      "eject",
      "Eject",
      "Scout",
      40,
      5,
      "Guess an enemy space. If a Scout is there, permanently swap Eject with it. 1 use.",
      1,
    ],
    [
      "sun",
      "Sunstreaker",
      "Trooper",
      80,
      20,
      "If Sideswipe is deployed, Sunstreaker may attack twice. 2 uses.",
      2,
    ],
    [
      "side",
      "Sideswipe",
      "Trooper",
      60,
      25,
      "If Sunstreaker dies while both are deployed, Sideswipe returns to full Health. 1 use.",
      1,
    ],
    [
      "ratchet",
      "Ratchet",
      "Tactician",
      70,
      10,
      "When damaged, every character sharing Ratchet's horizontal row heals 15. 1 use.",
      1,
    ],
    [
      "wheeljack",
      "Wheeljack",
      "Tactician",
      50,
      15,
      "All deployed Scouts gain +5 Damage on their next attack. 1 use.",
      1,
    ],
    [
      "elita",
      "Elita-1",
      "Commander",
      100,
      15,
      "A full Autobot team disables enemy Commander abilities until 2 Autobots die.",
      0,
    ],
    [
      "brawn",
      "Brawn",
      "Scout",
      50,
      10,
      "If killed by a Decepticon, the opponent scraps 2 Battle Cards. 1 use.",
      1,
    ],
    [
      "getaway",
      "Getaway",
      "Trooper",
      80,
      20,
      "Select a deployed friendly Commander's ability and copy it. 1 use.",
      1,
    ],
    [
      "grapple",
      "Grapple",
      "Tactician",
      50,
      15,
      "Draw one Battle Card for every Autobot in your Backups. 1 use.",
      1,
    ],
    [
      "highbrow",
      "Highbrow",
      "Tactician",
      50,
      15,
      "Enemy Tactician abilities are unusable for 3 rounds. 1 use.",
      1,
    ],
    [
      "hoist",
      "Hoist",
      "Tactician",
      70,
      10,
      "Replace every Battle Card in your hand with a random one. 1 use.",
      1,
    ],
  ],
  Decepticon: [
    [
      "megatron",
      "Megatron",
      "Commander",
      80,
      20,
      "Every Autobot Megatron defeats lets him heal any Decepticon by 10.",
      0,
    ],
    [
      "overlord",
      "Overlord",
      "Commander",
      100,
      15,
      "Scrap 4 Battle Cards to permanently change Overlord's Damage to 20.",
      1,
    ],
    [
      "soundwave",
      "Soundwave",
      "Tactician",
      70,
      10,
      "If Megatron is deployed, draw 3 Battle Cards. 1 use.",
      1,
    ],
    [
      "bombshell",
      "Bombshell",
      "Scout",
      40,
      5,
      "Choose an enemy space. A character there damages itself for its own Damage. 1 use.",
      1,
    ],
    [
      "shrapnel",
      "Shrapnel",
      "Scout",
      50,
      10,
      "If Kickback dies while Shrapnel is deployed, Kickback attacks once more. 1 use.",
      1,
    ],
    [
      "starscream",
      "Starscream",
      "Trooper",
      80,
      20,
      "After death, sacrifice any character to restore Starscream to Backup with 60 Health.",
      1,
    ],
    [
      "thunder",
      "Thundercracker",
      "Trooper",
      80,
      20,
      "Roll Out heals Thundercracker for 20 instead. 2 uses.",
      2,
    ],
    [
      "dreadwing",
      "Dreadwing",
      "Trooper",
      60,
      25,
      "Deny any Battle Card the opponent uses. 1 use.",
      1,
    ],
    [
      "shockwave",
      "Shockwave",
      "Tactician",
      50,
      15,
      "Launch one powerful 30-Damage attack. 1 use.",
      1,
    ],
    [
      "skywarp",
      "Skywarp",
      "Trooper",
      60,
      25,
      "When repositioning, freely move Skywarp to any spot. 2 uses.",
      2,
    ],
    [
      "fangry",
      "Fangry",
      "Scout",
      40,
      5,
      "Upon death, secretly remain with 20 Health but lose the ability to attack.",
      1,
    ],
    [
      "kickback",
      "Kickback",
      "Scout",
      50,
      10,
      "If attacked by a Trooper, heal any deployed character by 10. 1 use.",
      1,
    ],
    [
      "bludgeon",
      "Bludgeon",
      "Trooper",
      60,
      5,
      "Select 3 spaces to hide from detection for 2 rounds, including characters inside them. 1 use.",
      1,
    ],
    [
      "frenzy",
      "Frenzy",
      "Scout",
      40,
      5,
      "While Rumble is deployed, Frenzy's Health becomes 60.",
      0,
    ],
    [
      "galvatron",
      "Galvatron",
      "Commander",
      80,
      20,
      "While in Backup, give 2 deployed characters a shield for 2 rounds. 1 use.",
      1,
    ],
    [
      "jhiaxus",
      "Jhiaxus",
      "Tactician",
      70,
      10,
      "Force the opponent to reveal all characters in their Backups. 1 use.",
      1,
    ],
    [
      "laserbeak",
      "Laserbeak",
      "Scout",
      40,
      5,
      "While deployed, Megatron and Soundwave cannot be detected.",
      0,
    ],
    [
      "ravage",
      "Ravage",
      "Scout",
      50,
      10,
      "After repositioning, the first enemy attack that hits Ravage is blocked.",
      0,
    ],
    [
      "rumble",
      "Rumble",
      "Scout",
      50,
      10,
      "If Frenzy is deployed, draw 1 Battle Card. 1 use.",
      1,
    ],
    [
      "barrage",
      "Barrage",
      "Scout",
      40,
      5,
      "If Barrage is selected, your deck may contain 3 Commanders in place of one Scout.",
      0,
    ],
    [
      "cyclonus",
      "Cyclonus",
      "Trooper",
      80,
      20,
      "Heal every Decepticon on your team by 5. 1 use.",
      1,
    ],
  ],
  Predacon: [
    [
      "razor",
      "Razorclaw",
      "Commander",
      80,
      20,
      "Combine with one Backup: gain its Health and scrap it. 1 use.",
      1,
    ],
    [
      "pmega",
      "Megatron (P)",
      "Commander",
      100,
      15,
      "Force the opponent to reorder their deployed cards before you attack. 2 uses.",
      2,
    ],
    [
      "dive",
      "Divebomb",
      "Scout",
      40,
      5,
      "While deployed, all other Predacons gain 10 Health.",
      0,
    ],
    [
      "scorp",
      "Scorponok",
      "Scout",
      50,
      10,
      "Take a lethal hit for a Commander. 2 uses.",
      2,
    ],
    [
      "wasp",
      "Waspinator",
      "Scout",
      50,
      10,
      "The opponent reveals the positions of all 3 Scouts. 1 use.",
      1,
    ],
    [
      "rampage",
      "Rampage",
      "Trooper",
      80,
      20,
      "If Razorclaw combines with Rampage, draw 2 Battle Cards.",
      0,
    ],
    [
      "rampagebw",
      "Rampage (P)",
      "Trooper",
      60,
      25,
      "While in Backup, heal 15 every 3 turns.",
      0,
    ],
    [
      "head",
      "Headstrong",
      "Tactician",
      50,
      15,
      "At full Health, choose an enemy space. If occupied, both cards die. 1 use.",
      1,
    ],
    [
      "arachnia",
      "Black Arachnia",
      "Tactician",
      70,
      10,
      "Choose an enemy row; everyone there takes 5 poison damage for 3 rounds. 1 use.",
      1,
    ],
    [
      "terror",
      "Terrorsaur",
      "Tactician",
      70,
      10,
      "Start with a shield that completely blocks the first attack. 1 use.",
      1,
    ],
    [
      "quickstrike",
      "Quickstrike",
      "Scout",
      50,
      10,
      "Every friendly card sharing Quickstrike's horizontal row gains +5 Damage.",
      0,
    ],
    [
      "tarantulas",
      "Tarantulas",
      "Tactician",
      70,
      10,
      "While both enemy Commanders are deployed, draw 1 extra Battle Card every round.",
      0,
    ],
    [
      "transmetal-tarantulas",
      "Transmetal Tarantulas",
      "Tactician",
      70,
      10,
      "Whenever a Predacon on your team dies, heal Transmetal Tarantulas by 15.",
      0,
    ],
  ],
  Maximal: [
    [
      "primal",
      "Optimus Primal",
      "Commander",
      100,
      15,
      "If your other Commander dies, Optimus Primal permanently gains +10 Health and +10 Damage.",
      0,
    ],
    [
      "airrazor",
      "Airrazor",
      "Trooper",
      80,
      20,
      "If your deck contains at least 3 Maximals, Airrazor may permanently attack twice each round.",
      0,
    ],
    [
      "cheetor",
      "Cheetor",
      "Scout",
      40,
      5,
      "If Cheetor is defeated, the character that defeated him has its position revealed permanently.",
      0,
    ],
    [
      "depthcharge",
      "Depthcharge",
      "Commander",
      70,
      10,
      "When a Maximal on your board dies, leave a 10-Damage mine in that space. Only 1 mine may be active.",
      0,
    ],
    [
      "dinobot",
      "Dinobot",
      "Trooper",
      60,
      25,
      "After Dinobot is attacked twice in a row, restore him to full Health. 1 use.",
      1,
    ],
    [
      "maxgrimlock",
      "Maximal Grimlock",
      "Scout",
      50,
      10,
      "While Maximal Grimlock and Dinobot are both deployed, Dinobot's ability has 2 uses.",
      0,
    ],
    [
      "optimal",
      "Optimal Optimus",
      "Commander",
      80,
      20,
      "If Optimus Primal or Optimus Prime is deployed with him, permanently increase Optimal Optimus to 30 Damage.",
      0,
    ],
    [
      "tigatron",
      "Tigatron",
      "Tactician",
      50,
      15,
      "Immune to enemy Battle Card effects.",
      0,
    ],
    [
      "rattrap",
      "Rattrap",
      "Scout",
      50,
      10,
      "Neither team may reposition cards during this round's Reposition Phase. 2 uses.",
      2,
    ],
    [
      "rhinox",
      "Rhinox",
      "Tactician",
      70,
      10,
      "While above half Health, revive a defeated Maximal at half Health. 1 use.",
      1,
    ],
    [
      "silverbolt",
      "Silverbolt",
      "Trooper",
      80,
      20,
      "Predacon abilities have no effect on Silverbolt.",
      0,
    ],
    [
      "lio-convoy",
      "Lio Convoy",
      "Commander",
      100,
      15,
      "While your full nine-card team consists of Maximals, Lio Convoy cannot be detected.",
      0,
    ],
  ],
};

const imageNames: Record<string, string> = {
  bee: "bumblebee",
  sun: "sunstreaker",
  side: "sideswipe",
  pmega: "megatron-p",
  rampagebw: "rampage-p",
  head: "headstrong",
  arachnia: "black-arachnia",
  razor: "razorclaw",
  scorp: "scorponok",
  wasp: "waspinator",
  dive: "divebomb",
  terror: "terrorsaur",
  primal: "optimus-primal",
  thunder: "thundercracker",
  maxgrimlock: "maximal-grimlock",
  optimal: "optimal-optimus",
};
export const rosters = Object.fromEntries(
  Object.entries(rows).map(([faction, units]) => [
    faction,
    units.map(([id, name, role, max, dmg, ability, abilityUses]) => ({
      id,
      name,
      role,
      max,
      hp: max,
      dmg,
      ability,
      abilityUses,
      canAttack: true,
      faction: faction as Faction,
      image: `/cards/characters/${imageNames[id] || id}.png`,
      shield: id === "terror" ? 1 : 0,
    })),
  ]),
) as Record<Faction, Unit[]>;
export const allUnits = Object.values(rosters).flat();

export const battleCards: Record<string, BattleInfo> = {
  "2 For The Price Of 1": {
    rarity: "Common",
    effect:
      "After an enemy dies, the opponent reveals another occupied position.",
    image: "/cards/battle/two-for-one.png",
  },
  "Armor Plating": {
    rarity: "Common",
    effect: "Reduce the next damage dealt to one character by 10.",
    image: "/cards/battle/armor-plating.png",
  },
  "Dark Reflections": {
    rarity: "Common",
    effect:
      "Collect 2, scrap both, and replace an attacker's Damage with a defeated character's Damage.",
    image: "/cards/battle/dark-reflections.png",
  },
  "Deserved Punishment": {
    rarity: "Common",
    effect: "Choose an enemy position and deal 10 damage if occupied.",
    image: "/cards/battle/deserved-punishment.png",
  },
  "Face Off": {
    rarity: "Common",
    effect: "If your next attack hits, draw a Battle Card.",
    image: "/cards/battle/face-off.png",
  },
  "Flying Support": {
    rarity: "Common",
    effect: "Force the opponent to reveal one character position.",
    image: "/cards/battle/flying-support.png",
  },
  "He Will Find You": {
    rarity: "Common",
    effect:
      "Reveal the position of the enemy character with the lowest Health.",
    image: "/cards/battle/he-will-find-you.png",
  },
  Reinforce: {
    rarity: "Common",
    effect:
      "Exchange one deployed character with a Backup without a Reposition Action.",
    image: "/cards/battle/reinforce.png",
  },
  "Roll Out": {
    rarity: "Common",
    effect: "Heal one character by 10.",
    image: "/cards/battle/roll-out.png",
  },
  "Tyrants Reign": {
    rarity: "Common",
    effect: "Draw 2 more Battle Cards.",
    image: "/cards/battle/tyrants-reign.png",
  },
  Surprise: {
    rarity: "Common",
    effect: "Pick 2 spaces and learn whether a character is there.",
    image: "/cards/battle/surprise.png",
  },
  "Information Gathering": {
    rarity: "Rare",
    effect: "Force the opponent to reveal 3 deployed character positions.",
    image: "/cards/battle/information-gathering.png",
  },
  "Junkion Scrap": {
    rarity: "Rare",
    effect: "The opponent scraps 3 Battle Cards.",
    image: "/cards/battle/junkion-scrap.png",
  },
  "Power Of The Primes": {
    rarity: "Rare",
    effect: "Heal one character by 35.",
    image: "/cards/battle/power-of-the-primes.png",
  },
  "War Dawn": {
    rarity: "Rare",
    effect: "Choose an enemy row; everyone in it takes 15 damage.",
    image: "/cards/battle/war-dawn.svg",
  },
  "Ambush Trap": {
    rarity: "Common",
    effect:
      "Place on a vacant friendly space. If attacked, cancel the hit and reveal the attacking enemy position.",
    image: "",
  },
};
export const battleDeck = Object.keys(battleCards);
export const shuffled = <T>(items: T[]) =>
  [...items].sort(() => Math.random() - 0.5);
export const makeBattleDeck = () => {
  const cards = battleDeck.flatMap((name) => [name, name]);
  cards.splice(cards.indexOf("Ambush Trap"), 1);
  cards.splice(cards.indexOf("Surprise"), 1);
  return shuffled(cards);
};
export const starterDeck = (faction: Faction) => {
  const limits: Record<Role, number> = {
    Commander: 2,
    Scout: 3,
    Trooper: 2,
    Tactician: 2,
  };
  return (Object.entries(limits) as [Role, number][]).flatMap(
    ([role, amount]) =>
      rosters[faction]
        .filter((unit) => unit.role === role)
        .slice(0, amount)
        .map((unit) => ({ ...unit })),
  );
};
export const enemyDeck = (faction: Faction) => {
  const limits: Record<Role, number> = {
    Commander: 2,
    Scout: 3,
    Trooper: 2,
    Tactician: 2,
  };
  return (Object.entries(limits) as [Role, number][]).flatMap(
    ([role, amount]) =>
      shuffled(rosters[faction].filter((unit) => unit.role === role))
        .slice(0, amount)
        .map((unit) => ({ ...unit })),
  );
};
export const randomEnemyDeck = () => {
  const limits: Record<Role, number> = {
    Commander: 2,
    Scout: 3,
    Trooper: 2,
    Tactician: 2,
  };
  return (Object.entries(limits) as [Role, number][]).flatMap(
    ([role, amount]) =>
      shuffled(allUnits.filter((unit) => unit.role === role))
        .slice(0, amount)
        .map((unit) => ({
          ...unit,
          hp: unit.max,
          shield: unit.id === "terror" ? 1 : 0,
        })),
  );
};

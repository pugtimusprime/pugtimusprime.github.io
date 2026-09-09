export const QUINTESSON_RAID = {
  board: { playerBoards: 2, playerColumns: 3, playerRows: 3, bossColumns: 3, bossRows: 2 },
  boss: { id: "quintesson-judge", name: "Quintesson Judge", hp: 850, dmg: 15, image: "/cards/characters/quintesson-judge.png", ability: "When at the start of each boss turn summon one defeated quintesson troop back to half health, if none are defeated place down one allicon and limited to two allicons on the board at a time." },
  court: [
    { id: "quintesson-bailiff", name: "Quintesson Bailiff", role: "Commander", hp: 80, dmg: 20, image: "/cards/characters/quintesson-bailiff.png", ability: "While the Bailiff is alive, the Judge takes 50% less damage." },
    { id: "quintesson-prosecutor", name: "Quintesson Prosecutor", role: "Tactician", hp: 70, dmg: 10, image: "/cards/characters/quintesson-prosecutor.png", ability: "At the start of the boss turn, mark the player character with the lowest current Health. The next Quintesson attack against that character deals +10 damage." },
    { id: "quintesson-executor", name: "Quintesson Executor", role: "Trooper", hp: 60, dmg: 25, image: "/cards/characters/quintesson-executor.png", ability: "When attacking a character at half Health or lower, deal an additional 10 damage." },
    { id: "allicon", name: "Allicon", role: "Scout", hp: 40, dmg: 5, image: "/cards/characters/allicon.png", ability: "Gain +5 damage for every other Allicon alive, up to +10." },
  ],
} as const;

export const UNICRON_RAID = {
  board: { playerBoards: 2, playerColumns: 3, playerRows: 3, bossColumns: 3, bossRows: 1 },
  boss: {
    id: "unicron",
    name: "Unicron",
    hp: 1400,
    dmg: 20,
    image: "/cards/characters/unicron-phase-1.png",
    ability: "Every third boss turn, Unicron devours one random deployed character.",
  },
  phases: [
    { phase: 1, minHp: 1000, maxHp: 1400, dmg: 20, image: "/cards/characters/unicron-phase-1.png", ability: "Every third boss turn, Unicron devours one random deployed character." },
    { phase: 2, minHp: 400, maxHp: 999, dmg: 30, image: "/cards/characters/unicron-phase-2.png", ability: "Characters defeated by Unicron return as soldiers in his three-space legion row." },
    { phase: 3, minHp: 1, maxHp: 399, dmg: 35, image: "/cards/characters/unicron-phase-3.png", ability: "Summon The Fallen, Sideways and Rodimus Unicronus. Unicron cannot attack or take damage until all three are defeated." },
  ],
  legion: [
    { id: "the-fallen", name: "The Fallen", role: "Commander", hp: 80, dmg: 20, image: "/cards/characters/the-fallen.png", ability: "All Battle Cards are rendered useless until The Fallen is defeated." },
    { id: "sideways-unicron", name: "Sideways", role: "Commander", hp: 80, dmg: 20, image: "/cards/characters/sideways-unicron.png", ability: "At the start of every boss turn, heal The Fallen for 15 Health." },
    { id: "rodimus-unicronus", name: "Rodimus Unicronus", role: "Commander", hp: 80, dmg: 20, image: "/cards/characters/rodimus-unicronus.png", ability: "While this card is alive, The Fallen deals 15 additional damage." },
  ],
} as const;

export const QUINTESSON_RAID = {
  board: { playerBoards: 2, playerColumns: 3, playerRows: 3, bossColumns: 3, bossRows: 2 },
  boss: { id: "quintesson-judge", name: "Quintesson Judge", hp: 700, dmg: 15, image: "/cards/characters/quintesson-judge.png", ability: "When at the start of each boss turn summon one defeated quintesson troop back to half health, if none are defeated place down one allicon and limited to two allicons on the board at a time." },
  court: [
    { id: "quintesson-bailiff", name: "Quintesson Bailiff", role: "Trooper", hp: 80, dmg: 20, image: "/cards/characters/quintesson-bailiff.png", ability: "While the Bailiff is alive, the Judge takes 50% less damage." },
    { id: "quintesson-prosecutor", name: "Quintesson Prosecutor", role: "Tactician", hp: 70, dmg: 10, image: "/cards/characters/quintesson-prosecutor.png", ability: "At the start of the boss turn, mark the player character with the lowest current Health. The next Quintesson attack against that character deals +10 damage." },
    { id: "quintesson-executor", name: "Quintesson Executor", role: "Trooper", hp: 60, dmg: 25, image: "/cards/characters/quintesson-executor.png", ability: "When attacking a character at half Health or lower, deal an additional 10 damage." },
    { id: "allicon", name: "Allicon", role: "Scout", hp: 40, dmg: 5, image: "/cards/characters/allicon.png", ability: "Gain +5 damage for every other Allicon alive, up to +10." },
  ],
} as const;

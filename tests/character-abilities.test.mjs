import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { allUnits } from "../lib/card-data.ts";
import {
  applyBoardAuras,
  applyCharacterAttackDamage,
  applyDeckPassives,
  applyRoundPassives,
  attackLimit,
  canRhinoxRevive,
  isBattleCardImmune,
  isPredaconAbilityImmune,
  isCharacterAbilityImmune,
  repositionBlurr,
  reviveAtHalf,
  shouldLayDepthchargeMine,
  healFaction,
  healTransmetalTarantulas,
  hasTarantulasDraw,
  isFullFactionTeam,
  healFrontRow,
  hunGrrrWins,
  lastStandDamage,
  transferHealth,
  empowerBreakdown,
  matchesFaction,
  matchesRole,
  rescueOnslaught,
  triggerBrawlLastStand,
} from "../lib/combat-engine.mjs";

const abilitySignals = {
  optimus: /avoid death/i,
  grimlock: /all 3 attacks/i,
  bee: /\+5 Damage/i,
  wheelie: /cannot be revealed/i,
  eject: /swap Eject/i,
  sun: /attack twice/i,
  side: /returns to full Health/i,
  ratchet: /row heals 15/i,
  wheeljack: /Scouts gain \+5/i,
  elita: /disables enemy Commander/i,
  brawn: /scraps 2 Battle Cards/i,
  getaway: /copy it/i,
  grapple: /every Autobot in your Backups/i,
  highbrow: /Tactician abilities/i,
  hoist: /replace every Battle Card/i,
  megatron: /heal any Decepticon/i,
  overlord: /scrap 4 Battle Cards/i,
  soundwave: /draw 3 Battle Cards/i,
  bombshell: /damages itself/i,
  shrapnel: /Kickback attacks once more/i,
  starscream: /restore Starscream/i,
  thunder: /heals Thundercracker for 20/i,
  dreadwing: /deny any Battle Card/i,
  shockwave: /30-Damage attack/i,
  skywarp: /freely move Skywarp/i,
  fangry: /remain with 20 Health/i,
  kickback: /heal any deployed character/i,
  bludgeon: /select 3 spaces/i,
  frenzy: /Health becomes 60/i,
  galvatron: /give 2 deployed characters a shield/i,
  jhiaxus: /reveal all characters in their Backups/i,
  laserbeak: /Megatron and Soundwave cannot be detected/i,
  ravage: /first enemy attack/i,
  rumble: /draw 1 Battle Card/i,
  razor: /combine with one Backup/i,
  pmega: /reorder their deployed cards/i,
  dive: /other Predacons gain 10 Health/i,
  scorp: /lethal hit for a Commander/i,
  wasp: /positions of all 3 Scouts/i,
  rampage: /draw 2 Battle Cards/i,
  rampagebw: /heal 15 every 3 turns/i,
  head: /both cards die/i,
  arachnia: /poison damage for 3 rounds/i,
  terror: /blocks the first attack/i,
  primal: /permanently gains \+10 Health/i,
  airrazor: /attack twice each round/i,
  cheetor: /position revealed permanently/i,
  depthcharge: /10-Damage mine/i,
  dinobot: /attacked twice in a row/i,
  maxgrimlock: /Dinobot's ability has 2 uses/i,
  optimal: /30 Damage/i,
  tigatron: /immune to enemy Battle Card/i,
  rattrap: /neither team may reposition/i,
  rhinox: /revive a defeated Maximal/i,
  silverbolt: /Predacon abilities have no effect/i,
  barrage: /3 Commanders/i,
  cyclonus: /every Decepticon/i,
  quickstrike: /horizontal row/i,
  tarantulas: /extra Battle Card/i,
  "transmetal-tarantulas": /heal Transmetal Tarantulas by 15/i,
  "lio-convoy": /cannot be detected/i,
  cliffjumper: /2 Battle Cards/i,
  cosmos: /Tacticians are fully visible/i,
  dion: /Transfer Dion's Health/i,
  firestar: /swap positions/i,
  mirage: /reports an enemy attack as a miss/i,
  cutthroat: /gains a shield/i,
  blight: /Damage permanently becomes 40/i,
  "hun-grrr": /round 5/i,
  sinnertwin: /round 4/i,
  rippersnapper: /immune to all damage/i,
  "big-convoy": /front row/i,
  "claw-jaw": /shield for 3 rounds/i,
  "polar-claw": /last character alive/i,
  razorbeast: /defeated Maximal/i,
  "ultra-mammoth": /4 times/i,
  wolfang: /\+10 Damage to Predacons/i,
  "air-raid": /Troopers \+10 Damage for 2 rounds/i,
  "alpha-trion": /Autobots.*\+5 maximum Health/i,
  beachcomber: /cannot attack.*loses 10 Health/i,
  blades: /enemy scraps every Battle Card/i,
  blaster: /Eject or Steeljaw.*\+10 Damage/i,
  bluestreak: /position is revealed for 2 rounds/i,
  blurr: /random vacant space/i,
  brainstorm: /locked Turret with 20 Health and 15 Damage/i,
  chromia: /heal its occupant by 10 for 3 rounds/i,
  dirge: /heals 5 Health/i,
  "drag-strip": /Duplicate one Battle Card/i,
  dropshot: /last living Scout.*\+15 maximum Health/i,
  misfire: /\+5 Damage when attacking Tacticians/i,
  mixmaster: /Bonecrusher.*attack twice/i,
  motormaster: /Optimus Prime.*draw 3 Battle Cards/i,
  "nemesis-prime": /copy your other Commander's ability.*\+5 Damage/i,
  ramjet: /Ignore non-Decepticon character abilities for 3 rounds/i,
  "acid-storm": /Shockwave misses.*toxic.*4 turns/i,
  "blast-off": /Onslaught dies.*half Health/i,
  bonecrusher: /every class/i,
  brawl: /one more turn.*attack once/i,
  breakdown: /enemy Scout.*10 maximum Health/i,
  buzzsaw: /Battle Cards.*2 turns/i,
  "chop-shop": /every faction/i,
  darkwing: /enemy's Battle Cards.*select 2/i,
  "dead-end": /above half Health.*draw 4 Battle Cards/i,
};

test("the nine-card expansion resolves its combat state changes", () => {
  const unit = (id) => ({ ...allUnits.find((card) => card.id === id) });
  const bonecrusher = { ...unit("bonecrusher"), allClasses: true };
  const chopShop = { ...unit("chop-shop"), allFactions: true };
  assert.equal(matchesRole(bonecrusher, "Scout"), true);
  assert.equal(matchesFaction(chopShop, "Autobot"), true);

  const breakdown = empowerBreakdown(unit("breakdown"), unit("buzzsaw"));
  assert.deepEqual(
    [breakdown.max, breakdown.hp, breakdown.abilityUses],
    [70, 70, 0],
  );

  const brawl = triggerBrawlLastStand(unit("brawl"));
  assert.deepEqual(
    [brawl.hp, brawl.canAttack, brawl.abilityUses],
    [1, true, 0],
  );

  const onslaught = {
    ...unit("brawl"),
    id: "onslaught",
    name: "Onslaught",
    max: 100,
    hp: 0,
  };
  const rescue = rescueOnslaught(onslaught, [unit("blast-off")]);
  assert.equal(rescue.revived.hp, 50);
});

test("every character ability has an explicit regression case", async (t) => {
  assert.deepEqual(
    Object.keys(abilitySignals).sort(),
    allUnits.map((unit) => unit.id).sort(),
  );
  for (const unit of allUnits) {
    await t.test(`${unit.name}: ability text and artwork`, () => {
      assert.match(unit.ability, abilitySignals[unit.id]);
      const imageUrl = new URL(`../public${unit.image}`, import.meta.url);
      assert.equal(
        existsSync(imageUrl),
        true,
        `${unit.name} artwork exists at ${unit.image}`,
      );
    });
  }
});

const maximal = (id) => ({ ...allUnits.find((unit) => unit.id === id) });

test("small deployed teams can spend all three actions with surviving attackers", () => {
  const airrazor = maximal("airrazor"),
    cheetor = maximal("cheetor");
  assert.equal(
    attackLimit({
      unit: cheetor,
      board: [cheetor, airrazor],
      deck: [cheetor, airrazor],
      round: 2,
    }),
    3,
  );
});

test("Airrazor attacks twice when the deck contains three Maximals", () => {
  const airrazor = maximal("airrazor"),
    deck = [airrazor, maximal("cheetor"), maximal("rhinox")];
  const board = [
    airrazor,
    maximal("cheetor"),
    maximal("rhinox"),
    maximal("tigatron"),
  ];
  assert.equal(attackLimit({ unit: airrazor, board, deck, round: 2 }), 2);
});

test("Dinobot restores to full Health on the second consecutive hit", () => {
  const first = applyCharacterAttackDamage(maximal("dinobot"), 10).unit;
  const second = applyCharacterAttackDamage(first, 10);
  assert.equal(second.restored, true);
  assert.equal(second.unit.hp, second.unit.max);
  assert.equal(second.unit.abilityUses, 0);
});

test("Maximal Grimlock grants Dinobot a second restoration use", () => {
  const board = applyBoardAuras([maximal("dinobot"), maximal("maxgrimlock")]);
  assert.equal(board[0].abilityUses, 2);
  assert.equal(board[0].dinobotBonus, true);
});

test("Optimal Optimus permanently reaches 30 Damage with either Optimus support", () => {
  const board = applyBoardAuras([maximal("optimal"), maximal("primal")]);
  assert.equal(board[0].dmg, 30);
  assert.equal(board[0].optimalBoost, true);
});

test("Tigatron and Silverbolt apply their printed immunities", () => {
  assert.equal(isBattleCardImmune(maximal("tigatron")), true);
  assert.equal(isPredaconAbilityImmune(maximal("silverbolt")), true);
  assert.equal(isBattleCardImmune(maximal("silverbolt")), false);
});

test("Rhinox can revive a defeated Maximal at half Health only while healthy", () => {
  const rhinox = maximal("rhinox"),
    fallen = { ...maximal("cheetor"), hp: 0 };
  assert.equal(canRhinoxRevive(rhinox, [fallen]), true);
  assert.equal(reviveAtHalf(fallen).hp, 20);
  assert.equal(canRhinoxRevive({ ...rhinox, hp: 35 }, [fallen]), false);
});

test("Depthcharge leaves a mine only for a defeated Maximal", () => {
  assert.equal(
    shouldLayDepthchargeMine([maximal("depthcharge")], maximal("cheetor")),
    true,
  );
  assert.equal(
    shouldLayDepthchargeMine(
      [maximal("depthcharge")],
      allUnits.find((unit) => unit.id === "bee"),
    ),
    false,
  );
});

test("Quickstrike gives every card in his horizontal row +5 Damage", () => {
  const quickstrike = maximal("quickstrike"),
    ally = maximal("terror"),
    other = maximal("scorp");
  const board = applyBoardAuras([quickstrike, ally, null, other]);
  assert.equal(board[0].dmg, 15);
  assert.equal(board[1].dmg, 15);
  assert.equal(board[3].dmg, 10);
});

test("Transmetal Tarantulas heals 15 when a friendly Predacon dies", () => {
  const tarantulas = { ...maximal("transmetal-tarantulas"), hp: 30 };
  const healed = healTransmetalTarantulas([tarantulas], maximal("quickstrike"));
  assert.equal(healed[0].hp, 45);
  assert.equal(
    healTransmetalTarantulas([tarantulas], maximal("cheetor"))[0].hp,
    30,
  );
});

test("Cyclonus heals all Decepticons and Tarantulas checks both commanders", () => {
  const cyclonus = { ...maximal("cyclonus"), hp: 50 },
    barrage = { ...maximal("barrage"), hp: 20 };
  const healed = healFaction(
    [cyclonus, barrage, maximal("quickstrike")],
    "Decepticon",
    5,
  );
  assert.deepEqual(
    healed.map((unit) => unit.hp),
    [55, 25, 50],
  );
  assert.equal(
    hasTarantulasDraw(
      [maximal("tarantulas")],
      [maximal("razor"), maximal("pmega")],
    ),
    true,
  );
  assert.equal(
    hasTarantulasDraw([maximal("tarantulas")], [maximal("razor")]),
    false,
  );
});

test("new team abilities resolve their printed health and damage rules", () => {
  const blight = maximal("blight"),
    dion = { ...maximal("dion"), hp: 60 },
    wounded = { ...maximal("firestar"), hp: 20 },
    transferred = transferHealth(dion, wounded),
    healed = healFrontRow([
      { ...maximal("wolfang"), hp: 10 },
      null,
      { ...maximal("polar-claw"), hp: 20 },
      { ...maximal("razorbeast"), hp: 20 },
    ]);
  assert.equal(lastStandDamage(blight, 1), 40);
  assert.equal(lastStandDamage(blight, 2), 20);
  assert.equal(transferred.amount, 30);
  assert.equal(transferred.source.hp, 30);
  assert.equal(transferred.target.hp, 50);
  assert.equal(healed[0].hp, 15);
  assert.equal(healed[2].hp, 25);
  assert.equal(healed[3].hp, 20);
  assert.equal(
    hunGrrrWins([{ ...maximal("hun-grrr"), hunGrrrEligible: true }], 5),
    true,
  );
});

test("Lio Convoy's protection requires a full nine-card Maximal team", () => {
  const full = Array.from({ length: 9 }, () => maximal("cheetor"));
  assert.equal(isFullFactionTeam(full, "Maximal"), true);
  assert.equal(isFullFactionTeam(full.slice(0, 8), "Maximal"), false);
  assert.equal(
    isFullFactionTeam([...full.slice(0, 8), maximal("quickstrike")], "Maximal"),
    false,
  );
});

test("the new passive abilities change deck and round state", () => {
  const alpha = maximal("alpha-trion"),
    blaster = maximal("blaster"),
    eject = maximal("eject"),
    beachcomber = maximal("beachcomber"),
    prepared = applyDeckPassives([alpha, blaster, eject, beachcomber]);
  assert.equal(prepared.find((unit) => unit.id === "eject").max, 45);
  assert.equal(prepared.find((unit) => unit.id === "eject").dmg, 15);
  assert.equal(
    prepared.find((unit) => unit.id === "beachcomber").canAttack,
    false,
  );
  const roundBoard = applyRoundPassives(
    [
      { ...maximal("dirge"), hp: 50 },
      { ...maximal("dropshot") },
      { ...maximal("brainstorm"), brainstormDeployedRound: 1 },
      null,
    ],
    4,
  );
  assert.equal(roundBoard[0].hp, 55);
  assert.equal(roundBoard[1].max, 65);
  assert.equal(roundBoard[3].name, "Brainstorm Turret");
});

test("Blurr, Mixmaster and Ramjet enforce their special rules", () => {
  const blurr = maximal("blurr"),
    moved = repositionBlurr([blurr, null], 2, () => 0);
  assert.equal(moved[0], null);
  assert.equal(moved[1].id, "blurr");
  const mixmaster = maximal("mixmaster");
  assert.equal(
    attackLimit({
      unit: mixmaster,
      board: [
        mixmaster,
        { ...maximal("dirge"), id: "bonecrusher" },
        maximal("ramjet"),
      ],
      deck: [],
      round: 2,
    }),
    2,
  );
  assert.equal(
    isCharacterAbilityImmune(
      { ...maximal("ramjet"), ramjetImmuneUntil: 3 },
      "Autobot",
      2,
    ),
    true,
  );
});

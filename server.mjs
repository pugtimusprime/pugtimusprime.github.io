import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import {
  allUnits,
  bossRushBattleCards,
  makeBossRushBattleDeck,
} from "./lib/card-data.ts";
import {
  applyDeckPassives,
  applyRoundPassives,
  empowerBreakdown,
  matchesFaction,
  matchesRole,
  triggerBrawlLastStand,
  repositionBlurr,
} from "./lib/combat-engine.mjs";

const app = express();
const httpServer = createServer(app);
const permittedOrigins = (
  process.env.CLIENT_ORIGIN ||
  "https://pugtimusprime.github.io,https://transformers-hidden-front.shadowcomicsrouges.chatgpt.site"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new Server(httpServer, {
  cors: { origin: permittedOrigins, methods: ["GET", "POST"] },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: true,
  },
});
const rooms = new Map();
const raidRooms = new Map();
const quickMatchQueue = [];
const pendingDisconnects = new Map();
const pendingRaidDisconnects = new Map();
const TURN_DURATION_MS = Math.max(
  100,
  Number(process.env.TURN_DURATION_MS || 60_000),
);
const REPOSITION_DURATION_MS = Math.max(
  100,
  Number(process.env.REPOSITION_DURATION_MS || 30_000),
);
const STANDARD_CHALLENGES = new Set(["high-priority", "the-chosen"]);

function normaliseStandardChallenges(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id) => STANDARD_CHALLENGES.has(id)))].sort()
    : [];
}

function buildPriorityTargets(room) {
  const [firstId, secondId] = [...room.players.keys()];
  const firstDeck = room.decks.get(firstId) || [];
  const secondDeck = room.decks.get(secondId) || [];
  const secondCapacity = new Map();
  secondDeck.forEach((id) => {
    const role = allUnits.find((unit) => unit.id === id)?.role;
    if (role) secondCapacity.set(role, (secondCapacity.get(role) || 0) + 1);
  });
  const selectedByRole = new Map();
  const firstTargets = [...firstDeck]
    .sort(() => Math.random() - 0.5)
    .filter((id) => {
      const role = allUnits.find((unit) => unit.id === id)?.role;
      const selected = selectedByRole.get(role) || 0;
      if (!role || selected >= (secondCapacity.get(role) || 0)) return false;
      selectedByRole.set(role, selected + 1);
      return true;
    })
    .slice(0, 3);
  const used = new Set();
  const secondTargets = firstTargets.flatMap((cardId) => {
    const role = allUnits.find((unit) => unit.id === cardId)?.role;
    const candidates = secondDeck.filter(
      (id) =>
        !used.has(id) && allUnits.find((unit) => unit.id === id)?.role === role,
    );
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (chosen) used.add(chosen);
    return chosen ? [chosen] : [];
  });
  room.priorityTargets = new Map([
    [firstId, firstTargets],
    [secondId, secondTargets],
  ]);
}

app.get("/", (_request, response) =>
  response.json({ service: "Hidden Front multiplayer", status: "online" }),
);
app.get("/health", (_request, response) =>
  response.json({
    ok: true,
    rooms: rooms.size,
    raidRooms: raidRooms.size,
    quickMatchWaiting: quickMatchQueue.length,
    version: 9,
  }),
);

const raidTemplates = {
  judge: {
    id: "quintesson-judge",
    name: "Quintesson Judge",
    role: "Leader",
    max: 850,
    hp: 850,
    dmg: 15,
    image: "/cards/characters/quintesson-judge.png",
    ability:
      "When at the start of each boss turn summon one defeated quintesson troop back to half health, if none are defeated place down one allicon and limited to two allicons on the board at a time.",
  },
  bailiff: {
    id: "quintesson-bailiff",
    name: "Quintesson Bailiff",
    role: "Commander",
    max: 80,
    hp: 80,
    dmg: 20,
    image: "/cards/characters/quintesson-bailiff.png",
    ability: "While the Bailiff is alive, the Judge takes 50% less damage.",
  },
  prosecutor: {
    id: "quintesson-prosecutor",
    name: "Quintesson Prosecutor",
    role: "Tactician",
    max: 70,
    hp: 70,
    dmg: 10,
    image: "/cards/characters/quintesson-prosecutor.png",
    ability:
      "At the start of the boss turn, mark the player character with the lowest current Health. The next Quintesson attack against that character deals +10 damage.",
  },
  executor: {
    id: "quintesson-executor",
    name: "Quintesson Executor",
    role: "Trooper",
    max: 60,
    hp: 60,
    dmg: 25,
    image: "/cards/characters/quintesson-executor.png",
    ability:
      "When attacking a character at half Health or lower, deal an additional 10 damage.",
  },
  allicon: {
    id: "allicon",
    name: "Allicon",
    role: "Scout",
    max: 40,
    hp: 40,
    dmg: 5,
    image: "/cards/characters/allicon.png",
    ability: "Gain +5 damage for every other Allicon alive, up to +10.",
  },
  unicronPhase1: {
    id: "unicron",
    name: "Unicron",
    role: "Leader",
    max: 1400,
    hp: 1400,
    dmg: 20,
    phase: 1,
    image: "/cards/characters/unicron-phase-1.png",
    ability:
      "Every third boss turn, Unicron devours one random deployed character.",
  },
  unicronPhase2: {
    id: "unicron",
    name: "Unicron",
    role: "Leader",
    max: 1400,
    hp: 999,
    dmg: 30,
    phase: 2,
    image: "/cards/characters/unicron-phase-2.png",
    ability:
      "Characters defeated by Unicron return as soldiers in his three-space legion row.",
  },
  unicronPhase3: {
    id: "unicron",
    name: "Unicron",
    role: "Leader",
    max: 1400,
    hp: 399,
    dmg: 35,
    phase: 3,
    image: "/cards/characters/unicron-phase-3.png",
    ability:
      "Summon The Fallen, Sideways and Rodimus Unicronus. Unicron cannot attack or take damage until all three are defeated.",
  },
  fallen: {
    id: "the-fallen",
    name: "The Fallen",
    role: "Commander",
    max: 80,
    hp: 80,
    dmg: 20,
    image: "/cards/characters/the-fallen.png",
    ability:
      "All Battle Cards are rendered useless until The Fallen is defeated.",
  },
  sideways: {
    id: "sideways-unicron",
    name: "Sideways",
    role: "Commander",
    max: 80,
    hp: 80,
    dmg: 20,
    image: "/cards/characters/sideways-unicron.png",
    ability: "At the start of every boss turn, heal The Fallen for 15 Health.",
  },
  rodimusUnicronus: {
    id: "rodimus-unicronus",
    name: "Rodimus Unicronus",
    role: "Commander",
    max: 80,
    hp: 80,
    dmg: 20,
    image: "/cards/characters/rodimus-unicronus.png",
    ability: "While this card is alive, The Fallen deals 15 additional damage.",
  },
};
const raidCharacterById = new Map(allUnits.map((unit) => [unit.id, unit]));
function freshRaidUnit(unit) {
  return structuredClone({ ...unit, hp: unit.max });
}
const RAID_CHALLENGES = new Set([
  "no-battle-cards",
  "six-characters",
  "enemy-bonus-damage",
]);
function normaliseRaidChallenges(challenges) {
  if (!Array.isArray(challenges)) return [];
  return [
    ...new Set(
      challenges.filter((challenge) => RAID_CHALLENGES.has(challenge)),
    ),
  ].sort();
}
function raidChallengeActive(room, challenge) {
  return room.challengeModes.includes(challenge);
}
function legalRaidDeck(ids, sixCharacterChallenge = false) {
  const requiredSize = sixCharacterChallenge ? 6 : 9;
  if (
    !Array.isArray(ids) ||
    ids.length !== requiredSize ||
    new Set(ids).size !== requiredSize ||
    ids.some((id) => typeof id !== "string" || !raidCharacterById.has(id))
  )
    return null;
  const units = applyDeckPassives(
    ids.map((id) => freshRaidUnit(raidCharacterById.get(id))),
  );
  const roles = { Commander: 0, Scout: 0, Trooper: 0, Tactician: 0 };
  for (const unit of units) roles[unit.role] += 1;
  if (sixCharacterChallenge) return units;
  return roles.Commander === 2 &&
    roles.Scout === 3 &&
    roles.Trooper === 2 &&
    roles.Tactician === 2
    ? units
    : null;
}

function createRaidRoom(code, requestedBoss = "quintesson", requestedChallenges = []) {
  const encounterId = requestedBoss === "unicron" ? "unicron" : "quintesson";
  const unicron = encounterId === "unicron";
  return {
    code,
    encounterId,
    encounterName: unicron ? "Unicron" : "Quintesson Judge",
    challengeModes: normaliseRaidChallenges(requestedChallenges),
    players: new Map(),
    stage: "lobby",
    round: 0,
    decks: new Map(),
    teams: new Map(),
    ready: new Set(),
    placementOrder: [],
    placementIndex: 0,
    turnOrder: [],
    turnIndex: 0,
    actions: 3,
    judge: { ...(unicron ? raidTemplates.unicronPhase1 : raidTemplates.judge) },
    bossBoard: unicron
      ? Array(3).fill(null)
      : [
          { ...raidTemplates.bailiff },
          { ...raidTemplates.prosecutor },
          { ...raidTemplates.executor },
          null,
          null,
          null,
        ],
    fallen: [],
    enemyDefeatPending: false,
    alliconSerial: 0,
    log: [
      unicron
        ? "Unicron approaches. The Chaos Bringer has three phases."
        : "The Quintesson Tribunal awaits judgement.",
    ],
    battleDeck: makeBossRushBattleDeck(),
    battleHand: [],
    battlePlayed: false,
    briefingReady: new Set(),
    extraActions: new Map(),
    extraRepositions: 0,
    protectiveFormation: false,
    holdLine: false,
    bossDamageBonus: 0,
    repositions: new Map(),
    courtFeedback: new Map(),
    eventSeq: 0,
    markedTarget: null,
    bossIntel: new Map(),
    revealedBossSlots: new Set(),
    bossTacticianDisabledUntil: 0,
    repositionBlockedUntil: 0,
    unicronPhaseThreeSummoned: false,
    toxicBossSpaces: {},
  };
}
function bossTroops(room) {
  return room.bossBoard.filter(Boolean);
}
function bossUnits(room) {
  return [room.judge, ...bossTroops(room)];
}
function publicBossBoard(room) {
  return room.bossBoard.map((unit, slot) => {
    if (!unit) return null;
    if (room.encounterId === "unicron")
      return { ...unit, slot, hidden: false, occupied: true };
    return room.revealedBossSlots.has(slot)
      ? { ...unit, slot, hidden: false, occupied: true }
      : { slot, hidden: true, occupied: true };
  });
}
function publicRaidTeam(team, ownerId, viewerId) {
  if (!team) return null;
  const hiddenBackup = (index) => ({
    id: "hidden-backup-" + ownerId + "-" + index,
    name: "Hidden Backup",
    faction: "Autobot",
    role: "Scout",
    max: 1,
    hp: 1,
    dmg: 0,
    image: "",
    ability: "",
    abilityUses: 0,
    canAttack: false,
  });
  return {
    ...team,
    backups:
      viewerId === ownerId
        ? team.backups
        : team.backups.map((_, index) => hiddenBackup(index)),
    // Each player deploys simultaneously, but their undeployed choices remain private.
    pending: viewerId === ownerId ? team.pending : [],
  };
}
function raidPublic(room, viewer) {
  const unicron = room.encounterId === "unicron";
  return {
    code: room.code,
    encounterId: room.encounterId,
    encounterName: room.encounterName,
    challengeModes: room.challengeModes,
    bossColumns: unicron ? 3 : 3,
    bossRows: unicron ? 1 : 2,
    bossCardsVisible: unicron,
    stage: room.stage,
    round: room.round,
    youId: viewer,
    activeId:
      room.stage === "combat" ? room.turnOrder[room.turnIndex] || null : null,
    placementActiveId:
      room.stage === "deployment" &&
      (room.teams.get(viewer)?.pending?.length || 0) > 0
        ? viewer
        : null,
    actions: room.actions,
    repositions: Object.fromEntries(room.repositions),
    players: [...room.players.values()].map((p) => ({
      ...p,
      ready: room.ready.has(p.id),
      team: publicRaidTeam(room.teams.get(p.id), p.id, viewer),
    })),
    judge: room.judge,
    boss: [room.judge],
    bossBoard: publicBossBoard(room),
    courtFeedback: Object.fromEntries(room.courtFeedback),
    battleHand: room.battleHand,
    battleCards: raidChallengeActive(room, "no-battle-cards")
      ? []
      : bossRushBattleCards,
    battlePlayed: room.battlePlayed,
    briefingReady: room.briefingReady.has(viewer),
    bossRoster: unicron
      ? [
          raidTemplates.unicronPhase1,
          raidTemplates.unicronPhase2,
          raidTemplates.unicronPhase3,
          raidTemplates.fallen,
          raidTemplates.sideways,
          raidTemplates.rodimusUnicronus,
        ]
      : [
          raidTemplates.judge,
          raidTemplates.bailiff,
          raidTemplates.prosecutor,
          raidTemplates.executor,
          raidTemplates.allicon,
        ],
    log: room.log.slice(-30),
    eventSeq: room.eventSeq,
  };
}
function emitRaid(room) {
  for (const [id] of room.players)
    io.to(id).emit("raid-state", raidPublic(room, id));
}
function raidEvent(room, event) {
  room.eventSeq += 1;
  for (const [id] of room.players)
    io.to(id).emit("raid-event", { ...event, seq: room.eventSeq });
}
function livingRaidUnits(team) {
  return [
    ...(team?.board || []),
    ...(team?.backups || []),
    ...(team?.pending || []),
  ].filter((u) => u && u.hp > 0);
}
function firstEmptyPlayerSlot(room, playerId) {
  const team = room.teams.get(playerId);
  if (!team) return -1;
  for (let i = 0; i < 9; i++) if (!team.board[i]) return i;
  return -1;
}
function drawRaidCards(room, amount = 1) {
  if (raidChallengeActive(room, "no-battle-cards")) return;
  for (let i = 0; i < amount; i++) {
    if (!room.battleDeck.length) room.battleDeck = makeBossRushBattleDeck();
    const card = room.battleDeck.shift();
    if (card) room.battleHand.push(card);
  }
}
function raidIntel(room, playerId) {
  if (!room.bossIntel.has(playerId))
    room.bossIntel.set(playerId, { occupied: new Set(), empty: new Set() });
  return room.bossIntel.get(playerId);
}
function raidTargetCandidates(room, includeUnknown = false) {
  const candidates = [];
  for (const [playerId, team] of room.teams)
    for (let slot = 0; slot < team.board.length; slot++) {
      const unit = team.board[slot],
        intel = raidIntel(room, playerId);
      if (includeUnknown) {
        if (team.hiddenSpaces?.includes(slot)) continue;
        if (intel.empty.has(slot)) continue;
        candidates.push({
          playerId,
          unit: unit?.hp > 0 ? unit : null,
          slot,
          hidden: true,
          known: intel.occupied.has(slot),
        });
      } else if (unit?.hp > 0) candidates.push({ playerId, unit, slot });
    }
  return candidates;
}
function raidUtility(candidate, damage) {
  if (candidate.hidden) {
    const centrality = candidate.known && candidate.slot % 3 === 1 ? 8 : 0;
    return (candidate.known ? 130 : 45) + damage * 8 + centrality;
  }
  const remaining = Math.max(0, candidate.unit.hp - damage);
  return (
    (remaining === 0 ? 10000 : 0) +
    damage * 20 +
    (candidate.unit.max - remaining) * 2
  );
}
function minimaxRaidTarget(candidates, attacker, depth = 2) {
  if (!candidates.length) return null;
  const damage = attacker.dmg;
  const search = (options, remaining, maximizing) => {
    if (!options.length) return -Infinity;
    if (remaining <= 0)
      return maximizing
        ? Math.max(...options.map((c) => raidUtility(c, damage)))
        : Math.min(...options.map((c) => raidUtility(c, damage)));
    const scores = options.map((candidate) => {
      const survives = candidate.hidden || candidate.unit.hp > damage;
      const next = options.filter((entry) => entry !== candidate || survives);
      const immediate = raidUtility(candidate, damage);
      return maximizing
        ? immediate + 0.25 * search(next, remaining - 1, false)
        : immediate - 0.25 * search(next, remaining - 1, true);
    });
    return maximizing ? Math.max(...scores) : Math.min(...scores);
  };
  const scored = candidates.map((candidate) => ({
    candidate,
    score:
      raidUtility(candidate, damage) +
      0.25 *
        search(
          candidates.filter((entry) => entry !== candidate),
          depth - 1,
          false,
        ),
  }));
  const best = Math.max(...scored.map((entry) => entry.score));
  const tied = scored.filter((entry) => Math.abs(entry.score - best) < 0.001);
  return (
    tied[Math.floor(Math.random() * tied.length)]?.candidate ||
    scored[0].candidate
  );
}
function hiddenCourtSnapshot(board) {
  return board.map((unit, slot) =>
    unit
      ? {
          slot,
          hidden: true,
          occupied: true,
          hp: unit.hp,
          max: unit.max,
        }
      : null,
  );
}
function hiddenCourtValue(board) {
  return board.reduce((score, card, slot) => {
    if (!card?.occupied) return score;
    const health = Math.max(0, card.hp);
    const centrality = slot % 3 === 1 ? 8 : 0;
    // Hidden cards are still known to the boss as occupied threats, but their
    // identity is deliberately absent from this evaluation state.
    return score + 100 + health * 2 + centrality + (card.hidden ? 12 : 0);
  }, 0);
}
function hiddenCourtThreat(board, slot, damage) {
  return board.map((card, index) => {
    if (index !== slot || !card?.occupied) return card;
    const hp = Math.max(0, card.hp - damage);
    return hp > 0 ? { ...card, hp } : null;
  });
}
function revealRandomBossTroop(room) {
  room.revealedBossSlots.clear();
  const occupied = room.bossBoard
    .map((unit, index) => (unit?.hp > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (!occupied.length) return -1;
  const slot = occupied[Math.floor(Math.random() * occupied.length)];
  room.revealedBossSlots.add(slot);
  return slot;
}
function minimaxHiddenCourtMove(board, playerDamage, depth = 2) {
  const occupied = board
    .map((card, index) => (card ? index : -1))
    .filter((index) => index >= 0);
  if (occupied.length < 2)
    return { from: -1, to: -1, score: hiddenCourtValue(board) };
  const moves = [{ from: -1, to: -1, board }];
  for (const from of occupied)
    for (const to of occupied)
      if (from < to) {
        const next = board.slice();
        [next[from], next[to]] = [next[to], next[from]];
        moves.push({ from, to, board: next });
      }
  const search = (state, remaining, maximizing) => {
    if (remaining <= 0) return hiddenCourtValue(state);
    if (maximizing) {
      return Math.max(
        ...movesFor(state).map((move) =>
          search(move.board, remaining - 1, false),
        ),
      );
    }
    const targets = state
      .map((card, index) => (card ? index : -1))
      .filter((index) => index >= 0);
    if (!targets.length || playerDamage <= 0) return hiddenCourtValue(state);
    return Math.min(
      ...targets.map((slot) =>
        search(
          hiddenCourtThreat(state, slot, playerDamage),
          remaining - 1,
          true,
        ),
      ),
    );
  };
  const movesFor = (state) => {
    const slots = state
      .map((card, index) => (card ? index : -1))
      .filter((index) => index >= 0);
    const options = [{ from: -1, to: -1, board: state }];
    for (const from of slots)
      for (const to of slots)
        if (from < to) {
          const next = state.slice();
          [next[from], next[to]] = [next[to], next[from]];
          options.push({ from, to, board: next });
        }
    return options;
  };
  return moves
    .map((move) => ({ ...move, score: search(move.board, depth - 1, false) }))
    .sort((a, b) => b.score - a.score)[0];
}
function moveBossMinimax(room) {
  for (let move = 0; move < 2; move++) {
    const state = hiddenCourtSnapshot(room.bossBoard);
    const playerDamage = Math.max(
      0,
      ...raidTargetCandidates(room).map(({ unit }) => unit.dmg),
    );
    const best = minimaxHiddenCourtMove(state, playerDamage, 2);
    if (best.from < 0 || best.to < 0) break;
    [room.bossBoard[best.from], room.bossBoard[best.to]] = [
      room.bossBoard[best.to],
      room.bossBoard[best.from],
    ];
  }
  revealRandomBossTroop(room);
  room.courtFeedback.clear();
  room.log.push(
    "The Quintesson court repositioned two spaces and revealed one troop for this round.",
  );
  raidEvent(room, { kind: "reposition", side: "boss" });
}
function summonOrRevive(room) {
  if (room.encounterId !== "quintesson") return;
  const empty = room.bossBoard.findIndex(
    (unit, slot) => !unit && (room.toxicBossSpaces[slot] || 0) < room.round,
  );
  if (empty < 0) return;
  const fallen = room.fallen.shift();
  if (fallen) {
    room.bossBoard[empty] = { ...fallen, hp: Math.ceil(fallen.max / 2) };
    room.log.push("A defeated Quintesson troop returned at half Health.");
    raidEvent(room, { kind: "summon", slot: empty, side: "boss" });
    return;
  }
  const allicons = bossTroops(room).filter((unit) =>
    unit.id.startsWith("allicon"),
  ).length;
  if (allicons < 2) {
    room.alliconSerial += 1;
    room.bossBoard[empty] = {
      ...raidTemplates.allicon,
      id: `allicon-${room.alliconSerial}`,
    };
    room.log.push("The Judge placed a hidden Allicon on the court.");
    raidEvent(room, { kind: "summon", slot: empty, side: "boss" });
  }
}
function summonCorruptedSoldier(room, defeated) {
  if (room.encounterId !== "unicron" || room.judge.phase !== 2) return;
  const slot = room.bossBoard.findIndex((unit) => !unit);
  if (slot < 0) return;
  room.bossBoard[slot] = {
    ...structuredClone(defeated),
    id: `corrupted-${defeated.id}-${room.round}-${slot}`,
    name: `${defeated.name} — Corrupted`,
    hp: defeated.max,
    ability:
      "Defeated by Unicron and returned as a soldier of the Chaos Bringer.",
  };
  room.revealedBossSlots.add(slot);
  room.log.push(
    `${defeated.name} returned at full Health as Unicron's soldier.`,
  );
  raidEvent(room, { kind: "summon", slot, side: "boss" });
}
function updateUnicronPhase(room) {
  if (room.encounterId !== "unicron" || room.judge.hp <= 0) return;
  const next =
    room.judge.hp >= 1000
      ? raidTemplates.unicronPhase1
      : room.judge.hp >= 400
        ? raidTemplates.unicronPhase2
        : raidTemplates.unicronPhase3;
  if (room.judge.phase === next.phase) return;
  const hp = room.judge.hp;
  room.judge = { ...room.judge, ...next, hp, max: 1400 };
  room.log.push(`Unicron entered Phase ${next.phase}. ${next.ability}`);
  raidEvent(room, {
    kind: "phase",
    name: `Unicron Phase ${next.phase}`,
    side: "boss",
  });
  if (next.phase === 3 && !room.unicronPhaseThreeSummoned) {
    room.unicronPhaseThreeSummoned = true;
    room.bossBoard = [
      { ...raidTemplates.fallen },
      { ...raidTemplates.sideways },
      { ...raidTemplates.rodimusUnicronus },
    ];
    room.revealedBossSlots = new Set([0, 1, 2]);
    room.fallen = [];
    room.log.push(
      "The Fallen, Sideways and Rodimus Unicronus entered the legion row.",
    );
  }
}
function reinforceRaidTeam(room, team, slot) {
  if (!team.backups.length) return;
  const replacement = team.backups.shift();
  if (replacement.id === "brainstorm")
    replacement.brainstormDeployedRound = room.round;
  team.board[slot] = replacement;
  room.log.push(`${replacement.name} reinforced its owner's 3 x 3 board.`);
}
function recordBossIntel(room, target) {
  const intel = raidIntel(room, target.playerId);
  if (target.unit?.hp > 0) {
    intel.occupied.add(target.slot);
    intel.empty.delete(target.slot);
  } else {
    intel.empty.add(target.slot);
    intel.occupied.delete(target.slot);
  }
}
function raidBossTurn(room) {
  room.stage = "boss";
  emitRaid(room);
  summonOrRevive(room);
  if (room.encounterId === "unicron" && room.judge.phase === 3) {
    const fallen = bossTroops(room).find(
      (unit) => unit.id === "the-fallen" && unit.hp > 0,
    );
    const sideways = bossTroops(room).find(
      (unit) =>
        unit.id === "sideways-unicron" &&
        unit.hp > 0 &&
        (unit.raidAbilityDisabledUntil || 0) < room.round,
    );
    if (fallen && sideways) {
      fallen.hp = Math.min(fallen.max, fallen.hp + 15);
      room.log.push("Sideways restored 15 Health to The Fallen.");
    }
  }
  if (
    room.encounterId === "unicron" &&
    room.judge.phase === 1 &&
    room.round % 3 === 0
  ) {
    const victims = raidTargetCandidates(room);
    const devoured = victims[Math.floor(Math.random() * victims.length)];
    if (devoured) {
      const team = room.teams.get(devoured.playerId);
      devoured.unit.hp = 0;
      team.board[devoured.slot] = null;
      team.fallen = [...(team.fallen || []), devoured.unit];
      room.log.push(`Unicron devoured ${devoured.unit.name}.`);
      raidEvent(room, {
        kind: "hit",
        attackerId: room.judge.id,
        targetId: devoured.unit.id,
        damage: devoured.unit.max,
        side: "boss",
        defeated: true,
      });
      raidEvent(room, {
        kind: "player-defeat",
        defeatedName: devoured.unit.name,
        side: "boss",
      });
      reinforceRaidTeam(room, team, devoured.slot);
    }
  }
  for (let slot = 0; slot < room.bossBoard.length; slot++) {
    const poisoned = room.bossBoard[slot];
    if (!poisoned?.raidPoison) continue;
    poisoned.hp = Math.max(0, poisoned.hp - 5);
    poisoned.raidPoison = Math.max(0, poisoned.raidPoison - 1);
    if (poisoned.hp === 0) defeatRaidBossUnit(room, { unit: poisoned, slot });
  }
  const candidates = raidTargetCandidates(room, true);
  const prosecutor = bossTroops(room).find(
    (unit) =>
      unit.id === "quintesson-prosecutor" &&
      unit.hp > 0 &&
      (unit.raidAbilityDisabledUntil || 0) < room.round,
  );
  const marked = prosecutor
    ? minimaxRaidTarget(candidates, prosecutor, 2)
    : null;
  room.markedTarget = marked
    ? { playerId: marked.playerId, slot: marked.slot }
    : null;
  if (marked)
    room.log.push(
      "The Prosecutor marked a concealed player position for judgement.",
    );
  for (const attacker of bossUnits(room).filter((unit) => unit.hp > 0)) {
    if (
      room.encounterId === "unicron" &&
      attacker.id === "unicron" &&
      room.judge.phase === 3 &&
      bossTroops(room).some((unit) => unit.hp > 0)
    )
      continue;
    if (attacker.raidSuppressedUntil >= room.round) continue;
    if (
      attacker.role === "Tactician" &&
      room.bossTacticianDisabledUntil >= room.round
    )
      continue;
    const live = raidTargetCandidates(room, true);
    if (!live.length) break;
    const markedLive =
      marked &&
      live.find(
        (entry) =>
          entry.playerId === marked.playerId && entry.slot === marked.slot,
      );
    const forced =
      room.drawTheirFire &&
      live.find(
        (entry) =>
          entry.playerId === room.drawTheirFire.playerId &&
          entry.unit?.id === room.drawTheirFire.unitId,
      );
    const chosen =
      forced ||
      (attacker.id === "quintesson-prosecutor" && markedLive
        ? markedLive
        : minimaxRaidTarget(live, attacker, 2));
    if (!chosen) continue;
    if (!chosen.unit) {
      recordBossIntel(room, chosen);
      room.log.push(
        `${attacker.id === "quintesson-judge" ? attacker.name : "A hidden Quintesson troop"} searched player space ${chosen.slot + 1} and missed.`,
      );
      raidEvent(room, { kind: "miss", side: "boss", targetSlot: chosen.slot });
      continue;
    }
    const targetTeam = room.teams.get(chosen.playerId);
    if (targetTeam?.traps?.includes(chosen.slot)) {
      recordBossIntel(room, chosen);
      targetTeam.traps = targetTeam.traps.filter(
        (slot) => slot !== chosen.slot,
      );
      room.log.push("An Ambush Trap cancelled the hidden Quintesson attack.");
      raidEvent(room, { kind: "trap", side: "boss", targetSlot: chosen.slot });
      continue;
    }
    let damage = attacker.dmg + room.bossDamageBonus;
    if (raidChallengeActive(room, "enemy-bonus-damage"))
      damage += attacker.id === room.judge.id ? 15 : 10;
    if (
      attacker.id === "the-fallen" &&
      bossTroops(room).some(
        (unit) =>
          unit.id === "rodimus-unicronus" &&
          unit.hp > 0 &&
          (unit.raidAbilityDisabledUntil || 0) < room.round,
      )
    )
      damage += 15;
    if (
      room.markedTarget &&
      room.markedTarget.playerId === chosen.playerId &&
      room.markedTarget.slot === chosen.slot
    ) {
      damage += 10;
      room.markedTarget = null;
    }
    if (
      attacker.id === "quintesson-executor" &&
      (attacker.raidAbilityDisabledUntil || 0) < room.round &&
      chosen.unit.hp <= chosen.unit.max / 2
    )
      damage += 10;
    if (
      attacker.id.startsWith("allicon") &&
      (attacker.raidAbilityDisabledUntil || 0) < room.round
    )
      damage += Math.min(
        10,
        bossTroops(room).filter(
          (unit) =>
            unit.id.startsWith("allicon") && unit.hp > 0 && unit !== attacker,
        ).length * 5,
      );
    if (targetTeam?.armorTargets?.includes(chosen.unit.id)) {
      damage = Math.max(0, damage - 10);
      targetTeam.armorTargets = targetTeam.armorTargets.filter(
        (id) => id !== chosen.unit.id,
      );
    }
    if (chosen.unit.raidCover) {
      damage = Math.max(0, damage - chosen.unit.raidCover);
      chosen.unit.raidCover = 0;
    }
    if (room.protectiveFormation) damage = Math.max(0, damage - 5);
    if (room.drawTheirFire?.unitId === chosen.unit.id)
      damage = Math.max(0, damage - 10);
    if (
      chosen.unit.damageImmuneUntil >= room.round ||
      chosen.unit.raidShieldUntil >= room.round
    )
      damage = 0;
    chosen.unit.hp = Math.max(0, chosen.unit.hp - damage);
    if (chosen.unit.id === "beachcomber" && damage > 0) {
      attacker.hp = Math.max(0, attacker.hp - 10);
      room.log.push(
        "Beachcomber's pacifist field dealt 10 damage back to the attacker.",
      );
    }
    if (chosen.unit.id === "hun-grrr" && damage > 0)
      chosen.unit.hunGrrrEligible = false;
    if (chosen.unit.hp === 0 && room.holdLine) {
      chosen.unit.hp = 10;
      room.holdLine = false;
      room.log.push(`${chosen.unit.name} held the line at 10 Health.`);
    }
    if (
      chosen.unit.id === "mirage" &&
      chosen.unit.abilityUses > 0 &&
      damage > 0 &&
      chosen.unit.hp > 0
    ) {
      chosen.unit.abilityUses--;
      const intel = raidIntel(room, chosen.playerId);
      intel.empty.add(chosen.slot);
      intel.occupied.delete(chosen.slot);
      room.log.push(
        "Mirage disguised the successful hit as an empty-space miss.",
      );
    } else recordBossIntel(room, chosen);
    const attackerName =
      room.encounterId === "unicron"
        ? attacker.name
        : attacker.id === "quintesson-judge"
          ? attacker.name
          : "A hidden Quintesson troop";
    room.log.push(`${attackerName} struck ${chosen.unit.name} for ${damage}.`);
    raidEvent(room, {
      kind: "hit",
      attackerId: attacker.id === "quintesson-judge" ? attacker.id : undefined,
      targetId: chosen.unit.id,
      damage,
      side: "boss",
      defeated: chosen.unit.hp === 0,
    });
    if (chosen.unit.hp === 0) {
      const team = room.teams.get(chosen.playerId);
      const lastStand = triggerBrawlLastStand(chosen.unit);
      if (lastStand) {
        team.board[chosen.slot] = lastStand;
        room.log.push(
          "Brawl entered Last Stand and may make one final attack.",
        );
        continue;
      }
      team.board[chosen.slot] = null;
      team.fallen = [...(team.fallen || []), chosen.unit];
      if (
        chosen.unit.id === "blades" &&
        [...team.board, ...team.backups, ...(team.fallen || [])].some(
          (unit) => unit?.id === "brawn",
        )
      ) {
        room.battleHand = [];
        room.log.push(
          "Blades fell beside Brawn; the shared Battle Card hand was scrapped.",
        );
      }
      reinforceRaidTeam(room, team, chosen.slot);
      if (attacker.id === "unicron") summonCorruptedSoldier(room, chosen.unit);
      raidEvent(room, {
        kind: "player-defeat",
        defeatedName: chosen.unit.name,
        side: "boss",
      });
    }
  }
  room.protectiveFormation = false;
  room.drawTheirFire = null;
  room.bossDamageBonus = 0;
  room.breakDefences = false;
  if (
    [...room.teams.values()].every((team) => livingRaidUnits(team).length === 0)
  ) {
    room.stage = "defeat";
    room.log.push("Both player teams were defeated.");
    emitRaid(room);
    return;
  }
  if (room.encounterId === "unicron") {
    room.revealedBossSlots = new Set(
      room.bossBoard
        .map((unit, slot) => (unit?.hp > 0 ? slot : -1))
        .filter((slot) => slot >= 0),
    );
    room.courtFeedback.clear();
  } else if (room.repositionBlockedUntil === room.round) {
    room.log.push("Rattrap prevented the Quintesson court from repositioning.");
    revealRandomBossTroop(room);
  } else moveBossMinimax(room);
  room.repositions = new Map(
    [...room.players.keys()].map((id) => [id, 1 + room.extraRepositions]),
  );
  room.extraRepositions = 0;
  room.stage = "reposition";
  room.actions = 0;
  emitRaid(room);
}
function startRaidRound(room) {
  room.round += 1;
  for (const team of room.teams.values()) {
    team.board = applyRoundPassives(
      room.round > 1 ? repositionBlurr(team.board, room.round - 1) : team.board,
      room.round,
      team.backups,
    );
  }
  for (const team of room.teams.values()) {
    const requiredRound = team.hunGrrrWinRound || 5;
    const hunGrrr = team.board.find(
      (unit) =>
        unit?.id === "hun-grrr" && unit.hunGrrrEligible && unit.hp === unit.max,
    );
    if (hunGrrr && room.round >= requiredRound) {
      room.stage = "victory";
      room.log.push(
        `Hun-Grrr remained deployed and undamaged through round ${requiredRound}. Raid victory!`,
      );
      emitRaid(room);
      return;
    }
  }
  room.stage = "combat";
  room.turnIndex = 0;
  room.repositions.clear();
  room.turnOrder.reverse();
  if (!room.turnOrder.length) room.turnOrder = [...room.players.keys()];
  room.actions = 3 + (room.extraActions.get(room.turnOrder[0]) || 0);
  room.extraActions.delete(room.turnOrder[0]);
  room.battlePlayed = false;
  room.courtFeedback.clear();
  if (room.round === 1) revealRandomBossTroop(room);
  const cliffjumperOpening =
    room.round === 1 &&
    [...room.teams.values()].some((team) =>
      [...team.board, ...team.backups].some(
        (unit) => unit?.id === "cliffjumper",
      ),
    );
  drawRaidCards(room, cliffjumperOpening ? 2 : 1);
  if (
    room.round <= 2 &&
    [...room.teams.values()].some((team) =>
      team.board.some((unit) => unit?.id === "cosmos"),
    )
  )
    room.bossBoard.forEach((unit, slot) => {
      if (unit?.role === "Tactician") room.revealedBossSlots.add(slot);
    });
  room.teams.forEach((team) => {
    team.used = [];
    team.usedAbilities = [];
    team.faceOff = false;
    team.traps = [];
    team.hiddenSpaces = [];
  });
  emitRaid(room);
}
function completeRaidReposition(room) {
  if ([...room.repositions.values()].some((moves) => moves > 0)) return;
  startRaidRound(room);
}
function findBossTarget(room, id, targetSlot) {
  if (id === room.judge.id && room.judge.hp > 0)
    return { unit: room.judge, slot: -1 };
  if (
    !Number.isInteger(targetSlot) ||
    targetSlot < 0 ||
    targetSlot >= room.bossBoard.length
  )
    return null;
  const unit = room.bossBoard[targetSlot];
  return unit?.hp > 0 ? { unit, slot: targetSlot } : null;
}
function findPlayerUnit(room, id, ownerId) {
  for (const [playerId, team] of room.teams) {
    if (ownerId && playerId !== ownerId) continue;
    const slot = team.board.findIndex((unit) => unit?.id === id && unit.hp > 0);
    if (slot >= 0) return { playerId, team, unit: team.board[slot], slot };
  }
  return null;
}
function raidAttackDamage(room, team, attacker, slot) {
  let damage =
    attacker.id === "blight" && livingRaidUnits(team).length === 1
      ? 40
      : attacker.dmg;
  if (
    attacker.id === "bee" &&
    team.board.some(
      (unit) => unit?.faction === "Autobot" && unit.role === "Commander",
    )
  )
    damage += 5;
  if (
    team.board.some(
      (unit, index) =>
        unit?.id === "quickstrike" &&
        Math.floor(index / 3) === Math.floor(slot / 3),
    )
  )
    damage += 5;
  if (
    attacker.role === "Trooper" &&
    (attacker.airRaidBoostUntil || 0) >= room.round
  )
    damage += 10;
  if (attacker.raidWheeljackBoost) {
    damage += 5;
    attacker.raidWheeljackBoost = false;
  }
  if (attacker.raidSignalBoost) {
    damage += 5;
    attacker.raidSignalBoost = false;
  }
  if (attacker.raidRumbleBoost) {
    damage += 10;
    attacker.raidRumbleBoost = false;
  }
  if (attacker.raidRampageBoost) {
    damage += 10;
    attacker.raidRampageBoost = false;
  }
  if (attacker.raidWolfangBoost && room.judge.faction === "Predacon")
    damage += 10;
  if (
    attacker.id === "optimal" &&
    team.board.some((unit) => unit?.id === "primal" || unit?.id === "optimus")
  )
    damage = 30;
  if (team.reflectionDamage > 0) {
    damage = team.reflectionDamage;
    team.reflectionDamage = 0;
  }
  return damage;
}
function resolveBossDamage(room, target, damage) {
  if (
    room.encounterId === "unicron" &&
    target.unit.id === "unicron" &&
    room.judge.phase === 3 &&
    bossTroops(room).some((unit) => unit.hp > 0)
  ) {
    room.log.push(
      "Unicron ignored the attack while his Phase 3 legion remains alive.",
    );
    return 0;
  }
  const bailiffProtects =
    !room.breakDefences &&
    target.unit.id === room.judge.id &&
    bossTroops(room).some(
      (unit) =>
        unit.id === "quintesson-bailiff" &&
        unit.hp > 0 &&
        (unit.raidAbilityDisabledUntil || 0) < room.round,
    );
  const adjusted = bailiffProtects ? Math.ceil(damage / 2) : damage;
  target.unit.hp = Math.max(0, target.unit.hp - adjusted);
  updateUnicronPhase(room);
  return adjusted;
}
function bossTargetKey(room, target) {
  return target.unit.id === room.judge.id
    ? room.judge.id
    : `court-${target.slot}`;
}
function applyRaidBattleAttackBonuses(
  room,
  playerId,
  attacker,
  target,
  damage,
) {
  const key = bossTargetKey(room, target);
  if (room.coordinatedStrike) {
    if (!room.coordinatedStrike.key) room.coordinatedStrike.key = key;
    if (
      room.coordinatedStrike.key === key &&
      !room.coordinatedStrike.players.includes(playerId)
    ) {
      damage += 5;
      room.coordinatedStrike.players.push(playerId);
      if (room.coordinatedStrike.players.length >= 2)
        room.coordinatedStrike = null;
    }
  }
  if (
    room.concentratedFire?.key === key &&
    room.concentratedFire.remaining > 0
  ) {
    damage += 5;
    room.concentratedFire.remaining -= 1;
    if (room.concentratedFire.remaining <= 0) room.concentratedFire = null;
  }
  if (room.exploitWeakness === key) {
    damage += 10;
    room.exploitWeakness = null;
  }
  if (room.perfectOpening && target.unit.id === room.judge.id) {
    damage = Math.min(40, damage * 2);
    room.perfectOpening = false;
  }
  if (attacker.raidLastStandBoost) {
    damage += 15;
    attacker.raidLastStandBoost = false;
  }
  if (attacker.raidOvercharge) {
    damage += 20;
    attacker.raidOvercharge = false;
    attacker.raidOverchargeBacklash = true;
  }
  return damage;
}

function weakestRaidUnit(room, playerId) {
  return (
    raidTargetCandidates(room)
      .filter((entry) => !playerId || entry.playerId === playerId)
      .sort((a, b) => a.unit.hp - b.unit.hp)[0] || null
  );
}

function playBossRushCard(room, playerId, name, targetId, targetSlot) {
  const team = room.teams.get(playerId);
  const ownTarget = targetId ? findPlayerUnit(room, targetId, playerId) : null;
  const friendly = ownTarget || weakestRaidUnit(room, playerId);
  const bossTarget = targetId
    ? findBossTarget(room, targetId, targetSlot)
    : Number.isInteger(targetSlot)
      ? findBossTarget(room, undefined, targetSlot)
      : findBossTarget(room, room.judge.id);
  const key = bossTarget ? bossTargetKey(room, bossTarget) : room.judge.id;
  let effect = `${name} resolved.`;
  if (name === "Coordinated Strike") {
    room.coordinatedStrike = { key, players: [] };
    effect =
      "Coordinated Strike armed a +5 attack for each player against the same enemy.";
  } else if (name === "Emergency Repairs") {
    if (!friendly)
      return { ok: false, error: "No friendly character can be repaired." };
    friendly.unit.hp = Math.min(friendly.unit.max, friendly.unit.hp + 15);
    effect = `${friendly.unit.name} repaired 15 Health.`;
  } else if (name === "Cover Your Ally") {
    if (!friendly)
      return { ok: false, error: "No friendly character can be covered." };
    friendly.unit.raidCover = 10;
    effect = `${friendly.unit.name} will take 10 less damage from the next hit.`;
  } else if (name === "Combat Analysis") {
    const hidden = room.bossBoard
      .map((unit, index) =>
        unit && !room.revealedBossSlots.has(index) ? index : -1,
      )
      .filter((slot) => slot >= 0);
    if (hidden.length)
      room.revealedBossSlots.add(
        hidden[Math.floor(Math.random() * hidden.length)],
      );
    effect = "Combat Analysis revealed one non-boss enemy.";
  } else if (name === "Repositioning Orders") {
    room.extraRepositions += 1;
    effect = "Both players gained one additional reposition move.";
  } else if (name === "Concentrated Fire") {
    room.concentratedFire = { key, remaining: 3 };
    effect =
      "Concentrated Fire armed +5 damage for the next three attacks against the target.";
  } else if (name === "Tactical Withdrawal") {
    const deployed = raidTargetCandidates(room)
      .filter((entry) => entry.playerId === playerId)
      .sort((a, b) => a.unit.hp - b.unit.hp)[0];
    const backup = team?.backups.shift();
    if (!deployed || !backup)
      return {
        ok: false,
        error: "You need a deployed character and a Backup.",
      };
    team.board[deployed.slot] = backup;
    team.backups.push(deployed.unit);
    effect = `${backup.name} replaced ${deployed.unit.name} without spending a move.`;
  } else if (name === "Shared Energon") {
    for (const [id] of room.teams) {
      const target = weakestRaidUnit(room, id);
      if (target)
        target.unit.hp = Math.min(target.unit.max, target.unit.hp + 10);
    }
    effect = "One character belonging to each player recovered 10 Health.";
  } else if (name === "Protective Formation") {
    room.protectiveFormation = true;
    effect =
      "All deployed characters will take 5 less damage during the next boss turn.";
  } else if (name === "Suppressing Fire") {
    const target =
      bossTarget?.unit && bossTarget.unit.id !== room.judge.id
        ? bossTarget.unit
        : bossTroops(room).find((unit) => unit.hp > 0);
    if (!target)
      return { ok: false, error: "No non-boss enemy can be suppressed." };
    target.raidSuppressedUntil = room.round;
    effect = "One non-boss enemy was suppressed for the next boss turn.";
  } else if (name === "Exploit Weakness") {
    room.exploitWeakness = key;
    effect = "The next attack against the target gains +10 damage.";
  } else if (name === "System Disruption") {
    const target =
      bossTarget?.unit && bossTarget.unit.id !== room.judge.id
        ? bossTarget.unit
        : bossTroops(room).find((unit) => unit.hp > 0);
    if (!target)
      return { ok: false, error: "No non-boss enemy can be disrupted." };
    target.raidAbilityDisabledUntil = room.round;
    effect = `${target.name}'s ability was disabled through the next boss turn.`;
  } else if (name === "Hold the Line") {
    room.holdLine = true;
    effect =
      "The first allied character defeated during the next boss turn will remain at 10 Health.";
  } else if (name === "All-Out Assault") {
    room.actions += 1;
    for (const id of room.turnOrder)
      if (id !== playerId)
        room.extraActions.set(id, (room.extraActions.get(id) || 0) + 1);
    effect = "Both players gained one additional attack this round.";
  } else if (name === "Break Their Defences") {
    room.breakDefences = true;
    effect = "Enemy damage reduction is disabled until the end of the round.";
  } else if (name === "Perfect Opening") {
    room.perfectOpening = true;
    effect = "The next attack against the boss deals double damage, up to 40.";
  } else if (name === "Emergency Reinforcements") {
    const slot = firstEmptyPlayerSlot(room, playerId);
    const backup = team?.backups.shift();
    if (slot < 0 || !backup)
      return {
        ok: false,
        error: "You need an empty board space and a Backup.",
      };
    team.board[slot] = backup;
    effect = `${backup.name} deployed from the Backups without spending an action.`;
  } else if (name === "Last One Standing") {
    const target = raidTargetCandidates(room)
      .filter(
        (entry) =>
          entry.playerId === playerId && entry.unit.hp <= entry.unit.max / 2,
      )
      .sort((a, b) => a.unit.hp - b.unit.hp)[0];
    if (!target)
      return {
        ok: false,
        error: "No character below half Health can use Last One Standing.",
      };
    target.unit.raidLastStandBoost = true;
    effect = `${target.unit.name}'s next attack gains +15 damage.`;
  } else if (name === "Refuse to Fall") {
    const fallen = team?.fallen?.shift();
    if (!fallen)
      return { ok: false, error: "You have no defeated character to revive." };
    fallen.hp = Math.max(1, Math.ceil(fallen.max * 0.25));
    team.backups.push(fallen);
    effect = `${fallen.name} returned to the Backups at 25% Health.`;
  } else if (name === "Danger Close") {
    const target = bossTarget || findBossTarget(room, room.judge.id);
    if (!target) return { ok: false, error: "No enemy can be targeted." };
    const damage = resolveBossDamage(room, target, 30);
    const allies = raidTargetCandidates(room);
    const struck = allies[Math.floor(Math.random() * allies.length)];
    if (struck) {
      struck.unit.hp = Math.max(0, struck.unit.hp - 10);
      if (struck.unit.hp === 0) {
        const struckTeam = room.teams.get(struck.playerId);
        struckTeam.board[struck.slot] = null;
        struckTeam.fallen = [...(struckTeam.fallen || []), struck.unit];
        reinforceRaidTeam(room, struckTeam, struck.slot);
        raidEvent(room, {
          kind: "player-defeat",
          defeatedName: struck.unit.name,
          side: "players",
        });
      }
    }
    if (target.unit.hp === 0) defeatRaidBossUnit(room, target);
    effect = `Danger Close dealt ${damage} to the enemy and 10 damage to ${struck?.unit.name || "an ally"}.`;
  } else if (name === "Overcharge") {
    if (!friendly)
      return { ok: false, error: "No friendly character can be overcharged." };
    friendly.unit.raidOvercharge = true;
    effect = `${friendly.unit.name}'s next attack gains +20 damage, followed by 15 backlash damage.`;
  } else if (name === "No Turning Back") {
    room.actions += 1;
    for (const id of room.turnOrder)
      if (id !== playerId)
        room.extraActions.set(id, (room.extraActions.get(id) || 0) + 1);
    room.bossDamageBonus = 10;
    effect =
      "Both players gained one attack, but enemy attacks gain +10 damage this round.";
  } else if (name === "Against All Odds") {
    const allies = raidTargetCandidates(room);
    if (allies.length > 6)
      return {
        ok: false,
        error:
          "Against All Odds requires six or fewer deployed allied characters.",
      };
    allies.forEach(({ unit }) => {
      unit.hp = Math.min(unit.max, unit.hp + 15);
    });
    effect = "Every deployed allied character recovered 15 Health.";
  } else if (name === "Final Gambit") {
    const usedId = team?.used?.find((id) =>
      team.board.some((unit) => unit?.id === id && unit.hp > 0),
    );
    if (!usedId)
      return { ok: false, error: "No character has attacked yet this turn." };
    team.used = team.used.filter((id) => id !== usedId);
    const unit = team.board.find((entry) => entry?.id === usedId);
    effect = `${unit?.name || "One character"} may attack again this turn.`;
  } else if (name === "Draw Their Fire") {
    if (!friendly)
      return { ok: false, error: "No friendly character can draw enemy fire." };
    room.drawTheirFire = {
      playerId: friendly.playerId,
      unitId: friendly.unit.id,
    };
    effect = `${friendly.unit.name} will draw all enemy attacks and take 10 less damage from each.`;
  } else if (name === "Till All Are One") {
    raidTargetCandidates(room).forEach(({ unit }) => {
      unit.hp = Math.min(unit.max, unit.hp + 10);
    });
    room.extraRepositions += 1;
    effect =
      "Every deployed ally recovered 10 Health and both teams gained one reposition move.";
  }
  return { ok: true, effect };
}
function defeatRaidBossUnit(room, target) {
  if (target.unit.id === room.judge.id) {
    room.stage = "victory";
    room.log.push(`${room.judge.name} has fallen. Raid victory!`);
    return;
  }
  room.bossBoard[target.slot] = null;
  room.fallen.push(target.unit);
  room.enemyDefeatPending = true;
  room.revealedBossSlots.delete(target.slot);
  if (
    room.encounterId === "unicron" &&
    room.judge.phase === 3 &&
    !bossTroops(room).some((unit) => unit.hp > 0)
  ) {
    room.log.push(
      "The Phase 3 legion is destroyed. Unicron can attack and take damage again.",
    );
  }
}
function detachRaid(socket) {
  const code = socket.data.raidCode;
  if (!code) return;
  const pending = pendingRaidDisconnects.get(socket.id);
  if (pending) clearTimeout(pending.timer);
  pendingRaidDisconnects.delete(socket.id);
  const room = raidRooms.get(code);
  socket.leave(`raid-${code}`);
  socket.data.raidCode = undefined;
  if (!room) return;
  room.players.delete(socket.id);
  room.ready.delete(socket.id);
  room.decks.delete(socket.id);
  room.teams.delete(socket.id);
  if (room.players.size === 0) raidRooms.delete(code);
  else {
    room.stage = "lobby";
    room.ready.clear();
    room.decks.clear();
    room.teams.clear();
    room.log.push("A player left. The Raid returned to the lobby.");
    emitRaid(room);
  }
}

function removeQuickMatch(socketId) {
  let index = quickMatchQueue.indexOf(socketId);
  while (index >= 0) {
    quickMatchQueue.splice(index, 1);
    index = quickMatchQueue.indexOf(socketId);
  }
}

function nextQuickRoomCode() {
  let code = "QUICK" + Math.random().toString(36).slice(2, 8).toUpperCase();
  while (rooms.has(code))
    code = "QUICK" + Math.random().toString(36).slice(2, 8).toUpperCase();
  return code;
}

function addQuickPlayer(room, socket, name) {
  room.players.set(socket.id, { id: socket.id, name, ready: false });
  socket.join(room.code);
  socket.data.roomCode = room.code;
  socket.data.quickQueue = false;
}

function queueQuickMatch(socket, name) {
  removeQuickMatch(socket.id);
  socket.data.quickQueue = true;
  while (quickMatchQueue.length) {
    const waitingId = quickMatchQueue.shift();
    const waiting = io.sockets.sockets.get(waitingId);
    if (
      !waiting ||
      waiting.id === socket.id ||
      waiting.data.roomCode ||
      waiting.data.raidCode
    )
      continue;
    const room = createRoom(
      nextQuickRoomCode(),
      normaliseStandardChallenges(waiting.data.standardChallenges),
    );
    room.quickMatch = true;
    rooms.set(room.code, room);
    addQuickPlayer(room, waiting, waiting.data.quickName || "Player");
    addQuickPlayer(room, socket, name);
    waiting.emit("quick-match-found", { code: room.code });
    socket.emit("quick-match-found", { code: room.code });
    announce(room);
    return { matched: true, code: room.code };
  }
  socket.data.quickName = name;
  socket.data.standardChallenges = normaliseStandardChallenges(
    socket.data.standardChallenges,
  );
  quickMatchQueue.push(socket.id);
  return { matched: false };
}

function clean(value, max) {
  return typeof value === "string"
    ? value
        .trim()
        .replace(/[^a-zA-Z0-9 _-]/g, "")
        .slice(0, max)
    : "";
}

function createRoom(code, challenges = []) {
  return {
    code,
    quickMatch: false,
    challenges: normaliseStandardChallenges(challenges),
    players: new Map(),
    started: false,
    decks: new Map(),
    deployments: new Map(),
    stage: "lobby",
    round: 0,
    turnOrder: [],
    turnIndex: 0,
    repositions: new Map(),
    repositionSnapshots: new Map(),
    turnTimer: null,
    turnDeadline: 0,
    repositionDeadline: 0,
    skipRepositionRound: 0,
    priorityTargets: new Map(),
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(({ id, name, ready }) => ({
      id,
      name,
      ready,
    })),
    started: room.started,
    challenges: room.challenges,
  };
}

function announce(room) {
  io.to(room.code).emit("room-state", publicRoom(room));
}
function playerName(room, id) {
  return room.players.get(id)?.name || "Opponent";
}

function sendDecksReady(room, id) {
  const opponent = [...room.decks.entries()].find(
    ([other]) => other !== id,
  )?.[1];
  if (opponent)
    io.to(id).emit("decks-ready", {
      opponent,
      priority: room.challenges.includes("high-priority")
        ? {
            own: room.priorityTargets.get(id) || [],
            opponent:
              room.priorityTargets.get(
                [...room.players.keys()].find((other) => other !== id),
              ) || [],
          }
        : undefined,
    });
}

function syncPlayer(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room || !room.players.has(socket.id)) return;
  announce(room);
  if (room.stage === "deckbuilding") {
    socket.emit("match-ready", { room: publicRoom(room) });
    if (room.decks.has(socket.id))
      socket.emit(
        "match-status",
        "Your deck is locked. Waiting for your opponent to finish building.",
      );
  } else if (room.stage === "deployment" && room.decks.size === 2) {
    sendDecksReady(room, socket.id);
  }
}

function clearTurnTimer(room) {
  if (room.turnTimer) clearTimeout(room.turnTimer);
  room.turnTimer = null;
  room.turnDeadline = 0;
  room.repositionDeadline = 0;
}

function withRequiredReinforcements(deployment) {
  const board = Array.isArray(deployment?.board)
    ? deployment.board.slice(0, 9)
    : Array(9).fill(null);
  while (board.length < 9) board.push(null);
  const backups = Array.isArray(deployment?.backups)
    ? [...deployment.backups]
    : [];
  while (board.filter(Boolean).length < 6 && backups.length) {
    const vacancy = board.findIndex((card) => !card);
    if (vacancy < 0) break;
    board[vacancy] = backups.shift();
  }
  return { board, backups };
}

function completeReposition(room, expired = false) {
  clearTurnTimer(room);
  for (const [id] of room.players) {
    if (room.repositions.has(id)) continue;
    const latest = room.repositionSnapshots.get(id) || room.deployments.get(id);
    if (latest) room.repositions.set(id, withRequiredReinforcements(latest));
  }
  if (room.repositions.size !== room.players.size) return;
  if (expired)
    io.to(room.code).emit(
      "match-status",
      "The 30-second reposition timer expired. Unfinished positions were locked automatically.",
    );
  for (const [id] of room.players) {
    const opponent = [...room.repositions.entries()].find(
      ([other]) => other !== id,
    )?.[1];
    io.to(id).emit("opponent-repositioned", { opponent });
  }
  room.deployments = new Map(room.repositions);
  startRound(room);
}

function beginReposition(room) {
  room.stage = "reposition";
  room.repositions.clear();
  room.repositionSnapshots.clear();
  const locked = room.skipRepositionRound === room.round;
  room.repositionDeadline = Date.now() + REPOSITION_DURATION_MS;
  io.to(room.code).emit("reposition-start", {
    moves: locked ? 0 : 2,
    locked,
    repositionEndsAt: room.repositionDeadline,
    repositionDurationMs: REPOSITION_DURATION_MS,
  });
  const scheduledRound = room.round;
  room.turnTimer = setTimeout(() => {
    if (room.stage !== "reposition" || room.round !== scheduledRound) return;
    completeReposition(room, true);
  }, REPOSITION_DURATION_MS);
  room.turnTimer.unref?.();
}

function emitTurn(room) {
  clearTurnTimer(room);
  const activeId = room.turnOrder[room.turnIndex];
  const actions = room.round === 1 && room.turnIndex === 0 ? 2 : 3;
  room.turnDeadline = Date.now() + TURN_DURATION_MS;
  for (const [id] of room.players) {
    io.to(id).emit("turn-state", {
      round: room.round,
      activeId,
      activeName: playerName(room, activeId),
      yourTurn: id === activeId,
      actions: id === activeId ? actions : 0,
      firstTurn: room.turnIndex === 0,
      turnEndsAt: room.turnDeadline,
      turnDurationMs: TURN_DURATION_MS,
    });
  }
  const scheduledRound = room.round;
  room.turnTimer = setTimeout(() => {
    if (
      room.stage !== "combat" ||
      room.round !== scheduledRound ||
      room.turnOrder[room.turnIndex] !== activeId
    )
      return;
    io.to(room.code).emit(
      "match-status",
      `${playerName(room, activeId)}'s one-minute turn expired. The match advanced automatically.`,
    );
    advanceTurn(room);
  }, TURN_DURATION_MS);
  room.turnTimer.unref?.();
}

function advanceTurn(room) {
  clearTurnTimer(room);
  if (room.turnIndex === 0) {
    room.turnIndex = 1;
    emitTurn(room);
    return;
  }
  beginReposition(room);
}

function startRound(room) {
  const playerIds = [...room.players.keys()];
  if (playerIds.length !== 2) return;
  room.round += 1;
  room.stage = "combat";
  room.turnIndex = 0;
  room.repositions.clear();
  room.turnOrder =
    Math.random() < 0.5 ? playerIds : [playerIds[1], playerIds[0]];
  emitTurn(room);
}

function detach(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const pending = pendingDisconnects.get(socket.id);
  if (pending) clearTimeout(pending.timer);
  pendingDisconnects.delete(socket.id);
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = undefined;
  if (!room) return;
  room.players.delete(socket.id);
  room.decks.delete(socket.id);
  room.deployments.delete(socket.id);
  room.repositions.delete(socket.id);
  room.repositionSnapshots.delete(socket.id);
  if (room.players.size === 0) {
    clearTurnTimer(room);
    rooms.delete(code);
  } else {
    clearTurnTimer(room);
    room.stage = "lobby";
    room.started = false;
    announce(room);
    io.to(room.code).emit("opponent-left");
  }
}

io.on("connection", (socket) => {
  const pending = pendingDisconnects.get(socket.id);
  if (pending) clearTimeout(pending.timer);
  pendingDisconnects.delete(socket.id);
  const pendingRaid = pendingRaidDisconnects.get(socket.id);
  if (pendingRaid) clearTimeout(pendingRaid.timer);
  pendingRaidDisconnects.delete(socket.id);
  socket.emit("server-ready", { version: 9, recovered: socket.recovered });

  socket.on("quick-match", (payload = {}, reply = () => {}) => {
    const name = clean(payload.name, 20) || "Player";
    socket.data.standardChallenges = normaliseStandardChallenges(
      payload.challenges,
    );
    detachRaid(socket);
    detach(socket);
    queueQuickMatch(socket, name);
    const waiting = quickMatchQueue.includes(socket.id);
    reply({ ok: true, waiting });
    socket.emit(
      "quick-match-status",
      waiting
        ? "Searching for the first available opponent…"
        : "Opponent found. Ready up when you are both in the room.",
    );
    if (!waiting) {
      const room = rooms.get(socket.data.roomCode);
      if (room) announce(room);
    }
  });

  socket.on("quick-match-cancel", () => {
    removeQuickMatch(socket.id);
    socket.data.quickQueue = false;
    socket.emit("quick-match-status", "Quick Match search cancelled.");
  });

  socket.on("raid-join", (payload = {}, reply = () => {}) => {
    const code = clean(payload.code, 12).toUpperCase(),
      name = clean(payload.name, 20) || "Player",
      boss = payload.boss === "unicron" ? "unicron" : "quintesson",
      challenges = normaliseRaidChallenges(payload.challenges);
    if (code.length < 3)
      return reply({
        ok: false,
        error: "Room code needs at least 3 characters.",
      });
    removeQuickMatch(socket.id);
    socket.data.quickQueue = false;
    const current = raidRooms.get(socket.data.raidCode);
    if (current?.code === code && current.players.has(socket.id)) {
      current.players.get(socket.id).name = name;
      reply({ ok: true, recovered: true });
      emitRaid(current);
      return;
    }
    detachRaid(socket);
    let room = raidRooms.get(code);
    if (!room) {
      room = createRaidRoom(code, boss, challenges);
      raidRooms.set(code, room);
    }
    if (room.encounterId !== boss)
      return reply({
        ok: false,
        error: `That room is already assigned to the ${room.encounterName} Boss Rush.`,
      });
    if (room.players.size >= 2 && !room.players.has(socket.id))
      return reply({
        ok: false,
        error: "That Raid room already has two players.",
      });
    room.players.set(socket.id, { id: socket.id, name });
    socket.data.raidCode = code;
    socket.join(`raid-${code}`);
    reply({ ok: true });
    emitRaid(room);
  });
  socket.on("raid-ready", () => {
    const room = raidRooms.get(socket.data.raidCode);
    if (!room) return;
    room.ready.add(socket.id);
    if (room.ready.size === 2) room.stage = "deckbuilding";
    emitRaid(room);
  });
  socket.on("raid-submit-deck", (ids, reply = () => {}) => {
    const room = raidRooms.get(socket.data.raidCode);
    if (!room || room.stage !== "deckbuilding")
      return reply({ ok: false, error: "This Raid is not accepting decks." });
    const sixCharacterChallenge = raidChallengeActive(room, "six-characters");
    const units = legalRaidDeck(ids, sixCharacterChallenge);
    if (!units)
      return reply({
        ok: false,
        error: sixCharacterChallenge
          ? "Submit exactly six unique characters for this challenge."
          : "Submit nine unique characters with 2 Commanders, 3 Scouts, 2 Troopers and 2 Tacticians.",
      });
    room.decks.set(socket.id, ids);
    room.teams.set(socket.id, {
      board: Array(9).fill(null),
      backups: sixCharacterChallenge ? [] : units.slice(6),
      pending: units.slice(0, 6),
      used: [],
      usedAbilities: [],
      faceOff: false,
      armor: 0,
      traps: [],
      hiddenSpaces: [],
    });
    room.bossIntel.set(socket.id, { occupied: new Set(), empty: new Set() });
    reply({ ok: true });
    if (room.decks.size === 2) {
      room.stage = "briefing";
      room.briefingReady.clear();
      room.log.push(
        "The complete boss roster is open for both players to inspect.",
      );
    }
    emitRaid(room);
  });
  socket.on("raid-briefing-ready", () => {
    const room = raidRooms.get(socket.data.raidCode);
    if (!room || room.stage !== "briefing") return;
    room.briefingReady.add(socket.id);
    if (room.briefingReady.size === 2) {
      room.stage = "deployment";
      room.log.push(
        "Both players may now place six characters on their own 3 x 3 boards simultaneously.",
      );
    }
    emitRaid(room);
  });
  socket.on("raid-place", ({ unitId, slot } = {}, reply = () => {}) => {
    const room = raidRooms.get(socket.data.raidCode),
      team = room?.teams.get(socket.id);
    if (
      !room ||
      room.stage !== "deployment" ||
      !team ||
      team.pending.length === 0
    )
      return reply({
        ok: false,
        error: "Your deployment is already complete.",
      });
    if (!Number.isInteger(slot) || slot < 0 || slot >= 9 || team.board[slot])
      return reply({
        ok: false,
        error: "Choose an empty space on your own 3 x 3 board.",
      });
    const index = team.pending.findIndex((unit) => unit.id === unitId);
    if (index < 0)
      return reply({
        ok: false,
        error: "Choose one of your unplaced characters.",
      });
    team.board[slot] = team.pending.splice(index, 1)[0];
    if (team.board[slot].id === "hun-grrr")
      team.board[slot].hunGrrrEligible = true;
    if (team.board[slot].id === "brainstorm")
      team.board[slot].brainstormDeployedRound = 1;
    room.log.push(
      `${room.players.get(socket.id)?.name || "Player"} placed a character in their 3 x 3 board space ${slot + 1}.`,
    );
    reply({ ok: true });
    if (
      room.teams.size === 2 &&
      [...room.teams.values()].every((entry) => entry.pending.length === 0)
    ) {
      room.turnOrder = [...room.players.keys()];
      room.turnIndex = 0;
      room.round = 0;
      room.log.push(
        `${room.players.get(room.turnOrder[0])?.name || "Player"} acts first. Each player has three actions before the boss turn.`,
      );
      startRaidRound(room);
    } else emitRaid(room);
  });
  socket.on(
    "raid-attack",
    ({ attackerId, targetId, targetSlot } = {}, reply = () => {}) => {
      const room = raidRooms.get(socket.data.raidCode),
        team = room?.teams.get(socket.id);
      if (
        !room ||
        room.stage !== "combat" ||
        room.turnOrder[room.turnIndex] !== socket.id ||
        room.actions <= 0
      )
        return reply({ ok: false, error: "It is not your attack turn." });
      const attackerSlot =
        team?.board.findIndex(
          (unit) => unit?.id === attackerId && unit.hp > 0,
        ) ?? -1;
      const attacker = attackerSlot >= 0 ? team.board[attackerSlot] : null;
      const courtTarget =
        !targetId &&
        Number.isInteger(targetSlot) &&
        targetSlot >= 0 &&
        targetSlot < room.bossBoard.length
          ? { unit: room.bossBoard[targetSlot] || null, slot: targetSlot }
          : null;
      const target = targetId
        ? findBossTarget(room, targetId, targetSlot)
        : courtTarget;
      if (!attacker || !target)
        return reply({
          ok: false,
          error: "Choose one of your characters and a living boss card.",
        });
      const previousAttacks = (team.used || []).filter(
          (id) => id === attacker.id,
        ).length,
        attackLimit =
          attacker.id === "ultra-mammoth" &&
          attacker.raidRushRound === room.round
            ? 4
            : attacker.id === "mixmaster" &&
                team.board.some((unit) => unit?.id === "bonecrusher")
              ? 2
              : 1;
      if (previousAttacks >= attackLimit)
        return reply({
          ok: false,
          error: "That character already attacked this turn.",
        });
      team.used = [...(team.used || []), attacker.id];
      room.actions--;
      if (!target.unit) {
        room.courtFeedback.set(target.slot, "MISS");
        room.log.push(
          `${attacker.name} fired at Court space ${target.slot + 1} and missed.`,
        );
        raidEvent(room, {
          kind: "miss",
          attackerId: attacker.id,
          targetSlot: target.slot,
          side: "players",
        });
        reply({ ok: true });
        emitRaid(room);
        return;
      }
      let damage = raidAttackDamage(room, team, attacker, attackerSlot);
      if (attacker.id === "misfire" && target.unit.role === "Tactician")
        damage += 5;
      damage = applyRaidBattleAttackBonuses(
        room,
        socket.id,
        attacker,
        target,
        damage,
      );
      damage = resolveBossDamage(room, target, damage);
      if (target.slot >= 0) room.courtFeedback.set(target.slot, "OCCUPIED");
      const targetName =
        target.unit.id === room.judge.id
          ? target.unit.name
          : "a hidden Quintesson troop";
      room.log.push(`${attacker.name} dealt ${damage} to ${targetName}.`);
      raidEvent(room, {
        kind: "hit",
        attackerId: attacker.id,
        targetId: target.unit.id === room.judge.id ? target.unit.id : undefined,
        targetSlot: target.unit.id === room.judge.id ? undefined : target.slot,
        damage,
        side: "players",
        defeated: target.unit.hp === 0,
      });
      if (target.unit.hp === 0) {
        if (attacker.id === "breakdown" && matchesRole(target.unit, "Scout")) {
          Object.assign(attacker, empowerBreakdown(attacker, target.unit));
          room.log.push(
            "Breakdown defeated a Scout and permanently gained 10 Health.",
          );
        }
        defeatRaidBossUnit(room, target);
      }
      if (target.unit.id === "beachcomber" && damage > 0) {
        attacker.hp = Math.max(0, attacker.hp - 10);
        room.log.push(
          "Beachcomber's pacifist field dealt 10 damage back to " +
            attacker.name +
            ".",
        );
      }
      if (attacker.raidOverchargeBacklash) {
        attacker.raidOverchargeBacklash = false;
        attacker.hp = Math.max(0, attacker.hp - 15);
        if (attacker.hp === 0) {
          team.board[attackerSlot] = null;
          team.fallen = [...(team.fallen || []), attacker];
          reinforceRaidTeam(room, team, attackerSlot);
          raidEvent(room, {
            kind: "player-defeat",
            defeatedName: attacker.name,
            side: "players",
          });
        }
      }
      if (team.faceOff && target.unit.hp > 0) {
        team.faceOff = false;
        drawRaidCards(room, 1);
        room.log.push(
          "Face Off drew one shared Battle Card after a successful hit.",
        );
      }
      if (attacker.brawlLastStand) {
        team.board[attackerSlot] = null;
        team.fallen = [...(team.fallen || []), { ...attacker, hp: 0 }];
        reinforceRaidTeam(room, team, attackerSlot);
        room.log.push("Brawl completed his final attack and was scrapped.");
        raidEvent(room, {
          kind: "player-defeat",
          defeatedName: attacker.name,
          side: "players",
        });
      }
      reply({ ok: true });
      emitRaid(room);
    },
  );
  socket.on(
    "raid-play-battle",
    ({ name, targetId, targetSlot, row } = {}, reply = () => {}) => {
      const room = raidRooms.get(socket.data.raidCode),
        team = room?.teams.get(socket.id);
      if (room && raidChallengeActive(room, "no-battle-cards"))
        return reply({
          ok: false,
          error: "Battle Cards are disabled by this Boss Rush challenge.",
        });
      if (
        !room ||
        !team ||
        room.stage !== "combat" ||
        room.turnOrder[room.turnIndex] !== socket.id ||
        room.battlePlayed ||
        room.actions <= 0
      )
        return reply({
          ok: false,
          error:
            "Only one shared Battle Card can be played during an active player turn.",
        });
      if (
        room.encounterId === "unicron" &&
        bossTroops(room).some((unit) => unit.id === "the-fallen" && unit.hp > 0)
      )
        return reply({
          ok: false,
          error:
            "The Fallen renders all Battle Cards useless until he is defeated.",
        });
      const cardIndex = room.battleHand.indexOf(name);
      if (cardIndex < 0)
        return reply({
          ok: false,
          error: "That Battle Card is not in the shared hand.",
        });
      if (!bossRushBattleCards.some((card) => card.name === name))
        return reply({
          ok: false,
          error: "Only Boss Rush Battle Cards can be played in Boss Rush.",
        });
      const result = playBossRushCard(
        room,
        socket.id,
        name,
        targetId,
        targetSlot,
      );
      if (!result.ok) return reply(result);
      room.battleHand.splice(cardIndex, 1);
      room.battlePlayed = true;
      room.log.push(result.effect);
      raidEvent(room, { kind: "battle", name, side: "players" });
      reply({ ok: true });
      emitRaid(room);
      return;
      const ownTarget = targetId
        ? findPlayerUnit(room, targetId, socket.id)
        : null;
      const bossTarget = targetId
        ? findBossTarget(room, targetId, targetSlot)
        : Number.isInteger(targetSlot) && targetSlot >= 0
          ? findBossTarget(room, undefined, targetSlot)
          : null;
      const amount = name === "Power Of The Primes" ? 35 : 10;
      let effect = `${name} resolved.`;
      if (name === "Roll Out" || name === "Power Of The Primes") {
        const target =
          ownTarget ||
          raidTargetCandidates(room)
            .filter((entry) => entry.playerId === socket.id)
            .sort((a, b) => a.unit.hp - b.unit.hp)[0];
        if (!target)
          return reply({
            ok: false,
            error: "Choose one of your living characters.",
          });
        target.unit.hp = Math.min(target.unit.max, target.unit.hp + amount);
        effect = `${target.unit.name} healed ${amount}.`;
      } else if (name === "Armor Plating") {
        const target =
          ownTarget ||
          raidTargetCandidates(room)
            .filter((entry) => entry.playerId === socket.id)
            .sort((a, b) => a.unit.hp - b.unit.hp)[0];
        if (!target)
          return reply({
            ok: false,
            error: "Choose one of your living characters.",
          });
        team.armorTargets = [target.unit.id];
        team.armor = 10;
        effect = `${target.unit.name} gained Armor Plating for the next hit.`;
      } else if (name === "Deserved Punishment") {
        const target = bossTarget || findBossTarget(room, room.judge.id);
        if (target) {
          const damage = resolveBossDamage(room, target, 10);
          const targetName =
            target.unit.id === room.judge.id
              ? room.judge.name
              : "a hidden Quintesson troop";
          effect = `${targetName} took ${damage} damage.`;
          if (target.unit.hp === 0) defeatRaidBossUnit(room, target);
        }
      } else if (name === "War Dawn") {
        const chosenRow = Number.isInteger(row)
          ? Math.max(0, Math.min(1, row))
          : 0;
        for (let i = 0; i < 3; i++) {
          const slot = chosenRow * 3 + i,
            unit = room.bossBoard[slot];
          if (unit) {
            unit.hp = Math.max(0, unit.hp - 15);
            if (unit.hp === 0) defeatRaidBossUnit(room, { unit, slot });
          }
        }
        effect = `War Dawn hit Boss Court row ${chosenRow + 1} for 15.`;
      } else if (name === "Reinforce") {
        const replacement = team.backups.shift(),
          slot = ownTarget?.slot ?? firstEmptyPlayerSlot(room, socket.id);
        if (!replacement || slot < 0)
          return reply({
            ok: false,
            error: "You need a Backup and a deployed target or empty space.",
          });
        if (ownTarget) team.backups.push(team.board[slot]);
        team.board[slot] = replacement;
        effect = `${replacement.name} reinforced your 3 x 3 board space ${slot + 1}.`;
      } else if (name === "Tyrants Reign") {
        drawRaidCards(room, 2);
        effect = "Tyrants Reign drew two more shared Battle Cards.";
      } else if (name === "Face Off") {
        team.faceOff = true;
        effect =
          "Face Off armed your next successful attack to draw a shared Battle Card.";
      } else if (
        name === "Flying Support" ||
        name === "He Will Find You" ||
        name === "Information Gathering" ||
        name === "Surprise" ||
        name === "2 For The Price Of 1"
      ) {
        const occupied = room.bossBoard
          .map((unit, index) => (unit ? index : -1))
          .filter((index) => index >= 0);
        let slots = [];
        if (name === "He Will Find You") {
          const lowest = occupied
            .filter((slot) => !room.revealedBossSlots.has(slot))
            .sort((a, b) => room.bossBoard[a].hp - room.bossBoard[b].hp)[0];
          slots = lowest === undefined ? occupied.slice(0, 1) : [lowest];
        } else {
          const revealCount =
            name === "Information Gathering" ? 3 : name === "Surprise" ? 2 : 1;
          slots = Number.isInteger(targetSlot)
            ? [targetSlot]
            : occupied
                .filter((slot) => !room.revealedBossSlots.has(slot))
                .sort(() => Math.random() - 0.5)
                .slice(0, revealCount);
        }
        slots.forEach((slot) => {
          if (room.bossBoard[slot]) room.revealedBossSlots.add(slot);
        });
        effect =
          name +
          " revealed " +
          slots.length +
          " court position" +
          (slots.length === 1 ? "" : "s") +
          ".";
        if (name === "2 For The Price Of 1") room.enemyDefeatPending = false;
      } else if (name === "Junkion Scrap") {
        room.battleHand.splice(0, Math.min(3, room.battleHand.length));
        effect = "Junkion Scrap removed three shared Battle Cards.";
      } else if (name === "Ambush Trap") {
        const trapSlot =
          Number.isInteger(targetSlot) &&
          targetSlot >= 0 &&
          targetSlot < 9 &&
          !team.board[targetSlot]
            ? targetSlot
            : firstEmptyPlayerSlot(room, socket.id);
        if (trapSlot < 0)
          return reply({
            ok: false,
            error: "Choose an empty space on your own board for Ambush Trap.",
          });
        team.traps = [...(team.traps || []), trapSlot];
        effect =
          "Ambush Trap armed on your board space " + (trapSlot + 1) + ".";
      } else if (name === "Dark Reflections") {
        team.reflectionDamage = Math.max(
          ...room.fallen.map((unit) => unit.dmg),
          0,
        );
        effect =
          "Dark Reflections armed the strongest defeated Quintesson Damage for your next attack.";
      }
      // Battle Cards are a shared tactical interrupt; playing one does not consume
      // the active player's three attack actions.
      room.battleHand.splice(cardIndex, 1);
      room.battlePlayed = true;
      room.log.push(effect);
      raidEvent(room, { kind: "battle", name, side: "players" });
      reply({ ok: true });
      emitRaid(room);
    },
  );
  socket.on(
    "raid-use-ability",
    ({ sourceId, targetId, targetSlot } = {}, reply = () => {}) => {
      const room = raidRooms.get(socket.data.raidCode),
        team = room?.teams.get(socket.id);
      if (
        !room ||
        !team ||
        room.stage !== "combat" ||
        room.turnOrder[room.turnIndex] !== socket.id
      )
        return reply({
          ok: false,
          error: "Unique abilities can only be used during your active turn.",
        });
      const sourceSlot = team.board.findIndex(
        (unit) => unit?.id === sourceId && unit.hp > 0,
      );
      const source =
        sourceSlot >= 0
          ? team.board[sourceSlot]
          : team.backups.find((unit) => unit.id === sourceId);
      if (
        !source ||
        source.abilityUses <= 0 ||
        (team.usedAbilities || []).includes(sourceId)
      )
        return reply({
          ok: false,
          error:
            "That character has no unique ability use remaining this round.",
        });
      if (sourceSlot < 0 && sourceId !== "galvatron")
        return reply({
          ok: false,
          error: "Deploy this character before using its unique ability.",
        });
      const target = findBossTarget(room, targetId, targetSlot);
      let effect = source.name + " used its unique ability.";
      if (
        sourceId === "shockwave" ||
        sourceId === "bombshell" ||
        sourceId === "head" ||
        sourceId === "eject" ||
        sourceId === "arachnia"
      ) {
        const acidStormMiss =
          sourceId === "shockwave" &&
          Number.isInteger(targetSlot) &&
          targetSlot >= 0 &&
          targetSlot < room.bossBoard.length &&
          team.board.some((unit) => unit?.id === "acid-storm");
        if (
          !target &&
          !acidStormMiss &&
          !(
            sourceId === "head" &&
            Number.isInteger(targetSlot) &&
            targetSlot >= 0 &&
            targetSlot < room.bossBoard.length
          )
        )
          return reply({
            ok: false,
            error: "Choose an occupied court space for that ability.",
          });
        if (sourceId === "head" && !target) {
          effect = "Headstrong searched an empty court space and survived.";
        } else if (sourceId === "shockwave" && !target) {
          room.toxicBossSpaces[targetSlot] = room.round + 3;
          effect =
            "Shockwave missed; Acid Storm made court space " +
            (targetSlot + 1) +
            " toxic for four turns.";
        } else if (sourceId === "shockwave") {
          const damage = resolveBossDamage(room, target, 30);
          effect =
            "Shockwave dealt " +
            damage +
            " damage to " +
            (target.unit.id === room.judge.id
              ? room.judge.name
              : "a hidden Quintesson troop") +
            ".";
          if (target.unit.hp === 0) defeatRaidBossUnit(room, target);
        } else if (sourceId === "bombshell") {
          const damage = resolveBossDamage(room, target, target.unit.dmg);
          effect =
            "Bombshell forced the hidden target to take " + damage + " damage.";
          if (target.unit.hp === 0) defeatRaidBossUnit(room, target);
        } else if (sourceId === "head") {
          if (target.unit.id !== room.judge.id) {
            defeatRaidBossUnit(room, target);
            if (sourceSlot >= 0) {
              team.board[sourceSlot] = null;
              team.fallen = [...(team.fallen || []), source];
              raidEvent(room, {
                kind: "player-defeat",
                defeatedName: source.name,
                side: "players",
              });
              reinforceRaidTeam(room, team, sourceSlot);
            }
            effect =
              "Headstrong and a hidden Quintesson troop destroyed one another.";
          } else
            effect =
              "Headstrong cannot destroy the Judge; the ability was spent.";
        } else if (sourceId === "eject") {
          if (target.unit.role === "Scout") {
            const empty = firstEmptyPlayerSlot(room, socket.id);
            if (empty >= 0) {
              team.board[empty] = source;
              team.board[sourceSlot] = null;
              effect = "Eject swapped into the guessed hidden Scout position.";
            } else
              effect = "Eject found a hidden Scout, but your board was full.";
          } else
            effect = "Eject guessed wrong; the hidden card was not a Scout.";
        } else if (sourceId === "arachnia") {
          const row = Math.floor(target.slot / 3);
          room.bossBoard.forEach((unit, index) => {
            if (unit && Math.floor(index / 3) === row) unit.raidPoison = 3;
          });
          effect =
            "Black Arachnia poisoned Quintesson court row " +
            (row + 1) +
            " for three boss turns.";
        }
      } else if (sourceId === "getaway") {
        const commander = team.board.find(
          (unit) => unit && unit.role === "Commander" && unit.id !== sourceId,
        );
        if (!commander)
          return reply({
            ok: false,
            error: "Getaway requires a deployed friendly Commander.",
          });
        source.copiedCommanderId = commander.id;
        effect =
          "Getaway copied " + commander.name + " as its Commander ability.";
      } else if (sourceId === "wheeljack") {
        team.board.forEach((unit) => {
          if (matchesRole(unit, "Scout")) unit.raidWheeljackBoost = true;
        });
        effect = "Wheeljack empowered every deployed Scout's next attack.";
      } else if (sourceId === "soundwave") {
        if (!team.board.some((unit) => unit?.id === "megatron"))
          return reply({
            ok: false,
            error: "Soundwave requires Megatron deployed.",
          });
        team.board
          .filter((unit) => unit?.faction === "Decepticon")
          .forEach((unit) => {
            unit.raidSignalBoost = true;
          });
        effect =
          "Soundwave synchronized with Megatron; deployed Decepticons gain +5 on their next attack.";
      } else if (sourceId === "grapple") {
        const amount = team.backups.filter(
          (unit) => unit.faction === "Autobot",
        ).length;
        team.board
          .filter((unit) => unit?.faction === "Autobot")
          .forEach((unit) => {
            unit.hp = Math.min(unit.max, unit.hp + amount * 5);
          });
        effect =
          "Grapple repaired deployed Autobots for " +
          amount * 5 +
          " each (one repair pulse per Autobot Backup).";
      } else if (sourceId === "rumble") {
        if (!team.board.some((unit) => unit?.id === "frenzy"))
          return reply({
            ok: false,
            error: "Rumble requires Frenzy deployed.",
          });
        source.raidRumbleBoost = true;
        effect =
          "Rumble synchronized with Frenzy; Rumble's next attack deals +10 damage.";
      } else if (sourceId === "highbrow") {
        room.bossTacticianDisabledUntil = room.round + 3;
        effect =
          "Highbrow disabled Quintesson Tactician abilities for three rounds.";
      } else if (sourceId === "pmega") {
        for (let i = room.bossBoard.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [room.bossBoard[i], room.bossBoard[j]] = [
            room.bossBoard[j],
            room.bossBoard[i],
          ];
        }
        room.revealedBossSlots.clear();
        effect = "Pmega reordered the concealed court.";
      } else if (sourceId === "wasp") {
        room.bossBoard
          .map((unit, index) => (unit?.role === "Scout" ? index : -1))
          .filter((index) => index >= 0)
          .forEach((slot) => room.revealedBossSlots.add(slot));
        effect = "Waspinator revealed every detectable Quintesson Scout.";
      } else if (sourceId === "bludgeon") {
        team.hiddenSpaces = [0, 1, 2];
        room.bossIntel.set(socket.id, {
          occupied: new Set(),
          empty: new Set(),
        });
        effect = "Bludgeon concealed three of your board spaces from the boss.";
      } else if (sourceId === "cutthroat") {
        const row = Math.floor(sourceSlot / 3);
        team.board.forEach((unit, slot) => {
          if (unit && Math.floor(slot / 3) === row)
            unit.raidShieldUntil = room.round + 1;
        });
        effect =
          "Cutthroat shielded every character in his row through the next round.";
      } else if (sourceId === "sinnertwin") {
        if (!team.board.some((unit) => unit?.id === "hun-grrr"))
          return reply({
            ok: false,
            error: "Sinnertwin requires Hun-Grrr deployed.",
          });
        team.hunGrrrWinRound = 4;
        effect =
          "Sinnertwin lowered Hun-Grrr's untouched victory condition to round 4.";
      } else if (sourceId === "rippersnapper") {
        source.damageImmuneUntil = room.round + 2;
        effect = "Rippersnapper is immune to all damage for three rounds.";
      } else if (sourceId === "big-convoy") {
        if (!team.board.some((unit) => unit?.id === "ultra-mammoth"))
          return reply({
            ok: false,
            error: "Big Convoy requires Ultra Mammoth deployed.",
          });
        team.board.forEach((unit, slot) => {
          if (unit && slot < 3) unit.hp = Math.min(unit.max, unit.hp + 5);
        });
        effect = "Big Convoy restored 5 Health to every front-row ally.";
      } else if (sourceId === "claw-jaw") {
        if (!team.board.some((unit) => unit?.id === "depthcharge"))
          return reply({
            ok: false,
            error: "Claw Jaw requires Depthcharge deployed.",
          });
        source.raidShieldUntil = room.round + 2;
        effect = "Claw Jaw gained a three-round shield.";
      } else if (sourceId === "polar-claw") {
        if (livingRaidUnits(team).length !== 1)
          return reply({
            ok: false,
            error: "Polar Claw must be your last surviving character.",
          });
        room.bossBoard.forEach((unit, slot) => {
          if (unit) room.revealedBossSlots.add(slot);
        });
        effect =
          "Polar Claw permanently revealed every occupied court position.";
      } else if (sourceId === "razorbeast") {
        const amount = (team.fallen || []).filter(
          (unit) => unit.faction === "Maximal",
        ).length;
        if (!amount)
          return reply({
            ok: false,
            error: "Razorbeast needs a defeated Maximal.",
          });
        drawRaidCards(room, amount);
        effect =
          "Razorbeast drew " +
          amount +
          " shared Boss Rush Battle Card" +
          (amount === 1 ? "." : "s.");
      } else if (sourceId === "ultra-mammoth") {
        source.raidRushRound = room.round;
        room.actions += 1;
        effect = "Ultra Mammoth may attack up to four times this turn.";
      } else if (sourceId === "wolfang") {
        source.raidWolfangBoost = true;
        effect =
          "Wolfang armed +10 Damage against Predacon enemies for this turn.";
      } else if (sourceId === "dion") {
        const target = team.board
          .filter((unit) => unit && unit.id !== sourceId && unit.hp < unit.max)
          .sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
        if (!target || source.hp <= 1)
          return reply({
            ok: false,
            error: "Dion needs a damaged ally and at least 2 Health.",
          });
        const amount = Math.min(target.max - target.hp, source.hp - 1);
        source.hp -= amount;
        target.hp += amount;
        effect =
          "Dion transferred " + amount + " Health to " + target.name + ".";
      } else if (sourceId === "firestar") {
        const targetSlot = team.board
          .map((unit, slot) => ({ unit, slot }))
          .filter(
            (entry) =>
              entry.unit &&
              entry.unit.id !== sourceId &&
              entry.unit.hp < entry.unit.max,
          )
          .sort(
            (a, b) => a.unit.hp / a.unit.max - b.unit.hp / b.unit.max,
          )[0]?.slot;
        if (!Number.isInteger(targetSlot))
          return reply({
            ok: false,
            error: "Firestar needs another deployed ally to protect.",
          });
        [team.board[sourceSlot], team.board[targetSlot]] = [
          team.board[targetSlot],
          team.board[sourceSlot],
        ];
        effect = "Firestar swapped positions with a damaged ally.";
      } else if (sourceId === "air-raid") {
        team.board.forEach((unit) => {
          if (matchesRole(unit, "Trooper"))
            unit.airRaidBoostUntil = room.round + 1;
        });
        effect =
          "Air Raid gave every friendly Trooper +10 Damage for two rounds.";
      } else if (sourceId === "chromia") {
        if (source.hp <= 10)
          return reply({
            ok: false,
            error: "Chromia needs more than 10 Health to power a healing zone.",
          });
        const healSlot =
          Number.isInteger(targetSlot) && targetSlot >= 0 && targetSlot < 9
            ? targetSlot
            : sourceSlot;
        source.hp -= 10;
        source.chromiaHealSlot = healSlot;
        source.chromiaHealUntil = room.round + 3;
        effect =
          "Chromia powered board space " +
          (healSlot + 1) +
          " as a three-round healing zone.";
      } else if (sourceId === "drag-strip") {
        if (!room.battleHand.length)
          return reply({
            ok: false,
            error: "Drag Strip needs a shared Battle Card to duplicate.",
          });
        const copied = room.battleHand[0];
        room.battleHand.push(copied);
        effect = "Drag Strip duplicated " + copied + ".";
      } else if (sourceId === "motormaster") {
        return reply({
          ok: false,
          error:
            "Motormaster requires Optimus Prime on the enemy team; the Quintesson court does not satisfy that condition.",
        });
      } else if (sourceId === "nemesis-prime") {
        if (room.round !== 1)
          return reply({
            ok: false,
            error: "Nemesis Prime can only clone a Commander during round 1.",
          });
        const commander = team.board.find(
          (unit) => unit?.role === "Commander" && unit.id !== sourceId,
        );
        if (!commander)
          return reply({
            ok: false,
            error: "Nemesis Prime needs the other Commander deployed.",
          });
        source.copiedCommanderId = commander.id;
        source.dmg += 5;
        source.nemesisCopied = true;
        source.abilityUses = 2;
        effect =
          "Nemesis Prime cloned " + commander.name + " and gained +5 Damage.";
      } else if (sourceId === "ramjet") {
        source.ramjetImmuneUntil = room.round + 2;
        effect =
          "Ramjet ignores non-Decepticon character abilities for three rounds.";
      } else if (sourceId === "bonecrusher") {
        source.allClasses = true;
        effect = "Bonecrusher now qualifies for every class-based ability.";
      } else if (sourceId === "chop-shop") {
        source.allFactions = true;
        effect = "Chop Shop now qualifies for every faction-exclusive ability.";
      } else if (sourceId === "dead-end") {
        if (source.hp <= source.max / 2)
          return reply({
            ok: false,
            error: "Dead End must be above half Health.",
          });
        drawRaidCards(room, 4);
        team.board[sourceSlot] = null;
        team.fallen = [...(team.fallen || []), { ...source, abilityUses: 0 }];
        reinforceRaidTeam(room, team, sourceSlot);
        effect =
          "Dead End was scrapped to draw four shared Boss Rush Battle Cards.";
      } else if (sourceId === "buzzsaw" || sourceId === "darkwing") {
        return reply({
          ok: false,
          error:
            "Bosses do not hold Battle Cards, so this ability has no target in Boss Rush.",
        });
      } else if (sourceId === "cyclonus") {
        team.board
          .filter((unit) => matchesFaction(unit, "Decepticon"))
          .forEach((unit) => {
            unit.hp = Math.min(unit.max, unit.hp + 5);
          });
        effect = "Cyclonus healed every Decepticon on your board by 5.";
      } else if (sourceId === "overlord") {
        source.dmg = 20;
        effect =
          "Overlord reached 20 Damage; the court's card economy is disabled in Boss Rush.";
      } else if (sourceId === "hoist") {
        team.board
          .filter((unit) => unit && unit.hp < unit.max)
          .forEach((unit) => {
            unit.hp = Math.min(unit.max, unit.hp + 10);
          });
        effect =
          "Hoist redirected his repair systems and restored 10 Health to each damaged ally.";
      } else if (sourceId === "galvatron") {
        if (sourceSlot >= 0)
          return reply({
            ok: false,
            error: "Galvatron must be used from Backup.",
          });
        team.armorTargets = team.board
          .filter(Boolean)
          .slice(0, 2)
          .map((unit) => unit.id);
        effect =
          "Galvatron shielded two deployed characters for the next boss attacks.";
      } else if (sourceId === "razor") {
        const backup = team.backups.shift();
        if (!backup)
          return reply({
            ok: false,
            error: "Razorclaw has no Backup to combine with.",
          });
        source.max += backup.max;
        source.hp += backup.max;
        if (backup.id === "rampage") source.raidRampageBoost = true;
        effect =
          "Razorclaw combined with a hidden Backup and gained " +
          backup.max +
          " Health" +
          (backup.id === "rampage"
            ? "; its next attack gains +10 Damage."
            : ".");
      } else if (sourceId === "rhinox") {
        const fallen = (team.fallen || []).find(
          (unit) => unit.faction === "Maximal",
        );
        if (!fallen)
          return reply({
            ok: false,
            error: "Rhinox has no defeated Maximal to revive.",
          });
        team.fallen = team.fallen.filter((unit) => unit.id !== fallen.id);
        team.backups.push({ ...fallen, hp: Math.ceil(fallen.max / 2) });
        effect =
          "Rhinox revived a defeated Maximal into Backup at half Health.";
      } else if (sourceId === "rattrap") {
        room.repositionBlockedUntil = room.round;
        effect = "Rattrap blocked repositioning this round.";
      } else if (sourceId === "jhiaxus") {
        const opponent = [...room.teams.entries()].find(
          ([id]) => id !== socket.id,
        )?.[1];
        effect =
          "Jhiaxus forced the Tribunal to expose the opponent's Backup count: " +
          (opponent?.backups.length || 0) +
          " remain.";
      }
      // A unique ability is a once-per-round effect, not one of the player's three attacks.
      // Keeping the attack budget separate lets a player use an ability and still make
      // all three attacks promised by Boss Rush.
      source.abilityUses = Math.max(0, source.abilityUses - 1);
      team.usedAbilities = [...(team.usedAbilities || []), sourceId];
      room.log.push(effect);
      raidEvent(room, { kind: "ability", name: source.name, side: "players" });
      reply({ ok: true });
      emitRaid(room);
    },
  );
  socket.on(
    "raid-reposition",
    ({ unitId, from, to } = {}, reply = () => {}) => {
      const room = raidRooms.get(socket.data.raidCode),
        team = room?.teams.get(socket.id);
      if (
        !room ||
        room.stage !== "reposition" ||
        (room.repositions.get(socket.id) || 0) <= 0
      )
        return reply({
          ok: false,
          error: "You have no Reposition move remaining.",
        });
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from < 0 ||
        from >= 9 ||
        to < 0 ||
        to >= 9 ||
        team.board[from]?.id !== unitId
      )
        return reply({
          ok: false,
          error:
            "Choose one of your own cards and a valid space on your 3 x 3 board.",
        });
      if (team.board[from]?.locked)
        return reply({
          ok: false,
          error: "That locked emplacement cannot be repositioned.",
        });
      [team.board[from], team.board[to]] = [team.board[to], team.board[from]];
      team.board.forEach((unit) => {
        if (
          unit?.id === "blurr" &&
          (unit === team.board[to] || unit === team.board[from])
        )
          unit.blurrLastMovedRound = room.round;
      });
      const intel = raidIntel(room, socket.id);
      [from, to].forEach((slot) => {
        intel.occupied.delete(slot);
        intel.empty.delete(slot);
      });
      room.repositions.set(socket.id, 0);
      room.log.push(
        `${room.players.get(socket.id)?.name || "Player"} used one Reposition move.`,
      );
      raidEvent(room, {
        kind: "reposition",
        side: "players",
        playerId: socket.id,
      });
      reply({ ok: true });
      emitRaid(room);
      completeRaidReposition(room);
    },
  );
  socket.on("raid-backup-swap", ({ backupId, slot } = {}, reply = () => {}) => {
    const room = raidRooms.get(socket.data.raidCode),
      team = room?.teams.get(socket.id);
    if (
      !room ||
      !team ||
      room.stage !== "reposition" ||
      (room.repositions.get(socket.id) || 0) <= 0
    )
      return reply({
        ok: false,
        error: "You have no Reposition move remaining.",
      });
    if (!Number.isInteger(slot) || slot < 0 || slot >= 9 || !team.board[slot])
      return reply({
        ok: false,
        error: "Choose one of your deployed characters.",
      });
    const backupIndex = team.backups.findIndex((unit) => unit.id === backupId);
    if (backupIndex < 0)
      return reply({ ok: false, error: "That Backup is unavailable." });
    const replaced = team.board[slot];
    if (replaced.locked)
      return reply({
        ok: false,
        error: "A locked emplacement cannot be swapped out.",
      });
    const replacement = team.backups.splice(backupIndex, 1)[0];
    if (replacement.id === "brainstorm")
      replacement.brainstormDeployedRound = room.round;
    if (replacement.id === "blurr")
      replacement.blurrLastMovedRound = room.round;
    team.board[slot] = replacement;
    team.backups.push(replaced);
    const intel = raidIntel(room, socket.id);
    intel.occupied.delete(slot);
    intel.empty.delete(slot);
    room.repositions.set(socket.id, 0);
    room.log.push(
      `${room.players.get(socket.id)?.name || "Player"} swapped ${replacement.name} into board space ${slot + 1}.`,
    );
    raidEvent(room, {
      kind: "reposition",
      side: "players",
      playerId: socket.id,
    });
    reply({ ok: true });
    emitRaid(room);
    completeRaidReposition(room);
  });
  socket.on("raid-skip-reposition", () => {
    const room = raidRooms.get(socket.data.raidCode);
    if (
      !room ||
      room.stage !== "reposition" ||
      (room.repositions.get(socket.id) || 0) <= 0
    )
      return;
    room.repositions.set(socket.id, 0);
    room.log.push(
      `${room.players.get(socket.id)?.name || "Player"} skipped their Reposition move.`,
    );
    emitRaid(room);
    completeRaidReposition(room);
  });
  socket.on("raid-end-turn", () => {
    const room = raidRooms.get(socket.data.raidCode);
    if (
      !room ||
      room.stage !== "combat" ||
      room.turnOrder[room.turnIndex] !== socket.id
    )
      return;
    const team = room.teams.get(socket.id);
    if (team) team.used = [];
    if (room.turnIndex === 0) {
      room.turnIndex = 1;
      room.actions = 3 + (room.extraActions.get(room.turnOrder[1]) || 0);
      room.extraActions.delete(room.turnOrder[1]);
      emitRaid(room);
    } else raidBossTurn(room);
  });
  socket.on("raid-leave", () => detachRaid(socket));
  if (socket.recovered) {
    syncPlayer(socket);
    const raidRoom = raidRooms.get(socket.data.raidCode);
    if (raidRoom?.players.has(socket.id)) emitRaid(raidRoom);
  }

  socket.on("join-room", (payload = {}, reply = () => {}) => {
    const code = clean(payload.code, 12).toUpperCase();
    const name = clean(payload.name, 20) || "Player";
    if (code.length < 3)
      return reply({
        ok: false,
        error: "Room code needs at least 3 characters.",
      });
    removeQuickMatch(socket.id);
    socket.data.quickQueue = false;
    const currentRoom = rooms.get(socket.data.roomCode);
    if (currentRoom?.code === code && currentRoom.players.has(socket.id)) {
      currentRoom.players.get(socket.id).name = name;
      reply({ ok: true, room: publicRoom(currentRoom), recovered: true });
      syncPlayer(socket);
      return;
    }
    detach(socket);
    let room = rooms.get(code);
    if (!room) {
      room = createRoom(code, normaliseStandardChallenges(payload.challenges));
      rooms.set(code, room);
    }
    if (room.players.size >= 2)
      return reply({ ok: false, error: "That room already has two players." });
    room.players.set(socket.id, { id: socket.id, name, ready: false });
    socket.join(code);
    socket.data.roomCode = code;
    announce(room);
    reply({ ok: true, room: publicRoom(room) });
  });

  socket.on("set-ready", (ready) => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.get(socket.id);
    if (!room || !player) return;
    if (room.started) return syncPlayer(socket);
    player.ready = Boolean(ready);
    announce(room);
    if (
      room.players.size === 2 &&
      [...room.players.values()].every((entry) => entry.ready)
    ) {
      room.started = true;
      room.stage = "deckbuilding";
      announce(room);
      io.to(room.code).emit("match-ready", { room: publicRoom(room) });
    }
  });

  socket.on("submit-deck", (deck, reply = () => {}) => {
    const respond = typeof reply === "function" ? reply : () => {};
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.players.has(socket.id))
      return respond({
        ok: false,
        error:
          "You are no longer connected to this room. Go back to Multiplayer and rejoin it.",
      });
    if (
      !Array.isArray(deck) ||
      deck.length !== 9 ||
      new Set(deck).size !== 9 ||
      deck.some(
        (id) =>
          typeof id !== "string" || !allUnits.some((unit) => unit.id === id),
      )
    ) {
      return respond({
        ok: false,
        error: "Your deck must contain exactly nine different character cards.",
      });
    }
    const deckRoles = deck.map(
      (id) => allUnits.find((unit) => unit.id === id)?.role,
    );
    const roleCount = (role) =>
      deckRoles.filter((candidate) => candidate === role).length;
    const standardDeck =
      roleCount("Commander") === 2 &&
      roleCount("Scout") === 3 &&
      roleCount("Trooper") === 2 &&
      roleCount("Tactician") === 2;
    const barrageDeck =
      deck.includes("barrage") &&
      roleCount("Commander") === 3 &&
      roleCount("Scout") === 2 &&
      roleCount("Trooper") === 2 &&
      roleCount("Tactician") === 2;
    if (!standardDeck && !barrageDeck)
      return respond({
        ok: false,
        error: "Your deck does not match the required class composition.",
      });
    if (room.challenges.includes("the-chosen")) {
      const legalChosen =
        roleCount("Commander") === 2 &&
        roleCount("Tactician") === 2 &&
        roleCount("Trooper") === 2 &&
        roleCount("Scout") === 3;
      if (!legalChosen)
        return respond({
          ok: false,
          error: "The Chosen must lock 2 Commanders, 2 Tacticians, 2 Troopers and 3 Scouts.",
        });
    }
    if (
      room.stage === "deployment" &&
      room.decks.size === 2 &&
      room.decks.has(socket.id)
    ) {
      respond({ ok: true, waiting: false, recovered: true });
      sendDecksReady(room, socket.id);
      return;
    }
    if (room.stage !== "deckbuilding")
      return respond({
        ok: false,
        error:
          "This room is not accepting decks right now. Rejoin with a new room code and try again.",
      });
    room.decks.set(socket.id, deck);
    const waiting = room.decks.size !== 2;
    respond({ ok: true, waiting });
    if (waiting)
      return socket.emit(
        "match-status",
        "Deck locked. Waiting for your opponent to finish building.",
      );
    if (room.challenges.includes("high-priority")) buildPriorityTargets(room);
    room.stage = "deployment";
    for (const [id] of room.players) sendDecksReady(room, id);
  });

  socket.on("submit-deployment", (deployment) => {
    const room = rooms.get(socket.data.roomCode);
    if (
      !room ||
      room.stage !== "deployment" ||
      !deployment ||
      !Array.isArray(deployment.board) ||
      !Array.isArray(deployment.backups)
    )
      return;
    if (
      deployment.board.length !== 9 ||
      deployment.board.filter(Boolean).length !== 6 ||
      deployment.backups.length !== 3
    )
      return;
    room.deployments.set(socket.id, deployment);
    if (room.deployments.size !== 2)
      return socket.emit(
        "match-status",
        "Starting six locked. Waiting for your opponent to deploy.",
      );
    for (const [id] of room.players) {
      const opponent = [...room.deployments.entries()].find(
        ([other]) => other !== id,
      )?.[1];
      io.to(id).emit("deployments-ready", { opponent });
    }
    startRound(room);
  });

  socket.on("combat-action", (action) => {
    const room = rooms.get(socket.data.roomCode);
    if (
      !room ||
      room.stage !== "combat" ||
      room.turnOrder[room.turnIndex] !== socket.id
    )
      return;
    if (!action || typeof action !== "object") return;
    if (action.kind === "reposition-lock")
      room.skipRepositionRound = room.round;
    socket.to(room.code).emit("combat-action", {
      ...action,
      actorId: socket.id,
      actorName: playerName(room, socket.id),
    });
  });

  socket.on("darkwing-request", () => {
    const room = rooms.get(socket.data.roomCode);
    if (
      !room ||
      room.stage !== "combat" ||
      room.turnOrder[room.turnIndex] !== socket.id
    )
      return;
    socket.to(room.code).emit("darkwing-request");
  });

  socket.on("darkwing-hand", ({ cards } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "combat" || !Array.isArray(cards)) return;
    socket.to(room.code).emit("darkwing-hand", {
      cards: cards.filter((card) => typeof card === "string").slice(0, 30),
    });
  });

  socket.on("darkwing-discard", ({ cards } = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (
      !room ||
      room.stage !== "combat" ||
      room.turnOrder[room.turnIndex] !== socket.id ||
      !Array.isArray(cards)
    )
      return;
    socket.to(room.code).emit("darkwing-discard", {
      cards: cards.filter((card) => typeof card === "string").slice(0, 2),
    });
  });

  socket.on("finish-turn", () => {
    const room = rooms.get(socket.data.roomCode);
    if (
      !room ||
      room.stage !== "combat" ||
      room.turnOrder[room.turnIndex] !== socket.id
    )
      return;
    advanceTurn(room);
  });

  socket.on("forfeit", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.players.has(socket.id) || room.stage === "lobby") return;
    clearTurnTimer(room);
    room.stage = "over";
    socket.to(room.code).emit("opponent-forfeited");
  });

  socket.on("reposition-snapshot", (deployment) => {
    const room = rooms.get(socket.data.roomCode);
    if (
      !room ||
      room.stage !== "reposition" ||
      !deployment ||
      !Array.isArray(deployment.board) ||
      !Array.isArray(deployment.backups) ||
      deployment.board.length !== 9
    )
      return;
    room.repositionSnapshots.set(socket.id, deployment);
  });

  socket.on("finish-reposition", (deployment) => {
    const room = rooms.get(socket.data.roomCode);
    if (
      !room ||
      room.stage !== "reposition" ||
      !deployment ||
      !Array.isArray(deployment.board) ||
      !Array.isArray(deployment.backups)
    )
      return;
    room.repositions.set(socket.id, withRequiredReinforcements(deployment));
    if (room.repositions.size !== 2)
      return socket.emit(
        "match-status",
        "Repositioning locked. Waiting for your opponent.",
      );
    completeReposition(room);
  });

  socket.on("leave-room", () => detach(socket));
  socket.on("disconnect", (reason) => {
    removeQuickMatch(socket.id);
    socket.data.quickQueue = false;
    if (
      reason === "client namespace disconnect" ||
      reason === "server namespace disconnect"
    ) {
      detachRaid(socket);
      return detach(socket);
    }
    const raidCode = socket.data.raidCode;
    if (raidCode) {
      const raidTimer = setTimeout(() => {
        pendingRaidDisconnects.delete(socket.id);
        detachRaid(socket);
      }, 125_000);
      raidTimer.unref?.();
      pendingRaidDisconnects.set(socket.id, {
        timer: raidTimer,
        code: raidCode,
      });
    }
    const code = socket.data.roomCode;
    if (!code) return;
    const timer = setTimeout(() => {
      pendingDisconnects.delete(socket.id);
      detach(socket);
    }, 125_000);
    timer.unref?.();
    pendingDisconnects.set(socket.id, { timer, code });
  });
});

const port = Number(process.env.PORT || 3000);
httpServer.listen(port, "0.0.0.0", () =>
  console.log(`Hidden Front multiplayer server listening on ${port}`),
);

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { io } from "socket.io-client";
import { bossRushBattleCards, starterDeck } from "../lib/card-data.ts";
import { QUINTESSON_RAID, UNICRON_RAID } from "../lib/raid-data.ts";

const origin = "https://pugtimusprime.github.io";

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out starting Raid server")), 15000);
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      if (!chunk.includes("multiplayer server listening")) return;
      clearTimeout(timer);
      resolve();
    });
    server.once("error", reject);
  });
}

function tracker(socket) {
  let latest = null;
  const waiters = new Set();
  socket.on("raid-state", (state) => {
    latest = state;
    for (const waiter of waiters) waiter();
  });
  return {
    get latest() {
      return latest;
    },
    waitFor(predicate, timeout = 6000) {
      if (latest && predicate(latest)) return Promise.resolve(latest);
      return new Promise((resolve, reject) => {
        const check = () => {
          if (!latest || !predicate(latest)) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(latest);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error("Timed out waiting for Raid state"));
        }, timeout);
        waiters.add(check);
      });
    },
  };
}

function roomTracker(socket) {
  let latest = null;
  const waiters = new Set();
  socket.on("room-state", (state) => {
    latest = state;
    for (const waiter of waiters) waiter();
  });
  return {
    waitFor(predicate, timeout = 6000) {
      if (latest && predicate(latest)) return Promise.resolve(latest);
      return new Promise((resolve, reject) => {
        const check = () => {
          if (!latest || !predicate(latest)) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(latest);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error("Timed out waiting for multiplayer room state"));
        }, timeout);
        waiters.add(check);
      });
    },
  };
}

function emitReply(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test("the Quintesson court has the approved Boss Rush board, stats and wording", () => {
  assert.deepEqual(QUINTESSON_RAID.board, {
    playerBoards: 2,
    playerColumns: 3,
    playerRows: 3,
    bossColumns: 3,
    bossRows: 2,
  });
  assert.deepEqual([QUINTESSON_RAID.boss.hp, QUINTESSON_RAID.boss.dmg], [850, 15]);
  assert.match(QUINTESSON_RAID.boss.ability, /two allicons/i);
  assert.deepEqual(
    QUINTESSON_RAID.court.map(({ id, role, hp, dmg }) => [id, role, hp, dmg]),
    [
      ["quintesson-bailiff", "Commander", 80, 20],
      ["quintesson-prosecutor", "Tactician", 70, 10],
      ["quintesson-executor", "Trooper", 60, 25],
      ["allicon", "Scout", 40, 5],
    ],
  );
  assert.match(QUINTESSON_RAID.court.at(-1).ability, /Allicon alive/i);
  for (const unit of [QUINTESSON_RAID.boss, ...QUINTESSON_RAID.court]) {
    const publicAsset = readFileSync(new URL(`../public${unit.image}`, import.meta.url));
    const pagesAsset = readFileSync(new URL(`..${unit.image}`, import.meta.url));
    assert.equal(publicAsset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.deepEqual(publicAsset, pagesAsset);
  }
});

test("Unicron has three health-driven phases and a visible three-card legion", () => {
  assert.deepEqual(UNICRON_RAID.board, {
    playerBoards: 2,
    playerColumns: 3,
    playerRows: 3,
    bossColumns: 3,
    bossRows: 1,
  });
  assert.deepEqual(UNICRON_RAID.phases.map(({ phase, minHp, maxHp, dmg }) => [phase, minHp, maxHp, dmg]), [
    [1, 1000, 1400, 20],
    [2, 400, 999, 30],
    [3, 1, 399, 35],
  ]);
  assert.deepEqual(UNICRON_RAID.legion.map(({ id, hp, dmg }) => [id, hp, dmg]), [
    ["the-fallen", 80, 20],
    ["sideways-unicron", 80, 20],
    ["rodimus-unicronus", 80, 20],
  ]);
  assert.match(UNICRON_RAID.legion[0].ability, /Battle Cards.*useless/i);
  assert.match(UNICRON_RAID.legion[1].ability, /heal The Fallen for 15/i);
  assert.match(UNICRON_RAID.legion[2].ability, /15 additional damage/i);
  for (const unit of [...UNICRON_RAID.phases, ...UNICRON_RAID.legion]) {
    const publicAsset = readFileSync(new URL(`../public${unit.image}`, import.meta.url));
    const pagesAsset = readFileSync(new URL(`..${unit.image}`, import.meta.url));
    assert.equal(publicAsset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.deepEqual(publicAsset, pagesAsset);
  }
});

test("Unicron phase mechanics and persistent visible layout are wired into Boss Rush", () => {
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const raid = readFileSync(new URL("../app/raid/page.tsx", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(home, /href="\/raid\?boss=unicron"/);
  assert.match(raid, /3 LEGION SPACES · ALL CARDS VISIBLE/);
  assert.match(raid, /unicron-raid-board/);
  assert.match(server, /function updateUnicronPhase/);
  assert.match(server, /room\.judge\.hp >= 1000/);
  assert.match(server, /room\.judge\.hp >= 400/);
  assert.match(server, /room\.bossBoard = \[/);
  assert.match(server, /Sideways restored 15 Health to The Fallen/);
  assert.match(server, /The Fallen renders all Battle Cards useless/);
  assert.match(server, /Unicron ignored the attack while his Phase 3 legion remains alive/);
});

test("Raid is a separate route with twin boards and attack-only hit animations", () => {
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const raid = readFileSync(new URL("../app/raid/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const server = readFileSync(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(home, /Quick Match/);
  assert.match(home, /quick-match/);
  assert.match(raid, /Quintesson Court/);
  assert.match(raid, /3 × 3/);
  assert.match(raid, /raid-player-boards/);
  assert.match(raid, /Hidden Quintesson troop/);
  assert.match(raid, /SHARED BOSS RUSH DECK/);
  assert.match(raid, /Unique abilities/);
  assert.match(raid, /ENEMY BRIEFING/);
  assert.match(css, /\.raid-shared-grid/);
  assert.match(css, /raid-hit-animation/);
  assert.match(raid, /event\.kind === "hit" && \(event\.damage \|\| 0\) > 0/);
  assert.doesNotMatch(raid, /animation\.kind==="reposition"/);
  assert.match(raid, /raid-turn-control/);
  assert.match(server, /minimaxRaidTarget/);
  assert.match(server, /minimaxHiddenCourtMove/);
  assert.match(server, /hiddenCourtSnapshot/);
  assert.match(home, /minimaxEnemyTarget/);
  assert.match(home, /enemyAiOccupied/);
});

test("Quick Match pairs the first two waiting players", async () => {
  const port = 3199;
  const server = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, {
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  const b = io(`http://127.0.0.1:${port}`, {
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  const states = [roomTracker(a), roomTracker(b)];
  try {
    await Promise.all([new Promise((resolve) => a.once("connect", resolve)), new Promise((resolve) => b.once("connect", resolve))]);
    const waiting = await emitReply(a, "quick-match", { name: "Alpha" });
    const matched = await emitReply(b, "quick-match", { name: "Beta" });
    assert.equal(waiting.ok, true);
    assert.equal(waiting.waiting, true);
    assert.equal(matched.ok, true);
    assert.equal(matched.waiting, false);
    const room = await states[0].waitFor((state) => state.players.length === 2);
    assert.equal(room.players[0].name, "Alpha");
    assert.equal(room.players[1].name, "Beta");
    const readyPromise = new Promise((resolve) => a.once("match-ready", resolve));
    a.emit("set-ready", true);
    b.emit("set-ready", true);
    await readyPromise;
  } finally {
    a.disconnect();
    b.disconnect();
    server.kill("SIGTERM");
  }
});

test("Boss Rush rooms preserve the selected Unicron encounter", async () => {
  const port = 3201;
  const server = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const b = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const stateA = tracker(a);
  try {
    await Promise.all([new Promise((resolve) => a.once("connect", resolve)), new Promise((resolve) => b.once("connect", resolve))]);
    assert.equal((await emitReply(a, "raid-join", { code: "CHAOS3", name: "Alpha", boss: "unicron" })).ok, true);
    const lobby = await stateA.waitFor((state) => state.encounterId === "unicron");
    assert.equal(lobby.encounterName, "Unicron");
    assert.deepEqual([lobby.judge.max, lobby.judge.hp, lobby.judge.dmg, lobby.judge.phase], [1400, 1400, 20, 1]);
    assert.equal(lobby.bossBoard.length, 3);
    assert.equal(lobby.bossBoard.every((slot) => slot === null), true);
    assert.equal(lobby.bossRoster.length, 6);
    const mismatch = await emitReply(b, "raid-join", { code: "CHAOS3", name: "Beta", boss: "quintesson" });
    assert.equal(mismatch.ok, false);
    assert.match(mismatch.error, /already assigned to the Unicron Boss Rush/i);
    assert.equal((await emitReply(b, "raid-join", { code: "CHAOS3", name: "Beta", boss: "unicron" })).ok, true);
  } finally {
    a.disconnect();
    b.disconnect();
    server.kill("SIGTERM");
  }
});

test("Boss Rush briefs both players, allows simultaneous placement, deals exclusive Battle Cards and revives a Bailiff", async () => {
  const port = 3200;
  const server = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, {
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  const b = io(`http://127.0.0.1:${port}`, {
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  const stateA = tracker(a),
    stateB = tracker(b);
  try {
    await Promise.all([new Promise((resolve) => a.once("connect", resolve)), new Promise((resolve) => b.once("connect", resolve))]);
    await emitReply(a, "raid-join", { code: "COURT8", name: "Alpha" });
    await emitReply(b, "raid-join", { code: "COURT8", name: "Beta" });
    await stateA.waitFor((state) => state.players.length === 2);
    a.emit("raid-ready");
    b.emit("raid-ready");
    await stateA.waitFor((state) => state.stage === "deckbuilding");
    const ids = starterDeck("Autobot").map((unit) => unit.id);
    assert.equal((await emitReply(a, "raid-submit-deck", ids)).ok, true);
    assert.equal((await emitReply(b, "raid-submit-deck", ids)).ok, true);
    const briefing = await stateA.waitFor((next) => next.stage === "briefing");
    assert.equal(briefing.judge.max, 850);
    assert.equal(briefing.bossRoster.length, 5);
    assert.equal(briefing.bossRoster.find((unit) => unit.id === "quintesson-bailiff").role, "Commander");
    a.emit("raid-briefing-ready");
    b.emit("raid-briefing-ready");
    let state = await stateA.waitFor((next) => next.stage === "deployment");
    const stateForB = await stateB.waitFor((next) => next.stage === "deployment");
    assert.equal(
      state.players.every((player) => player.team.board.length === 9),
      true,
    );
    const ownA = state.players.find((player) => player.id === a.id);
    const allyA = state.players.find((player) => player.id === b.id);
    const ownB = stateForB.players.find((player) => player.id === b.id);
    assert.equal(ownA.team.pending.length, 6);
    assert.equal(ownB.team.pending.length, 6);
    assert.equal(allyA.team.pending.length, 0, "an ally's pending cards stay private");
    assert.equal((await emitReply(a, "raid-place", { unitId: ids[0], slot: 9 })).ok, false);
    const simultaneous = await Promise.all([emitReply(a, "raid-place", { unitId: ids[0], slot: 0 }), emitReply(b, "raid-place", { unitId: ids[0], slot: 0 })]);
    assert.equal(
      simultaneous.every((reply) => reply.ok),
      true,
      "both players can place without waiting for the other",
    );
    for (let index = 1; index < 6; index += 1) {
      const replies = await Promise.all([emitReply(a, "raid-place", { unitId: ids[index], slot: index }), emitReply(b, "raid-place", { unitId: ids[index], slot: index })]);
      assert.equal(
        replies.every((reply) => reply.ok),
        true,
      );
    }
    state = await stateA.waitFor((next) => next.stage === "combat");
    assert.equal(state.stage, "combat");
    assert.equal(state.battleHand.length, 1);
    assert.equal(state.battlePlayed, false);
    assert.equal(state.actions, 3);
    assert.equal(state.battleHand.every((name) => bossRushBattleCards.some((card) => card.name === name)), true);
    assert.equal(state.battleCards.length, 26);
    const firstActive = state.activeId;
    const firstSocket = firstActive === a.id ? a : b;
    const secondSocket = firstSocket === a ? b : a;
    const attackIds = ["grimlock", "sun"];
    assert.equal((await emitReply(firstSocket, "raid-play-battle", { name: "Roll Out" })).ok, false, "normal Battle Cards are rejected in Boss Rush");
    for (const attackerId of attackIds)
      assert.equal(
        (
          await emitReply(firstSocket, "raid-attack", {
            attackerId,
            targetSlot: 0,
          })
        ).ok,
        true,
      );
    firstSocket.emit("raid-end-turn");
    await stateB.waitFor((next) => next.stage === "combat" && next.activeId === secondSocket.id);
    const secondAttackIds = ["grimlock", "sun"];
    for (const attackerId of secondAttackIds)
      assert.equal(
        (
          await emitReply(secondSocket, "raid-attack", {
            attackerId,
            targetSlot: 0,
          })
        ).ok,
        true,
      );
    secondSocket.emit("raid-end-turn");
    const reposition = await stateA.waitFor((next) => next.stage === "reposition");
    assert.equal(reposition.bossBoard.filter(Boolean).length, 3);
    assert.equal(reposition.bossBoard.filter(Boolean).filter((unit) => unit.hidden === false).length, 1, "one random troop is revealed each round");
    assert.equal(reposition.bossBoard.filter(Boolean).filter((unit) => unit.hidden).length, 2, "the remaining troops stay concealed");
    assert.match(reposition.log.join("\n"), /defeated Quintesson troop returned at half Health/);
    assert.equal(reposition.repositions[a.id], 1);
    assert.equal(reposition.repositions[b.id], 1);
    a.emit("raid-skip-reposition");
    b.emit("raid-skip-reposition");
    const nextRound = await stateA.waitFor((next) => next.stage === "combat" && next.round === 2);
    assert.notEqual(nextRound.activeId, firstActive, "player order reverses after the boss turn");
  } finally {
    a.disconnect();
    b.disconnect();
    server.kill("SIGTERM");
  }
});

test("Boss Rush challenge modes combine six-character teams with no Battle Cards", async () => {
  const port = 3203;
  const server = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, {
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  const b = io(`http://127.0.0.1:${port}`, {
    extraHeaders: { Origin: origin },
    reconnection: false,
  });
  const stateA = tracker(a);
  try {
    await Promise.all([
      new Promise((resolve) => a.once("connect", resolve)),
      new Promise((resolve) => b.once("connect", resolve)),
    ]);
    const challenges = [
      "no-battle-cards",
      "six-characters",
      "enemy-bonus-damage",
    ];
    assert.equal(
      (await emitReply(a, "raid-join", {
        code: "TRIAL6",
        name: "Alpha",
        challenges,
      })).ok,
      true,
    );
    assert.equal(
      (await emitReply(b, "raid-join", { code: "TRIAL6", name: "Beta" })).ok,
      true,
    );
    const lobby = await stateA.waitFor((state) => state.players.length === 2);
    assert.deepEqual(lobby.challengeModes, [...challenges].sort());
    a.emit("raid-ready");
    b.emit("raid-ready");
    await stateA.waitFor((state) => state.stage === "deckbuilding");
    const nine = starterDeck("Autobot").map((unit) => unit.id);
    const six = nine.slice(0, 6);
    assert.equal((await emitReply(a, "raid-submit-deck", nine)).ok, false);
    assert.equal((await emitReply(a, "raid-submit-deck", six)).ok, true);
    assert.equal((await emitReply(b, "raid-submit-deck", six)).ok, true);
    const briefing = await stateA.waitFor((state) => state.stage === "briefing");
    assert.equal(briefing.battleCards.length, 0);
    a.emit("raid-briefing-ready");
    b.emit("raid-briefing-ready");
    const deployment = await stateA.waitFor((state) => state.stage === "deployment");
    const ownTeam = deployment.players.find((player) => player.id === a.id).team;
    assert.equal(ownTeam.pending.length, 6);
    assert.equal(ownTeam.backups.length, 0);
    for (let slot = 0; slot < six.length; slot += 1) {
      assert.equal(
        (await emitReply(a, "raid-place", { unitId: six[slot], slot })).ok,
        true,
      );
      assert.equal(
        (await emitReply(b, "raid-place", { unitId: six[slot], slot })).ok,
        true,
      );
    }
    const combat = await stateA.waitFor((state) => state.stage === "combat");
    assert.equal(combat.battleHand.length, 0);
    assert.equal(combat.battleCards.length, 0);
    const battleReply = await emitReply(a, "raid-play-battle", {
      name: "Rallying Cry",
    });
    assert.equal(battleReply.ok, false);
    assert.match(battleReply.error, /Battle Cards are disabled by this Boss Rush challenge/);
  } finally {
    a.disconnect();
    b.disconnect();
    server.kill("SIGTERM");
  }
});

test("Lio Convoy uses the repaired uploaded card in both asset roots", () => {
  const publicAsset = readFileSync(new URL("../public/cards/characters/lio-convoy.png", import.meta.url));
  const pagesAsset = readFileSync(new URL("../cards/characters/lio-convoy.png", import.meta.url));
  assert.equal(publicAsset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.deepEqual(publicAsset, pagesAsset);
});

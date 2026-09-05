import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { io } from "socket.io-client";
import { starterDeck } from "../lib/card-data.ts";
import { QUINTESSON_RAID } from "../lib/raid-data.ts";

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
    get latest() { return latest; },
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

function sharedPlaced(state) {
  return state.players.reduce((sum, player) => sum + (player.team?.board.filter(Boolean).length || 0), 0);
}

test("the Quintesson court has the approved Boss Rush board, stats and wording", () => {
  assert.deepEqual(QUINTESSON_RAID.board, { playerBoards: 2, playerColumns: 3, playerRows: 3, bossColumns: 3, bossRows: 2 });
  assert.deepEqual([QUINTESSON_RAID.boss.hp, QUINTESSON_RAID.boss.dmg], [700, 15]);
  assert.match(QUINTESSON_RAID.boss.ability, /two allicons/i);
  assert.deepEqual(QUINTESSON_RAID.court.map(({ id, role, hp, dmg }) => [id, role, hp, dmg]), [
    ["quintesson-bailiff", "Trooper", 80, 20],
    ["quintesson-prosecutor", "Tactician", 70, 10],
    ["quintesson-executor", "Trooper", 60, 25],
    ["allicon", "Scout", 40, 5],
  ]);
  assert.match(QUINTESSON_RAID.court.at(-1).ability, /Allicon alive/i);
  for (const unit of [QUINTESSON_RAID.boss, ...QUINTESSON_RAID.court]) {
    const publicAsset = readFileSync(new URL(`../public${unit.image}`, import.meta.url));
    const pagesAsset = readFileSync(new URL(`..${unit.image}`, import.meta.url));
    assert.equal(publicAsset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.deepEqual(publicAsset, pagesAsset);
  }
});

test("Raid is a separate route with shared boards, battle cards and animations", () => {
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
  assert.match(raid, /Shared Battle Cards/);
  assert.match(css, /\.raid-shared-grid/);
  assert.match(css, /raid-hit-animation/);
  assert.match(server, /minimaxRaidTarget/);
  assert.match(home, /minimaxEnemyTarget/);
});

test("Quick Match pairs the first two waiting players", async () => {
  const port = 3199;
  const server = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const b = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
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
    a.emit("set-ready", true); b.emit("set-ready", true);
    await readyPromise;
  } finally {
    a.disconnect(); b.disconnect(); server.kill("SIGTERM");
  }
});

test("Boss Rush alternates placement, shares one Battle Card and revives a Bailiff", async () => {
  const port = 3200;
  const server = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const b = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const stateA = tracker(a), stateB = tracker(b);
  try {
    await Promise.all([new Promise((resolve) => a.once("connect", resolve)), new Promise((resolve) => b.once("connect", resolve))]);
    await emitReply(a, "raid-join", { code: "COURT8", name: "Alpha" });
    await emitReply(b, "raid-join", { code: "COURT8", name: "Beta" });
    await stateA.waitFor((state) => state.players.length === 2);
    a.emit("raid-ready"); b.emit("raid-ready");
    await stateA.waitFor((state) => state.stage === "deckbuilding");
    const ids = starterDeck("Autobot").map((unit) => unit.id);
    assert.equal((await emitReply(a, "raid-submit-deck", ids)).ok, true);
    assert.equal((await emitReply(b, "raid-submit-deck", ids)).ok, true);
    let state = await stateA.waitFor((next) => next.stage === "deployment");
    assert.equal(state.players.every((player) => player.team.board.length === 9), true);
    while (state.stage === "deployment") {
      const activeId = state.placementActiveId;
      const socket = activeId === a.id ? a : b;
      const activePlayer = state.players.find((player) => player.id === activeId);
      const pending = activePlayer.team.pending;
      const slot = activePlayer.team.board.findIndex((unit) => !unit);
      assert.ok(slot >= 0 && slot < 9, "each player has an independent 3 x 3 placement board");
      assert.equal((await emitReply(socket, "raid-place", { unitId: pending[0].id, slot: 9 })).ok, false);
      const placedBefore = sharedPlaced(state);
      assert.equal((await emitReply(socket, "raid-place", { unitId: pending[0].id, slot })).ok, true);
      state = await stateA.waitFor((next) => next.stage !== "deployment" || sharedPlaced(next) > placedBefore);
    }
    assert.equal(state.stage, "combat");
    assert.equal(state.battleHand.length, 1);
    assert.equal(state.battlePlayed, false);
    const firstActive = state.activeId;
    const firstSocket = firstActive === a.id ? a : b;
    const secondSocket = firstSocket === a ? b : a;
    const firstTeam = state.players.find((player) => player.id === firstActive).team;
    const attackIds = ["grimlock", "sun"];
    const card = state.battleHand[0];
    assert.equal((await emitReply(firstSocket, "raid-play-battle", { name: card })).ok, true);
    state = await stateA.waitFor((next) => next.battlePlayed);
    assert.equal(stateA.latest.battlePlayed, true);
    for (const attackerId of attackIds) assert.equal((await emitReply(firstSocket, "raid-attack", { attackerId, targetSlot: 0 })).ok, true);
    firstSocket.emit("raid-end-turn");
    await stateB.waitFor((next) => next.stage === "combat" && next.activeId === secondSocket.id);
    const secondTeam = stateB.latest.players.find((player) => player.id === secondSocket.id).team;
    const secondAttackIds = ["grimlock", "sun"];
    for (const attackerId of secondAttackIds) assert.equal((await emitReply(secondSocket, "raid-attack", { attackerId, targetSlot: 0 })).ok, true);
    secondSocket.emit("raid-end-turn");
    const reposition = await stateA.waitFor((next) => next.stage === "reposition");
    assert.equal(reposition.bossBoard.filter(Boolean).length, 3);
    assert.equal(reposition.bossBoard.filter(Boolean).every((unit) => unit.hidden && unit.occupied), true);
    assert.equal(JSON.stringify(reposition.bossBoard).includes("quintesson-bailiff"), false);
    assert.equal(JSON.stringify(reposition.bossBoard).includes("quintesson-prosecutor"), false);
    assert.match(reposition.log.join("\n"), /defeated Quintesson troop returned at half Health/);
    assert.equal(reposition.repositions[a.id], 1);
    assert.equal(reposition.repositions[b.id], 1);
    a.emit("raid-skip-reposition"); b.emit("raid-skip-reposition");
    const nextRound = await stateA.waitFor((next) => next.stage === "combat" && next.round === 2);
    assert.notEqual(nextRound.activeId, firstActive, "player order reverses after the boss turn");
  } finally {
    a.disconnect(); b.disconnect(); server.kill("SIGTERM");
  }
});

test("Lio Convoy uses the repaired uploaded card in both asset roots", () => {
  const publicAsset = readFileSync(new URL("../public/cards/characters/lio-convoy.png", import.meta.url));
  const pagesAsset = readFileSync(new URL("../cards/characters/lio-convoy.png", import.meta.url));
  assert.equal(publicAsset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.deepEqual(publicAsset, pagesAsset);
});

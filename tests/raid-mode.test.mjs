import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { io } from "socket.io-client";
import { starterDeck } from "../lib/card-data.ts";
import { QUINTESSON_RAID } from "../lib/raid-data.ts";

const port = 3198;
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
    waitFor(predicate, timeout = 5000) {
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

function emitReply(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

test("the Quintesson court has the approved Raid stats and assets", () => {
  assert.deepEqual(
    [QUINTESSON_RAID.boss.hp, QUINTESSON_RAID.boss.dmg],
    [700, 15],
  );
  assert.deepEqual(
    QUINTESSON_RAID.court.map(({ id, role, hp, dmg }) => [id, role, hp, dmg]),
    [
      ["quintesson-bailiff", "Trooper", 80, 20],
      ["quintesson-prosecutor", "Tactician", 70, 10],
      ["quintesson-executor", "Trooper", 60, 25],
      ["allicon", "Scout", 40, 5],
    ],
  );
  for (const unit of [QUINTESSON_RAID.boss, ...QUINTESSON_RAID.court]) {
    const publicAsset = readFileSync(new URL(`../public${unit.image}`, import.meta.url));
    const pagesAsset = readFileSync(new URL(`..${unit.image}`, import.meta.url));
    assert.equal(publicAsset.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.deepEqual(publicAsset, pagesAsset);
  }
});

test("Raid is a separate route with its own theme, border and menu entry", () => {
  const home = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const raid = readFileSync(new URL("../app/raid/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(home, /href="\/raid"/);
  assert.match(home, /Online co-op Quintesson Raid/);
  assert.match(home, /verdict-engine.*Verdict Engine/);
  assert.match(home, /tribunal-shackle.*Tribunal Shackle/);
  assert.match(raid, /Player 1: 2 actions/);
  assert.match(raid, /Visible Boss Court/);
  assert.match(css, /\.quintesson-raid-board/);
});

test("two players can enter Raid and the Judge revives a defeated Bailiff", async () => {
  const server = spawn(process.execPath, ["server.mjs"], {
    env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const b = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const stateA = tracker(a), stateB = tracker(b);
  try {
    await Promise.all([
      new Promise((resolve) => a.once("connect", resolve)),
      new Promise((resolve) => b.once("connect", resolve)),
    ]);
    assert.equal((await emitReply(a, "raid-join", { code: "COURT7", name: "Alpha" })).ok, true);
    assert.equal((await emitReply(b, "raid-join", { code: "COURT7", name: "Beta" })).ok, true);
    await stateA.waitFor((state) => state.players.length === 2);
    a.emit("raid-ready");
    b.emit("raid-ready");
    await stateA.waitFor((state) => state.stage === "deckbuilding");
    const rejected = await emitReply(a, "raid-submit-deck", ["optimus"]);
    assert.equal(rejected.ok, false);
    const ids = starterDeck("Autobot").map((unit) => unit.id);
    assert.equal((await emitReply(a, "raid-submit-deck", ids)).ok, true);
    assert.equal((await emitReply(b, "raid-submit-deck", ids)).ok, true);
    const combat = await stateA.waitFor((state) => state.stage === "combat");
    assert.equal(combat.actions, 2);
    const first = combat.activeId === a.id ? a : b;
    const second = first === a ? b : a;
    const firstState = first === a ? stateA : stateB;
    const secondState = second === a ? stateA : stateB;
    for (const attackerId of ["grimlock", "sun"]) {
      assert.equal((await emitReply(first, "raid-attack", { attackerId, targetId: "quintesson-bailiff" })).ok, true);
    }
    first.emit("raid-end-turn");
    await secondState.waitFor((state) => state.stage === "combat" && state.activeId === second.id);
    for (const attackerId of ["grimlock", "sun"]) {
      assert.equal((await emitReply(second, "raid-attack", { attackerId, targetId: "quintesson-bailiff" })).ok, true);
    }
    second.emit("raid-end-turn");
    const roundTwo = await firstState.waitFor((state) => state.stage === "combat" && state.round === 2);
    assert.equal(roundTwo.boss.find((unit) => unit.id === "quintesson-bailiff").hp, 40);
    assert.match(roundTwo.log.join("\n"), /returned at half Health/);
    assert.equal(roundTwo.activeId, second.id, "player order reverses after the boss turn");
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

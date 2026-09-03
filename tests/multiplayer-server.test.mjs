import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import { io } from "socket.io-client";

const port = 3197;
const origin = "https://pugtimusprime.github.io";

function waitForServer(server) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out starting multiplayer server")), 15000);
    server.stdout.setEncoding("utf8");
    server.stdout.on("data", (chunk) => {
      if (!chunk.includes("multiplayer server listening")) return;
      clearTimeout(timer);
      resolve();
    });
    server.once("error", (error) => { clearTimeout(timer); reject(error); });
    server.once("exit", (code) => {
      if (code) { clearTimeout(timer); reject(new Error(`Multiplayer server exited with code ${code}`)); }
    });
  });
}

function once(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 5000);
    socket.once(event, (payload) => { clearTimeout(timer); resolve(payload); });
  });
}

test("multiplayer rounds gate turns and repositioning", async () => {
  const server = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(port), CLIENT_ORIGIN: origin, TURN_DURATION_MS:"2500" }, stdio: ["ignore", "pipe", "pipe"] });
  await waitForServer(server);
  const a = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  const b = io(`http://127.0.0.1:${port}`, { extraHeaders: { Origin: origin }, reconnection: false });
  try {
    await Promise.all([once(a, "connect"), once(b, "connect")]);
    await Promise.all([
      new Promise(resolve => a.emit("join-room", { code: "TEST9", name: "Alpha" }, resolve)),
      new Promise(resolve => b.emit("join-room", { code: "TEST9", name: "Beta" }, resolve)),
    ]);
    const matchA = once(a, "match-ready"), matchB = once(b, "match-ready");
    a.emit("set-ready", true); b.emit("set-ready", true); await Promise.all([matchA, matchB]);
    const rejected = await new Promise(resolve => a.emit("submit-deck", ["duplicate","duplicate"], resolve));
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /exactly nine/i);
    const decksA = once(a, "decks-ready"), decksB = once(b, "decks-ready");
    const acknowledgementA = new Promise(resolve => a.emit("submit-deck", ["a1","a2","a3","a4","a5","a6","a7","a8","a9"], resolve));
    const acknowledgementB = new Promise(resolve => b.emit("submit-deck", ["b1","b2","b3","b4","b5","b6","b7","b8","b9"], resolve));
    const acknowledgements = await Promise.all([acknowledgementA, acknowledgementB]);
    assert.ok(acknowledgements.every(result => result.ok));
    assert.deepEqual(acknowledgements.map(result => result.waiting).sort(), [false, true]);
    await Promise.all([decksA, decksB]);
    const deployA = once(a, "deployments-ready"), deployB = once(b, "deployments-ready");
    const turnA = once(a, "turn-state"), turnB = once(b, "turn-state");
    a.emit("submit-deployment", { board:["a1","a2","a3","a4","a5","a6",null,null,null], backups:["a7","a8","a9"] });
    b.emit("submit-deployment", { board:["b1","b2","b3","b4","b5","b6",null,null,null], backups:["b7","b8","b9"] });
    await Promise.all([deployA, deployB]);
    const initial = await Promise.all([turnA, turnB]);
    const firstIndex = initial.findIndex(state => state.yourTurn);
    assert.notEqual(firstIndex, -1);
    assert.equal(initial[firstIndex].actions, 2);
    assert.equal(initial[1-firstIndex].actions, 0);
    assert.equal(initial[firstIndex].turnDurationMs, 2500);
    assert.ok(initial[firstIndex].turnEndsAt > Date.now());
    const first = firstIndex === 0 ? a : b, second = firstIndex === 0 ? b : a;
    const action = once(second, "combat-action");
    first.emit("combat-action", { kind:"attack", target:4, hit:true, damage:20, result:{ id:"x", hp:20 }, attackerName:"ignored" });
    assert.equal((await action).target, 4);
    const lockAction = once(second, "combat-action");
    first.emit("combat-action", { kind:"reposition-lock", round:1 });
    assert.equal((await lockAction).kind, "reposition-lock");
    const nextA = once(a, "turn-state"), nextB = once(b, "turn-state");
    first.emit("finish-turn");
    const secondTurn = await Promise.all([nextA, nextB]);
    assert.equal(secondTurn[firstIndex].yourTurn, false);
    assert.equal(secondTurn[1-firstIndex].actions, 3);
    const repositionA = once(a, "reposition-start"), repositionB = once(b, "reposition-start");
    second.emit("finish-turn"); const reposition = await Promise.all([repositionA, repositionB]);
    assert.ok(reposition.every(state => state.locked && state.moves === 0));
    const round2A = once(a, "turn-state"), round2B = once(b, "turn-state");
    a.emit("finish-reposition", { board:[], backups:[] }); b.emit("finish-reposition", { board:[], backups:[] });
    const round2 = await Promise.all([round2A, round2B]);
    assert.equal(round2[0].round, 2); assert.equal(round2[1].round, 2);
    assert.equal(round2.find(state => state.yourTurn).actions, 3);
    const autoA = once(a, "turn-state"), autoB = once(b, "turn-state");
    const autoAdvanced = await Promise.all([autoA, autoB]);
    assert.equal(autoAdvanced[0].round, 2);
    assert.notEqual(autoAdvanced.findIndex(state => state.yourTurn), round2.findIndex(state => state.yourTurn));
    const forfeited = once(b, "opponent-forfeited");
    a.emit("forfeit");
    await forfeited;
  } finally {
    a.disconnect(); b.disconnect(); server.kill("SIGTERM");
  }
});

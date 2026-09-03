import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const permittedOrigins = (process.env.CLIENT_ORIGIN || "https://pugtimusprime.github.io")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const io = new Server(httpServer, { cors: { origin: permittedOrigins, methods: ["GET", "POST"] } });
const rooms = new Map();

app.get("/", (_request, response) => response.json({ service: "Hidden Front multiplayer", status: "online" }));
app.get("/health", (_request, response) => response.json({ ok: true, rooms: rooms.size }));

function clean(value, max) {
  return typeof value === "string" ? value.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, max) : "";
}

function createRoom(code) {
  return {
    code,
    players: new Map(),
    started: false,
    decks: new Map(),
    deployments: new Map(),
    stage: "lobby",
    round: 0,
    turnOrder: [],
    turnIndex: 0,
    repositions: new Map(),
  };
}

function publicRoom(room) {
  return {
    code: room.code,
    players: [...room.players.values()].map(({ id, name, ready }) => ({ id, name, ready })),
    started: room.started,
  };
}

function announce(room) { io.to(room.code).emit("room-state", publicRoom(room)); }
function playerName(room, id) { return room.players.get(id)?.name || "Opponent"; }

function emitTurn(room) {
  const activeId = room.turnOrder[room.turnIndex];
  const actions = room.round === 1 && room.turnIndex === 0 ? 2 : 3;
  for (const [id] of room.players) {
    io.to(id).emit("turn-state", {
      round: room.round,
      activeId,
      activeName: playerName(room, activeId),
      yourTurn: id === activeId,
      actions: id === activeId ? actions : 0,
      firstTurn: room.turnIndex === 0,
    });
  }
}

function startRound(room) {
  const playerIds = [...room.players.keys()];
  if (playerIds.length !== 2) return;
  room.round += 1;
  room.stage = "combat";
  room.turnIndex = 0;
  room.repositions.clear();
  room.turnOrder = Math.random() < 0.5 ? playerIds : [playerIds[1], playerIds[0]];
  emitTurn(room);
}

function detach(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = undefined;
  if (!room) return;
  room.players.delete(socket.id);
  room.decks.delete(socket.id);
  room.deployments.delete(socket.id);
  room.repositions.delete(socket.id);
  if (room.players.size === 0) rooms.delete(code);
  else {
    room.stage = "lobby";
    room.started = false;
    announce(room);
    io.to(room.code).emit("opponent-left");
  }
}

io.on("connection", (socket) => {
  socket.emit("server-ready", { version: 2 });

  socket.on("join-room", (payload = {}, reply = () => {}) => {
    const code = clean(payload.code, 12).toUpperCase();
    const name = clean(payload.name, 20) || "Player";
    if (code.length < 3) return reply({ ok: false, error: "Room code needs at least 3 characters." });
    detach(socket);
    let room = rooms.get(code);
    if (!room) { room = createRoom(code); rooms.set(code, room); }
    if (room.players.size >= 2) return reply({ ok: false, error: "That room already has two players." });
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
    player.ready = Boolean(ready);
    announce(room);
    if (room.players.size === 2 && [...room.players.values()].every((entry) => entry.ready)) {
      room.started = true;
      room.stage = "deckbuilding";
      announce(room);
      io.to(room.code).emit("match-ready", { room: publicRoom(room) });
    }
  });

  socket.on("submit-deck", (deck) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "deckbuilding" || !Array.isArray(deck) || deck.length !== 9 || new Set(deck).size !== 9) return;
    room.decks.set(socket.id, deck);
    if (room.decks.size !== 2) return socket.emit("match-status", "Deck locked. Waiting for your opponent to finish building.");
    room.stage = "deployment";
    for (const [id] of room.players) {
      const opponent = [...room.decks.entries()].find(([other]) => other !== id)?.[1];
      io.to(id).emit("decks-ready", { opponent });
    }
  });

  socket.on("submit-deployment", (deployment) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "deployment" || !deployment || !Array.isArray(deployment.board) || !Array.isArray(deployment.backups)) return;
    if (deployment.board.length !== 9 || deployment.board.filter(Boolean).length !== 6 || deployment.backups.length !== 3) return;
    room.deployments.set(socket.id, deployment);
    if (room.deployments.size !== 2) return socket.emit("match-status", "Starting six locked. Waiting for your opponent to deploy.");
    for (const [id] of room.players) {
      const opponent = [...room.deployments.entries()].find(([other]) => other !== id)?.[1];
      io.to(id).emit("deployments-ready", { opponent });
    }
    startRound(room);
  });

  socket.on("combat-action", (action) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "combat" || room.turnOrder[room.turnIndex] !== socket.id) return;
    if (!action || typeof action !== "object") return;
    socket.to(room.code).emit("combat-action", { ...action, actorId: socket.id, actorName: playerName(room, socket.id) });
  });

  socket.on("finish-turn", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "combat" || room.turnOrder[room.turnIndex] !== socket.id) return;
    if (room.turnIndex === 0) {
      room.turnIndex = 1;
      emitTurn(room);
    } else {
      room.stage = "reposition";
      room.repositions.clear();
      io.to(room.code).emit("reposition-start");
    }
  });

  socket.on("finish-reposition", (deployment) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "reposition" || !deployment || !Array.isArray(deployment.board) || !Array.isArray(deployment.backups)) return;
    room.repositions.set(socket.id, deployment);
    if (room.repositions.size !== 2) return socket.emit("match-status", "Repositioning locked. Waiting for your opponent.");
    for (const [id] of room.players) {
      const opponent = [...room.repositions.entries()].find(([other]) => other !== id)?.[1];
      io.to(id).emit("opponent-repositioned", { opponent });
    }
    startRound(room);
  });

  socket.on("leave-room", () => detach(socket));
  socket.on("disconnect", () => detach(socket));
});

const port = Number(process.env.PORT || 3000);
httpServer.listen(port, "0.0.0.0", () => console.log(`Hidden Front multiplayer server listening on ${port}`));

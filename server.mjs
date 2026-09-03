import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const permittedOrigins = (process.env.CLIENT_ORIGIN || "https://pugtimusprime.github.io")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const io = new Server(httpServer, {
  cors: { origin: permittedOrigins, methods: ["GET", "POST"] },
});
const rooms = new Map();

app.get("/", (_request, response) => response.json({ service: "Hidden Front multiplayer", status: "online" }));
app.get("/health", (_request, response) => response.json({ ok: true, rooms: rooms.size }));

function clean(value, max) {
  return typeof value === "string" ? value.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, max) : "";
}
function publicRoom(room) {
  return { code: room.code, players: [...room.players.values()].map(({ id, name, ready }) => ({ id, name, ready })), started: room.started };
}
function announce(room) { io.to(room.code).emit("room-state", publicRoom(room)); }
function detach(socket) {
  const code = socket.data.roomCode;
  if (!code) return;
  const room = rooms.get(code);
  socket.leave(code);
  socket.data.roomCode = undefined;
  if (!room) return;
  room.players.delete(socket.id);
  if (room.players.size === 0) rooms.delete(code); else announce(room);
}

io.on("connection", (socket) => {
  socket.emit("server-ready", { version: 1 });
  socket.on("join-room", (payload = {}, reply = () => {}) => {
    const code = clean(payload.code, 12).toUpperCase();
    const name = clean(payload.name, 20) || "Player";
    if (code.length < 3) return reply({ ok: false, error: "Room code needs at least 3 characters." });
    detach(socket);
    let room = rooms.get(code);
    if (!room) { room = { code, players: new Map(), started: false }; rooms.set(code, room); }
    if (room.players.size >= 2) return reply({ ok: false, error: "That room already has two players." });
    room.players.set(socket.id, { id: socket.id, name, ready: false });
    socket.join(code); socket.data.roomCode = code;
    announce(room); reply({ ok: true, room: publicRoom(room) });
  });
  socket.on("set-ready", (ready) => {
    const room = rooms.get(socket.data.roomCode); const player = room?.players.get(socket.id);
    if (!room || !player) return;
    player.ready = Boolean(ready); announce(room);
    if (room.players.size === 2 && [...room.players.values()].every((entry) => entry.ready)) {
      room.started = true; announce(room); io.to(room.code).emit("match-ready", { room: publicRoom(room) });
    }
  });
  socket.on("leave-room", () => detach(socket));
  socket.on("disconnect", () => detach(socket));
});

const port = Number(process.env.PORT || 3000);
httpServer.listen(port, "0.0.0.0", () => console.log(`Hidden Front multiplayer server listening on ${port}`));

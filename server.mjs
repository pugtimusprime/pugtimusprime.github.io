import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import { allUnits } from "./lib/card-data.ts";

const app = express();
const httpServer = createServer(app);
const permittedOrigins = (process.env.CLIENT_ORIGIN || "https://pugtimusprime.github.io,https://transformers-hidden-front.shadowcomicsrouges.chatgpt.site")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const io = new Server(httpServer, {
  cors: { origin: permittedOrigins, methods: ["GET", "POST"] },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120_000,
    skipMiddlewares: true,
  },
});
const rooms = new Map();
const raidRooms = new Map();
const pendingDisconnects = new Map();
const pendingRaidDisconnects = new Map();
const TURN_DURATION_MS = Math.max(100, Number(process.env.TURN_DURATION_MS || 60_000));
const REPOSITION_DURATION_MS = Math.max(100, Number(process.env.REPOSITION_DURATION_MS || 30_000));

app.get("/", (_request, response) => response.json({ service: "Hidden Front multiplayer", status: "online" }));
app.get("/health", (_request, response) => response.json({ ok: true, rooms: rooms.size, raidRooms: raidRooms.size, version: 6 }));

const raidTemplates = {
  judge: { id:"quintesson-judge", name:"Quintesson Judge", role:"Leader", max:700, hp:700, dmg:15, image:"/cards/characters/quintesson-judge.png", ability:"At the start of each boss turn, revive one defeated Quintesson troop at half Health. If none are defeated and fewer than three troops are alive, summon an Allicon." },
  bailiff: { id:"quintesson-bailiff", name:"Quintesson Bailiff", role:"Trooper", max:80, hp:80, dmg:20, image:"/cards/characters/quintesson-bailiff.png", ability:"While the Bailiff is alive, the Judge takes 50% less damage." },
  prosecutor: { id:"quintesson-prosecutor", name:"Quintesson Prosecutor", role:"Tactician", max:70, hp:70, dmg:10, image:"/cards/characters/quintesson-prosecutor.png", ability:"At the start of the boss turn, mark the player character with the lowest current Health. The next Quintesson attack against that character deals +10 damage." },
  executor: { id:"quintesson-executor", name:"Quintesson Executor", role:"Trooper", max:60, hp:60, dmg:25, image:"/cards/characters/quintesson-executor.png", ability:"When attacking a character at half Health or lower, deal an additional 10 damage." },
  allicon: { id:"allicon", name:"Allicon", role:"Scout", max:40, hp:40, dmg:5, image:"/cards/characters/allicon.png", ability:"Gain +5 damage for every other living Allicon, up to +10." },
};
const raidCharacterById = new Map(allUnits.map((unit) => [unit.id, unit]));
function freshRaidUnit(unit) { return structuredClone({ ...unit, hp: unit.max }); }
function legalRaidDeck(ids) {
  if (!Array.isArray(ids) || ids.length !== 9 || new Set(ids).size !== 9 || ids.some((id) => typeof id !== "string" || !raidCharacterById.has(id))) return null;
  const units = ids.map((id) => freshRaidUnit(raidCharacterById.get(id)));
  const roles = { Commander: 0, Scout: 0, Trooper: 0, Tactician: 0 };
  for (const unit of units) roles[unit.role] += 1;
  return roles.Commander === 2 && roles.Scout === 3 && roles.Trooper === 2 && roles.Tactician === 2 ? units : null;
}
function createRaidRoom(code){return {code,players:new Map(),stage:"lobby",round:1,decks:new Map(),teams:new Map(),ready:new Set(),turnOrder:[],turnIndex:0,actions:2,boss:[{...raidTemplates.judge},{...raidTemplates.bailiff},{...raidTemplates.prosecutor},{...raidTemplates.executor}],fallen:[],alliconSerial:0,log:["The Quintesson Tribunal awaits judgement."]};}
function raidPublic(room,viewer){return {code:room.code,stage:room.stage,round:room.round,youId:viewer,activeId:room.turnOrder[room.turnIndex]||null,actions:room.actions,players:[...room.players.values()].map(p=>({...p,ready:room.ready.has(p.id),team:room.teams.get(p.id)||null})),boss:room.boss,log:room.log.slice(-30)};}
function emitRaid(room){for(const [id] of room.players)io.to(id).emit("raid-state",raidPublic(room,id));}
function livingRaidUnits(team){return [...(team?.board||[]),...(team?.backups||[])].filter(u=>u&&u.hp>0);}
function raidBossTurn(room){
  const troops=room.boss.filter(u=>u.id!=="quintesson-judge"&&u.hp>0);
  const fallenNamed=room.fallen.find(u=>u.id!=="allicon");
  if(fallenNamed){room.fallen=room.fallen.filter(u=>u!==fallenNamed);room.boss.push({...fallenNamed,hp:Math.ceil(fallenNamed.max/2)});room.log.push(`${fallenNamed.name} returned at half Health.`);}
  else if(troops.length<3){room.alliconSerial++;room.boss.push({...raidTemplates.allicon,id:`allicon-${room.alliconSerial}`});room.log.push("The Judge summoned an Allicon.");}
  const candidates=[];for(const [playerId,team] of room.teams)for(const unit of team.board)if(unit?.hp>0)candidates.push({playerId,unit});
  const prosecutorAlive=room.boss.some(u=>u.id==="quintesson-prosecutor"&&u.hp>0);
  const marked=prosecutorAlive?candidates.toSorted((a,b)=>a.unit.hp-b.unit.hp)[0]:null;
  let markAvailable=Boolean(marked);
  if(marked)room.log.push(`The Prosecutor marked ${marked.unit.name} for judgement.`);
  const attackers=room.boss.filter(u=>u.hp>0);
  for(const attacker of attackers){
    const live=[];for(const [playerId,team] of room.teams)for(const unit of team.board)if(unit?.hp>0)live.push({playerId,unit});
    if(!live.length)break;
    const chosen=attacker.id==="quintesson-prosecutor"&&marked?marked:live[Math.floor(Math.random()*live.length)];
    let damage=attacker.dmg;
    if(markAvailable&&chosen.unit===marked.unit){damage+=10;markAvailable=false;}
    if(attacker.id==="quintesson-executor"&&chosen.unit.hp<=chosen.unit.max/2)damage+=10;
    if(attacker.id.startsWith("allicon")){const otherAllicons=room.boss.filter(u=>u!==attacker&&u.hp>0&&u.id.startsWith("allicon")).length;damage+=Math.min(10,otherAllicons*5);}
    chosen.unit.hp=Math.max(0,chosen.unit.hp-damage);room.log.push(`${attacker.name} struck ${chosen.unit.name} for ${damage}.`);
    if(chosen.unit.hp===0){const team=room.teams.get(chosen.playerId);const index=team.board.findIndex(u=>u?.id===chosen.unit.id);team.board[index]=team.backups.shift()||null;room.log.push(`${chosen.unit.name} was defeated${team.board[index]?`; ${team.board[index].name} reinforced the space`:""}.`);}
  }
  if([...room.teams.values()].every(team=>livingRaidUnits(team).length===0)){room.stage="defeat";room.log.push("Both player teams were defeated.");emitRaid(room);return;}
  room.round++;room.turnOrder.reverse();room.turnIndex=0;room.actions=2;room.stage="combat";emitRaid(room);
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
    repositionSnapshots: new Map(),
    turnTimer: null,
    turnDeadline: 0,
    repositionDeadline: 0,
    skipRepositionRound: 0,
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

function sendDecksReady(room, id) {
  const opponent = [...room.decks.entries()].find(([other]) => other !== id)?.[1];
  if (opponent) io.to(id).emit("decks-ready", { opponent });
}

function syncPlayer(socket) {
  const room = rooms.get(socket.data.roomCode);
  if (!room || !room.players.has(socket.id)) return;
  announce(room);
  if (room.stage === "deckbuilding") {
    socket.emit("match-ready", { room: publicRoom(room) });
    if (room.decks.has(socket.id)) socket.emit("match-status", "Your deck is locked. Waiting for your opponent to finish building.");
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
  const board = Array.isArray(deployment?.board) ? deployment.board.slice(0, 9) : Array(9).fill(null);
  while (board.length < 9) board.push(null);
  const backups = Array.isArray(deployment?.backups) ? [...deployment.backups] : [];
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
  if (expired) io.to(room.code).emit("match-status", "The 30-second reposition timer expired. Unfinished positions were locked automatically.");
  for (const [id] of room.players) {
    const opponent = [...room.repositions.entries()].find(([other]) => other !== id)?.[1];
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
    if (room.stage !== "combat" || room.round !== scheduledRound || room.turnOrder[room.turnIndex] !== activeId) return;
    io.to(room.code).emit("match-status", `${playerName(room, activeId)}'s one-minute turn expired. The match advanced automatically.`);
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
  room.turnOrder = Math.random() < 0.5 ? playerIds : [playerIds[1], playerIds[0]];
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
  if (room.players.size === 0) { clearTurnTimer(room); rooms.delete(code); }
  else {
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
  socket.emit("server-ready", { version: 6, recovered: socket.recovered });

  socket.on("raid-join",(payload={},reply=()=>{})=>{
    const code=clean(payload.code,12).toUpperCase(),name=clean(payload.name,20)||"Player";
    if(code.length<3)return reply({ok:false,error:"Room code needs at least 3 characters."});
    const current=raidRooms.get(socket.data.raidCode);
    if(current?.code===code&&current.players.has(socket.id)){current.players.get(socket.id).name=name;reply({ok:true,recovered:true});emitRaid(current);return;}
    detachRaid(socket);
    let room=raidRooms.get(code);if(!room){room=createRaidRoom(code);raidRooms.set(code,room);}
    if(room.players.size>=2&&!room.players.has(socket.id))return reply({ok:false,error:"That Raid room already has two players."});
    room.players.set(socket.id,{id:socket.id,name});socket.data.raidCode=code;socket.join(`raid-${code}`);reply({ok:true});emitRaid(room);
  });
  socket.on("raid-ready",()=>{const room=raidRooms.get(socket.data.raidCode);if(!room)return;room.ready.add(socket.id);if(room.ready.size===2)room.stage="deckbuilding";emitRaid(room);});
  socket.on("raid-submit-deck",(ids,reply=()=>{})=>{const room=raidRooms.get(socket.data.raidCode);if(!room||room.stage!=="deckbuilding")return reply({ok:false,error:"This Raid is not accepting decks."});const units=legalRaidDeck(ids);if(!units)return reply({ok:false,error:"Submit nine unique characters with 2 Commanders, 3 Scouts, 2 Troopers and 2 Tacticians."});room.decks.set(socket.id,ids);room.teams.set(socket.id,{board:units.slice(0,6),backups:units.slice(6),used:[]});reply({ok:true});if(room.decks.size===2){room.stage="combat";room.turnOrder=[...room.players.keys()];room.turnIndex=0;room.actions=2;room.log.push(`${room.players.get(room.turnOrder[0]).name} acts first. Each player has two actions before the boss turn.`);}emitRaid(room);});
  socket.on("raid-attack",({attackerId,targetId}={},reply=()=>{})=>{const room=raidRooms.get(socket.data.raidCode);if(!room||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id||room.actions<=0)return reply({ok:false});const team=room.teams.get(socket.id),attacker=team?.board.find(u=>u?.id===attackerId&&u.hp>0),target=room.boss.find(u=>u.id===targetId&&u.hp>0);if(!attacker||!target)return reply({ok:false});const used=team.used||[];if(used.includes(attacker.id))return reply({ok:false,error:"That character already attacked this turn."});let damage=attacker.dmg;if(target.id==="quintesson-judge"&&room.boss.some(u=>u.id==="quintesson-bailiff"&&u.hp>0))damage=Math.ceil(damage/2);target.hp=Math.max(0,target.hp-damage);team.used=[...used,attacker.id];room.actions--;room.log.push(`${attacker.name} dealt ${damage} to ${target.name}.`);if(target.hp===0){room.boss=room.boss.filter(u=>u!==target);room.fallen.push(target);if(target.id==="quintesson-judge"){room.stage="victory";room.log.push("The Quintesson Judge has fallen. Raid victory!");}}reply({ok:true});emitRaid(room);});
  socket.on("raid-end-turn",()=>{const room=raidRooms.get(socket.data.raidCode);if(!room||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id)return;const team=room.teams.get(socket.id);if(team)team.used=[];if(room.turnIndex===0){room.turnIndex=1;room.actions=2;emitRaid(room);}else{room.stage="boss";emitRaid(room);raidBossTurn(room);}});
  socket.on("raid-leave",()=>detachRaid(socket));
  if (socket.recovered) {
    syncPlayer(socket);
    const raidRoom=raidRooms.get(socket.data.raidCode);
    if(raidRoom?.players.has(socket.id))emitRaid(raidRoom);
  }

  socket.on("join-room", (payload = {}, reply = () => {}) => {
    const code = clean(payload.code, 12).toUpperCase();
    const name = clean(payload.name, 20) || "Player";
    if (code.length < 3) return reply({ ok: false, error: "Room code needs at least 3 characters." });
    const currentRoom = rooms.get(socket.data.roomCode);
    if (currentRoom?.code === code && currentRoom.players.has(socket.id)) {
      currentRoom.players.get(socket.id).name = name;
      reply({ ok: true, room: publicRoom(currentRoom), recovered: true });
      syncPlayer(socket);
      return;
    }
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
    if (room.started) return syncPlayer(socket);
    player.ready = Boolean(ready);
    announce(room);
    if (room.players.size === 2 && [...room.players.values()].every((entry) => entry.ready)) {
      room.started = true;
      room.stage = "deckbuilding";
      announce(room);
      io.to(room.code).emit("match-ready", { room: publicRoom(room) });
    }
  });

  socket.on("submit-deck", (deck, reply = () => {}) => {
    const respond = typeof reply === "function" ? reply : () => {};
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.players.has(socket.id)) return respond({ ok: false, error: "You are no longer connected to this room. Go back to Multiplayer and rejoin it." });
    if (!Array.isArray(deck) || deck.length !== 9 || new Set(deck).size !== 9 || deck.some((id) => typeof id !== "string")) {
      return respond({ ok: false, error: "Your deck must contain exactly nine different character cards." });
    }
    if (room.stage === "deployment" && room.decks.size === 2 && room.decks.has(socket.id)) {
      respond({ ok: true, waiting: false, recovered: true });
      sendDecksReady(room, socket.id);
      return;
    }
    if (room.stage !== "deckbuilding") return respond({ ok: false, error: "This room is not accepting decks right now. Rejoin with a new room code and try again." });
    room.decks.set(socket.id, deck);
    const waiting = room.decks.size !== 2;
    respond({ ok: true, waiting });
    if (waiting) return socket.emit("match-status", "Deck locked. Waiting for your opponent to finish building.");
    room.stage = "deployment";
    for (const [id] of room.players) sendDecksReady(room, id);
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
    if (action.kind === "reposition-lock") room.skipRepositionRound = room.round;
    socket.to(room.code).emit("combat-action", { ...action, actorId: socket.id, actorName: playerName(room, socket.id) });
  });

  socket.on("finish-turn", () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "combat" || room.turnOrder[room.turnIndex] !== socket.id) return;
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
    if (!room || room.stage !== "reposition" || !deployment || !Array.isArray(deployment.board) || !Array.isArray(deployment.backups) || deployment.board.length !== 9) return;
    room.repositionSnapshots.set(socket.id, deployment);
  });

  socket.on("finish-reposition", (deployment) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.stage !== "reposition" || !deployment || !Array.isArray(deployment.board) || !Array.isArray(deployment.backups)) return;
    room.repositions.set(socket.id, withRequiredReinforcements(deployment));
    if (room.repositions.size !== 2) return socket.emit("match-status", "Repositioning locked. Waiting for your opponent.");
    completeReposition(room);
  });

  socket.on("leave-room", () => detach(socket));
  socket.on("disconnect", (reason) => {
    if (reason === "client namespace disconnect" || reason === "server namespace disconnect") { detachRaid(socket); return detach(socket); }
    const raidCode = socket.data.raidCode;
    if (raidCode) {
      const raidTimer = setTimeout(() => {
        pendingRaidDisconnects.delete(socket.id);
        detachRaid(socket);
      }, 125_000);
      raidTimer.unref?.();
      pendingRaidDisconnects.set(socket.id, { timer: raidTimer, code: raidCode });
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
httpServer.listen(port, "0.0.0.0", () => console.log(`Hidden Front multiplayer server listening on ${port}`));

import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import { allUnits, makeBattleDeck } from "./lib/card-data.ts";

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
const quickMatchQueue = [];
const pendingDisconnects = new Map();
const pendingRaidDisconnects = new Map();
const TURN_DURATION_MS = Math.max(100, Number(process.env.TURN_DURATION_MS || 60_000));
const REPOSITION_DURATION_MS = Math.max(100, Number(process.env.REPOSITION_DURATION_MS || 30_000));

app.get("/", (_request, response) => response.json({ service: "Hidden Front multiplayer", status: "online" }));
app.get("/health", (_request, response) => response.json({ ok: true, rooms: rooms.size, raidRooms: raidRooms.size, quickMatchWaiting: quickMatchQueue.length, version: 7 }));

const raidTemplates = {
  judge: { id:"quintesson-judge", name:"Quintesson Judge", role:"Leader", max:700, hp:700, dmg:15, image:"/cards/characters/quintesson-judge.png", ability:"When at the start of each boss turn summon one defeated quintesson troop back to half health, if none are defeated place down one allicon and limited to two allicons on the board at a time." },
  bailiff: { id:"quintesson-bailiff", name:"Quintesson Bailiff", role:"Trooper", max:80, hp:80, dmg:20, image:"/cards/characters/quintesson-bailiff.png", ability:"While the Bailiff is alive, the Judge takes 50% less damage." },
  prosecutor: { id:"quintesson-prosecutor", name:"Quintesson Prosecutor", role:"Tactician", max:70, hp:70, dmg:10, image:"/cards/characters/quintesson-prosecutor.png", ability:"At the start of the boss turn, mark the player character with the lowest current Health. The next Quintesson attack against that character deals +10 damage." },
  executor: { id:"quintesson-executor", name:"Quintesson Executor", role:"Trooper", max:60, hp:60, dmg:25, image:"/cards/characters/quintesson-executor.png", ability:"When attacking a character at half Health or lower, deal an additional 10 damage." },
  allicon: { id:"allicon", name:"Allicon", role:"Scout", max:40, hp:40, dmg:5, image:"/cards/characters/allicon.png", ability:"Gain +5 damage for every other Allicon alive, up to +10." },
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

function createRaidRoom(code) {
  return {
    code, players:new Map(), stage:"lobby", round:0, decks:new Map(), teams:new Map(), ready:new Set(),
    placementOrder:[], placementIndex:0, turnOrder:[], turnIndex:0, actions:2,
    judge:{...raidTemplates.judge}, bossBoard:[{...raidTemplates.bailiff},{...raidTemplates.prosecutor},{...raidTemplates.executor},null,null,null],
    fallen:[], alliconSerial:0, log:["The Quintesson Tribunal awaits judgement."],
    battleDeck:makeBattleDeck(), battleHand:[], battlePlayed:false, repositions:new Map(), eventSeq:0,
    markedTargetId:null,
  };
}
function bossTroops(room) { return room.bossBoard.filter(Boolean); }
function bossUnits(room) { return [room.judge, ...bossTroops(room)]; }
function raidPublic(room, viewer) {
  return {
    code:room.code, stage:room.stage, round:room.round, youId:viewer,
    activeId:room.stage === "combat" ? room.turnOrder[room.turnIndex] || null : null,
    placementActiveId:room.stage === "deployment" ? room.placementOrder[room.placementIndex] || null : null,
    actions:room.actions, repositions:Object.fromEntries(room.repositions),
    players:[...room.players.values()].map(p=>({...p,ready:room.ready.has(p.id),team:room.teams.get(p.id)||null})),
    judge:room.judge, boss:bossUnits(room), bossBoard:room.bossBoard,
    battleHand:room.battleHand, battlePlayed:room.battlePlayed, log:room.log.slice(-30), eventSeq:room.eventSeq,
  };
}
function emitRaid(room) { for(const [id] of room.players) io.to(id).emit("raid-state",raidPublic(room,id)); }
function raidEvent(room, event) {
  room.eventSeq += 1;
  for(const [id] of room.players) io.to(id).emit("raid-event",{...event,seq:room.eventSeq});
}
function livingRaidUnits(team) { return [...(team?.board||[]),...(team?.backups||[]),...(team?.pending||[])].filter(u=>u&&u.hp>0); }
function firstEmptyPlayerSlot(room) {
  for(let i=0;i<18;i++) if (![...room.teams.values()].some(team=>team.board[i])) return i;
  return -1;
}
function drawRaidCards(room, amount=1) {
  for(let i=0;i<amount;i++) {
    if (!room.battleDeck.length) room.battleDeck=makeBattleDeck();
    const card=room.battleDeck.shift();
    if(card) room.battleHand.push(card);
  }
}
function raidTargetCandidates(room) {
  const candidates=[];
  for(const [playerId,team] of room.teams) for(let slot=0;slot<team.board.length;slot++) {
    const unit=team.board[slot]; if(unit?.hp>0) candidates.push({playerId,unit,slot});
  }
  return candidates;
}
function raidUtility(candidate, damage) {
  const remaining=Math.max(0,candidate.unit.hp-damage);
  return (remaining===0?10000:0) + damage*20 + (candidate.unit.max-remaining)*2;
}
function minimaxRaidTarget(candidates, attacker, depth=2) {
  if(!candidates.length) return null;
  const damage=attacker.dmg;
  const search=(options,remaining,maximizing)=>{
    if(!options.length) return -Infinity;
    if(remaining<=0) return maximizing ? Math.max(...options.map((c)=>raidUtility(c,damage))) : Math.min(...options.map((c)=>raidUtility(c,damage)));
    const scores=options.map((candidate)=>{
      const next=options.filter((entry)=>entry!==candidate || candidate.unit.hp>damage);
      const immediate=raidUtility(candidate,damage);
      return maximizing ? immediate + 0.25*search(next,remaining-1,false) : immediate - 0.25*search(next,remaining-1,true);
    });
    return maximizing ? Math.max(...scores) : Math.min(...scores);
  };
  return candidates.map((candidate)=>({candidate,score:raidUtility(candidate,damage)+0.25*search(candidates.filter((entry)=>entry!==candidate),depth-1,false)})).sort((a,b)=>b.score-a.score)[0].candidate;
}
function moveBossMinimax(room) {
  for(let move=0;move<2;move++) {
    const occupied=room.bossBoard.map((unit,index)=>unit?index:-1).filter(index=>index>=0);
    if(occupied.length<2) break;
    let best=[occupied[0],occupied[1]], bestScore=-Infinity;
    for(const from of occupied) for(const to of occupied) if(from<to) {
      const board=room.bossBoard.slice(); [board[from],board[to]]=[board[to],board[from]];
      const score=board.reduce((sum,unit,index)=>sum+(unit?unit.hp+(index===0?5:0):0),0);
      if(score>bestScore){bestScore=score;best=[from,to];}
    }
    [room.bossBoard[best[0]],room.bossBoard[best[1]]]=[room.bossBoard[best[1]],room.bossBoard[best[0]]];
  }
  room.log.push("The Quintesson court repositioned two spaces.");
  raidEvent(room,{kind:"reposition",side:"boss"});
}
function summonOrRevive(room) {
  const empty=room.bossBoard.findIndex((unit)=>!unit);
  if(empty<0) return;
  const fallen=room.fallen.shift();
  if(fallen) {
    room.bossBoard[empty]={...fallen,hp:Math.ceil(fallen.max/2)};
    room.log.push(`${fallen.name} returned at half Health.`);
    raidEvent(room,{kind:"summon",unit:room.bossBoard[empty],slot:empty});
    return;
  }
  const allicons=bossTroops(room).filter((unit)=>unit.id.startsWith("allicon")).length;
  if(allicons<2) {
    room.alliconSerial += 1;
    room.bossBoard[empty]={...raidTemplates.allicon,id:`allicon-${room.alliconSerial}`};
    room.log.push("The Judge placed an Allicon on the court.");
    raidEvent(room,{kind:"summon",unit:room.bossBoard[empty],slot:empty});
  }
}
function reinforceRaidTeam(room,team,slot) {
  if(!team.backups.length) return;
  const replacement=team.backups.shift();
  team.board[slot]=replacement;
  room.log.push(`${replacement.name} reinforced the shared grid.`);
}
function raidBossTurn(room) {
  room.stage="boss"; emitRaid(room);
  summonOrRevive(room);
  const candidates=raidTargetCandidates(room);
  const prosecutor=bossTroops(room).find((unit)=>unit.id==="quintesson-prosecutor"&&unit.hp>0);
  const marked=prosecutor?candidates.slice().sort((a,b)=>a.unit.hp-b.unit.hp)[0]:null;
  room.markedTargetId=marked?.unit.id||null;
  if(marked) room.log.push(`The Prosecutor marked ${marked.unit.name} for judgement.`);
  for(const attacker of bossUnits(room).filter((unit)=>unit.hp>0)) {
    const live=raidTargetCandidates(room); if(!live.length) break;
    const chosen=attacker.id==="quintesson-prosecutor"&&marked?marked:minimaxRaidTarget(live,attacker,2);
    if(!chosen) continue;
    let damage=attacker.dmg;
    if(room.markedTargetId===chosen.unit.id){damage+=10;room.markedTargetId=null;}
    if(attacker.id==="quintesson-executor"&&chosen.unit.hp<=chosen.unit.max/2) damage+=10;
    if(attacker.id.startsWith("allicon")) damage+=Math.min(10,bossTroops(room).filter((unit)=>unit.id.startsWith("allicon")&&unit.hp>0&&unit!==attacker).length*5);
    chosen.unit.hp=Math.max(0,chosen.unit.hp-damage);
    room.log.push(`${attacker.name} struck ${chosen.unit.name} for ${damage}.`);
    raidEvent(room,{kind:"hit",attackerId:attacker.id,targetId:chosen.unit.id,damage,side:"boss",defeated:chosen.unit.hp===0});
    if(chosen.unit.hp===0) {
      const team=room.teams.get(chosen.playerId); team.board[chosen.slot]=null; reinforceRaidTeam(room,team,chosen.slot);
    }
  }
  if([...room.teams.values()].every((team)=>livingRaidUnits(team).length===0)){room.stage="defeat";room.log.push("Both player teams were defeated.");emitRaid(room);return;}
  moveBossMinimax(room);
  room.repositions=new Map([...room.players.keys()].map((id)=>[id,1]));
  room.stage="reposition"; room.actions=0; emitRaid(room);
}
function startRaidRound(room) {
  room.round += 1; room.stage="combat"; room.turnIndex=0; room.repositions.clear(); room.turnOrder.reverse();
  if(!room.turnOrder.length) room.turnOrder=[...room.players.keys()];
  room.actions=2; room.battlePlayed=false; drawRaidCards(room,1); room.teams.forEach((team)=>{team.used=[];}); emitRaid(room);
}
function completeRaidReposition(room) {
  if([...room.repositions.values()].some((moves)=>moves>0)) return;
  startRaidRound(room);
}
function findBossTarget(room, id) {
  if (id === room.judge.id && room.judge.hp > 0) return { unit: room.judge, slot: -1 };
  const slot = room.bossBoard.findIndex((unit) => unit?.id === id && unit.hp > 0);
  return slot >= 0 ? { unit: room.bossBoard[slot], slot } : null;
}
function findPlayerUnit(room, id) {
  for (const [playerId, team] of room.teams) {
    const slot = team.board.findIndex((unit) => unit?.id === id && unit.hp > 0);
    if (slot >= 0) return { playerId, team, unit: team.board[slot], slot };
  }
  return null;
}
function sharedRaidBoardOccupied(room, slot) {
  return [...room.teams.values()].some((team) => Boolean(team.board[slot]));
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
  while (rooms.has(code)) code = "QUICK" + Math.random().toString(36).slice(2, 8).toUpperCase();
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
    if (!waiting || waiting.id === socket.id || waiting.data.roomCode || waiting.data.raidCode) continue;
    const room = createRoom(nextQuickRoomCode());
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
  quickMatchQueue.push(socket.id);
  return { matched: false };
}

function clean(value, max) {
  return typeof value === "string" ? value.trim().replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, max) : "";
}

function createRoom(code) {
  return {
    code,
    quickMatch: false,
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
  socket.emit("server-ready", { version: 7, recovered: socket.recovered });

  socket.on("quick-match", (payload = {}, reply = () => {}) => {
    const name = clean(payload.name, 20) || "Player";
    detachRaid(socket);
    detach(socket);
    queueQuickMatch(socket, name);
    const waiting = quickMatchQueue.includes(socket.id);
    reply({ ok: true, waiting });
    socket.emit("quick-match-status", waiting ? "Searching for the first available opponent…" : "Opponent found. Ready up when you are both in the room.");
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

  socket.on("raid-join",(payload={},reply=()=>{})=>{
    const code=clean(payload.code,12).toUpperCase(),name=clean(payload.name,20)||"Player";
    if(code.length<3)return reply({ok:false,error:"Room code needs at least 3 characters."});
    removeQuickMatch(socket.id);
    socket.data.quickQueue = false;
    const current=raidRooms.get(socket.data.raidCode);
    if(current?.code===code&&current.players.has(socket.id)){current.players.get(socket.id).name=name;reply({ok:true,recovered:true});emitRaid(current);return;}
    detachRaid(socket);
    let room=raidRooms.get(code);if(!room){room=createRaidRoom(code);raidRooms.set(code,room);}
    if(room.players.size>=2&&!room.players.has(socket.id))return reply({ok:false,error:"That Raid room already has two players."});
    room.players.set(socket.id,{id:socket.id,name});socket.data.raidCode=code;socket.join(`raid-${code}`);reply({ok:true});emitRaid(room);
  });
  socket.on("raid-ready",()=>{const room=raidRooms.get(socket.data.raidCode);if(!room)return;room.ready.add(socket.id);if(room.ready.size===2)room.stage="deckbuilding";emitRaid(room);});
  socket.on("raid-submit-deck",(ids,reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode);
    if(!room||room.stage!=="deckbuilding")return reply({ok:false,error:"This Raid is not accepting decks."});
    const units=legalRaidDeck(ids);
    if(!units)return reply({ok:false,error:"Submit nine unique characters with 2 Commanders, 3 Scouts, 2 Troopers and 2 Tacticians."});
    room.decks.set(socket.id,ids);
    room.teams.set(socket.id,{board:Array(18).fill(null),backups:units.slice(6),pending:units.slice(0,6),used:[]});
    reply({ok:true});
    if(room.decks.size===2){
      room.stage="deployment"; room.placementOrder=[...room.players.keys()]; room.placementIndex=0;
      room.log.push("Take turns placing six characters on the shared 3 x 6 grid.");
    }
    emitRaid(room);
  });
  socket.on("raid-place",({unitId,slot}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode), team=room?.teams.get(socket.id);
    if(!room||room.stage!=="deployment"||room.placementOrder[room.placementIndex]!==socket.id)return reply({ok:false,error:"Wait for your placement turn."});
    if(!Number.isInteger(slot)||slot<0||slot>=18||sharedRaidBoardOccupied(room,slot))return reply({ok:false,error:"Choose an empty shared grid space."});
    const index=team.pending.findIndex((unit)=>unit.id===unitId);
    if(index<0)return reply({ok:false,error:"Choose one of your unplaced characters."});
    team.board[slot]=team.pending.splice(index,1)[0];
    room.log.push(`${room.players.get(socket.id)?.name||"Player"} placed a character in shared space ${slot+1}.`);
    while(room.placementIndex<room.placementOrder.length&&room.teams.get(room.placementOrder[room.placementIndex])?.pending.length===0)room.placementIndex+=1;
    reply({ok:true});
    if(room.teams.size===2&&[...room.teams.values()].every((entry)=>entry.pending.length===0)){
      room.turnOrder=[...room.players.keys()]; room.turnIndex=0; room.round=0; room.log.push(`${room.players.get(room.turnOrder[0])?.name||"Player"} acts first. Each player has two actions before the boss turn.`); startRaidRound(room);
    } else emitRaid(room);
  });
  socket.on("raid-attack",({attackerId,targetId}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode),team=room?.teams.get(socket.id);
    if(!room||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id||room.actions<=0)return reply({ok:false,error:"It is not your attack turn."});
    const attacker=team?.board.find((unit)=>unit?.id===attackerId&&unit.hp>0),target=findBossTarget(room,targetId);
    if(!attacker||!target)return reply({ok:false,error:"Choose one of your characters and a living boss card."});
    if((team.used||[]).includes(attacker.id))return reply({ok:false,error:"That character already attacked this turn."});
    let damage=attacker.dmg;
    if(target.unit.id==="quintesson-judge"&&bossTroops(room).some((unit)=>unit.id==="quintesson-bailiff"&&unit.hp>0))damage=Math.ceil(damage/2);
    target.unit.hp=Math.max(0,target.unit.hp-damage); team.used=[...(team.used||[]),attacker.id]; room.actions--;
    room.log.push(`${attacker.name} dealt ${damage} to ${target.unit.name}.`);
    raidEvent(room,{kind:"hit",attackerId:attacker.id,targetId:target.unit.id,damage,side:"players",defeated:target.unit.hp===0});
    if(target.unit.hp===0){
      if(target.unit.id==="quintesson-judge"){room.stage="victory";room.log.push("The Quintesson Judge has fallen. Raid victory!");}
      else {room.bossBoard[target.slot]=null;room.fallen.push(target.unit);}
    }
    reply({ok:true}); emitRaid(room);
  });
  socket.on("raid-play-battle",({name,targetId,row}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode),team=room?.teams.get(socket.id);
    if(!room||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id||room.battlePlayed)return reply({ok:false,error:"Only one shared Battle Card can be played across both player turns."});
    const cardIndex=room.battleHand.indexOf(name);
    if(cardIndex<0)return reply({ok:false,error:"That Battle Card is not in the shared hand."});
    room.battleHand.splice(cardIndex,1);room.battlePlayed=true;
    let effect=`${name} resolved.`;
    if(name==="Roll Out"||name==="Power Of The Primes"){
      const target=findPlayerUnit(room,targetId)||raidTargetCandidates(room).sort((a,b)=>a.unit.hp-b.unit.hp)[0];
      if(target){const amount=name==="Power Of The Primes"?35:10;target.unit.hp=Math.min(target.unit.max,target.unit.hp+amount);effect=`${target.unit.name} healed ${amount}.`;}
    } else if(name==="Deserved Punishment"){
      const target=findBossTarget(room,targetId)||findBossTarget(room,room.judge.id); if(target){target.unit.hp=Math.max(0,target.unit.hp-10);effect=`${target.unit.name} took 10 damage.`;if(target.unit.hp===0&&target.unit.id==="quintesson-judge")room.stage="victory";}
    } else if(name==="War Dawn"){
      const chosenRow=Number.isInteger(row)?Math.max(0,Math.min(1,row)):0; for(let i=0;i<3;i++){const slot=chosenRow*3+i,unit=room.bossBoard[slot];if(unit)unit.hp=Math.max(0,unit.hp-15);} effect=`War Dawn hit Boss Court row ${chosenRow+1} for 15.`;
    } else if(name==="Reinforce"){
      const replacement=team?.backups.shift(),slot=firstEmptyPlayerSlot(room); if(replacement&&slot>=0){team.board[slot]=replacement;effect=`${replacement.name} reinforced shared space ${slot+1}.`;}
    } else if(name==="Tyrants Reign"){drawRaidCards(room,2);effect="Tyrants Reign drew two more shared Battle Cards.";}
    room.log.push(effect);raidEvent(room,{kind:"battle",name,side:"players"});reply({ok:true});emitRaid(room);
  });
  socket.on("raid-reposition",({unitId,from,to}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode),team=room?.teams.get(socket.id);
    if(!room||room.stage!=="reposition"||(room.repositions.get(socket.id)||0)<=0)return reply({ok:false,error:"You have no Reposition move remaining."});
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>=18||to<0||to>=18||team.board[from]?.id!==unitId)return reply({ok:false,error:"Choose one of your own cards and a valid shared space."});
    const occupant=[...room.teams.values()].map((entry)=>entry.board[to]).find(Boolean);
    if(occupant&&occupant!==team.board[to]&&occupant!==team.board[from])return reply({ok:false,error:"You cannot move onto your ally's card."});
    [team.board[from],team.board[to]]=[team.board[to],team.board[from]];room.repositions.set(socket.id,0);room.log.push(`${room.players.get(socket.id)?.name||"Player"} used one Reposition move.`);raidEvent(room,{kind:"reposition",side:"players",playerId:socket.id});reply({ok:true});emitRaid(room);completeRaidReposition(room);
  });
  socket.on("raid-skip-reposition",()=>{
    const room=raidRooms.get(socket.data.raidCode);
    if(!room||room.stage!=="reposition"||(room.repositions.get(socket.id)||0)<=0)return;
    room.repositions.set(socket.id,0);room.log.push(`${room.players.get(socket.id)?.name||"Player"} skipped their Reposition move.`);emitRaid(room);completeRaidReposition(room);
  });
  socket.on("raid-end-turn",()=>{const room=raidRooms.get(socket.data.raidCode);if(!room||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id)return;const team=room.teams.get(socket.id);if(team)team.used=[];if(room.turnIndex===0){room.turnIndex=1;room.actions=2;emitRaid(room);}else raidBossTurn(room);});
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
    removeQuickMatch(socket.id);
    socket.data.quickQueue = false;
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

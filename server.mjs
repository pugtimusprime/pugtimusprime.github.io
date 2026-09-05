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
    fallen:[], enemyDefeatPending:false, alliconSerial:0, log:["The Quintesson Tribunal awaits judgement."],
    battleDeck:makeBattleDeck(), battleHand:[], battlePlayed:false, repositions:new Map(), eventSeq:0,
    markedTarget:null, bossIntel:new Map(), revealedBossSlots:new Set(), bossTacticianDisabledUntil:0, repositionBlockedUntil:0,
  };
}
function bossTroops(room) { return room.bossBoard.filter(Boolean); }
function bossUnits(room) { return [room.judge, ...bossTroops(room)]; }
function publicBossBoard(room) {
  return room.bossBoard.map((unit, slot) => {
    if (!unit) return null;
    return room.revealedBossSlots.has(slot)
      ? { ...unit, slot, hidden: false, occupied: true }
      : { slot, hidden: true, occupied: true };
  });
}
function publicRaidTeam(team, ownerId, viewerId) {
  if (!team) return null;
  const hiddenBackup = (index) => ({ id:"hidden-backup-" + ownerId + "-" + index, name:"Hidden Backup", faction:"Autobot", role:"Scout", max:1, hp:1, dmg:0, image:"", ability:"", abilityUses:0, canAttack:false });
  return {
    ...team,
    backups: viewerId===ownerId ? team.backups : team.backups.map((_,index)=>hiddenBackup(index)),
    // Pending cards are shared during deployment so either player can follow the
    // alternating placement order; only the private backup identities stay hidden.
    pending: team.pending,
  };
}
function raidPublic(room, viewer) {
  return {
    code:room.code, stage:room.stage, round:room.round, youId:viewer,
    activeId:room.stage === "combat" ? room.turnOrder[room.turnIndex] || null : null,
    placementActiveId:room.stage === "deployment" ? room.placementOrder[room.placementIndex] || null : null,
    actions:room.actions, repositions:Object.fromEntries(room.repositions),
    players:[...room.players.values()].map(p=>({...p,ready:room.ready.has(p.id),team:publicRaidTeam(room.teams.get(p.id),p.id,viewer)})),
    judge:room.judge, boss:[room.judge], bossBoard:publicBossBoard(room),
    battleHand:room.battleHand, battlePlayed:room.battlePlayed, log:room.log.slice(-30), eventSeq:room.eventSeq,
  };
}
function emitRaid(room) { for(const [id] of room.players) io.to(id).emit("raid-state",raidPublic(room,id)); }
function raidEvent(room, event) {
  room.eventSeq += 1;
  for(const [id] of room.players) io.to(id).emit("raid-event",{...event,seq:room.eventSeq});
}
function livingRaidUnits(team) { return [...(team?.board||[]),...(team?.backups||[]),...(team?.pending||[])].filter(u=>u&&u.hp>0); }
function firstEmptyPlayerSlot(room, playerId) {
  const team = room.teams.get(playerId);
  if (!team) return -1;
  for(let i=0;i<9;i++) if (!team.board[i]) return i;
  return -1;
}
function drawRaidCards(room, amount=1) {
  for(let i=0;i<amount;i++) {
    if (!room.battleDeck.length) room.battleDeck=makeBattleDeck();
    const card=room.battleDeck.shift();
    if(card) room.battleHand.push(card);
  }
}
function raidIntel(room, playerId) {
  if (!room.bossIntel.has(playerId)) room.bossIntel.set(playerId, { occupied:new Set(), empty:new Set() });
  return room.bossIntel.get(playerId);
}
function raidTargetCandidates(room, includeUnknown=false) {
  const candidates=[];
  for(const [playerId,team] of room.teams) for(let slot=0;slot<team.board.length;slot++) {
    const unit=team.board[slot], intel=raidIntel(room,playerId);
    if (includeUnknown) {
      if (team.hiddenSpaces?.includes(slot)) continue;
      if (intel.empty.has(slot)) continue;
      candidates.push({playerId,unit:unit?.hp>0?unit:null,slot,hidden:true,known:intel.occupied.has(slot)});
    } else if(unit?.hp>0) candidates.push({playerId,unit,slot});
  }
  return candidates;
}
function raidUtility(candidate, damage) {
  if (candidate.hidden) {
    const centrality=candidate.known&&candidate.slot%3===1?8:0;
    return (candidate.known?130:45) + damage*8 + centrality;
  }
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
      const survives=candidate.hidden || candidate.unit.hp>damage;
      const next=options.filter((entry)=>entry!==candidate || survives);
      const immediate=raidUtility(candidate,damage);
      return maximizing ? immediate + 0.25*search(next,remaining-1,false) : immediate - 0.25*search(next,remaining-1,true);
    });
    return maximizing ? Math.max(...scores) : Math.min(...scores);
  };
  const scored=candidates.map((candidate)=>({candidate,score:raidUtility(candidate,damage)+0.25*search(candidates.filter((entry)=>entry!==candidate),depth-1,false)}));
  const best=Math.max(...scored.map((entry)=>entry.score));
  const tied=scored.filter((entry)=>Math.abs(entry.score-best)<0.001);
  return tied[Math.floor(Math.random()*tied.length)]?.candidate || scored[0].candidate;
}
function hiddenCourtSnapshot(board) {
  return board.map((unit, slot) => unit ? {
    slot, hidden:true, occupied:true, hp:unit.hp, max:unit.max,
  } : null);
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
    return hp > 0 ? {...card, hp} : null;
  });
}
function minimaxHiddenCourtMove(board, playerDamage, depth=2) {
  const occupied = board.map((card,index)=>card ? index : -1).filter(index=>index>=0);
  if (occupied.length < 2) return { from:-1, to:-1, score:hiddenCourtValue(board) };
  const moves = [{from:-1,to:-1,board}];
  for (const from of occupied) for (const to of occupied) if (from < to) {
    const next=board.slice(); [next[from],next[to]]=[next[to],next[from]];
    moves.push({from,to,board:next});
  }
  const search = (state, remaining, maximizing) => {
    if (remaining <= 0) return hiddenCourtValue(state);
    if (maximizing) {
      return Math.max(...movesFor(state).map((move) => search(move.board, remaining - 1, false)));
    }
    const targets=state.map((card,index)=>card ? index : -1).filter(index=>index>=0);
    if (!targets.length || playerDamage <= 0) return hiddenCourtValue(state);
    return Math.min(...targets.map((slot) => search(hiddenCourtThreat(state, slot, playerDamage), remaining - 1, true)));
  };
  const movesFor = (state) => {
    const slots=state.map((card,index)=>card ? index : -1).filter(index=>index>=0);
    const options=[{from:-1,to:-1,board:state}];
    for (const from of slots) for (const to of slots) if (from < to) {
      const next=state.slice(); [next[from],next[to]]=[next[to],next[from]];
      options.push({from,to,board:next});
    }
    return options;
  };
  return moves.map((move) => ({...move, score:search(move.board, depth - 1, false)})).sort((a,b)=>b.score-a.score)[0];
}
function moveBossMinimax(room) {
  for(let move=0;move<2;move++) {
    const state=hiddenCourtSnapshot(room.bossBoard);
    const playerDamage=Math.max(0,...raidTargetCandidates(room).map(({unit})=>unit.dmg));
    const best=minimaxHiddenCourtMove(state,playerDamage,2);
    if(best.from<0 || best.to<0) break;
    [room.bossBoard[best.from],room.bossBoard[best.to]]=[room.bossBoard[best.to],room.bossBoard[best.from]];
  }
  room.revealedBossSlots.clear();
  room.log.push("The Quintesson court repositioned two spaces.");
  raidEvent(room,{kind:"reposition",side:"boss"});
}
function summonOrRevive(room) {
  const empty=room.bossBoard.findIndex((unit)=>!unit);
  if(empty<0) return;
  const fallen=room.fallen.shift();
  if(fallen) {
    room.bossBoard[empty]={...fallen,hp:Math.ceil(fallen.max/2)};
    room.log.push("A defeated Quintesson troop returned at half Health.");
    raidEvent(room,{kind:"summon",slot:empty,side:"boss"});
    return;
  }
  const allicons=bossTroops(room).filter((unit)=>unit.id.startsWith("allicon")).length;
  if(allicons<2) {
    room.alliconSerial += 1;
    room.bossBoard[empty]={...raidTemplates.allicon,id:`allicon-${room.alliconSerial}`};
    room.log.push("The Judge placed a hidden Allicon on the court.");
    raidEvent(room,{kind:"summon",slot:empty,side:"boss"});
  }
}
function reinforceRaidTeam(room,team,slot) {
  if(!team.backups.length) return;
  const replacement=team.backups.shift();
  team.board[slot]=replacement;
  room.log.push(`${replacement.name} reinforced its owner's 3 x 3 board.`);
}
function recordBossIntel(room, target) {
  const intel=raidIntel(room,target.playerId);
  if (target.unit?.hp>0) {
    intel.occupied.add(target.slot);
    intel.empty.delete(target.slot);
  } else {
    intel.empty.add(target.slot);
    intel.occupied.delete(target.slot);
  }
}
function raidBossTurn(room) {
  room.stage="boss"; emitRaid(room);
  summonOrRevive(room);
  for (let slot=0; slot<room.bossBoard.length; slot++) {
    const poisoned=room.bossBoard[slot];
    if (!poisoned?.raidPoison) continue;
    poisoned.hp=Math.max(0,poisoned.hp-5);
    poisoned.raidPoison=Math.max(0,poisoned.raidPoison-1);
    if (poisoned.hp===0) defeatRaidBossUnit(room,{unit:poisoned,slot});
  }
  const candidates=raidTargetCandidates(room,true);
  const prosecutor=bossTroops(room).find((unit)=>unit.id==="quintesson-prosecutor"&&unit.hp>0);
  const marked=prosecutor?minimaxRaidTarget(candidates,prosecutor,2):null;
  room.markedTarget=marked?{playerId:marked.playerId,slot:marked.slot}:null;
  if(marked) room.log.push("The Prosecutor marked a concealed player position for judgement.");
  for(const attacker of bossUnits(room).filter((unit)=>unit.hp>0)) {
    if (attacker.role==="Tactician"&&room.bossTacticianDisabledUntil>=room.round) continue;
    const live=raidTargetCandidates(room,true); if(!live.length) break;
    const markedLive=marked&&live.find((entry)=>entry.playerId===marked.playerId&&entry.slot===marked.slot);
    const chosen=attacker.id==="quintesson-prosecutor"&&markedLive?markedLive:minimaxRaidTarget(live,attacker,2);
    if(!chosen) continue;
    if (!chosen.unit) {
      recordBossIntel(room,chosen);
      room.log.push(`${attacker.id==="quintesson-judge"?attacker.name:"A hidden Quintesson troop"} searched player space ${chosen.slot+1} and missed.`);
      raidEvent(room,{kind:"miss",side:"boss",targetSlot:chosen.slot});
      continue;
    }
    const targetTeam=room.teams.get(chosen.playerId);
    if(targetTeam?.traps?.includes(chosen.slot)){
      recordBossIntel(room,chosen);
      targetTeam.traps=targetTeam.traps.filter((slot)=>slot!==chosen.slot);
      room.log.push("An Ambush Trap cancelled the hidden Quintesson attack.");
      raidEvent(room,{kind:"trap",side:"boss",targetSlot:chosen.slot});
      continue;
    }
    let damage=attacker.dmg;
    if(room.markedTarget&&room.markedTarget.playerId===chosen.playerId&&room.markedTarget.slot===chosen.slot){damage+=10;room.markedTarget=null;}
    if(attacker.id==="quintesson-executor"&&chosen.unit.hp<=chosen.unit.max/2) damage+=10;
    if(attacker.id.startsWith("allicon")) damage+=Math.min(10,bossTroops(room).filter((unit)=>unit.id.startsWith("allicon")&&unit.hp>0&&unit!==attacker).length*5);
    if(targetTeam?.armorTargets?.includes(chosen.unit.id)){damage=Math.max(0,damage-10);targetTeam.armorTargets=targetTeam.armorTargets.filter((id)=>id!==chosen.unit.id);}
    chosen.unit.hp=Math.max(0,chosen.unit.hp-damage);
    recordBossIntel(room,chosen);
    const attackerName = attacker.id === "quintesson-judge" ? attacker.name : "A hidden Quintesson troop";
    room.log.push(`${attackerName} struck ${chosen.unit.name} for ${damage}.`);
    raidEvent(room,{kind:"hit",attackerId:attacker.id === "quintesson-judge" ? attacker.id : undefined,targetId:chosen.unit.id,damage,side:"boss",defeated:chosen.unit.hp===0});
    if(chosen.unit.hp===0) {
      const team=room.teams.get(chosen.playerId); team.board[chosen.slot]=null; team.fallen=[...(team.fallen||[]),chosen.unit]; reinforceRaidTeam(room,team,chosen.slot);
    }
  }
  if([...room.teams.values()].every((team)=>livingRaidUnits(team).length===0)){room.stage="defeat";room.log.push("Both player teams were defeated.");emitRaid(room);return;}
  if(room.repositionBlockedUntil===room.round) room.log.push("Rattrap prevented the Quintesson court from repositioning.");
  else moveBossMinimax(room);
  room.repositions=new Map([...room.players.keys()].map((id)=>[id,1]));
  room.stage="reposition"; room.actions=0; emitRaid(room);
}
function startRaidRound(room) {
  room.round += 1; room.stage="combat"; room.turnIndex=0; room.repositions.clear(); room.turnOrder.reverse();
  if(!room.turnOrder.length) room.turnOrder=[...room.players.keys()];
  room.actions=2; room.battlePlayed=false; drawRaidCards(room,1); room.teams.forEach((team)=>{team.used=[];team.usedAbilities=[];team.faceOff=false;team.traps=[];team.hiddenSpaces=[];}); emitRaid(room);
}
function completeRaidReposition(room) {
  if([...room.repositions.values()].some((moves)=>moves>0)) return;
  startRaidRound(room);
}
function findBossTarget(room, id, targetSlot) {
  if (id === room.judge.id && room.judge.hp > 0) return { unit: room.judge, slot: -1 };
  if (!Number.isInteger(targetSlot) || targetSlot < 0 || targetSlot >= room.bossBoard.length) return null;
  const unit = room.bossBoard[targetSlot];
  return unit?.hp > 0 ? { unit, slot: targetSlot } : null;
}
function findPlayerUnit(room, id, ownerId) {
  for (const [playerId, team] of room.teams) {
    if (ownerId && playerId!==ownerId) continue;
    const slot = team.board.findIndex((unit) => unit?.id === id && unit.hp > 0);
    if (slot >= 0) return { playerId, team, unit: team.board[slot], slot };
  }
  return null;
}
function raidAttackDamage(room, team, attacker, slot) {
  let damage=attacker.dmg;
  if (attacker.id==="bee" && team.board.some((unit)=>unit?.faction==="Autobot"&&unit.role==="Commander")) damage+=5;
  if (team.board.some((unit,index)=>unit?.id==="quickstrike"&&Math.floor(index/3)===Math.floor(slot/3))) damage+=5;
  if (attacker.raidWheeljackBoost) { damage+=5; attacker.raidWheeljackBoost=false; }
  if (attacker.id==="optimal"&&team.board.some((unit)=>unit?.id==="primal"||unit?.id==="optimus")) damage=30;
  if (team.reflectionDamage>0) { damage=team.reflectionDamage; team.reflectionDamage=0; }
  return damage;
}
function resolveBossDamage(room, target, damage) {
  const adjusted=target.unit.id===room.judge.id&&bossTroops(room).some((unit)=>unit.id==="quintesson-bailiff"&&unit.hp>0) ? Math.ceil(damage/2) : damage;
  target.unit.hp=Math.max(0,target.unit.hp-adjusted);
  return adjusted;
}
function defeatRaidBossUnit(room, target) {
  if (target.unit.id==="quintesson-judge") {
    room.stage="victory";
    room.log.push("The Quintesson Judge has fallen. Raid victory!");
    return;
  }
  room.bossBoard[target.slot]=null;
  room.fallen.push(target.unit);
  room.enemyDefeatPending=true;
  room.revealedBossSlots.delete(target.slot);
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
    room.teams.set(socket.id,{board:Array(9).fill(null),backups:units.slice(6),pending:units.slice(0,6),used:[],usedAbilities:[],faceOff:false,armor:0,traps:[],hiddenSpaces:[]});
    room.bossIntel.set(socket.id,{occupied:new Set(),empty:new Set()});
    reply({ok:true});
    if(room.decks.size===2){
      room.stage="deployment"; room.placementOrder=[...room.players.keys()]; room.placementIndex=0;
      room.log.push("Take turns placing six characters across your own 3 x 3 board.");
    }
    emitRaid(room);
  });
  socket.on("raid-place",({unitId,slot}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode), team=room?.teams.get(socket.id);
    if(!room||room.stage!=="deployment"||room.placementOrder[room.placementIndex]!==socket.id)return reply({ok:false,error:"Wait for your placement turn."});
    if(!Number.isInteger(slot)||slot<0||slot>=9||team.board[slot])return reply({ok:false,error:"Choose an empty space on your own 3 x 3 board."});
    const index=team.pending.findIndex((unit)=>unit.id===unitId);
    if(index<0)return reply({ok:false,error:"Choose one of your unplaced characters."});
    team.board[slot]=team.pending.splice(index,1)[0];
    room.log.push(`${room.players.get(socket.id)?.name||"Player"} placed a character in their 3 x 3 board space ${slot+1}.`);
    while(room.placementIndex<room.placementOrder.length&&room.teams.get(room.placementOrder[room.placementIndex])?.pending.length===0)room.placementIndex+=1;
    reply({ok:true});
    if(room.teams.size===2&&[...room.teams.values()].every((entry)=>entry.pending.length===0)){
      room.turnOrder=[...room.players.keys()]; room.turnIndex=0; room.round=0; room.log.push(`${room.players.get(room.turnOrder[0])?.name||"Player"} acts first. Each player has two actions before the boss turn.`); startRaidRound(room);
    } else emitRaid(room);
  });
  socket.on("raid-attack",({attackerId,targetId,targetSlot}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode),team=room?.teams.get(socket.id);
    if(!room||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id||room.actions<=0)return reply({ok:false,error:"It is not your attack turn."});
    const attackerSlot=team?.board.findIndex((unit)=>unit?.id===attackerId&&unit.hp>0) ?? -1;
    const attacker=attackerSlot>=0?team.board[attackerSlot]:null,target=findBossTarget(room,targetId,targetSlot);
    if(!attacker||!target)return reply({ok:false,error:"Choose one of your characters and a living boss card."});
    if((team.used||[]).includes(attacker.id))return reply({ok:false,error:"That character already attacked this turn."});
    let damage=raidAttackDamage(room,team,attacker,attackerSlot);
    damage=resolveBossDamage(room,target,damage);
    team.used=[...(team.used||[]),attacker.id]; room.actions--;
    const targetName = target.unit.id === room.judge.id ? target.unit.name : "a hidden Quintesson troop";
    room.log.push(`${attacker.name} dealt ${damage} to ${targetName}.`);
    raidEvent(room,{kind:"hit",attackerId:attacker.id,targetId:target.unit.id===room.judge.id?target.unit.id:undefined,targetSlot:target.unit.id===room.judge.id?undefined:target.slot,damage,side:"players",defeated:target.unit.hp===0});
    if(target.unit.hp===0) defeatRaidBossUnit(room,target);
    if(team.faceOff && target.unit.hp>0) { team.faceOff=false; drawRaidCards(room,1); room.log.push("Face Off drew one shared Battle Card after a successful hit."); }
    reply({ok:true}); emitRaid(room);
  });
  socket.on("raid-play-battle",({name,targetId,targetSlot,row}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode),team=room?.teams.get(socket.id);
    if(!room||!team||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id||room.battlePlayed||room.actions<=0)return reply({ok:false,error:"Only one shared Battle Card can be played during an active player turn."});
    const cardIndex=room.battleHand.indexOf(name);
    if(cardIndex<0)return reply({ok:false,error:"That Battle Card is not in the shared hand."});
    const ownTarget=targetId?findPlayerUnit(room,targetId,socket.id):null;
    const bossTarget=Number.isInteger(targetSlot)&&targetSlot>=0?findBossTarget(room,undefined,targetSlot):null;
    const amount=name==="Power Of The Primes"?35:10;
    let effect=`${name} resolved.`;
    if(name==="Roll Out"||name==="Power Of The Primes"){
      const target=ownTarget||raidTargetCandidates(room).filter((entry)=>entry.playerId===socket.id).sort((a,b)=>a.unit.hp-b.unit.hp)[0];
      if(!target)return reply({ok:false,error:"Choose one of your living characters."});
      target.unit.hp=Math.min(target.unit.max,target.unit.hp+amount);effect=`${target.unit.name} healed ${amount}.`;
    } else if(name==="Armor Plating"){
      const target=ownTarget||raidTargetCandidates(room).filter((entry)=>entry.playerId===socket.id).sort((a,b)=>a.unit.hp-b.unit.hp)[0];
      if(!target)return reply({ok:false,error:"Choose one of your living characters."});
      team.armorTargets=[target.unit.id]; team.armor=10; effect=`${target.unit.name} gained Armor Plating for the next hit.`;
    } else if(name==="Deserved Punishment"){
      const target=bossTarget||findBossTarget(room,room.judge.id); if(target){const damage=resolveBossDamage(room,target,10);const targetName=target.unit.id===room.judge.id?room.judge.name:"a hidden Quintesson troop";effect=`${targetName} took ${damage} damage.`;if(target.unit.hp===0)defeatRaidBossUnit(room,target);}
    } else if(name==="War Dawn"){
      const chosenRow=Number.isInteger(row)?Math.max(0,Math.min(1,row)):0;
      for(let i=0;i<3;i++){const slot=chosenRow*3+i,unit=room.bossBoard[slot];if(unit){unit.hp=Math.max(0,unit.hp-15);if(unit.hp===0)defeatRaidBossUnit(room,{unit,slot});}}
      effect=`War Dawn hit Boss Court row ${chosenRow+1} for 15.`;
    } else if(name==="Reinforce"){
      const replacement=team.backups.shift(),slot=ownTarget?.slot??firstEmptyPlayerSlot(room,socket.id);
      if(!replacement||slot<0)return reply({ok:false,error:"You need a Backup and a deployed target or empty space."});
      if(ownTarget)team.backups.push(team.board[slot]);
      team.board[slot]=replacement;effect=`${replacement.name} reinforced your 3 x 3 board space ${slot+1}.`;
    } else if(name==="Tyrants Reign"){drawRaidCards(room,2);effect="Tyrants Reign drew two more shared Battle Cards.";}
    else if(name==="Face Off"){team.faceOff=true;effect="Face Off armed your next successful attack to draw a shared Battle Card.";}
    else if(name==="Flying Support"||name==="He Will Find You"||name==="Information Gathering"||name==="Surprise"||name==="2 For The Price Of 1"){
      const occupied=room.bossBoard.map((unit,index)=>unit?index:-1).filter((index)=>index>=0);
      let slots=[];
      if(name==="He Will Find You") {
        const lowest=occupied.filter((slot)=>!room.revealedBossSlots.has(slot)).sort((a,b)=>room.bossBoard[a].hp-room.bossBoard[b].hp)[0];
        slots=lowest===undefined?occupied.slice(0,1):[lowest];
      } else {
        const revealCount=name==="Information Gathering"?3:name==="Surprise"?2:1;
        slots=(Number.isInteger(targetSlot)?[targetSlot]:occupied.filter((slot)=>!room.revealedBossSlots.has(slot)).sort(()=>Math.random()-.5).slice(0,revealCount));
      }
      slots.forEach((slot)=>{if(room.bossBoard[slot])room.revealedBossSlots.add(slot);});
      effect=name+" revealed "+slots.length+" court position"+(slots.length===1?"":"s")+".";
      if(name==="2 For The Price Of 1") room.enemyDefeatPending=false;
    } else if(name==="Junkion Scrap"){room.battleHand.splice(0,Math.min(3,room.battleHand.length));effect="Junkion Scrap removed three shared Battle Cards.";}
    else if(name==="Ambush Trap"){
      const trapSlot=Number.isInteger(targetSlot)&&targetSlot>=0&&targetSlot<9&&!team.board[targetSlot]
        ? targetSlot : firstEmptyPlayerSlot(room,socket.id);
      if(trapSlot<0)return reply({ok:false,error:"Choose an empty space on your own board for Ambush Trap."});
      team.traps=[...(team.traps||[]),trapSlot];effect="Ambush Trap armed on your board space "+(trapSlot+1)+".";
    } else if(name==="Dark Reflections"){team.reflectionDamage=Math.max(...room.fallen.map((unit)=>unit.dmg),0);effect="Dark Reflections armed the strongest defeated Quintesson Damage for your next attack.";}
    // Battle Cards are a shared tactical interrupt; playing one does not consume
    // the active player's two attack actions.
    room.battleHand.splice(cardIndex,1);room.battlePlayed=true;
    room.log.push(effect);raidEvent(room,{kind:"battle",name,side:"players"});reply({ok:true});emitRaid(room);
  });
  socket.on("raid-use-ability",({sourceId,targetId,targetSlot}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode),team=room?.teams.get(socket.id);
    if(!room||!team||room.stage!=="combat"||room.turnOrder[room.turnIndex]!==socket.id||room.actions<=0)return reply({ok:false,error:"Unique abilities can only be used during your active turn."});
    const sourceSlot=team.board.findIndex((unit)=>unit?.id===sourceId&&unit.hp>0);
    const source=sourceSlot>=0?team.board[sourceSlot]:team.backups.find((unit)=>unit.id===sourceId);
    if(!source||source.abilityUses<=0||(team.usedAbilities||[]).includes(sourceId))return reply({ok:false,error:"That character has no unique ability use remaining this round."});
    if(sourceSlot<0&&sourceId!=="galvatron")return reply({ok:false,error:"Deploy this character before using its unique ability."});
    const target=findBossTarget(room,targetId,targetSlot);
    let effect=source.name+" used its unique ability.";
    if(sourceId==="shockwave"||sourceId==="bombshell"||sourceId==="head"||sourceId==="eject"||sourceId==="arachnia"){
      if(!target && !(sourceId==="head" && Number.isInteger(targetSlot)&&targetSlot>=0&&targetSlot<room.bossBoard.length))return reply({ok:false,error:"Choose an occupied court space for that ability."});
      if(sourceId==="head"&&!target){effect="Headstrong searched an empty court space and survived.";}
      else if(sourceId==="shockwave"){const damage=resolveBossDamage(room,target,30);effect="Shockwave dealt "+damage+" damage to "+(target.unit.id===room.judge.id?room.judge.name:"a hidden Quintesson troop")+".";if(target.unit.hp===0)defeatRaidBossUnit(room,target);}
      else if(sourceId==="bombshell"){const damage=resolveBossDamage(room,target,target.unit.dmg);effect="Bombshell forced the hidden target to take "+damage+" damage.";if(target.unit.hp===0)defeatRaidBossUnit(room,target);}
      else if(sourceId==="head"){if(target.unit.id!==room.judge.id){defeatRaidBossUnit(room,target);if(sourceSlot>=0){team.board[sourceSlot]=null;team.fallen=[...(team.fallen||[]),source];reinforceRaidTeam(room,team,sourceSlot);}effect="Headstrong and a hidden Quintesson troop destroyed one another.";}else effect="Headstrong cannot destroy the Judge; the ability was spent.";}
      else if(sourceId==="eject"){if(target.unit.role==="Scout"){const empty=firstEmptyPlayerSlot(room,socket.id);if(empty>=0){team.board[empty]=source;team.board[sourceSlot]=null;effect="Eject swapped into the guessed hidden Scout position.";}else effect="Eject found a hidden Scout, but your board was full.";}else effect="Eject guessed wrong; the hidden card was not a Scout.";}
      else if(sourceId==="arachnia"){const row=Math.floor(target.slot/3);room.bossBoard.forEach((unit,index)=>{if(unit&&Math.floor(index/3)===row)unit.raidPoison=3;});effect="Black Arachnia poisoned Quintesson court row "+(row+1)+" for three boss turns.";}
    } else if(sourceId==="getaway"){
      const commander=team.board.find((unit)=>unit&&unit.role==="Commander"&&unit.id!==sourceId);
      if(!commander)return reply({ok:false,error:"Getaway requires a deployed friendly Commander."});
      source.copiedCommanderId=commander.id; effect="Getaway copied "+commander.name+" as its Commander ability.";
    } else if(sourceId==="wheeljack"){
      team.board.forEach((unit)=>{if(unit?.role==="Scout")unit.raidWheeljackBoost=true;});effect="Wheeljack empowered every deployed Scout's next attack.";
    } else if(sourceId==="soundwave"){
      if(!team.board.some((unit)=>unit?.id==="megatron"))return reply({ok:false,error:"Soundwave requires Megatron deployed."});
      drawRaidCards(room,3);effect="Soundwave drew three shared Battle Cards.";
    } else if(sourceId==="grapple"){
      const amount=team.backups.filter((unit)=>unit.faction==="Autobot").length;drawRaidCards(room,amount);effect="Grapple drew "+amount+" shared Battle Card"+(amount===1?"":"s")+".";
    } else if(sourceId==="rumble"){
      if(!team.board.some((unit)=>unit?.id==="frenzy"))return reply({ok:false,error:"Rumble requires Frenzy deployed."});
      drawRaidCards(room,1);effect="Rumble drew one shared Battle Card.";
    } else if(sourceId==="highbrow"){room.bossTacticianDisabledUntil=room.round+3;effect="Highbrow disabled Quintesson Tactician abilities for three rounds.";}
    else if(sourceId==="pmega"){for(let i=room.bossBoard.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[room.bossBoard[i],room.bossBoard[j]]=[room.bossBoard[j],room.bossBoard[i]];}room.revealedBossSlots.clear();effect="Pmega reordered the concealed court.";}
    else if(sourceId==="wasp"){room.bossBoard.map((unit,index)=>unit?.role==="Scout"?index:-1).filter((index)=>index>=0).forEach((slot)=>room.revealedBossSlots.add(slot));effect="Waspinator revealed every detectable Quintesson Scout.";}
    else if(sourceId==="bludgeon"){team.hiddenSpaces=[0,1,2];room.bossIntel.set(socket.id,{occupied:new Set(),empty:new Set()});effect="Bludgeon concealed three of your board spaces from the boss.";}
    else if(sourceId==="cyclonus"){team.board.filter((unit)=>unit?.faction==="Decepticon").forEach((unit)=>{unit.hp=Math.min(unit.max,unit.hp+5);});effect="Cyclonus healed every Decepticon on your board by 5.";}
    else if(sourceId==="overlord"){if(room.battleHand.length<4)return reply({ok:false,error:"Overlord requires four shared Battle Cards to scrap."});room.battleHand.splice(0,4);source.dmg=20;effect="Overlord scrapped four shared Battle Cards and reached 20 Damage.";}
    else if(sourceId==="hoist"){const count=Math.max(1,room.battleHand.length);room.battleHand=[];drawRaidCards(room,count);effect="Hoist replaced the shared Battle Cards with random draws.";}
    else if(sourceId==="galvatron"){if(sourceSlot>=0)return reply({ok:false,error:"Galvatron must be used from Backup."});team.armorTargets=team.board.filter(Boolean).slice(0,2).map((unit)=>unit.id);effect="Galvatron shielded two deployed characters for the next boss attacks.";}
    else if(sourceId==="razor"){const backup=team.backups.shift();if(!backup)return reply({ok:false,error:"Razorclaw has no Backup to combine with."});source.max+=backup.max;source.hp+=backup.max;if(backup.id==="rampage")drawRaidCards(room,2);effect="Razorclaw combined with a hidden Backup and gained "+backup.max+" Health.";}
    else if(sourceId==="rhinox"){const fallen=(team.fallen||[]).find((unit)=>unit.faction==="Maximal");if(!fallen)return reply({ok:false,error:"Rhinox has no defeated Maximal to revive."});team.fallen=team.fallen.filter((unit)=>unit.id!==fallen.id);team.backups.push({...fallen,hp:Math.ceil(fallen.max/2)});effect="Rhinox revived a defeated Maximal into Backup at half Health.";}
    else if(sourceId==="rattrap"){room.repositionBlockedUntil=room.round;effect="Rattrap blocked repositioning this round.";}
    else if(sourceId==="jhiaxus"){effect="Jhiaxus forced the Tribunal to expose its Backup count: "+team.backups.length+" remain.";}
    source.abilityUses=Math.max(0,source.abilityUses-1);team.usedAbilities=[...(team.usedAbilities||[]),sourceId];room.actions--;
    room.log.push(effect);raidEvent(room,{kind:"ability",name:source.name,side:"players"});reply({ok:true});emitRaid(room);
  });
  socket.on("raid-reposition",({unitId,from,to}={},reply=()=>{})=>{
    const room=raidRooms.get(socket.data.raidCode),team=room?.teams.get(socket.id);
    if(!room||room.stage!=="reposition"||(room.repositions.get(socket.id)||0)<=0)return reply({ok:false,error:"You have no Reposition move remaining."});
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>=9||to<0||to>=9||team.board[from]?.id!==unitId)return reply({ok:false,error:"Choose one of your own cards and a valid space on your 3 x 3 board."});
    [team.board[from],team.board[to]]=[team.board[to],team.board[from]];
    const intel=raidIntel(room,socket.id); [from,to].forEach((slot)=>{intel.occupied.delete(slot);intel.empty.delete(slot);});
    room.repositions.set(socket.id,0);room.log.push(`${room.players.get(socket.id)?.name||"Player"} used one Reposition move.`);raidEvent(room,{kind:"reposition",side:"players",playerId:socket.id});reply({ok:true});emitRaid(room);completeRaidReposition(room);
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

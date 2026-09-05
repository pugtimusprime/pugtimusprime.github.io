"use client";

import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import Link from "next/link";
import { allUnits, starterDeck, type Unit } from "@/lib/card-data";

type RaidStage = "lobby" | "deckbuilding" | "deployment" | "combat" | "boss" | "reposition" | "victory" | "defeat";
type RaidBossUnit = { id:string; name:string; role:string; max:number; hp:number; dmg:number; image:string; ability:string };
type RaidBossSlot = { slot:number; hidden:boolean; occupied:true; id?:string; name?:string; role?:string; max?:number; hp?:number; dmg?:number; image?:string; ability?:string };
type RaidTeam = { board:(Unit|null)[]; backups:Unit[]; pending?:Unit[]; used:string[]; usedAbilities?:string[]; faceOff?:boolean; armor?:number; traps?:number[]; hiddenSpaces?:number[] };
type RaidPlayer = { id:string; name:string; ready:boolean; team:RaidTeam|null };
type RaidState = {
  code:string; stage:RaidStage; round:number; youId:string; activeId:string|null; placementActiveId:string|null;
  actions:number; repositions:Record<string,number>; players:RaidPlayer[]; judge:RaidBossUnit; boss:RaidBossUnit[];
  bossBoard:(RaidBossSlot|null)[]; courtFeedback?:Record<number,"MISS"|"OCCUPIED">; battleHand:string[]; battlePlayed:boolean; log:string[]; eventSeq:number;
};
type RaidReply = { ok:boolean; error?:string; recovered?:boolean };
type RaidEvent = { kind:string; seq:number; attackerId?:string; targetId?:string; targetSlot?:number; damage?:number; name?:string; side?:string; defeated?:boolean };

const raidServer = "https://hidden-front-server.onrender.com";

function CardImage({ src, alt }: { src:string; alt:string }) {
  return <img src={src} alt={alt} />;
}

export default function RaidPage() {
  const [socket, setSocket] = useState<Socket|null>(null);
  const [server, setServer] = useState(raidServer);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<RaidState|null>(null);
  const [message, setMessage] = useState("Create a room code and share it with one co-op partner.");
  const [deck, setDeck] = useState<Unit[]>(() => starterDeck("Autobot"));
  const [locked, setLocked] = useState(false);
  const [attacker, setAttacker] = useState<string|null>(null);
  const [abilitySource, setAbilitySource] = useState<string|null>(null);
  const [placement, setPlacement] = useState<string|null>(null);
  const [moveSource, setMoveSource] = useState<number|null>(null);
  const [backupSource, setBackupSource] = useState<string|null>(null);
  const [animation, setAnimation] = useState<RaidEvent|null>(null);

  useEffect(() => () => socket?.disconnect(), [socket]);
  useEffect(() => {
    if (!socket) return;
    const onState = (next:RaidState) => {
      setState(next);
      if (next.stage !== "deckbuilding") setLocked(false);
      if (next.stage !== "combat") setAttacker(null);
      if (next.stage !== "reposition") { setMoveSource(null); setBackupSource(null); }
      if (next.stage !== "combat") setAbilitySource(null);
    };
    const onEvent = (event:RaidEvent) => {
      setAnimation(event);
      window.setTimeout(() => setAnimation((current) => current?.seq === event.seq ? null : current), 800);
    };
    socket.on("raid-state", onState);
    socket.on("raid-event", onEvent);
    return () => { socket.off("raid-state", onState); socket.off("raid-event", onEvent); };
  }, [socket]);

  const me = state?.players.find((player) => player.id === state.youId);
  const displayPlayers = state ? [...state.players].sort((a,b) => Number(b.id === state.youId) - Number(a.id === state.youId)) : [];
  const active = state?.stage === "combat" && state.activeId === state.youId;
  const placing = state?.stage === "deployment" && state.placementActiveId === state.youId;
  const moving = state?.stage === "reposition" && (state.repositions[state.youId] || 0) > 0;
  const counts = useMemo(() => Object.fromEntries(["Commander","Scout","Trooper","Tactician"].map((role) => [role, deck.filter((unit) => unit.role === role).length])), [deck]);
  const legal = deck.length === 9 && counts.Commander === 2 && counts.Scout === 3 && counts.Trooper === 2 && counts.Tactician === 2;
  const boardFor = (player:RaidPlayer|undefined) => player?.team?.board || Array(9).fill(null);
  const ownUnitAt = (slot:number) => me?.team?.board[slot] || null;
  const isAnimated = (id?:string, slot?:number) => animation && (((id && animation.targetId===id) || (Number.isInteger(slot) && animation.targetSlot===slot) || animation.kind==="reposition")) ? `raid-hit-animation raid-animation-${animation.seq}` : "";

  function join() {
    const url = server.trim().replace(/\/$/, "");
    if (!url || code.trim().length < 3) { setMessage("Enter the Render server address and a room code of at least three characters."); return; }
    socket?.disconnect();
    const next = io(url, { transports:["websocket"] });
    setSocket(next);
    next.on("connect", () => next.emit("raid-join", { name, code }, (reply:RaidReply) => setMessage(reply.ok ? "Raid room joined. Ready up when your ally arrives." : reply.error || "Could not join the Raid room.")));
    next.on("connect_error", () => setMessage("The Raid server is waking up or unavailable. Try connecting again in a moment."));
    next.on("disconnect", () => setMessage("Connection lost. Socket recovery will retry briefly."));
  }
  function toggle(unit:Unit) {
    if (locked) return;
    setDeck((current) => current.some((entry) => entry.id === unit.id) ? current.filter((entry) => entry.id !== unit.id) : current.length < 9 ? [...current, unit] : current);
  }
  function moveDeckCard(index:number, direction:-1|1) {
    if (locked) return;
    const destination=index+direction;
    if (destination<0 || destination>=deck.length) return;
    setDeck((current) => { const reordered=[...current]; [reordered[index],reordered[destination]]=[reordered[destination],reordered[index]]; return reordered; });
  }
  function submit() {
    socket?.emit("raid-submit-deck", deck.map((unit) => unit.id), (reply:RaidReply) => {
      if (reply.ok) { setLocked(true); setMessage("Deck locked. After both decks are ready, take turns placing your six characters."); }
      else setMessage(reply.error || "The server rejected this Raid deck.");
    });
  }
  function choosePlacement(slot:number) {
    if (!placing || !placement || ownUnitAt(slot)) return;
    socket?.emit("raid-place", { unitId:placement, slot }, (reply:RaidReply) => {
      if (!reply.ok) setMessage(reply.error || "That space is unavailable.");
      else setPlacement(null);
    });
  }
  function chooseCombatCard(unit:Unit) {
    if (!active || unit.hp <= 0 || me?.team?.used?.includes(unit.id)) return;
    setAttacker((current) => current === unit.id ? null : unit.id);
    setAbilitySource(null);
  }
  const abilityTargets = new Set(["eject","bombshell","shockwave","head","arachnia"]);
  const raidActiveAbilities = new Set(["eject","wheeljack","soundwave","bombshell","overlord","shockwave","pmega","wasp","head","arachnia","razor","getaway","grapple","highbrow","hoist","bludgeon","jhiaxus","rumble","rattrap","rhinox","cyclonus"]);
  function useAbility(sourceId:string) {
    if (!active || !me?.team) return;
    const source = me.team.board.find((unit) => unit?.id===sourceId) || me.team.backups.find((unit) => unit?.id===sourceId);
    if (!source || !(source.abilityUses>0) || me.team.usedAbilities?.includes(sourceId)) return;
    if (!raidActiveAbilities.has(sourceId) && sourceId!=="galvatron") {
      setMessage(`${source.name}'s ability triggers automatically during combat.`);
      return;
    }
    setAttacker(null);
    if (abilityTargets.has(sourceId)) {
      setAbilitySource((current) => current===sourceId ? null : sourceId);
      setMessage(sourceId==="head" ? "Choose a court space. Headstrong will destroy both cards if occupied." : `${source.name} is ready. Choose a court target.`);
      return;
    }
    socket?.emit("raid-use-ability", { sourceId }, (reply:RaidReply) => {
      if (!reply.ok) setMessage(reply.error || "That unique ability cannot be used now.");
    });
  }
  function attack(targetId?:string, targetSlot?:number) {
    if (!active) return;
    if (abilitySource) {
      socket?.emit("raid-use-ability", { sourceId:abilitySource, ...(targetId ? { targetId } : { targetSlot }) }, (reply:RaidReply) => {
        if (!reply.ok) setMessage(reply.error || "That unique ability cannot target this space.");
      });
      setAbilitySource(null);
      return;
    }
    if (!attacker) return;
    socket?.emit("raid-attack", { attackerId:attacker, ...(targetId ? { targetId } : { targetSlot }) }, (reply:RaidReply) => { if (!reply.ok) setMessage(reply.error || "That attack is unavailable."); });
    setAttacker(null);
  }
  function reposition(slot:number) {
    if (!moving) return;
    const unit=ownUnitAt(slot);
    if (backupSource) {
      if (!unit) { setMessage("Choose a deployed character to swap with this Backup."); return; }
      socket?.emit("raid-backup-swap", { backupId:backupSource, slot }, (reply:RaidReply) => {
        if (!reply.ok) setMessage(reply.error || "That Backup cannot be swapped in right now.");
        else setMessage("Backup swapped onto your board.");
      });
      setBackupSource(null);
      return;
    }
    if (moveSource===null) { if (unit) setMoveSource(slot); return; }
    if (slot===moveSource) { setMoveSource(null); return; }
    socket?.emit("raid-reposition", { unitId:ownUnitAt(moveSource)?.id, from:moveSource, to:slot }, (reply:RaidReply) => {
      if (!reply.ok) setMessage(reply.error || "You can only reposition your own cards into a free space or onto your own card.");
      setMoveSource(null);
    });
  }
  function selectBackup(id:string) {
    if (!moving || !me?.team?.backups.some((unit) => unit.id === id)) return;
    setMoveSource(null);
    setBackupSource((current) => current === id ? null : id);
    setMessage("Choose one of your deployed characters to swap with this Backup.");
  }

  if (!state) return (
    <main className="raid-page"><section className="raid-lobby">
      <p className="eyebrow">ONLINE CO-OP PVE</p><h1>Quintesson Boss Rush</h1>
      <p className="raid-lead">Two human players deploy on separate 3 × 3 boards beside one another. The visible Quintesson Judge stands above a 2 × 3 troop court whose enemy cards stay concealed.</p>
      <div className="raid-rules-callout"><b>Round order</b><span>Alternate placement</span><span>Player 1: 2 actions</span><span>Player 2: 2 actions</span><span>Boss turn + 2 moves</span></div>
      <label>Render server address<input value={server} onChange={(event) => setServer(event.target.value)} /></label>
      <label>Your name<input value={name} maxLength={20} placeholder="Player name" onChange={(event) => setName(event.target.value)} /></label>
      <label>Boss Rush room code<input value={code} maxLength={12} placeholder="E.G. VERDICT7" onChange={(event) => setCode(event.target.value.toUpperCase())} /></label>
      <div className="raid-lobby-actions"><button className="primary" onClick={join}>Join Boss Rush</button><Link className="ghost" href="/">Main menu</Link></div>
      <p className="raid-message">Both players use the same room code. Your cards remain yours: you cannot move or attack with your ally’s characters.</p><p className="raid-message">{message}</p>
    </section></main>
  );

  if (state.stage === "lobby") return (
    <main className="raid-page"><section className="raid-lobby"><p className="eyebrow">BOSS RUSH ROOM {state.code}</p><h1>Assemble the strike team</h1>
      <div className="raid-players">{state.players.map((player) => <div key={player.id}><b>{player.name}</b><span>{player.ready ? "READY" : "NOT READY"}</span></div>)}{state.players.length<2 ? <div className="waiting-slot">WAITING FOR ALLY</div> : null}</div>
      <button className="primary" disabled={Boolean(me?.ready)} onClick={() => socket?.emit("raid-ready")}>{me?.ready ? "Waiting for ally" : "I am ready"}</button><p className="raid-message">Both players ready up before building decks.</p><p className="raid-message">{message}</p></section></main>
  );

  if (state.stage === "deckbuilding") return (
    <main className="raid-page"><header className="raid-header"><div><p className="eyebrow">BOSS RUSH DECKBUILDER</p><h1>Choose and order your nine</h1></div><b className={legal ? "legal" : ""}>{deck.length}/9</b><button className="primary" disabled={!legal || locked} onClick={submit}>{locked ? "Waiting for ally" : "Lock Raid team"}</button></header>
      <div className="raid-counts"><span className={counts.Commander===2 ? "ok" : ""}>2 Commanders · {counts.Commander}</span><span className={counts.Scout===3 ? "ok" : ""}>3 Scouts · {counts.Scout}</span><span className={counts.Trooper===2 ? "ok" : ""}>2 Troopers · {counts.Trooper}</span><span className={counts.Tactician===2 ? "ok" : ""}>2 Tacticians · {counts.Tactician}</span></div>
      <section className="raid-loadout"><h2>Deployment order</h2><p>The first six become your deployable characters. Cards 7–9 stay as your hidden Backups.</p><div>{deck.map((unit,index) => <article key={unit.id} className={index<6 ? "deployed" : "backup"}><b>{index+1}</b><CardImage src={unit.image} alt="" /><span>{unit.name}<small>{index<6 ? "DEPLOYED" : "BACKUP"}</small></span><button disabled={locked || index===0} onClick={() => moveDeckCard(index,-1)} aria-label={`Move ${unit.name} earlier`}>↑</button><button disabled={locked || index===deck.length-1} onClick={() => moveDeckCard(index,1)} aria-label={`Move ${unit.name} later`}>↓</button></article>)}</div></section>
      <section className="raid-card-pool">{allUnits.map((unit) => <button key={unit.id} className={deck.some((entry) => entry.id===unit.id) ? "chosen" : ""} onClick={() => toggle(unit)} aria-pressed={deck.some((entry) => entry.id===unit.id)}><CardImage src={unit.image} alt={unit.name}/><span>{unit.name}</span></button>)}</section><p className="raid-message">{message}</p></main>
  );

  if (state.stage === "deployment") return (
    <main className="raid-page raid-combat-page"><header className="raid-header"><div><p className="eyebrow">SEPARATE DEPLOYMENT BOARDS · {state.code}</p><h1>{placing ? "Your placement turn" : `${state.players.find((player) => player.id===state.placementActiveId)?.name || "Your ally"}'s placement turn`}</h1></div><b>{state.players.reduce((sum,player) => sum+(player.team?.board.filter(Boolean).length || 0),0)}/12 placed</b></header>
      <div className="raid-deployment-layout"><section className="raid-player-boards-panel"><div className="raid-board-title"><div><p>ALLIED STRIKE FORMATION</p><h2>Your 3 × 3 board</h2></div><span>{placing ? "PLACE ON YOUR HIGHLIGHTED BOARD" : "WAIT FOR YOUR ALLY"}</span></div><p className="raid-placement-privacy">Only your board is shown while you place. Your ally’s formation remains private until combat begins.</p><div className="raid-player-boards">{state.players.filter((player) => player.id===state.youId).map((player) => {const board=boardFor(player);const playerNumber=state.players.findIndex((entry)=>entry.id===player.id)+1;return <section key={player.id} className="raid-player-board your-board"><header><div><strong>PLAYER {playerNumber} · YOU</strong><small>{placing ? "YOUR BOARD · CONTROLS UNLOCKED" : "YOUR BOARD · LOCKED UNTIL YOUR TURN"}</small></div><span>{board.filter(Boolean).length}/6 deployed</span></header><div className="raid-player-grid">{Array.from({length:9},(_,slot) => {const unit=board[slot];return <button key={slot} className={`raid-slot ${unit ? "own-slot" : "vacant"}`} onClick={() => choosePlacement(slot)} disabled={!placing || Boolean(unit)}>{unit ? <><CardImage src={unit.image} alt={unit.name}/><b>{unit.name}</b><small>YOUR CARD</small></> : <span>SPACE {slot+1}</span>}</button>;})}</div></section>;})}</div></section>
      <section className="raid-placement-hand"><h2>Your six to place</h2><p>Placement alternates one card at a time. Each player can place cards only on their own highlighted 3 × 3 board.</p><div>{me?.team?.pending?.map((unit) => <button key={unit.id} className={placement===unit.id ? "selected" : ""} disabled={!placing} onClick={() => setPlacement((current) => current===unit.id ? null : unit.id)}><CardImage src={unit.image} alt={unit.name}/><span>{unit.name}</span></button>)}</div><p className="raid-message">{placement ? `Selected ${me?.team?.pending?.find((unit) => unit.id===placement)?.name}. Choose an empty space on your board.` : message}</p></section></div>
    </main>
  );

  const finished=state.stage === "victory" || state.stage === "defeat";
  const activeName=state.players.find((player) => player.id===state.activeId)?.name;
  return (
    <main className="raid-page raid-combat-page"><header className="raid-header"><div><p className="eyebrow">QUINTESSON BOSS RUSH · ROUND {state.round}</p><h1>{state.stage==="victory" ? "Boss Rush Victory" : state.stage==="defeat" ? "Boss Rush Defeat" : state.stage==="boss" ? "Boss Turn" : state.stage==="reposition" ? "Repositioning" : active ? "Your Turn" : `${activeName || "Your ally"}'s Turn`}</h1></div><b>{active ? `${state.actions} attacks` : state.stage==="reposition" ? `${state.repositions[state.youId] || 0} move` : "Stand by"}</b>{finished ? <Link className="ghost" href="/">Return to menu</Link> : null}</header>
      <section className="raid-arena"><section className="raid-player-boards-panel"><div className="raid-board-title"><div><p>ALLIED STRIKE FORMATION</p><h2>Player boards</h2></div><span>{moving ? "SELECT A CARD, THEN A SPACE" : active ? "SELECT YOUR CARD, THEN A BOSS" : "YOUR BOARD IS HIGHLIGHTED"}</span></div><div className="raid-player-boards">{displayPlayers.map((player) => {const own=player.id===state.youId;const board=boardFor(player);const playerNumber=state.players.findIndex((entry)=>entry.id===player.id)+1;return <section key={player.id} className={`raid-player-board ${own ? "your-board" : "ally-board"}`}><header><div><strong>PLAYER {playerNumber} · {own ? "YOU" : player.name.toUpperCase()}</strong><small>{own ? "YOUR BOARD · CONTROLS UNLOCKED" : "ALLY BOARD · LOCKED TO OWNER"}</small></div><span>{board.filter(Boolean).length}/6 deployed</span></header><div className="raid-player-grid">{Array.from({length:9},(_,slot) => {const unit=board[slot];const selected=own && moveSource===slot;const disabled=moving ? !own || (backupSource ? !unit : moveSource===null ? !unit : false) : !active || !own || !unit || Boolean(me?.team?.used?.includes(unit.id));return <button key={slot} className={`raid-slot ${unit ? own ? "own-slot" : "ally-slot" : "vacant"} ${selected ? "move-source" : ""} ${unit && (attacker || abilitySource) ? "targetable" : ""} ${unit ? isAnimated(unit.id) : ""}`} onClick={() => moving ? own ? reposition(slot) : undefined : own && unit ? chooseCombatCard(unit) : undefined} disabled={disabled}>{unit ? <><CardImage src={unit.image} alt={unit.name}/><b>{unit.name}</b><small>{own ? `${unit.hp}/${unit.max} HP · YOUR CARD` : `${unit.hp}/${unit.max} HP · ALLY CARD`}</small>{own && active && raidActiveAbilities.has(unit.id) && unit.abilityUses>0 && !me?.team?.usedAbilities?.includes(unit.id) ? <span className="raid-ability-chip" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); useAbility(unit.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); useAbility(unit.id); } }}>ABILITY</span> : null}{animation?.targetId===unit.id && animation.damage ? <em className="raid-damage-pop">-{animation.damage}</em> : null}</> : <span>SPACE {slot+1}</span>}</button>;})}</div><div className="raid-board-backups"><strong>BACKUPS · {player.team?.backups.length || 0} REMAIN</strong>{own ? <span>{player.team?.backups.length ? player.team.backups.map((unit) => unit.name).join(" · ") : "None"}</span> : <span>Hidden from opponent</span>}</div></section>;})}</div></section>
        {/* Hidden Quintesson troop cards are represented only by these neutral cardbacks. */}<section className="quintesson-raid-board raid-boss-panel"><div className="raid-board-title"><div><p>VERDICT CHAMBER</p><h2>Quintesson Court</h2></div><span>6 COURT SPACES · TARGET ANY SPACE</span></div><div className="raid-judge-space"><button className={`raid-judge-card ${isAnimated(state.judge.id)}`} onClick={() => attack(state.judge.id)} disabled={!active || (!attacker && !abilitySource)}><CardImage src={state.judge.image} alt={state.judge.name}/><div><strong>{state.judge.name}</strong><span>{state.judge.hp}/{state.judge.max} HP · {state.judge.dmg} DMG</span><small>{state.judge.ability}</small></div>{animation?.targetId===state.judge.id && animation.damage ? <em className="raid-damage-pop">-{animation.damage}</em> : null}</button></div><div className="raid-boss-board">{state.bossBoard.map((unit,slot) => {const feedback=state.courtFeedback?.[slot];const revealedUnit=unit?.hidden===false && unit.image ? unit : null;return <button key={slot} className={`raid-boss-slot ${unit ? isAnimated(undefined,slot) : "vacant"} ${attacker || abilitySource ? "targetable" : ""} ${feedback ? "court-feedback" : ""}`} onClick={() => attack(undefined,slot)} disabled={!active || (!attacker && !abilitySource)} aria-label={`Court space ${slot+1}`}>{revealedUnit ? <><CardImage src={revealedUnit.image} alt={revealedUnit.name || "Revealed Quintesson troop"}/><strong>{revealedUnit.name}</strong><span>{revealedUnit.hp}/{revealedUnit.max} HP · {revealedUnit.dmg} DMG</span><small>{revealedUnit.ability}</small></> : <><span className="raid-hidden-card-back">?</span><span>COURT SPACE</span></>}{feedback ? <small className={`raid-court-result ${feedback.toLowerCase()}`}>{feedback}</small> : null}{animation?.targetSlot===slot && animation.damage ? <em className="raid-damage-pop">-{animation.damage}</em> : null}</button>;})}</div></section>
      </section>
      {/* Shared Battle Cards are intentionally not rendered in Boss Rush; attacks and character abilities drive this mode. */}<section className="raid-command-panel"><div className="raid-command-status"><div><p className="raid-command-kicker">COMBAT PHASE</p><h2>{active ? "Your attack turn" : state.stage==="boss" ? "Quintesson turn" : state.stage==="reposition" ? "Repositioning" : "Co-op combat"}</h2><p>{active ? `${state.actions} attacks remaining. Each player gets exactly two attacks before the boss acts.` : "Your ally controls their own board. The Judge and court resolve after both players finish."}</p><p className="raid-ability-help"><strong>Abilities:</strong> select the glowing ABILITY chip on one of your cards. Targeted abilities highlight a court space; passive abilities resolve automatically.</p><span className="raid-battle-disabled">BATTLE CARDS DISABLED IN BOSS RUSH</span></div><div className="raid-backup-area"><h3>Your Backups</h3><p className="raid-backup-help">During repositioning, choose a Backup, then choose one of your deployed cards to swap it in.</p><div className="raid-backup-cards">{me?.team?.backups?.length ? me.team.backups.map((unit) => <article key={unit.id} className={`raid-backup-card ${backupSource===unit.id ? "backup-selected" : ""}`} role={moving ? "button" : undefined} tabIndex={moving ? 0 : undefined} onClick={() => moving ? selectBackup(unit.id) : undefined} onKeyDown={(event) => { if (moving && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); selectBackup(unit.id); } }}><CardImage src={unit.image} alt={unit.name}/><b>{unit.name}</b><small>{unit.hp}/{unit.max} HP</small>{active && unit.id==="galvatron" && unit.abilityUses>0 && !me.team?.usedAbilities?.includes(unit.id) ? <span className="raid-ability-chip" role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); useAbility(unit.id); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); useAbility(unit.id); } }}>ABILITY</span> : null}</article>) : <span className="raid-message">No backups remaining.</span>}</div></div></div></section>
      {active && state.stage === "combat" ? <button className="primary raid-end" onClick={() => socket?.emit("raid-end-turn")}>End attack turn</button> : null}
      {state.stage === "reposition" && moving ? <button className="primary raid-end" onClick={() => { setMoveSource(null); setMessage("Reposition skipped. Waiting for your ally."); socket?.emit("raid-skip-reposition"); }}>Skip reposition</button> : null}
      {finished ? <section className="raid-result"><h2>{state.stage === "victory" ? "The Judge has been overruled." : "The Tribunal has defeated both teams."}</h2><Link className="primary" href="/">Return to main menu</Link></section> : null}
      <p className="raid-message">{message}</p><aside className="raid-log" aria-live="polite"><h2>Tribunal record</h2>{[...state.log].reverse().map((entry,index) => <p key={`${entry}-${index}`}>{entry}</p>)}</aside>
    </main>
  );
}

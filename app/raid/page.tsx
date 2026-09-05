"use client";

import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import Link from "next/link";
import { battleCards, allUnits, starterDeck, type Unit } from "@/lib/card-data";

type RaidStage = "lobby" | "deckbuilding" | "deployment" | "combat" | "boss" | "reposition" | "victory" | "defeat";
type RaidBossUnit = { id:string; name:string; role:string; max:number; hp:number; dmg:number; image:string; ability:string };
type RaidTeam = { board:(Unit|null)[]; backups:Unit[]; pending?:Unit[]; used:string[] };
type RaidPlayer = { id:string; name:string; ready:boolean; team:RaidTeam|null };
type RaidState = {
  code:string; stage:RaidStage; round:number; youId:string; activeId:string|null; placementActiveId:string|null;
  actions:number; repositions:Record<string,number>; players:RaidPlayer[]; judge:RaidBossUnit; boss:RaidBossUnit[];
  bossBoard:(RaidBossUnit|null)[]; battleHand:string[]; battlePlayed:boolean; log:string[]; eventSeq:number;
};
type RaidReply = { ok:boolean; error?:string; recovered?:boolean };
type RaidEvent = { kind:string; seq:number; attackerId?:string; targetId?:string; damage?:number; name?:string; side?:string; defeated?:boolean };

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
  const [placement, setPlacement] = useState<string|null>(null);
  const [moveSource, setMoveSource] = useState<number|null>(null);
  const [animation, setAnimation] = useState<RaidEvent|null>(null);

  useEffect(() => () => socket?.disconnect(), [socket]);
  useEffect(() => {
    if (!socket) return;
    const onState = (next:RaidState) => {
      setState(next);
      if (next.stage !== "deckbuilding") setLocked(false);
      if (next.stage !== "combat") setAttacker(null);
      if (next.stage !== "reposition") setMoveSource(null);
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
  const ally = state?.players.find((player) => player.id !== state.youId);
  const active = state?.stage === "combat" && state.activeId === state.youId;
  const placing = state?.stage === "deployment" && state.placementActiveId === state.youId;
  const moving = state?.stage === "reposition" && (state.repositions[state.youId] || 0) > 0;
  const counts = useMemo(() => Object.fromEntries(["Commander","Scout","Trooper","Tactician"].map((role) => [role, deck.filter((unit) => unit.role === role).length])), [deck]);
  const legal = deck.length === 9 && counts.Commander === 2 && counts.Scout === 3 && counts.Trooper === 2 && counts.Tactician === 2;
  const sharedUnit = (slot:number) => state?.players.map((player) => ({ player, unit:player.team?.board[slot] || null })).find((entry) => entry.unit) || null;
  const ownUnitAt = (slot:number) => me?.team?.board[slot] || null;
  const isAnimated = (id:string) => animation?.targetId === id ? `raid-hit-animation raid-animation-${animation.seq}` : "";

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
    if (!placing || !placement || sharedUnit(slot)) return;
    socket?.emit("raid-place", { unitId:placement, slot }, (reply:RaidReply) => {
      if (!reply.ok) setMessage(reply.error || "That space is unavailable.");
      else setPlacement(null);
    });
  }
  function chooseCombatCard(unit:Unit) {
    if (!active || unit.hp <= 0 || me?.team?.used?.includes(unit.id)) return;
    setAttacker((current) => current === unit.id ? null : unit.id);
  }
  function attack(targetId:string) {
    if (!attacker || !active) return;
    socket?.emit("raid-attack", { attackerId:attacker, targetId }, (reply:RaidReply) => { if (!reply.ok) setMessage(reply.error || "That attack is unavailable."); });
    setAttacker(null);
  }
  function useBattleCard(card:string) {
    if (!active || state?.battlePlayed) return;
    socket?.emit("raid-play-battle", { name:card }, (reply:RaidReply) => { if (!reply.ok) setMessage(reply.error || "That shared Battle Card cannot be played now."); });
  }
  function reposition(slot:number) {
    if (!moving) return;
    const unit=ownUnitAt(slot);
    if (moveSource===null) { if (unit) setMoveSource(slot); return; }
    if (slot===moveSource) { setMoveSource(null); return; }
    socket?.emit("raid-reposition", { unitId:ownUnitAt(moveSource)?.id, from:moveSource, to:slot }, (reply:RaidReply) => {
      if (!reply.ok) setMessage(reply.error || "You can only reposition your own cards into a free space or onto your own card.");
      setMoveSource(null);
    });
  }

  if (!state) return (
    <main className="raid-page"><section className="raid-lobby">
      <p className="eyebrow">ONLINE CO-OP PVE</p><h1>Quintesson Boss Rush</h1>
      <p className="raid-lead">Two human players share a 3 x 6 grid and fight one visible Quintesson Judge. The Judge stands in a larger leader space behind a 2 x 3 troop court.</p>
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
    <main className="raid-page raid-combat-page"><header className="raid-header"><div><p className="eyebrow">SHARED DEPLOYMENT · {state.code}</p><h1>{placing ? "Your placement turn" : `${state.players.find((player) => player.id===state.placementActiveId)?.name || "Your ally"}'s placement turn`}</h1></div><b>{state.players.reduce((sum,player) => sum+(player.team?.board.filter(Boolean).length || 0),0)}/12 placed</b></header>
      <section className="shared-grid-panel"><div className="raid-board-title"><div><p>ALLIED STRIKE GRID</p><h2>3 wide × 6 tall · Shared board</h2></div><span>{placing ? "PLACE ONE OF YOUR CARDS" : "WAIT FOR YOUR ALLY"}</span></div><div className="raid-shared-grid">{Array.from({length:18},(_,slot) => {const entry=sharedUnit(slot);return <button key={slot} className={`raid-slot ${entry ? entry.player.id===state.youId ? "own-slot" : "ally-slot" : "vacant"}`} onClick={() => choosePlacement(slot)} disabled={!placing || Boolean(entry)}>{entry ? <><CardImage src={entry.unit!.image} alt={entry.unit!.name}/><b>{entry.unit!.name}</b><small>{entry.player.id===state.youId ? "YOUR CARD" : "ALLY CARD"}</small></> : <span>SPACE {slot+1}</span>}</button>;})}</div></section>
      <section className="raid-placement-hand"><h2>Your six to place</h2><p>Placement alternates one card at a time. Your ally’s cards are visible, but never controllable by you.</p><div>{me?.team?.pending?.map((unit) => <button key={unit.id} className={placement===unit.id ? "selected" : ""} disabled={!placing} onClick={() => setPlacement((current) => current===unit.id ? null : unit.id)}><CardImage src={unit.image} alt={unit.name}/><span>{unit.name}</span></button>)}</div><p className="raid-message">{placement ? `Selected ${me?.team?.pending?.find((unit) => unit.id===placement)?.name}. Choose an empty shared space.` : message}</p></section>
    </main>
  );

  const finished=state.stage === "victory" || state.stage === "defeat";
  const activeName=state.players.find((player) => player.id===state.activeId)?.name;
  return (
    <main className="raid-page raid-combat-page"><header className="raid-header"><div><p className="eyebrow">QUINTESSON BOSS RUSH · ROUND {state.round}</p><h1>{state.stage==="victory" ? "Boss Rush Victory" : state.stage==="defeat" ? "Boss Rush Defeat" : state.stage==="boss" ? "Boss Turn" : state.stage==="reposition" ? "Repositioning" : active ? "Your Turn" : `${activeName || "Your ally"}'s Turn`}</h1></div><b>{active ? `${state.actions} actions` : state.stage==="reposition" ? `${state.repositions[state.youId] || 0} move` : "Stand by"}</b>{finished ? <Link className="ghost" href="/">Return to menu</Link> : null}</header>
      <section className="quintesson-raid-board"><div className="raid-board-title"><div><p>VERDICT CHAMBER</p><h2>Visible Quintesson Court</h2></div><span>{state.bossBoard.filter(Boolean).length}/6 TROOP SPACES</span></div><div className="raid-judge-space"><button className={`raid-judge-card ${isAnimated(state.judge.id)}`} onClick={() => attack(state.judge.id)} disabled={!active || !attacker}><CardImage src={state.judge.image} alt={state.judge.name}/><div><strong>{state.judge.name}</strong><span>{state.judge.hp}/{state.judge.max} HP · {state.judge.dmg} DMG</span><small>{state.judge.ability}</small></div>{animation?.targetId===state.judge.id && animation.damage ? <em className="raid-damage-pop">-{animation.damage}</em> : null}</button></div><div className="raid-boss-board">{state.bossBoard.map((unit,slot) => <button key={slot} className={`raid-boss-slot ${unit ? isAnimated(unit.id) : "vacant"}`} onClick={() => unit && attack(unit.id)} disabled={!active || !attacker || !unit}>{unit ? <><CardImage src={unit.image} alt={unit.name}/><strong>{unit.name}</strong><span>{unit.hp}/{unit.max} HP · {unit.dmg} DMG</span><small>{unit.ability}</small>{animation?.targetId===unit.id && animation.damage ? <em className="raid-damage-pop">-{animation.damage}</em> : null}</> : <span>EMPTY COURT SPACE</span>}</button>)}</div></section>
      <section className="raid-battle-panel"><div><h2>Shared Battle Cards</h2><p>One card is drawn at the start of each round. Either player may play it, but only once across both player turns.</p></div><div className="raid-shared-hand">{state.battleHand.length ? state.battleHand.map((card,index) => <button key={`${card}-${index}`} disabled={!active || state.battlePlayed} onClick={() => useBattleCard(card)} title={battleCards[card]?.effect}>{battleCards[card]?.image ? <CardImage src={battleCards[card].image} alt={card}/> : <span className="raid-card-placeholder">AMBUSH<br/>TRAP</span>}<b>{card}</b><small>{battleCards[card]?.effect}</small></button>) : <span className="raid-message">No shared Battle Cards remain in hand.</span>}</div><p className="raid-card-status">{state.battlePlayed ? "SHARED CARD USED THIS ROUND" : active ? "SHARED CARD READY" : "WAITING FOR ACTIVE PLAYER"}</p></section>
      <section className="raid-team-row"><div><div className="raid-board-title"><div><p>YOUR CONTROLLED SPACES</p><h2>Shared 3 × 6 grid</h2></div><span>{moving ? "SELECT A CARD, THEN A DESTINATION" : active ? "SELECT YOUR CARD, THEN A BOSS" : "ALLY CARDS ARE LOCKED"}</span></div><div className="raid-shared-grid raid-combat-grid">{Array.from({length:18},(_,slot) => {const entry=sharedUnit(slot), own=entry?.player.id===state.youId;return <button key={slot} className={`raid-slot ${own ? "own-slot" : entry ? "ally-slot" : "vacant"} ${own && moveSource===slot ? "move-source" : ""} ${entry?.unit ? isAnimated(entry.unit.id) : ""}`} onClick={() => moving ? reposition(slot) : own ? chooseCombatCard(entry!.unit!) : undefined} disabled={moving ? !own && !(!entry) : !active || !own || !entry?.unit || Boolean(me?.team?.used?.includes(entry.unit.id))}>{entry ? <><CardImage src={entry.unit!.image} alt={entry.unit!.name}/><b>{entry.unit!.name}</b><small>{own ? `${entry.unit!.hp}/${entry.unit!.max} HP · YOUR CARD` : `${entry.unit!.hp}/${entry.unit!.max} HP · ALLY CARD`}</small>{animation?.targetId===entry.unit!.id && animation.damage ? <em className="raid-damage-pop">-{animation.damage}</em> : null}</> : <span>SPACE {slot+1}</span>}</button>;})}</div><h3>Your Backups</h3><div className="raid-backups">{me?.team?.backups.length ? me.team.backups.map((unit) => <span key={unit.id}>{unit.name} · {unit.hp} HP</span>) : <span>No Backups remain</span>}</div></div><div className="raid-ally-panel"><h2>{ally?.name || "Ally"}</h2><p>Ally cards are visible for co-op planning, but only your owner can move or attack with them.</p><div className="raid-ally-summary">{ally?.team?.board.filter(Boolean).map((unit) => unit && <span key={unit.id}>{unit.name} · {unit.hp}/{unit.max} HP</span>)}</div><small>{ally?.team?.backups.length || 0} Backups remaining</small></div></section>
      {active && state.stage === "combat" ? <button className="primary raid-end" onClick={() => socket?.emit("raid-end-turn")}>End attack turn</button> : null}
      {state.stage === "reposition" && moving ? <button className="primary raid-end" onClick={() => { setMoveSource(null); setMessage("Reposition skipped. Waiting for your ally."); socket?.emit("raid-skip-reposition"); }}>Skip reposition</button> : null}
      {finished ? <section className="raid-result"><h2>{state.stage === "victory" ? "The Judge has been overruled." : "The Tribunal has defeated both teams."}</h2><Link className="primary" href="/">Return to main menu</Link></section> : null}
      <p className="raid-message">{message}</p><aside className="raid-log" aria-live="polite"><h2>Tribunal record</h2>{[...state.log].reverse().map((entry,index) => <p key={`${entry}-${index}`}>{entry}</p>)}</aside>
    </main>
  );
}

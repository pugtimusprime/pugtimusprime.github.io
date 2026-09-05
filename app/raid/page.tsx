"use client";

import { useEffect, useMemo, useState } from "react";
import { io, type Socket } from "socket.io-client";
import Link from "next/link";
import { allUnits, starterDeck, type Unit } from "@/lib/card-data";

type RaidBossUnit = {
  id: string;
  name: string;
  role: string;
  max: number;
  hp: number;
  dmg: number;
  image: string;
  ability: string;
};
type RaidTeam = {
  board: (Unit | null)[];
  backups: Unit[];
  used: string[];
};
type RaidPlayer = {
  id: string;
  name: string;
  ready: boolean;
  team: RaidTeam | null;
};
type RaidState = {
  code: string;
  stage: "lobby" | "deckbuilding" | "combat" | "boss" | "victory" | "defeat";
  round: number;
  youId: string;
  activeId: string | null;
  actions: number;
  players: RaidPlayer[];
  boss: RaidBossUnit[];
  log: string[];
};
type RaidReply = { ok: boolean; error?: string; recovered?: boolean };

const raidServer = "https://hidden-front-server.onrender.com";

export default function RaidPage() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [server, setServer] = useState(raidServer);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<RaidState | null>(null);
  const [message, setMessage] = useState(
    "Create a room code and share it with one co-op partner.",
  );
  const [deck, setDeck] = useState<Unit[]>(() => starterDeck("Autobot"));
  const [locked, setLocked] = useState(false);
  const [attacker, setAttacker] = useState<string | null>(null);

  useEffect(() => () => socket?.disconnect(), [socket]);

  const me = state?.players.find((player) => player.id === state.youId);
  const ally = state?.players.find((player) => player.id !== state.youId);
  const active = state?.stage === "combat" && state.activeId === state.youId;
  const counts = useMemo(
    () =>
      Object.fromEntries(
        ["Commander", "Scout", "Trooper", "Tactician"].map((role) => [
          role,
          deck.filter((unit) => unit.role === role).length,
        ]),
      ),
    [deck],
  );
  const legal =
    deck.length === 9 &&
    counts.Commander === 2 &&
    counts.Scout === 3 &&
    counts.Trooper === 2 &&
    counts.Tactician === 2;

  function join() {
    const url = server.trim().replace(/\/$/, "");
    if (!url || code.trim().length < 3) {
      setMessage("Enter the Render server address and a room code of at least three characters.");
      return;
    }
    socket?.disconnect();
    const next = io(url, { transports: ["websocket"] });
    setSocket(next);
    next.on("connect", () =>
      next.emit("raid-join", { name, code }, (reply: RaidReply) =>
        setMessage(
          reply.ok
            ? "Raid room joined. Ready up when your ally arrives."
            : reply.error || "Could not join the Raid room.",
        ),
      ),
    );
    next.on("raid-state", (nextState: RaidState) => setState(nextState));
    next.on("connect_error", () =>
      setMessage("The Raid server is waking up or unavailable. Try connecting again in a moment."),
    );
    next.on("disconnect", () =>
      setMessage("Connection lost. Socket recovery will retry briefly."),
    );
  }

  function toggle(unit: Unit) {
    if (locked) return;
    setDeck((current) =>
      current.some((entry) => entry.id === unit.id)
        ? current.filter((entry) => entry.id !== unit.id)
        : current.length < 9
          ? [...current, unit]
          : current,
    );
  }

  function moveDeckCard(index: number, direction: -1 | 1) {
    if (locked) return;
    const destination = index + direction;
    if (destination < 0 || destination >= deck.length) return;
    setDeck((current) => {
      const reordered = [...current];
      [reordered[index], reordered[destination]] = [
        reordered[destination],
        reordered[index],
      ];
      return reordered;
    });
  }

  function submit() {
    socket?.emit(
      "raid-submit-deck",
      deck.map((unit) => unit.id),
      (reply: RaidReply) => {
        if (reply.ok) {
          setLocked(true);
          setMessage("Deck and deployment order locked. Waiting for your ally.");
        } else setMessage(reply.error || "The server rejected this Raid deck.");
      },
    );
  }

  function attack(targetId: string) {
    if (!attacker || !active) return;
    socket?.emit(
      "raid-attack",
      { attackerId: attacker, targetId },
      (reply: RaidReply) => {
        if (!reply.ok) setMessage(reply.error || "That attack is unavailable.");
      },
    );
    setAttacker(null);
  }

  if (!state)
    return (
      <main className="raid-page">
        <section className="raid-lobby">
          <p className="eyebrow">ONLINE CO-OP PVE</p>
          <h1>Quintesson Raid</h1>
          <p className="raid-lead">
            Two human players command separate teams against one visible,
            server-controlled Quintesson Tribunal.
          </p>
          <div className="raid-rules-callout">
            <b>Round order</b>
            <span>Player 1: 2 actions</span>
            <span>Player 2: 2 actions</span>
            <span>Boss court attacks</span>
          </div>
          <label>
            Render server address
            <input value={server} onChange={(event) => setServer(event.target.value)} />
          </label>
          <label>
            Your name
            <input
              value={name}
              maxLength={20}
              placeholder="Player name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Raid room code
            <input
              value={code}
              maxLength={12}
              placeholder="E.G. VERDICT7"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
          </label>
          <div className="raid-lobby-actions">
            <button className="primary" onClick={join}>Join Raid room</button>
            <Link className="ghost" href="/">Main menu</Link>
          </div>
          <p className="raid-message">{message}</p>
        </section>
      </main>
    );

  if (state.stage === "lobby")
    return (
      <main className="raid-page">
        <section className="raid-lobby">
          <p className="eyebrow">RAID ROOM {state.code}</p>
          <h1>Assemble the strike team</h1>
          <div className="raid-players">
            {state.players.map((player) => (
              <div key={player.id}>
                <b>{player.name}</b>
                <span>{player.ready ? "READY" : "NOT READY"}</span>
              </div>
            ))}
            {state.players.length < 2 ? <div className="waiting-slot">WAITING FOR ALLY</div> : null}
          </div>
          <button
            className="primary"
            disabled={Boolean(me?.ready)}
            onClick={() => socket?.emit("raid-ready")}
          >
            {me?.ready ? "Waiting for ally" : "I am ready"}
          </button>
          <p className="raid-message">Both players ready up before building their decks.</p>
        </section>
      </main>
    );

  if (state.stage === "deckbuilding")
    return (
      <main className="raid-page">
        <header className="raid-header">
          <div>
            <p className="eyebrow">RAID DECKBUILDER</p>
            <h1>Choose and order your nine</h1>
          </div>
          <b className={legal ? "legal" : ""}>{deck.length}/9</b>
          <button className="primary" disabled={!legal || locked} onClick={submit}>
            {locked ? "Waiting for ally" : "Lock Raid team"}
          </button>
        </header>
        <div className="raid-counts">
          <span className={counts.Commander === 2 ? "ok" : ""}>2 Commanders · {counts.Commander}</span>
          <span className={counts.Scout === 3 ? "ok" : ""}>3 Scouts · {counts.Scout}</span>
          <span className={counts.Trooper === 2 ? "ok" : ""}>2 Troopers · {counts.Trooper}</span>
          <span className={counts.Tactician === 2 ? "ok" : ""}>2 Tacticians · {counts.Tactician}</span>
        </div>
        <section className="raid-loadout">
          <h2>Deployment order</h2>
          <p>The first six deploy. Cards 7–9 become your Backups.</p>
          <div>
            {deck.map((unit, index) => (
              <article key={unit.id} className={index < 6 ? "deployed" : "backup"}>
                <b>{index + 1}</b>
                <img src={unit.image} alt="" />
                <span>{unit.name}<small>{index < 6 ? "DEPLOYED" : "BACKUP"}</small></span>
                <button disabled={locked || index === 0} onClick={() => moveDeckCard(index, -1)} aria-label={`Move ${unit.name} earlier`}>↑</button>
                <button disabled={locked || index === deck.length - 1} onClick={() => moveDeckCard(index, 1)} aria-label={`Move ${unit.name} later`}>↓</button>
              </article>
            ))}
          </div>
        </section>
        <section className="raid-card-pool">
          {allUnits.map((unit) => (
            <button
              key={unit.id}
              className={deck.some((entry) => entry.id === unit.id) ? "chosen" : ""}
              onClick={() => toggle(unit)}
              aria-pressed={deck.some((entry) => entry.id === unit.id)}
            >
              <img src={unit.image} alt={unit.name} />
              <span>{unit.name}</span>
            </button>
          ))}
        </section>
        <p className="raid-message">{message}</p>
      </main>
    );

  const team = me?.team;
  const finished = state.stage === "victory" || state.stage === "defeat";
  const activeName = state.players.find((player) => player.id === state.activeId)?.name;
  return (
    <main className="raid-page raid-combat-page">
      <header className="raid-header">
        <div>
          <p className="eyebrow">QUINTESSON TRIBUNAL · ROUND {state.round}</p>
          <h1>
            {state.stage === "victory"
              ? "Raid Victory"
              : state.stage === "defeat"
                ? "Raid Defeat"
                : state.stage === "boss"
                  ? "Boss Turn"
                  : active
                    ? "Your Turn"
                    : `${activeName || "Your ally"}'s Turn`}
          </h1>
        </div>
        <b>{active ? `${state.actions} actions` : "Stand by"}</b>
        {finished ? <Link className="ghost" href="/">Return to menu</Link> : null}
      </header>

      <section className="quintesson-raid-board">
        <div className="raid-board-title">
          <div><p>VERDICT CHAMBER</p><h2>Visible Boss Court</h2></div>
          <span>{state.boss.length} HOSTILES ACTIVE</span>
        </div>
        <div className="raid-boss-grid">
          {state.boss.map((unit) => (
            <button
              key={unit.id}
              className={unit.id === "quintesson-judge" ? "judge" : ""}
              onClick={() => attack(unit.id)}
              disabled={!active || !attacker}
            >
              <img src={unit.image} alt={unit.name} />
              <strong>{unit.name}</strong>
              <span>{unit.hp}/{unit.max} HP · {unit.dmg} DMG</span>
              <small>{unit.ability}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="raid-team-row">
        <div>
          <h2>Your deployed team</h2>
          <p>{active ? "Select a character, then select a visible boss target." : "Your team is standing by."}</p>
          <div className="raid-team-grid">
            {team?.board.map((unit, index) =>
              unit ? (
                <button
                  key={unit.id}
                  className={`${attacker === unit.id ? "selected" : ""} ${team.used?.includes(unit.id) ? "used" : ""}`}
                  disabled={!active || unit.hp <= 0 || team.used?.includes(unit.id)}
                  onClick={() => setAttacker(unit.id)}
                >
                  <img src={unit.image} alt={unit.name} />
                  <b>{unit.name}</b>
                  <span>{unit.hp}/{unit.max} HP · {unit.dmg} DMG</span>
                </button>
              ) : <div key={index} className="raid-empty">DEFEATED</div>,
            )}
          </div>
          <h3>Backups</h3>
          <div className="raid-backups">
            {team?.backups.length ? team.backups.map((unit) => <span key={unit.id}>{unit.name} · {unit.hp} HP</span>) : <span>No Backups remain</span>}
          </div>
        </div>
        <div className="raid-ally-panel">
          <h2>{ally?.name || "Ally"}</h2>
          <p>Co-op team status</p>
          <div className="raid-ally-summary">
            {ally?.team?.board.filter(Boolean).map((unit) => unit && (
              <span key={unit.id}>{unit.name} · {unit.hp} HP</span>
            ))}
          </div>
          <small>{ally?.team?.backups.length || 0} Backups remaining</small>
        </div>
      </section>

      {active ? (
        <button className="primary raid-end" onClick={() => socket?.emit("raid-end-turn")}>
          End Raid turn
        </button>
      ) : null}
      <p className="raid-message">{message}</p>
      <aside className="raid-log" aria-live="polite">
        <h2>Tribunal record</h2>
        {[...state.log].reverse().map((entry, index) => <p key={`${entry}-${index}`}>{entry}</p>)}
      </aside>
    </main>
  );
}

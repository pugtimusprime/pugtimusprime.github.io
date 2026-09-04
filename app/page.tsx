"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import {
  Bomb,
  BookOpen,
  ChevronDown,
  Crosshair,
  Eye,
  Flame,
  GripVertical,
  Heart,
  Palette,
  RotateCcw,
  ScrollText,
  Settings,
  Shield,
  Skull,
  Sparkles,
  Swords,
  Users,
  Zap,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  applyBoardAuras,
  applyCharacterAttackDamage,
  applyDamage,
  attackLimit,
  canPlayBattleCard,
  canRhinoxRevive,
  hiddenAttackMessage,
  isBattleCardImmune,
  isPredaconAbilityImmune,
  isFullFactionTeam,
  hasTarantulasDraw,
  healFaction,
  healTransmetalTarantulas,
  reposition,
  resolveTrap,
  reviveAtHalf,
  shouldLayDepthchargeMine,
  stalemateResult,
  validateDeck,
} from "@/lib/combat-engine.mjs";
import {
  allUnits,
  battleCards,
  battleDeck,
  enemyDeck,
  makeBattleDeck,
  randomEnemyDeck,
  rosters,
  shuffled,
  starterDeck,
  type Faction,
  type Slot,
  type Unit,
} from "@/lib/card-data";

type Phase =
  | "start"
  | "multiplayer"
  | "waiting"
  | "build"
  | "opponent"
  | "deploy"
  | "combat"
  | "reinforce"
  | "reposition"
  | "over";
type EnemyChoice = Faction | "Random";
type DragSource = { zone: "hand" | "board" | "backup"; index: number };
type Interaction = {
  kind:
    | "attack"
    | "ability"
    | "battle-enemy"
    | "battle-friendly"
    | "trap"
    | "reinforce"
    | "razor"
    | "getaway"
    | "bludgeon"
    | "galvatron"
    | "rhinox";
  actor?: number;
  name?: string;
  cardIndex?: number;
  picks?: number[];
} | null;
type Feedback = { text: string; tone: "good" | "bad" | "info"; key: number };
type CardInspection =
  Unit | { name: string; image: string; effect: string; rarity: string };
type Concealment = { spaces: number[]; until: number } | null;
type OnlineDeployment = { board: (Unit | null)[]; backups: Unit[] };
type OnlineTurn = {
  round: number;
  activeId: string;
  activeName: string;
  yourTurn: boolean;
  actions: number;
  firstTurn: boolean;
  turnEndsAt: number;
  turnDurationMs: number;
};
type OnlineReposition = {
  moves?: number;
  locked?: boolean;
  repositionEndsAt: number;
  repositionDurationMs: number;
};
type OnlineCombatAction = (
  | {
      kind: "attack";
      target: number;
      hit: boolean;
      damage: number;
      result: Unit | null;
      defeated?: Unit;
      attackerName: string;
      revealedAttackerId?: string;
    }
  | {
      kind: "mine-trigger";
      target: number;
      attackerPosition: number;
      attackerResult: Unit | null;
      defeatedAttacker?: Unit;
    }
  | { kind: "revive"; unit: Unit }
  | { kind: "reposition-lock"; round: number }
  | { kind: "tactician-lock"; untilRound: number }
  | { kind: "conceal-spaces"; spaces: number[]; untilRound: number }
  | { kind: "timed-shields"; positions: number[]; untilRound: number }
  | { kind: "team-heal"; faction: Faction; amount: number }
) & { actorName: string };
type DeckSubmitResponse = { ok: boolean; waiting?: boolean; error?: string };

const themes = [
  ["cybertron", "Cybertron Command"],
  ["matrix", "Matrix Gold"],
  ["energon", "Energon Surge"],
  ["predacon", "Predacon Wilds"],
  ["synthwave", "Neon 1984"],
  ["arctic", "Arctic Siege"],
  ["molten", "Molten Forge"],
  ["void", "Unicron Void"],
  ["blueprint", "Iacon Blueprint"],
  ["quintesson", "Quintesson Tribunal"],
  ["chromedome", "Chromedome Circuit"],
  ["spacebridge", "Space Bridge Transit"],
  ["soundwave", "Soundwave Signal"],
  ["velocitron", "Velocitron Raceway"],
  ["axalon", "Axalon Dawn"],
  ["earthbunker", "Earth Command Bunker"],
  ["omega", "Omega Sentinel"],
  ["nemesis", "Nemesis Flight Deck"],
  ["metroplex", "Metroplex Grid"],
  ["vectorsigma", "Vector Sigma Vault"],
  ["teletraan", "Teletraan Archive"],
  ["darksyde", "Darksyde Reactor"],
] as const;
const cardBorders = [
  ["energon-edge", "Energon Edge"],
  ["matrix-relic", "Matrix Relic"],
  ["decepticon-alloy", "Decepticon Alloy"],
  ["beast-claw", "Beast Wars Claw"],
  ["cybertron-neon", "Cybertron Neon"],
  ["plasma-rivet", "Plasma Rivet"],
  ["stasis-chrome", "Stasis Chrome"],
] as const;
const activeAbilities = new Set([
  "eject",
  "wheeljack",
  "soundwave",
  "bombshell",
  "overlord",
  "shockwave",
  "pmega",
  "wasp",
  "head",
  "arachnia",
  "razor",
  "getaway",
  "grapple",
  "highbrow",
  "hoist",
  "bludgeon",
  "jhiaxus",
  "rumble",
  "rattrap",
  "rhinox",
  "cyclonus",
]);
const targetAbility = new Set([
  "eject",
  "bombshell",
  "shockwave",
  "head",
  "arachnia",
]);

function RulesModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="tool-button">
          <BookOpen size={17} /> Rules
        </button>
      </DialogTrigger>
      <DialogContent className="rules-modal">
        <DialogHeader>
          <DialogTitle>Hidden Front — Complete Rules</DialogTitle>
          <DialogDescription>
            Everything required to build a deck and complete a match.
          </DialogDescription>
        </DialogHeader>
        <div className="rules-scroll">
          <section>
            <h3>1. Objective</h3>
            <p>
              Defeat all nine enemy Character Cards. A defeated card is removed
              from its board or Backup area. When one team has no surviving
              cards, the other team wins.
            </p>
          </section>
          <section>
            <h3>2. Character deck construction</h3>
            <p>
              Build exactly nine unique characters: 2 Commanders, 3 Scouts, 2
              Troopers and 2 Tacticians. Factions may be freely mixed. The two
              different Rampage characters count as separate characters.
            </p>
          </section>
          <section>
            <h3>3. Battle Deck</h3>
            <p>
              The Battle Deck contains 30 cards and no more than 8 Rare cards.
              At the beginning of every round, draw exactly one Battle Card.
            </p>
          </section>
          <section>
            <h3>4. Initial deployment</h3>
            <p>
              View all nine characters in your deck and choose which six begin
              deployed. Secretly place those six, one at a time, on any six
              spaces of your 3×3 grid. The three characters you do not place
              become your Backups. Enemy identities and occupied spaces remain
              hidden.
            </p>
          </section>
          <section>
            <h3>5. Round order</h3>
            <ol>
              <li>Draw one Battle Card.</li>
              <li>Optional Battle Card window.</li>
              <li>The first player uses up to three combat actions.</li>
              <li>The second player uses up to three combat actions.</li>
              <li>
                Replace defeated deployed characters from Backup during the free
                Reinforcement Phase.
              </li>
              <li>Both teams normally receive two Reposition Actions.</li>
              <li>Apply end-of-round effects and start the next round.</li>
            </ol>
            <p>
              Round 1's first attacker receives only two actions. Online turns
              last one minute and may be ended early. A player may forfeit at
              any time during battle.
            </p>
          </section>
          <section>
            <h3>6. Battle Cards</h3>
            <p>
              A Battle Card normally costs one of your three combat actions. It
              can only be used before any other combat action, and normally only
              one Battle Card may be played per round. A card’s printed wording
              overrides these rules. Dark Reflections requires two copies.
              Battle Cards that say “choose” wait for you to choose a valid
              card, space or row.
            </p>
          </section>
          <section>
            <h3>7. Attacking</h3>
            <p>
              Select a deployed character, then select an enemy coordinate. A
              character normally attacks once per round. With fewer than three
              attack-capable characters deployed, survivors may attack
              repeatedly to use the team's remaining actions. An empty
              coordinate is a miss. A hit deals the attacker's Damage. A
              surviving enemy remains unidentified; its identity is revealed
              only when defeated or by a specific revealing effect.
            </p>
          </section>
          <section>
            <h3>8. Unique abilities</h3>
            <p>
              Active unique abilities cost one combat action and replace an
              attack. Passive and triggered abilities resolve automatically and
              do not cost a separate action. Each limited ability shows its
              remaining uses. Galvatron activates from Backup. Depthcharge mines
              remain hidden from the enemy, deal 10 Damage to the next attacker
              targeting that space, and only one mine may exist per team.
            </p>
          </section>
          <section>
            <h3>9. Reinforcement and Repositioning</h3>
            <p>
              After both teams fight, each defeated deployed character must be
              replaced from Backup while a Backup remains. These required
              replacements are free and do not spend either Reposition Action.
              Then each team normally spends two Reposition Actions to move a
              deployed card into a vacancy, swap two deployed cards, or exchange
              a Backup with a deployed card. A team can never have more than six
              Character Cards deployed. Positions are changed secretly. Online
              teams have 30 seconds for this phase; unfinished positions lock
              automatically. Rattrap can reduce both teams to zero moves for
              that round.
            </p>
          </section>
          <section>
            <h3>10. Dragging and selection</h3>
            <p>
              Cards can be dragged between valid spaces on desktop, with the
              moving card following the pointer. Clicking a card and then its
              destination performs the same action and supports touch devices.
              Click the selected card again or use Deselect to cancel.
            </p>
          </section>
          <section>
            <h3>11. Ambush Trap prototype</h3>
            <p>
              Ambush Trap is placed on an empty friendly space during the
              start-of-round Battle Card window. It is not a character and never
              damages its owner. A friendly character may later move onto or
              swap into that space. If the enemy attacks the trapped space, the
              attack is cancelled before the friendly character can be hurt, the
              trap is scrapped, and the attacking enemy position is revealed.
            </p>
          </section>
          <section>
            <h3>12. Four-round stalemate</h3>
            <p>
              If neither team takes damage for four complete rounds, compare
              surviving Character Cards, including Backups. More surviving cards
              wins. If tied, compare combined remaining Health. If still tied,
              the match is a draw.
            </p>
          </section>
          <section>
            <h3>13. Hidden information</h3>
            <p>
              The opponent preview shows which nine characters are in the enemy
              team for balance, but their board positions remain hidden. A
              successful hit marks that position as occupied until the round
              ends. The Enemy Team viewer marks defeated characters with a
              skull.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CombatLogModal({ log }: { log: string[] }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="tool-button">
          <ScrollText size={17} /> Combat history{" "}
          {log.length > 0 && (
            <span className="tool-count">
              {log.length > 99 ? "99+" : log.length}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent className="log-modal">
        <DialogHeader>
          <DialogTitle>Complete combat history</DialogTitle>
          <DialogDescription>
            Newest event first. Living enemy identities remain hidden.
          </DialogDescription>
        </DialogHeader>
        <div className="full-history" aria-live="polite">
          {log.length ? (
            log.map((entry, i) => (
              <article key={`${entry}-${i}`}>
                <b>{log.length - i}</b>
                <p>{entry}</p>
              </article>
            ))
          ) : (
            <p className="empty-copy">The match has not started yet.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EnemyRosterCards({
  units,
  defeated,
}: {
  units: Unit[];
  defeated: Unit[];
}) {
  const inspect = useContext(CardInspectContext),
    dead = new Set(defeated.map((unit) => unit.id));
  return (
    <div className="enemy-team-grid">
      {units.map((unit) => (
        <figure
          key={unit.id}
          className={`character-border-frame ${dead.has(unit.id) ? "enemy-card-dead" : ""}`}
          onMouseEnter={() => inspect(unit)}
          onMouseLeave={() => inspect(null)}
        >
          <img src={unit.image} alt={`${unit.name}, ${unit.role}`} />
          <figcaption>
            <b>{unit.name}</b>
            <span>
              {unit.role} · {unit.faction}
            </span>
          </figcaption>
          {dead.has(unit.id) && (
            <div className="death-stamp">
              <Skull />
              <b>DEFEATED</b>
            </div>
          )}
        </figure>
      ))}
    </div>
  );
}

function EnemyTeamModal({
  units,
  defeated,
}: {
  units: Unit[];
  defeated: Unit[];
}) {
  if (!units.length) return null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="tool-button">
          <Users size={17} /> Enemy Team
        </button>
      </DialogTrigger>
      <DialogContent className="enemy-team-modal">
        <DialogHeader>
          <DialogTitle>Enemy Team</DialogTitle>
          <DialogDescription>
            You know their roster, but their positions on the battlefield remain
            hidden.
          </DialogDescription>
        </DialogHeader>
        <EnemyRosterCards units={units} defeated={defeated} />
      </DialogContent>
    </Dialog>
  );
}

function AppTools({
  theme,
  setTheme,
  cardBorder,
  setCardBorder,
  showFilterCounts,
  setShowFilterCounts,
  log,
  enemyRoster,
  enemyScrap,
}: {
  theme: string;
  setTheme: (v: string) => void;
  cardBorder: string;
  setCardBorder: (v: string) => void;
  showFilterCounts: boolean;
  setShowFilterCounts: (v: boolean) => void;
  log: string[];
  enemyRoster: Unit[];
  enemyScrap: Unit[];
}) {
  return (
    <div className="app-tools">
      <RulesModal />
      <CombatLogModal log={log} />
      <EnemyTeamModal units={enemyRoster} defeated={enemyScrap} />
      <details className="settings-menu">
        <summary className="tool-button">
          <Settings size={17} /> Settings
        </summary>
        <div className="settings-panel">
          <label className="settings-theme">
            <span>
              <Palette size={15} /> Theme
            </span>
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              {themes.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-theme">
            <span>
              <Sparkles size={15} /> Character Card border
            </span>
            <select
              value={cardBorder}
              onChange={(e) => setCardBorder(e.target.value)}
            >
              {cardBorders.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={showFilterCounts}
              onChange={(e) => setShowFilterCounts(e.target.checked)}
            />
            <span>Show available-card counts</span>
          </label>
        </div>
      </details>
    </div>
  );
}

function RailPanel({
  title,
  status,
  className = "",
  children,
}: {
  title: string;
  status?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <details
      className={`rail-panel ${className}`}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <span>{title}</span>
        {status && <small>{status}</small>}
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="rail-panel-body">{children}</div>
    </details>
  );
}

const CardInspectContext = createContext<(unit: CardInspection | null) => void>(
  () => {},
);
function CharacterCard({
  unit,
  hidden = false,
  small = false,
  used = false,
}: {
  unit: Unit;
  hidden?: boolean;
  small?: boolean;
  used?: boolean;
}) {
  const inspect = useContext(CardInspectContext);
  if (hidden)
    return (
      <div className={`character-card card-back ${small ? "small" : ""}`}>
        <Shield />
        <b>HIDDEN</b>
      </div>
    );
  return (
    <div
      className={`character-card character-border-frame ${small ? "small" : ""} ${used ? "used" : ""}`}
      onMouseEnter={() => inspect(unit)}
      onMouseLeave={() => inspect(null)}
    >
      <img src={unit.image} alt={unit.name} />
      <div className="card-hud">
        <b>{unit.name}</b>
        <span>
          <Heart size={12} />
          {unit.hp}/{unit.max}
        </span>
        <span>
          <Zap size={12} />
          {unit.dmg}
        </span>
        {((unit.shield ?? 0) > 0 || unit.ravageGuard) && (
          <span
            title={
              unit.ravageGuard
                ? "Ravage reposition guard active"
                : "Shield active"
            }
          >
            <Shield size={12} />
            {unit.ravageGuard ? "GUARD" : unit.shield}
          </span>
        )}
      </div>
    </div>
  );
}
function CardInspector({ unit }: { unit: CardInspection | null }) {
  if (!unit) return null;
  const battle = "effect" in unit;
  return (
    <aside
      className={`card-inspector ${battle ? "battle-inspector" : "character-inspector"}`}
      aria-live="polite"
    >
      {unit.image ? (
        <img src={unit.image} alt={unit.name} />
      ) : battle ? (
        <BattleCardFace name={unit.name} />
      ) : (
        <TrapCard />
      )}
      <div>
        <p className="eyebrow">CARD DETAILS</p>
        <h2>{unit.name}</h2>
        <b>
          {battle
            ? `${unit.rarity} Battle Card`
            : `${unit.role} · ${unit.faction}`}
        </b>
        <p>{battle ? unit.effect : unit.ability}</p>
        {!battle && (
          <>
            <span>
              <Heart size={15} />
              {unit.hp}/{unit.max} Health
            </span>
            <span>
              <Zap size={15} />
              {unit.dmg} Damage
            </span>
          </>
        )}
      </div>
    </aside>
  );
}
function TrapCard() {
  return (
    <div className="character-card trap-face">
      <Crosshair />
      <b>
        AMBUSH
        <br />
        TRAP
      </b>
      <small>Armed</small>
    </div>
  );
}
function BattleCardFace({ name }: { name: string }) {
  return name === "Ambush Trap" ? (
    <TrapCard />
  ) : (
    <div className="character-card battle-card-face">
      <Swords />
      <b>{name}</b>
      <small>BATTLE CARD</small>
    </div>
  );
}
function MineCard() {
  return (
    <div className="character-card mine-face">
      <Bomb />
      <b>
        DEPTHCHARGE
        <br />
        MINE
      </b>
      <small>10 Damage</small>
    </div>
  );
}

type RoomPlayer = { id: string; name: string; ready: boolean };
function MultiplayerLobby({
  onSolo,
  onStart,
}: {
  onSolo: () => void;
  onStart: (socket: Socket) => void;
}) {
  const [server, setServer] = useState(
      "https://hidden-front-server.onrender.com",
    ),
    [name, setName] = useState(""),
    [code, setCode] = useState(""),
    [message, setMessage] = useState(
      "Choose a name and room code, then connect.",
    ),
    [players, setPlayers] = useState<RoomPlayer[]>([]),
    [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<Socket | null>(null);
  const inRoom = players.length > 0;
  function join() {
    const url = server.trim().replace(/\/$/, "");
    if (!url || !code.trim()) {
      setMessage("Add the server address and a room code first.");
      return;
    }
    socket?.disconnect();
    const next = io(url, { transports: ["websocket"] });
    setSocket(next);
    next.on("connect", () => {
      setConnected(true);
      next.emit(
        "join-room",
        { name, code },
        (result: { ok: boolean; error?: string }) =>
          setMessage(
            result.ok
              ? "Room joined. Waiting for your opponent."
              : result.error || "Could not join room.",
          ),
      );
    });
    next.on("connect_error", () => {
      setConnected(false);
      setMessage(
        "Could not reach the server. Check the Render address and that deployment finished.",
      );
    });
    next.on(
      "room-state",
      (room: { players: RoomPlayer[]; started: boolean }) => {
        setPlayers(room.players);
        if (room.started)
          setMessage("Both players are ready. Opening deck building…");
      },
    );
    next.on("match-ready", () => onStart(next));
    next.on("disconnect", () => setConnected(false));
  }
  function ready() {
    socket?.emit("set-ready", true);
    setMessage("You are ready. Waiting for the other player.");
  }
  return (
    <section className="start-card multiplayer-lobby">
      <p className="eyebrow">ONLINE MULTIPLAYER</p>
      <h1>Battle a friend</h1>
      <p className="lead">
        Create a private room, then give the room code to one friend. The Render
        server keeps the room and both players connected.
      </p>
      <div className="setup-grid">
        <label>
          Render server address
          <input
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="https://hidden-front.onrender.com"
          />
        </label>
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Player name"
            maxLength={20}
          />
        </label>
        <label>
          Room code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="E.G. PRIME9"
            maxLength={12}
          />
        </label>
      </div>
      {inRoom ? (
        <div className="lobby-players">
          {players.map((player) => (
            <div key={player.id}>
              <b>{player.name}</b>
              <span>{player.ready ? "READY" : "CHOOSING DECK"}</span>
            </div>
          ))}
        </div>
      ) : null}
      <p className="lobby-message">{message}</p>
      <div className="lobby-actions">
        {!inRoom ? (
          <button className="primary" onClick={join}>
            Connect to room
          </button>
        ) : (
          <button className="primary" disabled={!connected} onClick={ready}>
            I am ready
          </button>
        )}
        <button className="ghost" onClick={onSolo}>
          Back to solo game
        </button>
      </div>
    </section>
  );
}

export default function Home() {
  const [phase, setPhase] = useState<Phase>("start"),
    [faction, setFaction] = useState<Faction>("Autobot"),
    [enemyFaction, setEnemyFaction] = useState<EnemyChoice>("Predacon"),
    [theme, setTheme] = useState("cybertron"),
    [cardBorder, setCardBorder] = useState("energon-edge"),
    [showFilterCounts, setShowFilterCounts] = useState(true);
  const [deck, setDeck] = useState<string[]>(
      starterDeck("Autobot").map((x) => x.id),
    ),
    [filter, setFilter] = useState("All"),
    [factionFilter, setFactionFilter] = useState<"All" | Faction>("All");
  const [board, setBoard] = useState<Slot[]>(Array(9).fill(null)),
    [enemyBoard, setEnemyBoard] = useState<Slot[]>(Array(9).fill(null)),
    [hand, setHand] = useState<Unit[]>([]),
    [backups, setBackups] = useState<Unit[]>([]),
    [enemyBackups, setEnemyBackups] = useState<Unit[]>([]);
  const [scrap, setScrap] = useState<Unit[]>([]),
    [enemyScrap, setEnemyScrap] = useState<Unit[]>([]),
    [enemyRoster, setEnemyRoster] = useState<Unit[]>([]),
    [battleHand, setBattleHand] = useState<string[]>([]),
    [drawPile, setDrawPile] = useState<string[]>([]);
  const [round, setRound] = useState(1),
    [actions, setActions] = useState(3),
    [repositions, setRepositions] = useState(2),
    [battlePlayed, setBattlePlayed] = useState(false),
    [usedAttacks, setUsedAttacks] = useState<string[]>([]),
    [usedAbilities, setUsedAbilities] = useState<string[]>([]);
  const [interaction, setInteraction] = useState<Interaction>(null),
    [dragSource, setDragSource] = useState<DragSource | null>(null),
    [revealed, setRevealed] = useState<number[]>([]),
    [traps, setTraps] = useState<number[]>([]),
    [armored, setArmored] = useState<string | null>(null),
    [faceOff, setFaceOff] = useState(false),
    [darkDamage, setDarkDamage] = useState<number | null>(null),
    [grimlockFrenzyRound, setGrimlockFrenzyRound] = useState<number | null>(
      null,
    ),
    [scoutBuff, setScoutBuff] = useState<string[]>([]),
    [enemyDefeatPending, setEnemyDefeatPending] = useState(false),
    [quietRounds, setQuietRounds] = useState(0),
    [roundDamage, setRoundDamage] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>({
      text: "Build your team and take command.",
      tone: "info",
      key: 0,
    }),
    [log, setLog] = useState<string[]>([]),
    [winner, setWinner] = useState(""),
    [multiplayerSocket, setMultiplayerSocket] = useState<Socket | null>(null),
    [hitSpaces, setHitSpaces] = useState<number[]>([]),
    [isMyTurn, setIsMyTurn] = useState(true),
    [activePlayerName, setActivePlayerName] = useState(""),
    [deckLocked, setDeckLocked] = useState(false),
    [repositionLocked, setRepositionLocked] = useState(false),
    [inspectedUnit, setInspectedUnit] = useState<CardInspection | null>(null);
  const [tacticianDisabledUntil, setTacticianDisabledUntil] = useState(0),
    [enemyConcealment, setEnemyConcealment] = useState<Concealment>(null),
    [friendlyConcealment, setFriendlyConcealment] = useState<Concealment>(null),
    [enemyBackupsRevealed, setEnemyBackupsRevealed] = useState(false);
  const [permanentRevealedIds, setPermanentRevealedIds] = useState<string[]>(
      [],
    ),
    [friendlyMines, setFriendlyMines] = useState<number[]>([]),
    [enemyMines, setEnemyMines] = useState<number[]>([]),
    [repositionBlockedUntil, setRepositionBlockedUntil] = useState(0);
  const [turnEndsAt, setTurnEndsAt] = useState(0),
    [turnDurationMs, setTurnDurationMs] = useState(60000),
    [turnRemainingMs, setTurnRemainingMs] = useState(0);
  const lastOnlineRound = useRef(0),
    deckAdvancedRef = useRef(false);
  const boardRef = useRef(board),
    backupsRef = useRef(backups),
    enemyBoardRef = useRef(enemyBoard);
  boardRef.current = board;
  backupsRef.current = backups;
  enemyBoardRef.current = enemyBoard;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("hidden-front-theme", theme);
  }, [theme]);
  useEffect(() => {
    const saved = localStorage.getItem("hidden-front-theme");
    if (saved && themes.some(([id]) => id === saved)) setTheme(saved);
    const savedBorder = localStorage.getItem("hidden-front-card-border");
    if (savedBorder && cardBorders.some(([id]) => id === savedBorder))
      setCardBorder(savedBorder);
    const savedCounts = localStorage.getItem("hidden-front-filter-counts");
    if (savedCounts !== null) setShowFilterCounts(savedCounts === "true");
  }, []);
  useEffect(() => {
    localStorage.setItem(
      "hidden-front-filter-counts",
      String(showFilterCounts),
    );
  }, [showFilterCounts]);
  useEffect(() => {
    localStorage.setItem("hidden-front-card-border", cardBorder);
  }, [cardBorder]);
  useEffect(() => {
    if (!turnEndsAt || !["combat", "reinforce", "reposition"].includes(phase))
      return;
    const update = () =>
      setTurnRemainingMs(Math.max(0, turnEndsAt - Date.now()));
    update();
    const timer = window.setInterval(update, 100);
    return () => window.clearInterval(timer);
  }, [turnEndsAt, phase]);
  useEffect(() => {
    if (
      multiplayerSocket &&
      (phase === "reinforce" || phase === "reposition") &&
      !repositionLocked
    )
      multiplayerSocket.emit("reposition-snapshot", { board, backups });
  }, [multiplayerSocket, phase, board, backups, repositionLocked]);
  useEffect(() => {
    if (
      multiplayerSocket &&
      (phase === "reinforce" || phase === "reposition") &&
      turnEndsAt > 0 &&
      turnRemainingMs <= 0
    ) {
      setRepositionLocked(true);
      setDragSource(null);
      setInteraction(null);
    }
  }, [multiplayerSocket, phase, turnEndsAt, turnRemainingMs]);
  useEffect(() => {
    if (!multiplayerSocket) return;
    const freshUnit = (value: string | Unit | null) => {
      if (!value) return null;
      const base =
        typeof value === "string"
          ? allUnits.find((unit) => unit.id === value)
          : value;
      return base
        ? {
            ...base,
            hp: base.hp ?? base.max,
            canAttack: base.canAttack ?? true,
            shield: base.shield ?? (base.id === "terror" ? 1 : 0),
          }
        : null;
    };
    const ready = (data: { opponent: string[] }) => {
      deckAdvancedRef.current = true;
      const roster = data.opponent
        .map(freshUnit)
        .filter((unit): unit is Unit => !!unit);
      setEnemyRoster(roster);
      setPhase("opponent");
      setDeckLocked(false);
      flash("Both decks are locked. The enemy team is now available.", "good");
    };
    const deployed = (data: {
      opponent: { board: (string | null)[]; backups: string[] };
    }) => {
      setEnemyBoard(applyBoardAuras(data.opponent.board.map(freshUnit)));
      setEnemyBackups(
        data.opponent.backups
          .map(freshUnit)
          .filter((unit): unit is Unit => !!unit),
      );
      setEnemyBackupsRevealed(false);
      setPhase("waiting");
      flash(
        "Both teams are deployed. The server is choosing who attacks first.",
        "good",
      );
    };
    const turn = (data: OnlineTurn) => {
      const newRound = data.round !== lastOnlineRound.current;
      if (newRound) {
        lastOnlineRound.current = data.round;
        setRound(data.round);
        setBoard((current) => expireTimedShields(current, data.round));
        setEnemyBoard((current) => expireTimedShields(current, data.round));
        setBattlePlayed(false);
        setUsedAttacks([]);
        setUsedAbilities([]);
        setRoundDamage(false);
        setRevealed([]);
        setHitSpaces([]);
        setRepositionLocked(false);
        if (data.round > 1)
          setDrawPile((pile) => {
            const amount = hasTarantulasDraw(
              boardRef.current,
              enemyBoardRef.current,
            )
              ? 2
              : 1;
            const cards = pile.slice(0, amount);
            if (cards.length) setBattleHand((hand) => [...hand, ...cards]);
            return pile.slice(cards.length);
          });
      }
      setIsMyTurn(data.yourTurn);
      setActivePlayerName(data.activeName);
      setActions(data.actions);
      setTurnEndsAt(data.turnEndsAt);
      setTurnDurationMs(data.turnDurationMs);
      setTurnRemainingMs(Math.max(0, data.turnEndsAt - Date.now()));
      setInteraction(null);
      setPhase("combat");
      flash(
        data.yourTurn
          ? `${data.activeName}, it is your attack turn. You have ${data.actions} actions and one minute.`
          : `${data.activeName} is attacking. Your controls are locked.`,
        data.yourTurn ? "good" : "info",
      );
    };
    const combat = (data: OnlineCombatAction) => {
      if (data.kind === "team-heal") {
        setEnemyBoard((current) =>
          healFaction(current, data.faction, data.amount),
        );
        setEnemyBackups((current) =>
          healFaction(current, data.faction, data.amount),
        );
        flash(
          `${data.actorName}'s Cyclonus healed every enemy Decepticon by ${data.amount}.`,
          "info",
        );
        return;
      }
      if (data.kind === "tactician-lock") {
        setTacticianDisabledUntil(data.untilRound);
        flash(
          `${data.actorName}'s Highbrow disabled your Tactician abilities through round ${data.untilRound}.`,
          "bad",
        );
        return;
      }
      if (data.kind === "conceal-spaces") {
        setEnemyConcealment({ spaces: data.spaces, until: data.untilRound });
        flash(
          `${data.actorName}'s Bludgeon concealed three enemy spaces from detection.`,
          "info",
        );
        return;
      }
      if (data.kind === "timed-shields") {
        setEnemyBoard((current) =>
          current.map((unit, index) =>
            unit && data.positions.includes(index)
              ? {
                  ...unit,
                  shield: (unit.shield ?? 0) + 1,
                  timedShield: true,
                  shieldUntil: data.untilRound,
                }
              : unit,
          ),
        );
        flash(
          `${data.actorName}'s Galvatron shielded two enemy characters.`,
          "info",
        );
        return;
      }
      if (data.kind === "reposition-lock") {
        setRepositionBlockedUntil(data.round);
        flash(
          `${data.actorName}'s Rattrap locked both teams out of this round's Reposition Phase.`,
          "info",
        );
        return;
      }
      if (data.kind === "revive") {
        setEnemyScrap((cards) =>
          cards.filter((card) => card.id !== data.unit.id),
        );
        setEnemyBackups((cards) =>
          cards.some((card) => card.id === data.unit.id)
            ? cards
            : [...cards, data.unit],
        );
        flash(
          `${data.actorName}'s Rhinox revived ${data.unit.name} at half Health.`,
          "info",
        );
        return;
      }
      if (data.kind === "mine-trigger") {
        setFriendlyMines((mines) =>
          mines.filter((position) => position !== data.target),
        );
        setEnemyBoard((current) =>
          applyBoardAuras(
            current.map((unit, index) =>
              index === data.attackerPosition ? data.attackerResult : unit,
            ),
          ),
        );
        if (data.defeatedAttacker)
          setEnemyScrap((cards) =>
            cards.some((card) => card.id === data.defeatedAttacker!.id)
              ? cards
              : [...cards, data.defeatedAttacker!],
          );
        flash(
          data.defeatedAttacker
            ? `Your Depthcharge mine defeated ${data.defeatedAttacker.name}.`
            : `Your Depthcharge mine hit the attacking enemy for 10 Damage.`,
          "good",
        );
        return;
      }
      if (data.revealedAttackerId)
        setPermanentRevealedIds((ids) => [
          ...new Set([...ids, data.revealedAttackerId!]),
        ]);
      setHitSpaces((spaces) => [...new Set([...spaces, data.target])]);
      if (!data.hit) {
        flash(
          `${data.actorName} attacked your empty position ${data.target + 1}.`,
          "good",
        );
        return;
      }
      setRoundDamage(true);
      setBoard((current) => {
        if (data.defeated && shouldLayDepthchargeMine(current, data.defeated))
          setFriendlyMines([data.target]);
        let next = applyBoardAuras(
          current.map((unit, index) =>
            index === data.target ? data.result : unit,
          ),
        );
        if (data.defeated)
          next = applyBoardAuras(healTransmetalTarantulas(next, data.defeated));
        if (next.filter(Boolean).length + backupsRef.current.length === 0) {
          setWinner("Defeat — every character on your team has been defeated.");
          setPhase("over");
        }
        return next;
      });
      if (data.defeated)
        setScrap((cards) =>
          cards.some((card) => card.id === data.defeated!.id)
            ? cards
            : [...cards, data.defeated!],
        );
      if (data.defeated)
        setBackups((cards) => healTransmetalTarantulas(cards, data.defeated));
      flash(
        data.defeated
          ? `${data.actorName} defeated ${data.defeated.name} at position ${data.target + 1}.`
          : `${data.actorName} hit your card at position ${data.target + 1} for ${data.damage}.`,
        "bad",
      );
    };
    const repositionStart = (data: OnlineReposition) => {
      const moves = data.moves ?? 2,
        endsAt = data.repositionEndsAt || Date.now() + 30000,
        duration = data.repositionDurationMs || 30000;
      setIsMyTurn(false);
      setActivePlayerName("");
      setActions(0);
      setTurnEndsAt(endsAt);
      setTurnDurationMs(duration);
      setTurnRemainingMs(Math.max(0, endsAt - Date.now()));
      setRepositions(moves);
      setRepositionLocked(false);
      setInteraction(null);
      setDragSource(null);
      multiplayerSocket.emit("reposition-snapshot", {
        board: boardRef.current,
        backups: backupsRef.current,
      });
      const needed = Math.min(
        Math.max(0, 6 - boardRef.current.filter(Boolean).length),
        backupsRef.current.length,
      );
      setPhase(needed > 0 ? "reinforce" : "reposition");
      flash(
        needed > 0
          ? `Both attack turns are complete. Deploy ${needed} free reinforcement${needed === 1 ? "" : "s"}. You have 30 seconds.`
          : data.locked
            ? "Rattrap blocked repositioning this round. Lock in before the 30-second timer ends."
            : "Both attack turns are complete. You have 30 seconds to reposition your cards.",
        "info",
      );
    };
    const repositioned = (data: { opponent: OnlineDeployment }) => {
      setEnemyBoard(data.opponent.board.map(freshUnit));
      setEnemyBackups(
        data.opponent.backups
          .map(freshUnit)
          .filter((unit): unit is Unit => !!unit),
      );
    };
    const status = (text: string) => flash(text, "info");
    const left = () => {
      setIsMyTurn(false);
      setPhase("waiting");
      flash("Your opponent disconnected from the room.", "bad");
    };
    const opponentForfeited = () => {
      setIsMyTurn(false);
      setTurnEndsAt(0);
      setWinner("Victory — your opponent forfeited the match.");
      setPhase("over");
      flash("Your opponent forfeited. You win!", "good");
    };
    multiplayerSocket.on("decks-ready", ready);
    multiplayerSocket.on("deployments-ready", deployed);
    multiplayerSocket.on("turn-state", turn);
    multiplayerSocket.on("combat-action", combat);
    multiplayerSocket.on("reposition-start", repositionStart);
    multiplayerSocket.on("opponent-repositioned", repositioned);
    multiplayerSocket.on("match-status", status);
    multiplayerSocket.on("opponent-left", left);
    multiplayerSocket.on("opponent-forfeited", opponentForfeited);
    return () => {
      multiplayerSocket.off("decks-ready", ready);
      multiplayerSocket.off("deployments-ready", deployed);
      multiplayerSocket.off("turn-state", turn);
      multiplayerSocket.off("combat-action", combat);
      multiplayerSocket.off("reposition-start", repositionStart);
      multiplayerSocket.off("opponent-repositioned", repositioned);
      multiplayerSocket.off("match-status", status);
      multiplayerSocket.off("opponent-left", left);
      multiplayerSocket.off("opponent-forfeited", opponentForfeited);
    };
  }, [multiplayerSocket]);
  const built = useMemo(
    () => deck.map((id) => allUnits.find((x) => x.id === id)!).filter(Boolean),
    [deck],
  );
  const count = (role: string) => built.filter((x) => x.role === role).length,
    legal = validateDeck(built),
    playerLeft = board.filter(Boolean).length + backups.length + hand.length,
    enemyLeft = enemyBoard.filter(Boolean).length + enemyBackups.length,
    reinforcementsNeeded = Math.min(
      Math.max(0, 6 - board.filter(Boolean).length),
      backups.length,
    );
  const classRequirements =
    deck.includes("barrage") && count("Commander") === 3
      ? { Commander: 3, Scout: 2, Trooper: 2, Tactician: 2 }
      : { Commander: 2, Scout: 3, Trooper: 2, Tactician: 2 };
  const flash = (text: string, tone: Feedback["tone"] = "info") => {
    setFeedback({ text, tone, key: Date.now() });
    setLog((v) => [text, ...v]);
  };
  const mutateUnit = (list: Slot[], index: number, unit: Unit | null) =>
    list.map((x, i) => (i === index ? unit : x));
  const onlineLocked = Boolean(
    multiplayerSocket && (!isMyTurn || turnRemainingMs <= 0),
  );
  const abilityKey = (u: Unit) => u.copiedCommanderId || u.id;
  const hasAbility = (u: Unit | null | undefined, id: string) =>
    !!u && abilityKey(u) === id;
  const displayedAbility = (u: Unit) =>
    u.copiedCommanderId
      ? `Copied from ${allUnits.find((unit) => unit.id === u.copiedCommanderId)?.name || "Commander"}: ${allUnits.find((unit) => unit.id === u.copiedCommanderId)?.ability || u.ability}`
      : u.ability;
  const abilityReady = (u: Unit) =>
    !onlineLocked &&
    activeAbilities.has(abilityKey(u)) &&
    u.abilityUses > 0 &&
    !usedAbilities.includes(u.id) &&
    !usedAttacks.includes(u.id) &&
    actions > 0 &&
    !(u.role === "Tactician" && round <= tacticianDisabledUntil) &&
    (abilityKey(u) !== "head" || u.hp === u.max);
  const battleWindow =
    !onlineLocked &&
    canPlayBattleCard({
      phase,
      actionsLeft: actions,
      battleCardPlayed: battlePlayed,
    });
  function spendAction() {
    setActions((v) => Math.max(0, v - 1));
    setBattlePlayed(true);
    setInteraction(null);
  }
  function removeBattleCard(index: number, pair = false) {
    setBattleHand((v) => {
      if (!pair) return v.filter((_, i) => i !== index);
      let removed = 0,
        name = v[index];
      return v.filter((x) => x !== name || removed++ >= 2);
    });
  }
  function drawCards(n: number) {
    const cards = drawPile.slice(0, n);
    setBattleHand((v) => [...v, ...cards]);
    setDrawPile((v) => v.slice(cards.length));
    return cards.length;
  }
  function expireTimedShields(slots: Slot[], currentRound: number) {
    return slots.map((unit) =>
      unit?.timedShield &&
      unit.shieldUntil !== undefined &&
      unit.shieldUntil < currentRound
        ? {
            ...unit,
            shield: Math.max(0, (unit.shield ?? 0) - 1),
            timedShield: false,
            shieldUntil: undefined,
          }
        : unit,
    );
  }
  function detectionProtected(
    unit: Unit,
    index: number,
    source: "ability" | "battle" = "ability",
    actorFaction?: Faction,
  ) {
    const bludgeonHidden =
        !!enemyConcealment &&
        round <= enemyConcealment.until &&
        enemyConcealment.spaces.includes(index),
      laserbeakActive = enemyBoard.some((card) => card?.id === "laserbeak");
    const lioConvoyProtected =
      unit.id === "lio-convoy" && isFullFactionTeam(enemyRoster, "Maximal");
    return (
      unit.id === "wheelie" ||
      lioConvoyProtected ||
      bludgeonHidden ||
      (laserbeakActive &&
        (unit.id === "megatron" || unit.id === "soundwave")) ||
      (source === "battle" && unit.id === "tigatron") ||
      (source === "ability" &&
        actorFaction === "Predacon" &&
        unit.id === "silverbolt")
    );
  }
  function healWeakest(factionName: Faction, amount: number) {
    setBoard((v) => {
      const candidates = v
        .map((u, i) => ({ u, i }))
        .filter(
          (x): x is { u: Unit; i: number } =>
            !!x.u && x.u.faction === factionName && x.u.hp < x.u.max,
        )
        .sort((a, b) => a.u.hp - a.u.max - (b.u.hp - b.u.max));
      if (!candidates.length) return v;
      const chosen = candidates[0];
      flash(
        `${chosen.u.name} healed ${amount} Health from a triggered ability.`,
        "good",
      );
      return v.map((u, i) =>
        i === chosen.i && u ? { ...u, hp: Math.min(u.max, u.hp + amount) } : u,
      );
    });
  }

  function prepareOpponent() {
    if (multiplayerSocket) {
      deckAdvancedRef.current = false;
      setDeckLocked(true);
      flash("Sending your deck to the server…", "info");
      multiplayerSocket
        .timeout(8000)
        .emit(
          "submit-deck",
          deck,
          (error: Error | null, response?: DeckSubmitResponse) => {
            if (deckAdvancedRef.current) return;
            if (error) {
              setDeckLocked(false);
              flash(
                "Render did not confirm your deck. Press Lock in deck again after the latest server deployment is Live.",
                "bad",
              );
              return;
            }
            if (!response?.ok) {
              setDeckLocked(false);
              flash(
                response?.error ||
                  "The server rejected your deck. Please try again.",
                "bad",
              );
              return;
            }
            flash(
              response.waiting
                ? "Deck confirmed. Waiting for your opponent to lock their deck."
                : "Both decks confirmed. Opening the enemy-team preview…",
              response.waiting ? "info" : "good",
            );
          },
        );
      return;
    }
    const roster = (
      enemyFaction === "Random" ? randomEnemyDeck() : enemyDeck(enemyFaction)
    ).map((unit) => ({
      ...unit,
      hp: unit.max,
      canAttack: true,
      shield: unit.id === "terror" ? 1 : 0,
    }));
    setEnemyRoster(roster);
    setEnemyScrap([]);
    setPhase("opponent");
  }
  function beginDeployment() {
    const chosenDeck = built.map((x) => ({
        ...x,
        hp: x.max,
        canAttack: true,
        shield: x.id === "terror" ? 1 : 0,
      })),
      enemy = shuffled(enemyRoster.map((unit) => ({ ...unit })));
    const enemySlots = shuffled([0, 1, 2, 3, 4, 5, 6, 7, 8]).slice(0, 6),
      eBoard: Slot[] = Array(9).fill(null);
    if (!multiplayerSocket)
      enemySlots.forEach((slot, i) => (eBoard[slot] = enemy[i]));
    setBoard(Array(9).fill(null));
    setHand(chosenDeck);
    setBackups([]);
    setEnemyBoard(eBoard);
    setEnemyBackups(multiplayerSocket ? [] : enemy.slice(6));
    setScrap([]);
    setLog([]);
    setRound(1);
    setRevealed([]);
    setPermanentRevealedIds([]);
    setHitSpaces([]);
    setTraps([]);
    setFriendlyMines([]);
    setEnemyMines([]);
    setRepositionBlockedUntil(0);
    setTurnEndsAt(0);
    setTurnRemainingMs(0);
    setDragSource(null);
    setInteraction(null);
    setTacticianDisabledUntil(0);
    setEnemyConcealment(null);
    setFriendlyConcealment(null);
    setEnemyBackupsRevealed(false);
    flash(
      "Choose any six of your nine characters and place them on your grid.",
    );
    setPhase("deploy");
  }
  function placeFromHand(handIndex: number, slot: number) {
    if (phase !== "deploy") return;
    const unit = hand[handIndex],
      outgoing = board[slot];
    if (!unit) return;
    if (!outgoing && board.filter(Boolean).length >= 6) {
      flash(
        "Only six characters may be deployed. The other three become Backups.",
        "bad",
      );
      return;
    }
    setBoard(mutateUnit(board, slot, unit));
    setHand((v) =>
      outgoing
        ? v.map((x, i) => (i === handIndex ? outgoing : x))
        : v.filter((_, i) => i !== handIndex),
    );
    setDragSource(null);
    flash(
      outgoing
        ? `${unit.name} replaced ${outgoing.name} at position ${slot + 1}.`
        : `${unit.name} deployed to position ${slot + 1}.`,
      "good",
    );
  }
  function returnDeploymentCard(index: number) {
    const unit = board[index];
    if (phase !== "deploy" || !unit) return;
    setBoard(mutateUnit(board, index, null));
    setHand((v) => [...v, unit]);
    setDragSource(null);
    flash(`${unit.name} returned to your nine-card selection.`);
  }
  function startCombat() {
    if (hand.length !== 3 || board.filter(Boolean).length !== 6) return;
    const pile = makeBattleDeck(),
      deployed = applyBoardAuras(board);
    setBackups(hand);
    setHand([]);
    setBoard(deployed);
    setEnemyBoard((v) => applyBoardAuras(v));
    const openingDraw = hasTarantulasDraw(deployed, enemyBoard) ? 2 : 1;
    setBattleHand(pile.slice(0, openingDraw));
    setDrawPile(pile.slice(openingDraw));
    setActions(3);
    setBattlePlayed(false);
    setUsedAttacks([]);
    setUsedAbilities([]);
    if (multiplayerSocket) {
      multiplayerSocket.emit("submit-deployment", {
        board: deployed.map((unit) => unit?.id ?? null),
        backups: hand.map((unit) => unit.id),
      });
      setPhase("waiting");
      flash(
        "Your starting six are locked. Waiting for the other player to deploy.",
        "info",
      );
      return;
    }
    setPhase("combat");
    flash(
      `Round 1. Your three unplaced characters became Backups; ${openingDraw} Battle Card${openingDraw === 1 ? "" : "s"} drawn and the Battle Card window is open.`,
      "good",
    );
  }
  function effectiveDamage(unit: Unit) {
    let dmg = unit.dmg;
    const bee = board.some((x) => x?.id === "bee"),
      autobotCommander = board.some(
        (x) => x?.faction === "Autobot" && x.role === "Commander",
      );
    if (
      bee &&
      autobotCommander &&
      (unit.id === "bee" ||
        (unit.faction === "Autobot" && unit.role === "Commander"))
    )
      dmg += 5;
    if (scoutBuff.includes(unit.id)) dmg += 5;
    return dmg;
  }
  function selectAttacker(index: number) {
    const u = board[index];
    if (phase !== "combat" || !u || !u.canAttack || actions === 0) return;
    if (interaction?.kind === "attack" && interaction.actor === index) {
      setInteraction(null);
      flash(`${u.name} deselected.`);
      return;
    }
    if (usedAbilities.includes(u.id)) {
      flash(
        `${u.name} already used an ability instead of attacking this round.`,
        "bad",
      );
      return;
    }
    const times = usedAttacks.filter((id) => id === u.id).length,
      limit = attackLimit({
        unit: u,
        board,
        deck: built,
        grimlockFrenzyRound,
        round,
      });
    if (times >= limit) {
      flash(
        `${u.name} has already used every permitted attack this round.`,
        "bad",
      );
      return;
    }
    setInteraction({ kind: "attack", actor: index });
    flash(`${u.name} selected. Choose an enemy position.`);
  }
  function defeatEnemy(index: number, unit: Unit, next: Slot[]) {
    if (
      unit.faction === "Maximal" &&
      next.some((card) => hasAbility(card, "depthcharge"))
    ) {
      setEnemyMines([index]);
      flash(
        `A hidden Depthcharge mine was left at enemy position ${index + 1}.`,
        "info",
      );
    }
    setEnemyScrap((v) => [...v, unit]);
    setEnemyBackups((cards) => healTransmetalTarantulas(cards, unit));
    setEnemyDefeatPending(true);
    next[index] = null;
    next.splice(
      0,
      next.length,
      ...applyBoardAuras(healTransmetalTarantulas(next, unit)),
    );
    flash(
      `Enemy defeated at position ${index + 1}: ${unit.name} revealed.`,
      "good",
    );
    if (enemyBackups.length === 0 && next.filter(Boolean).length === 0) {
      setWinner("Victory — every enemy character has been defeated.");
      setPhase("over");
    }
  }
  function resolveAttack(index: number) {
    if (
      interaction?.kind !== "attack" ||
      interaction.actor === undefined ||
      onlineLocked
    )
      return;
    const attacker = board[interaction.actor];
    if (!attacker) return;
    if (enemyMines.includes(index)) {
      const mineHit = applyDamage(attacker, 10).unit,
        defeatedAttacker = mineHit.hp === 0 ? attacker : undefined;
      setEnemyMines((mines) => mines.filter((position) => position !== index));
      setBoard((current) =>
        applyBoardAuras(
          current.map((unit, position) =>
            position === interaction.actor
              ? defeatedAttacker
                ? null
                : mineHit
              : unit,
          ),
        ),
      );
      setHitSpaces((spaces) => [...new Set([...spaces, interaction.actor!])]);
      if (defeatedAttacker) setScrap((cards) => [...cards, defeatedAttacker]);
      setRevealed((spaces) => [...new Set([...spaces, index])]);
      multiplayerSocket?.emit("combat-action", {
        kind: "mine-trigger",
        target: index,
        attackerPosition: interaction.actor,
        attackerResult: defeatedAttacker ? null : mineHit,
        defeatedAttacker,
      });
      setUsedAttacks((v) => [...v, attacker.id]);
      setDarkDamage(null);
      flash(
        defeatedAttacker
          ? `${attacker.name} triggered a Depthcharge mine and was defeated.`
          : `${attacker.name} triggered a Depthcharge mine and took 10 Damage.`,
        "bad",
      );
      spendAction();
      return;
    }
    const dmg = darkDamage ?? effectiveDamage(attacker),
      next = enemyBoard.map((unit, position) =>
        unit?.id === "dinobot" && position !== index
          ? { ...unit, dinobotHitStreak: 0 }
          : unit,
      ),
      target = next[index];
    setRevealed((v) => [...new Set([...v, index])]);
    let networkResult: Unit | null = null,
      networkDamage = 0,
      defeated: Unit | undefined,
      revealedAttackerId: string | undefined;
    if (target) {
      const result = applyCharacterAttackDamage(target, dmg, 0);
      next[index] = result.unit;
      networkResult = result.unit;
      networkDamage = result.damage;
      if (result.blocked)
        flash(
          `Position ${index + 1} is occupied. The unknown enemy's shield blocked the attack.`,
          "bad",
        );
      else {
        setRoundDamage(true);
        if (faceOff) {
          drawCards(1);
          setFaceOff(false);
          flash(
            "Face Off triggered: the attack hit and drew a Battle Card.",
            "good",
          );
        }
        if (result.restored)
          flash(
            `The unknown enemy restored itself to full Health after the second consecutive attack. Position ${index + 1} remains occupied.`,
            "bad",
          );
        else if (result.unit.hp === 0) {
          defeated = target;
          revealedAttackerId =
            target.id === "cheetor" ? attacker.id : undefined;
          networkResult = null;
          defeatEnemy(index, target, next);
          if (hasAbility(attacker, "megatron") && target.faction === "Autobot")
            healWeakest("Decepticon", 10);
          if (
            hasAbility(attacker, "grimlock") &&
            target.role === "Commander" &&
            attacker.abilityUses > 0
          ) {
            setGrimlockFrenzyRound(round + 1);
            setBoard((v) =>
              v.map((u, i) =>
                i === interaction.actor && u
                  ? { ...u, abilityUses: u.abilityUses - 1 }
                  : u,
              ),
            );
            flash(
              `${attacker.name} copied Grimlock's frenzy and may use all 3 attacks next round!`,
              "good",
            );
          }
        } else
          flash(
            `${hiddenAttackMessage({ attackerName: attacker.name, target: index, damage: result.damage, hit: true })} Position ${index + 1} is marked occupied until the round ends.`,
            "good",
          );
      }
    } else
      flash(
        hiddenAttackMessage({
          attackerName: attacker.name,
          target: index,
          damage: dmg,
          hit: false,
        }),
        "bad",
      );
    const updatedEnemy = applyBoardAuras(next);
    setEnemyBoard(updatedEnemy);
    if (target && !defeated) networkResult = updatedEnemy[index];
    multiplayerSocket?.emit("combat-action", {
      kind: "attack",
      target: index,
      hit: !!target,
      damage: networkDamage,
      result: networkResult,
      defeated,
      attackerName: attacker.name,
      revealedAttackerId,
    });
    const previous = usedAttacks.filter((id) => id === attacker.id).length;
    setUsedAttacks((v) => [...v, attacker.id]);
    if (attacker.id === "sun" && previous === 1)
      setBoard((v) =>
        v.map((u, i) =>
          i === interaction.actor && u
            ? { ...u, abilityUses: Math.max(0, u.abilityUses - 1) }
            : u,
        ),
      );
    setScoutBuff((v) => v.filter((id) => id !== attacker.id));
    setDarkDamage(null);
    spendAction();
  }

  function activateAbility(index: number) {
    const u = board[index];
    if (!u || !abilityReady(u)) return;
    const key = abilityKey(u);
    if (targetAbility.has(key)) {
      setInteraction({ kind: "ability", actor: index });
      flash(`${u.name}'s ability ready. Choose an enemy position.`);
      return;
    }
    if (key === "getaway") {
      setInteraction({ kind: "getaway", actor: index });
      flash(
        "Choose one of your deployed Commanders. Getaway will copy that ability.",
      );
      return;
    }
    if (key === "bludgeon") {
      setInteraction({ kind: "bludgeon", actor: index, picks: [] });
      flash("Choose the first of 3 friendly spaces to conceal from detection.");
      return;
    }
    if (key === "wheeljack") {
      setScoutBuff(
        board
          .filter((x): x is Unit => !!x && x.role === "Scout")
          .map((x) => x.id),
      );
      flash("Wheeljack empowered every deployed Scout's next attack.", "good");
    } else if (key === "soundwave") {
      if (!board.some((x) => x?.id === "megatron")) {
        flash("Soundwave requires Megatron on the board.", "bad");
        return;
      }
      flash(`Soundwave drew ${drawCards(3)} Battle Cards.`, "good");
    } else if (key === "overlord") {
      if (battleHand.length < 4) {
        flash("Overlord requires 4 Battle Cards to scrap.", "bad");
        return;
      }
      setBattleHand((v) => v.slice(4));
      setBoard((v) =>
        v.map((x, i) => (i === index && x ? { ...x, dmg: 20 } : x)),
      );
      flash(
        `${u.name} scrapped 4 Battle Cards and permanently reached 20 Damage.`,
        "good",
      );
    } else if (key === "pmega") {
      const fixed = new Set(
          enemyBoard
            .map((card, i) => (card && isPredaconAbilityImmune(card) ? i : -1))
            .filter((i) => i >= 0),
        ),
        movable = shuffled(enemyBoard.filter((_, i) => !fixed.has(i)));
      let cursor = 0;
      setEnemyBoard(
        enemyBoard.map((card, i) => (fixed.has(i) ? card : movable[cursor++])),
      );
      setRevealed([]);
      flash(
        `${u.name} reordered every vulnerable enemy position. Silverbolt remained fixed.`,
        "good",
      );
    } else if (key === "wasp") {
      const scouts = enemyBoard
        .map((x, i) =>
          x?.role === "Scout" &&
          !detectionProtected(x, i, "ability", "Predacon")
            ? i
            : -1,
        )
        .filter((i) => i >= 0);
      setRevealed((v) => [...new Set([...v, ...scouts])]);
      flash(
        scouts.length
          ? "Waspinator revealed every detectable enemy Scout position."
          : "Every enemy Scout is protected from detection.",
        scouts.length ? "good" : "bad",
      );
    } else if (key === "razor") {
      if (!backups.length) {
        flash("Razorclaw has no Backup to combine with.", "bad");
        return;
      }
      setBackups((v) => shuffled(v));
      setInteraction({ kind: "razor", actor: index });
      flash(
        `${u.name} shuffled the Backups face down. Choose one without knowing which character it is.`,
      );
      return;
    } else if (key === "grapple") {
      const amount = backups.filter(
        (card) => card.faction === "Autobot",
      ).length;
      if (!amount) {
        flash(
          "Grapple needs at least one Autobot in Backup before using this ability.",
          "bad",
        );
        return;
      }
      flash(
        `Grapple drew ${drawCards(amount)} Battle Card${amount === 1 ? "" : "s"} for the Autobots in Backup.`,
        "good",
      );
    } else if (key === "highbrow") {
      const untilRound = round + 2;
      multiplayerSocket?.emit("combat-action", {
        kind: "tactician-lock",
        untilRound,
      });
      flash(
        `Highbrow disabled enemy Tactician abilities through round ${untilRound}.`,
        "good",
      );
    } else if (key === "hoist") {
      if (!battleHand.length) {
        flash("Hoist needs at least one Battle Card to replace.", "bad");
        return;
      }
      const replacements = makeBattleDeck().slice(0, battleHand.length);
      setBattleHand(replacements);
      flash(
        `Hoist replaced all ${replacements.length} Battle Cards with random ones.`,
        "good",
      );
    } else if (key === "jhiaxus") {
      setEnemyBackupsRevealed(true);
      flash(
        `Jhiaxus revealed ${enemyBackups.length} enemy Backup character${enemyBackups.length === 1 ? "" : "s"}.`,
        "good",
      );
    } else if (key === "rumble") {
      if (!board.some((card) => card?.id === "frenzy")) {
        flash("Rumble requires Frenzy on the board.", "bad");
        return;
      }
      flash(`Rumble drew ${drawCards(1)} Battle Card.`, "good");
    } else if (key === "rattrap") {
      setRepositionBlockedUntil(round);
      multiplayerSocket?.emit("combat-action", {
        kind: "reposition-lock",
        round,
      });
      flash(
        "Rattrap locked both teams out of repositioning this round.",
        "good",
      );
    } else if (key === "rhinox") {
      if (!canRhinoxRevive(u, scrap)) {
        flash(
          "Rhinox must be above half Health and needs a defeated Maximal to revive.",
          "bad",
        );
        return;
      }
      setInteraction({ kind: "rhinox", actor: index });
      flash("Choose a defeated Maximal to revive at half Health.");
      return;
    } else if (key === "cyclonus") {
      setBoard((current) => healFaction(current, "Decepticon", 5));
      setBackups((current) => healFaction(current, "Decepticon", 5));
      multiplayerSocket?.emit("combat-action", {
        kind: "team-heal",
        faction: "Decepticon",
        amount: 5,
      });
      flash("Cyclonus healed every Decepticon on your team by 5.", "good");
    }
    setBoard((v) =>
      v.map((x, i) =>
        i === index && x ? { ...x, abilityUses: x.abilityUses - 1 } : x,
      ),
    );
    setUsedAbilities((v) => [...v, u.id]);
    spendAction();
  }
  function resolveGetaway(index: number) {
    if (interaction?.kind !== "getaway" || interaction.actor === undefined)
      return;
    const actor = board[interaction.actor],
      commander = board[index];
    if (!actor || !commander || commander.role !== "Commander") {
      flash("Getaway must copy one of your deployed Commander cards.", "bad");
      return;
    }
    setBoard((current) =>
      applyBoardAuras(
        current.map((unit, i) =>
          i === interaction.actor && unit
            ? { ...unit, copiedCommanderId: commander.id, abilityUses: 1 }
            : unit,
        ),
      ),
    );
    setUsedAbilities((current) => [...current, actor.id]);
    flash(
      `Getaway copied ${commander.name}'s ability for the rest of this battle.`,
      "good",
    );
    spendAction();
  }
  function resolveRhinox(unitId: string) {
    if (interaction?.kind !== "rhinox" || interaction.actor === undefined)
      return;
    const actor = board[interaction.actor],
      fallen = scrap.find((unit) => unit.id === unitId);
    if (!actor || !fallen || fallen.faction !== "Maximal") return;
    const revived = reviveAtHalf(fallen);
    setScrap((cards) => cards.filter((unit) => unit.id !== unitId));
    setBackups((cards) => [...cards, revived]);
    setBoard((current) =>
      current.map((unit, index) =>
        index === interaction.actor && unit
          ? { ...unit, abilityUses: Math.max(0, unit.abilityUses - 1) }
          : unit,
      ),
    );
    setUsedAbilities((current) => [...current, actor.id]);
    multiplayerSocket?.emit("combat-action", { kind: "revive", unit: revived });
    flash(
      `${actor.name} revived ${fallen.name} at half Health and moved them to Backups.`,
      "good",
    );
    spendAction();
  }
  function resolveBludgeon(index: number) {
    if (interaction?.kind !== "bludgeon" || interaction.actor === undefined)
      return;
    if (interaction.picks?.includes(index)) {
      flash("Choose 3 different spaces.", "bad");
      return;
    }
    const picks = [...(interaction.picks || []), index];
    if (picks.length < 3) {
      setInteraction({ ...interaction, picks });
      flash(`Space ${index + 1} selected. Choose ${3 - picks.length} more.`);
      return;
    }
    const actor = board[interaction.actor],
      until = round + 1;
    if (!actor) return;
    setFriendlyConcealment({ spaces: picks, until });
    setBoard((current) =>
      current.map((unit, i) =>
        i === interaction.actor && unit
          ? { ...unit, abilityUses: Math.max(0, unit.abilityUses - 1) }
          : unit,
      ),
    );
    setUsedAbilities((current) => [...current, actor.id]);
    multiplayerSocket?.emit("combat-action", {
      kind: "conceal-spaces",
      spaces: picks,
      untilRound: until,
    });
    flash(
      `Bludgeon concealed spaces ${picks.map((value) => value + 1).join(", ")} through round ${until}.`,
      "good",
    );
    spendAction();
  }
  function resolveGalvatron(index: number) {
    if (interaction?.kind !== "galvatron" || interaction.actor === undefined)
      return;
    const target = board[index];
    if (!target) {
      flash("Galvatron must shield a deployed character.", "bad");
      return;
    }
    if (interaction.picks?.includes(index)) {
      flash("Choose 2 different characters.", "bad");
      return;
    }
    const picks = [...(interaction.picks || []), index];
    if (picks.length < 2) {
      setInteraction({ ...interaction, picks });
      flash(`${target.name} selected. Choose 1 more deployed character.`);
      return;
    }
    const galvatron = backups[interaction.actor],
      until = round + 1;
    if (!galvatron) return;
    setBoard((current) =>
      current.map((unit, i) =>
        unit && picks.includes(i)
          ? {
              ...unit,
              shield: (unit.shield ?? 0) + 1,
              timedShield: true,
              shieldUntil: until,
            }
          : unit,
      ),
    );
    setBackups((current) =>
      current.map((unit, i) =>
        i === interaction.actor
          ? { ...unit, abilityUses: Math.max(0, unit.abilityUses - 1) }
          : unit,
      ),
    );
    setUsedAbilities((current) => [...current, galvatron.id]);
    multiplayerSocket?.emit("combat-action", {
      kind: "timed-shields",
      positions: picks,
      untilRound: until,
    });
    flash(
      `Galvatron shielded positions ${picks.map((value) => value + 1).join(" and ")} through round ${until}.`,
      "good",
    );
    spendAction();
  }
  function resolveAbilityTarget(index: number) {
    if (interaction?.kind !== "ability" || interaction.actor === undefined)
      return;
    const actor = board[interaction.actor],
      target = enemyBoard[index],
      next = [...enemyBoard];
    if (!actor) return;
    const key = abilityKey(actor),
      predaconProtected =
        !!target &&
        actor.faction === "Predacon" &&
        isPredaconAbilityImmune(target);
    if (target && !predaconProtected)
      setRevealed((v) => [...new Set([...v, index])]);
    if (key === "shockwave" && target) {
      const r = applyDamage(target, 30);
      next[index] = r.unit;
      if (r.unit.hp === 0) defeatEnemy(index, target, next);
      else
        flash(
          `Shockwave dealt 30 damage. Position ${index + 1} is occupied.`,
          "good",
        );
      setRoundDamage(true);
    } else if (key === "bombshell" && target) {
      const r = applyDamage(target, target.dmg);
      next[index] = r.unit;
      if (r.unit.hp === 0) defeatEnemy(index, target, next);
      else
        flash(
          `Bombshell forced the unknown enemy to deal itself ${target.dmg} damage.`,
          "good",
        );
      setRoundDamage(true);
    } else if (key === "head") {
      if (predaconProtected)
        flash("Silverbolt is immune to Headstrong's Predacon ability.", "bad");
      else if (target) {
        next[index] = null;
        setEnemyScrap((v) => [...v, target]);
        setBoard((v) => v.map((x, i) => (i === interaction.actor ? null : x)));
        setScrap((v) => [...v, actor]);
        setEnemyDefeatPending(true);
        flash(`Headstrong and ${target.name} destroyed one another.`, "good");
      } else
        flash(
          "Headstrong chose an empty position and survived; the use is spent.",
          "bad",
        );
    } else if (key === "arachnia") {
      const row = Math.floor(index / 3);
      next.forEach((x, i) => {
        if (x && Math.floor(i / 3) === row && !isPredaconAbilityImmune(x))
          next[i] = { ...x, poison: 3 };
      });
      flash(
        `Black Arachnia poisoned vulnerable cards in enemy row ${row + 1} for 3 rounds.`,
        "good",
      );
    } else if (key === "eject") {
      if (target?.role === "Scout") {
        next[index] = actor;
        setBoard((v) =>
          v.map((x, i) => (i === interaction.actor ? target : x)),
        );
        setEnemyRoster((v) =>
          v.map((unit) => (unit.id === target.id ? actor : unit)),
        );
        flash(
          `Eject successfully exchanged teams with ${target.name}.`,
          "good",
        );
      } else flash("Eject did not find a Scout in that position.", "bad");
    }
    setEnemyBoard(next);
    setBoard((v) =>
      v.map((x, i) =>
        i === interaction.actor && x
          ? { ...x, abilityUses: Math.max(0, x.abilityUses - 1) }
          : x,
      ),
    );
    setUsedAbilities((v) => (actor ? [...v, actor.id] : v));
    spendAction();
  }

  function spendBattle(name: string, index: number, pair = false) {
    removeBattleCard(index, pair);
    setBattlePlayed(true);
    setActions((v) => Math.max(0, v - 1));
    setInteraction(null);
  }
  function playBattleCard(name: string, index: number) {
    if (interaction?.cardIndex === index) {
      setInteraction(null);
      flash(`${name} deselected.`);
      return;
    }
    if (!battleWindow) return;
    if (
      name === "Dark Reflections" &&
      battleHand.filter((x) => x === name).length < 2
    ) {
      flash("Dark Reflections requires two copies.", "bad");
      return;
    }
    if (name === "2 For The Price Of 1" && !enemyDefeatPending) {
      flash(
        "This card requires an enemy defeated in the previous combat.",
        "bad",
      );
      return;
    }
    if (["Roll Out", "Power Of The Primes", "Armor Plating"].includes(name)) {
      setInteraction({ kind: "battle-friendly", name, cardIndex: index });
      flash(`Choose a friendly character for ${name}.`);
      return;
    }
    if (name === "Ambush Trap") {
      setInteraction({ kind: "trap", name, cardIndex: index });
      flash("Choose an empty friendly position for the Ambush Trap.");
      return;
    }
    if (name === "Reinforce") {
      setInteraction({ kind: "reinforce", name, cardIndex: index });
      flash("Choose a Backup, then choose the deployed character to exchange.");
      return;
    }
    if (["Deserved Punishment", "War Dawn", "Surprise"].includes(name)) {
      setInteraction({
        kind: "battle-enemy",
        name,
        cardIndex: index,
        picks: [],
      });
      flash(
        `Choose ${name === "Surprise" ? "two enemy positions" : "an enemy position or row"}.`,
      );
      return;
    }
    const occupied = enemyBoard
      .map((x, i) => (x && !detectionProtected(x, i, "battle") ? i : -1))
      .filter((i) => i >= 0);
    if (name === "Flying Support" || name === "2 For The Price Of 1")
      setRevealed((v) => [
        ...new Set([...v, ...shuffled(occupied).slice(0, 1)]),
      ]);
    if (name === "2 For The Price Of 1") setEnemyDefeatPending(false);
    if (name === "Information Gathering")
      setRevealed((v) => [
        ...new Set([...v, ...shuffled(occupied).slice(0, 3)]),
      ]);
    if (name === "He Will Find You") {
      const low = enemyBoard
        .map((x, i) => ({ x, i }))
        .filter(
          (a): a is { x: Unit; i: number } =>
            !!a.x && !detectionProtected(a.x, a.i, "battle"),
        )
        .sort((a, b) => a.x.hp - b.x.hp)[0];
      if (low) setRevealed((v) => [...new Set([...v, low.i])]);
    }
    if (name === "Tyrants Reign")
      flash(`Tyrants Reign drew ${drawCards(2)} Battle Cards.`, "good");
    else if (name === "Face Off") {
      setFaceOff(true);
      flash(
        "Face Off armed. Your next successful attack draws a card.",
        "good",
      );
    } else if (name === "Junkion Scrap")
      flash("The enemy scrapped 3 Battle Cards.", "good");
    else if (name === "Dark Reflections") {
      if (!scrap.length) {
        flash(
          "Dark Reflections requires a defeated friendly character.",
          "bad",
        );
        return;
      }
      setDarkDamage(Math.max(...scrap.map((u) => u.dmg)));
      flash(
        "Two Dark Reflections were scrapped. Your next attacker uses the strongest defeated ally's Damage.",
        "good",
      );
    } else flash(`${name} resolved.`, "good");
    spendBattle(name, index, name === "Dark Reflections");
  }
  function resolveFriendly(index: number) {
    const u = board[index];
    if (interaction?.kind === "trap") {
      if (u || interaction.cardIndex === undefined) return;
      setTraps((v) => [...v, index]);
      spendBattle("Ambush Trap", interaction.cardIndex);
      flash(`Ambush Trap armed at position ${index + 1}.`, "good");
      return;
    }
    if (
      interaction?.kind !== "battle-friendly" ||
      !u ||
      interaction.cardIndex === undefined
    )
      return;
    const name = interaction.name!;
    if (name === "Armor Plating") {
      setArmored(u.id);
      flash(`${u.name} gained Armor Plating for the next hit.`, "good");
    } else {
      const thunderBoost = u.id === "thunder" && u.abilityUses > 0,
        heal = name === "Power Of The Primes" ? 35 : thunderBoost ? 20 : 10;
      setBoard((v) =>
        v.map((x, i) =>
          i === index && x
            ? {
                ...x,
                hp: Math.min(x.max, x.hp + heal),
                abilityUses: thunderBoost
                  ? Math.max(0, x.abilityUses - 1)
                  : x.abilityUses,
              }
            : x,
        ),
      );
      flash(`${u.name} healed ${heal} Health.`, "good");
    }
    spendBattle(name, interaction.cardIndex);
  }
  function resolveBattleEnemy(index: number) {
    if (
      interaction?.kind !== "battle-enemy" ||
      interaction.cardIndex === undefined
    )
      return;
    const name = interaction.name!,
      next = [...enemyBoard];
    if (name === "Surprise") {
      const picks = [...(interaction.picks || []), index],
        result = (i: number) => {
          const card = enemyBoard[i];
          return card && detectionProtected(card, i, "battle")
            ? "protected from detection"
            : card
              ? "occupied"
              : "empty";
        };
      if (picks.length < 2) {
        setInteraction({ ...interaction, picks });
        flash(`Position ${index + 1} is ${result(index)}. Choose one more.`);
        return;
      }
      flash(
        `Surprise: ${picks.map((i) => `${i + 1} is ${result(i)}`).join("; ")}.`,
        "good",
      );
    } else if (name === "Deserved Punishment") {
      const u = next[index];
      if (u && isBattleCardImmune(u))
        flash("Tigatron is immune to Deserved Punishment.", "bad");
      else if (u) {
        const r = applyDamage(u, 10);
        next[index] = r.unit;
        if (r.unit.hp === 0) defeatEnemy(index, u, next);
        else
          flash(
            "Deserved Punishment dealt 10 damage to an unknown enemy.",
            "good",
          );
        setRoundDamage(true);
      } else flash("Deserved Punishment found an empty position.", "bad");
    } else if (name === "War Dawn") {
      const row = Math.floor(index / 3);
      next.forEach((u, i) => {
        if (u && Math.floor(i / 3) === row && !isBattleCardImmune(u)) {
          const r = applyDamage(u, 15);
          next[i] = r.unit;
          if (r.unit.hp === 0) defeatEnemy(i, u, next);
        }
      });
      setRoundDamage(true);
      flash(
        `War Dawn struck vulnerable cards in enemy row ${row + 1} for 15 damage each.`,
        "good",
      );
    }
    setEnemyBoard(next);
    spendBattle(name, interaction.cardIndex);
  }

  function resolveEnemyClick(index: number) {
    if (interaction?.kind === "attack") resolveAttack(index);
    else if (interaction?.kind === "ability") resolveAbilityTarget(index);
    else if (interaction?.kind === "battle-enemy") resolveBattleEnemy(index);
  }
  function selectBackup(index: number) {
    if (repositionLocked && (phase === "reposition" || phase === "reinforce"))
      return;
    if (interaction?.kind === "razor" && interaction.actor !== undefined) {
      const chosen = backups[index],
        actor = board[interaction.actor];
      if (!chosen || !actor) return;
      setBackups((v) => v.filter((_, i) => i !== index));
      setScrap((v) => [...v, chosen]);
      setBoard((v) =>
        applyBoardAuras(
          v.map((x, i) =>
            i === interaction.actor
              ? {
                  ...actor,
                  max: actor.max + chosen.max,
                  hp: actor.hp + chosen.max,
                  abilityUses: actor.abilityUses - 1,
                }
              : x,
          ),
        ),
      );
      if (chosen.id === "rampage") drawCards(2);
      setUsedAbilities((v) => [...v, actor.id]);
      flash(
        `${actor.name} combined with ${chosen.name} and gained ${chosen.max} Health.`,
        "good",
      );
      spendAction();
      return;
    }
    if (interaction?.kind === "reinforce") {
      setInteraction({ ...interaction, picks: [index] });
      flash(
        `Selected ${backups[index].name}. Now choose the deployed card to exchange.`,
      );
      return;
    }
    const chosen = backups[index];
    if (
      phase === "combat" &&
      !interaction &&
      chosen?.id === "galvatron" &&
      chosen.abilityUses > 0 &&
      !onlineLocked &&
      actions > 0 &&
      !usedAbilities.includes(chosen.id)
    ) {
      setInteraction({ kind: "galvatron", actor: index, picks: [] });
      flash(
        "Galvatron is activating from Backup. Choose the first character to shield.",
      );
      return;
    }
    if (phase === "reposition" || phase === "reinforce")
      setDragSource((current) =>
        current?.zone === "backup" && current.index === index
          ? null
          : { zone: "backup", index },
      );
  }
  function performReinforcement(source: DragSource, target: DragSource) {
    if (
      phase !== "reinforce" ||
      repositionLocked ||
      source.zone !== "backup" ||
      target.zone !== "board"
    )
      return;
    if (board[target.index]) {
      setDragSource(null);
      flash(
        "Required reinforcements must be placed in a vacant board space.",
        "bad",
      );
      return;
    }
    const result = reposition(board, backups, source, target);
    if (!result.moved) {
      setDragSource(null);
      flash("Choose a Backup and an empty board space.", "bad");
      return;
    }
    const nextBoard = applyBoardAuras(result.board);
    setBoard(nextBoard);
    setBackups(result.backups);
    setDragSource(null);
    const remaining = Math.min(
      Math.max(0, 6 - nextBoard.filter(Boolean).length),
      result.backups.length,
    );
    if (remaining === 0) {
      setPhase("reposition");
      flash(
        repositions === 0
          ? "Reinforcements complete. Rattrap blocked repositioning; lock in when ready."
          : "Reinforcements complete. Spend both Reposition Actions.",
        "good",
      );
    } else
      flash(
        `Reinforcement deployed. ${remaining} required replacement${remaining === 1 ? "" : "s"} remain.`,
        "good",
      );
  }
  function resolveBoardClick(index: number) {
    if (repositionLocked && (phase === "reinforce" || phase === "reposition"))
      return;
    if (phase === "deploy") {
      if (dragSource?.zone === "hand") placeFromHand(dragSource.index, index);
      else returnDeploymentCard(index);
      return;
    }
    if (phase === "combat") {
      if (interaction?.kind === "getaway") resolveGetaway(index);
      else if (interaction?.kind === "bludgeon") resolveBludgeon(index);
      else if (interaction?.kind === "galvatron") resolveGalvatron(index);
      else if (
        interaction?.kind === "battle-friendly" ||
        interaction?.kind === "trap"
      )
        resolveFriendly(index);
      else if (
        interaction?.kind === "reinforce" &&
        interaction.picks?.length &&
        interaction.cardIndex !== undefined
      ) {
        const bi = interaction.picks[0],
          result = reposition(
            board,
            backups,
            { zone: "backup", index: bi },
            { zone: "board", index },
          );
        if (!result.moved) {
          flash(
            result.reason === "board_limit"
              ? "Only six characters may be deployed. Choose a character on the board to exchange."
              : "Choose a deployed character to exchange.",
            "bad",
          );
          return;
        }
        setBoard(applyBoardAuras(result.board));
        setBackups(result.backups);
        spendBattle("Reinforce", interaction.cardIndex);
        flash("Reinforce completed the selected exchange.", "good");
      } else selectAttacker(index);
      return;
    }
    if (phase === "reinforce") {
      if (!dragSource) {
        flash("Select a Backup, then choose an empty board space.");
        return;
      }
      performReinforcement(dragSource, { zone: "board", index });
      return;
    }
    if (phase === "reposition") {
      if (dragSource?.zone === "board" && dragSource.index === index) {
        setDragSource(null);
        flash("Card deselected.");
        return;
      }
      if (!dragSource) {
        if (board[index]) setDragSource({ zone: "board", index });
        return;
      }
      performReposition(dragSource, { zone: "board", index });
    }
  }
  function performReposition(source: DragSource, target: DragSource) {
    if (
      phase !== "reposition" ||
      repositionLocked ||
      repositions <= 0 ||
      source.zone === "hand" ||
      target.zone === "hand"
    )
      return;
    const moving =
        source.zone === "board"
          ? board[source.index]
          : source.zone === "backup"
            ? backups[source.index]
            : null,
      result = reposition(board, backups, source, target);
    if (!result.moved) {
      setDragSource(null);
      flash(
        result.reason === "board_limit"
          ? "Board limit reached: exchange the Backup with one of your six deployed characters."
          : "That selection did not move a character. Choose a different destination.",
        "bad",
      );
      return;
    }
    let nextBoard = applyBoardAuras(result.board);
    if (moving?.id === "ravage")
      nextBoard = nextBoard.map((unit) =>
        unit?.id === "ravage" ? { ...unit, ravageGuard: true } : unit,
      );
    setBoard(nextBoard);
    setBackups(result.backups);
    const freeSkywarp = moving?.id === "skywarp" && moving.abilityUses > 0;
    if (freeSkywarp)
      setBoard((v) =>
        v.map((u) =>
          u?.id === "skywarp" ? { ...u, abilityUses: u.abilityUses - 1 } : u,
        ),
      );
    else setRepositions((v) => Math.max(0, v - 1));
    setDragSource(null);
    flash(
      moving?.id === "ravage"
        ? "Ravage repositioned and will block the first enemy attack that hits him."
        : freeSkywarp
          ? "Skywarp teleported without spending a Reposition Action."
          : "Reposition action completed.",
      "good",
    );
  }
  function onDrop(target: DragSource, e: React.DragEvent) {
    e.preventDefault();
    const raw = e.dataTransfer.getData("application/json");
    const source = raw ? (JSON.parse(raw) as DragSource) : dragSource;
    if (!source) return;
    if (phase === "deploy" && source.zone === "hand" && target.zone === "board")
      placeFromHand(source.index, target.index);
    else if (phase === "reinforce") performReinforcement(source, target);
    else if (phase === "reposition") performReposition(source, target);
  }
  function onDrag(source: DragSource, e: React.DragEvent) {
    if (repositionLocked && (phase === "reinforce" || phase === "reposition")) {
      e.preventDefault();
      return;
    }
    setDragSource(source);
    e.dataTransfer.setData("application/json", JSON.stringify(source));
    e.dataTransfer.effectAllowed = "move";
    const card = e.currentTarget
      .querySelector(".character-card")
      ?.cloneNode(true) as HTMLElement | null;
    if (card) {
      card.classList.add("drag-card-ghost");
      document.body.appendChild(card);
      e.dataTransfer.setDragImage(
        card,
        card.offsetWidth / 2,
        card.offsetHeight / 2,
      );
      setTimeout(() => card.remove(), 0);
    }
  }

  function applyEnemyHit(
    pb: Slot[],
    targetIndex: number,
    attacker: Unit,
    attackerIndex: number,
  ) {
    if (friendlyMines.includes(targetIndex)) {
      const mineHit = applyDamage(attacker, 10).unit,
        defeatedAttacker = mineHit.hp === 0;
      setFriendlyMines((mines) =>
        mines.filter((position) => position !== targetIndex),
      );
      setEnemyBoard((current) =>
        applyBoardAuras(
          current.map((unit, index) =>
            index === attackerIndex
              ? defeatedAttacker
                ? null
                : mineHit
              : unit,
          ),
        ),
      );
      setRevealed((spaces) => [...new Set([...spaces, attackerIndex])]);
      if (defeatedAttacker) {
        setEnemyScrap((cards) => [...cards, attacker]);
        setEnemyDefeatPending(true);
      }
      flash(
        defeatedAttacker
          ? `Your Depthcharge mine defeated ${attacker.name}.`
          : `Your Depthcharge mine hit ${attacker.name} for 10 Damage.`,
        "good",
      );
      return pb;
    }
    const trap = resolveTrap(traps, targetIndex);
    if (trap.triggered) {
      setTraps(trap.traps);
      setRevealed((v) => [...new Set([...v, attackerIndex])]);
      flash(
        `Ambush Trap at ${targetIndex + 1} triggered: enemy attack cancelled and position ${attackerIndex + 1} revealed!`,
        "good",
      );
      return pb;
    }
    pb = pb.map((unit, index) =>
      unit?.id === "dinobot" && index !== targetIndex
        ? { ...unit, dinobotHitStreak: 0 }
        : unit,
    );
    const victim = pb[targetIndex];
    if (!victim) {
      flash(`Enemy attacked your empty position ${targetIndex + 1}.`, "info");
      return pb;
    }
    let target = victim;
    const initialReduction = armored === victim.id ? 10 : 0,
      lethalDamage = Math.max(0, attacker.dmg - initialReduction) >= victim.hp;
    if (victim.role === "Commander" && lethalDamage) {
      const guardIndex = pb.findIndex(
        (x) => x?.id === "scorp" && x.abilityUses > 0,
      );
      if (guardIndex >= 0) {
        target = pb[guardIndex]!;
        targetIndex = guardIndex;
        pb[guardIndex] = { ...target, abilityUses: target.abilityUses - 1 };
        flash(
          `Scorponok intercepted a lethal threat aimed at ${victim.name}.`,
          "good",
        );
      }
    }
    const reduction = armored === target.id ? 10 : 0,
      result = applyCharacterAttackDamage(target, attacker.dmg, reduction);
    if (reduction) setArmored(null);
    if (result.blocked) {
      pb[targetIndex] = result.unit;
      flash(
        target.ravageGuard
          ? "Ravage's reposition guard blocked the first attack that hit him."
          : `${target.name}'s shield completely blocked the unknown enemy attack.`,
        "good",
      );
      return pb;
    }
    setRoundDamage(true);
    if (result.restored) {
      pb[targetIndex] = result.unit;
      flash(
        `${target.name} restored to full Health after the second consecutive hit.`,
        "good",
      );
      return applyBoardAuras(pb);
    }
    if (
      result.unit.hp === 0 &&
      target.id === "fangry" &&
      target.abilityUses > 0
    ) {
      pb[targetIndex] = { ...target, hp: 20, abilityUses: 0, canAttack: false };
      flash(
        "Fangry secretly survived with 20 Health, but can no longer attack.",
        "good",
      );
      return pb;
    }
    if (result.unit.hp === 0 && target.faction === "Autobot") {
      const primeIndex = pb.findIndex(
        (x) => !!x && hasAbility(x, "optimus") && x.abilityUses > 0,
      );
      const vacancy = pb.findIndex((x, i) => !x && i !== targetIndex);
      if (primeIndex >= 0 && vacancy >= 0) {
        const protector = pb[primeIndex]!;
        pb[primeIndex] = {
          ...protector,
          abilityUses: protector.abilityUses - 1,
        };
        pb[targetIndex] = null;
        pb[vacancy] = { ...target, hp: 1 };
        flash(
          `${protector.name} used Optimus Prime's ability to save ${target.name} and secretly move them to position ${vacancy + 1}.`,
          "good",
        );
        return pb;
      }
    }
    if (result.unit.hp === 0) {
      if (shouldLayDepthchargeMine(pb, target)) setFriendlyMines([targetIndex]);
      if (target.id === "cheetor")
        setPermanentRevealedIds((ids) => [...new Set([...ids, attacker.id])]);
      pb[targetIndex] = null;
      pb = healTransmetalTarantulas(pb, target);
      setBackups((cards) => healTransmetalTarantulas(cards, target));
      setScrap((v) => [...v, target]);
      flash(`${target.name} was defeated by an unknown enemy attack.`, "bad");
      if (target.id === "sun")
        pb = pb.map((x) =>
          x?.id === "side" && x.abilityUses > 0
            ? { ...x, hp: x.max, abilityUses: x.abilityUses - 1 }
            : x,
        );
      if (target.role === "Commander")
        pb = pb.map((x) =>
          x && hasAbility(x, "primal")
            ? { ...x, max: x.max + 10, hp: x.hp + 10, dmg: x.dmg + 10 }
            : x,
        );
    } else {
      pb[targetIndex] = result.unit;
      flash(`Unknown enemy hit ${target.name} for ${result.damage}.`, "bad");
      if (target.id === "ratchet" && target.abilityUses > 0) {
        const row = Math.floor(targetIndex / 3);
        pb = pb.map((x, i) =>
          x && Math.floor(i / 3) === row
            ? {
                ...x,
                hp: Math.min(x.max, x.hp + 15),
                abilityUses:
                  x.id === "ratchet" ? x.abilityUses - 1 : x.abilityUses,
              }
            : x,
        );
        flash(
          "Ratchet healed every friendly character in his row by 15.",
          "good",
        );
      }
      if (
        target.id === "kickback" &&
        attacker.role === "Trooper" &&
        target.abilityUses > 0
      ) {
        pb[targetIndex] = {
          ...pb[targetIndex]!,
          abilityUses: target.abilityUses - 1,
        };
        const ally = pb
          .map((x, i) => ({ x, i }))
          .filter((a): a is { x: Unit; i: number } => !!a.x && a.x.hp < a.x.max)
          .sort((a, b) => a.x.hp - a.x.max - (b.x.hp - b.x.max))[0];
        if (ally)
          pb[ally.i] = { ...ally.x, hp: Math.min(ally.x.max, ally.x.hp + 10) };
        flash("Kickback triggered and healed a deployed ally by 10.", "good");
      }
    }
    return applyBoardAuras(pb);
  }
  function enemyTurn() {
    if (multiplayerSocket) {
      finishOnlineTurn();
      return;
    }
    let pb = [...board],
      live = shuffled(
        enemyBoard
          .map((x, i) => ({ x, i }))
          .filter((a): a is { x: Unit; i: number } => !!a.x),
      );
    for (let n = 0; n < 3 && live.length; n++) {
      const attacker = live[n % live.length],
        target = Math.floor(Math.random() * 9),
        beeBoost =
          attacker.x.faction === "Autobot" &&
          (attacker.x.id === "bee" || attacker.x.role === "Commander") &&
          enemyBoard.some((x) => x?.id === "bee") &&
          enemyBoard.some(
            (x) => x?.faction === "Autobot" && x.role === "Commander",
          );
      pb = applyEnemyHit(
        pb,
        target,
        { ...attacker.x, dmg: attacker.x.dmg + (beeBoost ? 5 : 0) },
        attacker.i,
      );
    }
    setBoard(pb);
    if (pb.filter(Boolean).length + backups.length === 0) {
      setWinner("Defeat — every character on your team has been defeated.");
      setPhase("over");
      return;
    }
    const needed = Math.min(
        Math.max(0, 6 - pb.filter(Boolean).length),
        backups.length,
      ),
      moves = repositionBlockedUntil === round ? 0 : 2;
    setRepositions(moves);
    setActions(0);
    setDragSource(null);
    setInteraction(null);
    setPhase(needed > 0 ? "reinforce" : "reposition");
    flash(
      needed > 0
        ? `Reinforcement Phase: deploy ${needed} replacement${needed === 1 ? "" : "s"} for free.`
        : moves === 0
          ? "Combat complete. Rattrap blocked repositioning this round."
          : "Combat complete. Spend both Reposition Actions.",
      "info",
    );
  }
  function finishOnlineTurn() {
    if (!multiplayerSocket || !isMyTurn) return;
    setActions(0);
    setIsMyTurn(false);
    setInteraction(null);
    multiplayerSocket.emit("finish-turn");
    flash("Your attacks are complete. Waiting for the other player.", "info");
  }
  function forfeit() {
    if (
      phase === "over" ||
      !window.confirm(
        "Forfeit this match? This gives the opponent the victory.",
      )
    )
      return;
    multiplayerSocket?.emit("forfeit");
    setTurnEndsAt(0);
    setIsMyTurn(false);
    setWinner("Defeat — you forfeited the match.");
    setPhase("over");
    flash("You forfeited the match.", "bad");
  }
  function restartGame() {
    if (multiplayerSocket) {
      multiplayerSocket.emit("leave-room");
      multiplayerSocket.disconnect();
      setMultiplayerSocket(null);
      setEnemyRoster([]);
      setPhase("start");
      return;
    }
    setEnemyRoster([]);
    setPhase("build");
  }
  function finishOnlineReposition() {
    if (!multiplayerSocket || repositions !== 0 || repositionLocked) return;
    setRepositionLocked(true);
    setPhase("waiting");
    multiplayerSocket.emit("finish-reposition", { board, backups });
    flash(
      "Your repositioning is locked. Waiting for the other player.",
      "info",
    );
  }
  function repositionEnemy(sourceBoard: Slot[], sourceBackups: Unit[]) {
    let eb = [...sourceBoard],
      bk = shuffled(sourceBackups);
    const movedIds = new Set<string>();
    while (eb.filter(Boolean).length < 6 && bk.length) {
      const empty = shuffled(
        eb.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0),
      )[0];
      eb[empty] = bk[0];
      movedIds.add(bk[0].id);
      bk = bk.slice(1);
    }
    for (let m = 0; m < 2; m++) {
      const occupied = eb.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
      if (occupied.length > 1) {
        const [a, b] = shuffled(occupied).slice(0, 2);
        if (eb[a]) movedIds.add(eb[a]!.id);
        if (eb[b]) movedIds.add(eb[b]!.id);
        [eb[a], eb[b]] = [eb[b], eb[a]];
      }
    }
    eb = eb.map((unit) =>
      unit?.id === "ravage" && movedIds.has(unit.id)
        ? { ...unit, ravageGuard: true }
        : unit,
    );
    return { board: applyBoardAuras(eb), backups: bk };
  }
  function nextRound() {
    if (multiplayerSocket) {
      finishOnlineReposition();
      return;
    }
    if (repositions !== 0) return;
    const newRound = round + 1,
      moved =
        repositionBlockedUntil === round
          ? { board: enemyBoard, backups: enemyBackups }
          : repositionEnemy(enemyBoard, enemyBackups),
      poisoned: Slot[] = moved.board.map((u) =>
        u?.poison
          ? { ...u, hp: Math.max(0, u.hp - 5), poison: u.poison - 1 }
          : u,
      );
    const poisonDeaths: Unit[] = [];
    const eb = expireTimedShields(
      poisoned.map((u) => {
        if (u && u.hp === 0) {
          poisonDeaths.push(u);
          return null;
        }
        return u;
      }),
      newRound,
    );
    if (poisonDeaths.length) {
      setEnemyScrap((v) => [...v, ...poisonDeaths]);
      setEnemyDefeatPending(true);
      flash(
        `Poison defeated ${poisonDeaths.map((u) => u.name).join(" and ")}.`,
        "good",
      );
    }
    const bk = backups.map((u) =>
      u.id === "rampagebw" && round % 3 === 0
        ? { ...u, hp: Math.min(u.max, u.hp + 15) }
        : u,
    );
    setBoard((current) => expireTimedShields(current, newRound));
    setEnemyBoard(eb);
    setEnemyBackups(moved.backups);
    setBackups(bk);
    if (eb.filter(Boolean).length + moved.backups.length === 0) {
      setWinner("Victory — every enemy character has been defeated.");
      setPhase("over");
      return;
    }
    const quiet = roundDamage ? 0 : quietRounds + 1;
    setQuietRounds(quiet);
    if (quiet >= 4) {
      const result = stalemateResult(board, bk, eb, moved.backups);
      setWinner(
        result === "draw"
          ? "Draw — surviving cards and Health are equal."
          : result === "victory"
            ? "Victory by the four-round stalemate count."
            : "Defeat by the four-round stalemate count.",
      );
      setPhase("over");
      return;
    }
    setRound(newRound);
    setActions(3);
    setBattlePlayed(false);
    setUsedAttacks([]);
    setUsedAbilities([]);
    setRoundDamage(false);
    setRevealed([]);
    drawCards(hasTarantulasDraw(board, eb) ? 2 : 1);
    setPhase("combat");
    const cardsDrawn = hasTarantulasDraw(board, eb) ? 2 : 1;
    flash(
      `Round ${newRound}. ${cardsDrawn} Battle Card${cardsDrawn === 1 ? "" : "s"} drawn; start-of-round window open.`,
      "good",
    );
  }

  const filtered = allUnits.filter(
    (unit) =>
      (filter === "All" || unit.role === filter) &&
      (factionFilter === "All" || unit.faction === factionFilter),
  );
  const classFilterPool = allUnits.filter(
    (unit) => factionFilter === "All" || unit.faction === factionFilter,
  );
  const factionFilterPool = allUnits.filter(
    (unit) => filter === "All" || unit.role === filter,
  );
  const poolRoleCount = (role: string) =>
    classFilterPool.filter((unit) => unit.role === role).length;
  const poolFactionCount = (name: Faction) =>
    factionFilterPool.filter((unit) => unit.faction === name).length;
  const permanentEnemySpaces = enemyBoard
    .map((unit, index) =>
      unit && permanentRevealedIds.includes(unit.id) ? index : -1,
    )
    .filter((index) => index >= 0);
  const shell = (children: React.ReactNode) => (
    <CardInspectContext.Provider value={setInspectedUnit}>
      <main
        className={`app-shell ${showFilterCounts ? "" : "hide-filter-counts"}`}
        data-theme={theme}
        data-card-border={cardBorder}
      >
        <div className="utility-row">
          <AppTools
            theme={theme}
            setTheme={setTheme}
            cardBorder={cardBorder}
            setCardBorder={setCardBorder}
            showFilterCounts={showFilterCounts}
            setShowFilterCounts={setShowFilterCounts}
            log={log}
            enemyRoster={enemyRoster}
            enemyScrap={enemyScrap}
          />
        </div>
        {children}
        <CardInspector unit={inspectedUnit} />
      </main>
    </CardInspectContext.Provider>
  );
  if (phase === "start")
    return shell(
      <section className="start-card">
        <div className="brand-mark">
          <Swords />
        </div>
        <p className="eyebrow">TACTICAL CARD BATTLE</p>
        <h1>Hidden Front</h1>
        <p className="lead">
          Build your nine-card squad, deploy it yourself and command every
          attack, ability and secret reposition.
        </p>
        <div className="setup-grid">
          <label>
            Starter deck
            <select
              value={faction}
              onChange={(e) => {
                const f = e.target.value as Faction;
                setFaction(f);
                setDeck(starterDeck(f).map((x) => x.id));
              }}
            >
              {Object.keys(rosters)
                .filter((x) => starterDeck(x as Faction).length === 9)
                .map((x) => (
                  <option key={x}>{x}</option>
                ))}
            </select>
          </label>
          <label>
            Enemy team
            <select
              value={enemyFaction}
              onChange={(e) => {
                setEnemyFaction(e.target.value as EnemyChoice);
                setEnemyRoster([]);
              }}
            >
              <option value="Random">Random mixed team</option>
              {Object.keys(rosters)
                .filter((x) => starterDeck(x as Faction).length === 9)
                .map((x) => (
                  <option key={x}>{x}</option>
                ))}
            </select>
          </label>
        </div>
        <div className="lobby-actions">
          <button className="primary" onClick={() => setPhase("build")}>
            <Zap /> Solo game
          </button>
          <button className="ghost" onClick={() => setPhase("multiplayer")}>
            <Users size={17} /> Multiplayer
          </button>
        </div>
      </section>,
    );
  if (phase === "multiplayer")
    return shell(
      <MultiplayerLobby
        onSolo={() => setPhase("start")}
        onStart={(socket) => {
          setMultiplayerSocket(socket);
          setPhase("build");
        }}
      />,
    );
  if (phase === "waiting")
    return shell(
      <section className="start-card multiplayer-lobby">
        <p className="eyebrow">MULTIPLAYER MATCH</p>
        <h1>Waiting for opponent</h1>
        <p className="lead">
          Your selections are safely locked in. The game will continue
          automatically as soon as the other player finishes this step.
        </p>
      </section>,
    );
  if (phase === "build")
    return shell(
      <div className="builder">
        <header className="builder-head">
          <div>
            <p className="eyebrow">DECK BUILDER</p>
            <h1>Choose your nine</h1>
          </div>
          <div className={`deck-status ${legal ? "legal" : ""}`}>
            <b>{deck.length}/9</b>
            <span>
              {legal ? "LEGAL DECK" : "Match every class requirement"}
            </span>
          </div>
          <button
            className="primary"
            disabled={!legal || deckLocked}
            onClick={prepareOpponent}
          >
            {multiplayerSocket
              ? deckLocked
                ? "Waiting for opponent"
                : "Lock in deck"
              : "Reveal opponent"}
          </button>
        </header>
        <p className="filter-label">FILTER BY CLASS</p>
        <div className="class-filters count-filters">
          <button
            disabled={deckLocked}
            className={filter === "All" ? "active" : ""}
            onClick={() => setFilter("All")}
          >
            <span>All classes</span>
            <b className="pool-count">{classFilterPool.length}</b>
            <small>{deck.length}/9 selected</small>
          </button>
          {Object.entries(classRequirements).map(([role, need]) => (
            <button
              disabled={deckLocked}
              key={role}
              className={`${filter === role ? "active" : ""} ${count(role) === need ? "complete" : ""}`}
              onClick={() => setFilter(filter === role ? "All" : role)}
            >
              <span>{role}</span>
              <b className="pool-count">{poolRoleCount(role)}</b>
              <small>
                {count(role)}/{need} selected
              </small>
            </button>
          ))}
        </div>
        <p className="filter-label">FILTER BY FACTION</p>
        <div className="class-filters faction-filters count-filters">
          <button
            disabled={deckLocked}
            className={factionFilter === "All" ? "active" : ""}
            onClick={() => setFactionFilter("All")}
          >
            <span>All factions</span>
            <b className="pool-count">{factionFilterPool.length}</b>
            <small>available</small>
          </button>
          {(Object.keys(rosters) as Faction[]).map((name) => (
            <button
              disabled={deckLocked}
              key={name}
              className={factionFilter === name ? "active" : ""}
              onClick={() =>
                setFactionFilter(factionFilter === name ? "All" : name)
              }
            >
              <span>{name}</span>
              <b className="pool-count">{poolFactionCount(name)}</b>
              <small>available</small>
            </button>
          ))}
        </div>
        <p className="filter-results pool-count-summary" aria-live="polite">
          Showing <b>{filtered.length}</b> of <b>{allUnits.length}</b>{" "}
          characters
        </p>
        <section className="card-pool">
          {filtered.map((u) => {
            const on = deck.includes(u.id);
            return (
              <button
                disabled={deckLocked}
                key={u.id}
                className={`deck-card character-border-frame ${on ? "chosen" : ""}`}
                onMouseEnter={() => setInspectedUnit(u)}
                onMouseLeave={() => setInspectedUnit(null)}
                onClick={() =>
                  setDeck((v) =>
                    on
                      ? v.filter((id) => id !== u.id)
                      : v.length < 9
                        ? [...v, u.id]
                        : v,
                  )
                }
                title={`${u.name}: ${u.ability}`}
              >
                <img src={u.image} alt={u.name} />
                <em>{on ? `SELECTED ${deck.indexOf(u.id) + 1}` : "ADD"}</em>
              </button>
            );
          })}
        </section>
        <section className="battle-deck-summary">
          <div>
            <p className="eyebrow">BATTLE DECK</p>
            <h2>30 cards</h2>
            <p>Includes 8 Rare cards and the new Ambush Trap prototype.</p>
          </div>
          <div>
            {battleDeck.map((name) => (
              <figure
                key={name}
                onMouseEnter={() =>
                  setInspectedUnit({
                    name,
                    image: battleCards[name].image,
                    effect: battleCards[name].effect,
                    rarity: battleCards[name].rarity,
                  })
                }
                onMouseLeave={() => setInspectedUnit(null)}
              >
                {battleCards[name].image ? (
                  <img src={battleCards[name].image} alt={name} />
                ) : (
                  <BattleCardFace name={name} />
                )}
                <figcaption>{name}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>,
    );
  if (phase === "opponent")
    return shell(
      <section className="opponent-preview">
        <div className="opponent-preview-head">
          <div>
            <p className="eyebrow">OPPONENT INTELLIGENCE</p>
            <h1>Know the enemy team</h1>
            <p>
              You may study all nine enemy characters for balance. Once battle
              begins, their identities and board positions remain hidden.
            </p>
          </div>
          <button className="primary" onClick={beginDeployment}>
            Choose your starting six
          </button>
        </div>
        <EnemyRosterCards units={enemyRoster} defeated={[]} />
      </section>,
    );
  if (phase === "deploy")
    return shell(
      <div className="stage-page">
        <StageHeader
          phase={phase}
          round={round}
          playerLeft={playerLeft}
          enemyLeft={enemyLeft}
          turnRemainingMs={0}
          turnDurationMs={turnDurationMs}
        />
        <FeedbackBar feedback={feedback} />
        <div className="deployment-layout">
          <section>
            <p className="eyebrow">
              YOUR SECRET GRID · {board.filter(Boolean).length}/6 DEPLOYED
            </p>
            <h2>Choose and place your starting six</h2>
            <Board
              board={board}
              enemy={false}
              phase={phase}
              traps={traps}
              mines={[]}
              revealed={revealed}
              concealed={[]}
              used={usedAttacks}
              onClick={resolveBoardClick}
              onDrop={onDrop}
              onDrag={onDrag}
            />
          </section>
          <aside className="drawn-hand">
            <p className="eyebrow">YOUR NINE-CARD DECK</p>
            <div>
              {hand.map((u, i) => (
                <button
                  key={u.id}
                  draggable
                  onDragStart={(e) => onDrag({ zone: "hand", index: i }, e)}
                  onClick={() =>
                    setDragSource((v) =>
                      v?.zone === "hand" && v.index === i
                        ? null
                        : { zone: "hand", index: i },
                    )
                  }
                  className={
                    dragSource?.zone === "hand" && dragSource.index === i
                      ? "selected-source"
                      : ""
                  }
                >
                  <GripVertical />
                  <CharacterCard unit={u} small />
                </button>
              ))}
            </div>
            <p>
              Select any six. Drag or click a card and then choose a grid space.
              Click a deployed card with no selection to return it. Your three
              unplaced cards become Backups.
            </p>
            <button
              className="primary"
              disabled={board.filter(Boolean).length !== 6}
              onClick={startCombat}
            >
              Begin round 1 · {board.filter(Boolean).length}/6
            </button>
          </aside>
        </div>
      </div>,
    );
  const phaseTitle =
    phase === "combat"
      ? multiplayerSocket
        ? isMyTurn
          ? "Your attack turn"
          : `${activePlayerName} is attacking`
        : "Combat phase"
      : phase === "reinforce"
        ? "Reinforcement phase"
        : "Reposition phase";
  const phaseStatus =
    phase === "combat"
      ? isMyTurn
        ? `${actions} actions`
        : "CONTROLS LOCKED"
      : phase === "reinforce"
        ? `${reinforcementsNeeded} required`
        : `${repositions} moves`;
  const phaseHeading =
    phase === "combat"
      ? isMyTurn
        ? `${actions} actions remaining`
        : `Waiting for ${activePlayerName}`
      : phase === "reinforce"
        ? `${reinforcementsNeeded} replacements required`
        : `${repositions} moves remaining`;
  const phaseCopy =
    phase === "combat"
      ? onlineLocked
        ? "The board updates live while your opponent completes their attacks."
        : interaction
          ? "Complete the highlighted action."
          : battleWindow
            ? "Play one Battle Card or begin your actions."
            : "Select a character to attack or use an ability."
      : phase === "reinforce"
        ? dragSource
          ? "Now choose an empty board space."
          : "Choose a Backup to replace each defeated deployed character. These replacements are free."
        : repositionLocked
          ? "Your positions are locked. Waiting for your opponent."
          : dragSource
            ? "Now choose a destination."
            : "Drag or select a board or Backup card.";
  return shell(
    <div className="stage-page">
      <StageHeader
        phase={phase}
        round={round}
        playerLeft={playerLeft}
        enemyLeft={enemyLeft}
        turnRemainingMs={
          multiplayerSocket &&
          ["combat", "reinforce", "reposition"].includes(phase)
            ? turnRemainingMs
            : 0
        }
        turnDurationMs={turnDurationMs}
      />
      <FeedbackBar feedback={feedback} />
      {phase === "over" ? (
        <section className="end-screen">
          <Sparkles />
          <h1>{winner}</h1>
          <button className="primary" onClick={restartGame}>
            <RotateCcw />{" "}
            {multiplayerSocket ? "Return to main menu" : "Build another deck"}
          </button>
        </section>
      ) : (
        <div
          className={`game-layout ${onlineLocked || repositionLocked ? "controls-locked" : ""}`}
        >
          <section className="boards">
            <div>
              <div className="board-title">
                <span>
                  <span className="red-dot" />
                  ENEMY GRID
                </span>
                <b>
                  {enemyLeft} cards left · {enemyBoard.filter(Boolean).length}/6
                  deployed
                </b>
              </div>
              <Board
                board={enemyBoard}
                enemy
                phase={phase}
                traps={[]}
                mines={[]}
                revealed={[...new Set([...revealed, ...permanentEnemySpaces])]}
                concealed={
                  enemyConcealment && round <= enemyConcealment.until
                    ? enemyConcealment.spaces
                    : []
                }
                used={[]}
                onClick={resolveEnemyClick}
                onDrop={onDrop}
                onDrag={onDrag}
              />
            </div>
            <div>
              <div className="board-title">
                <span>
                  <span className="blue-dot" />
                  YOUR GRID
                </span>
                <b>
                  {playerLeft} cards left · {board.filter(Boolean).length}/6
                  deployed
                </b>
              </div>
              <Board
                board={board}
                enemy={false}
                phase={phase}
                traps={traps}
                mines={friendlyMines}
                revealed={hitSpaces}
                concealed={
                  friendlyConcealment && round <= friendlyConcealment.until
                    ? friendlyConcealment.spaces
                    : []
                }
                used={usedAttacks}
                onClick={resolveBoardClick}
                onDrop={onDrop}
                onDrag={onDrag}
              />
            </div>
          </section>
          <aside className="control-rail">
            <RailPanel
              className="phase-panel"
              title={phaseTitle}
              status={phaseStatus}
            >
              <h2>{phaseHeading}</h2>
              <p>{phaseCopy}</p>
              {phase === "combat" ? (
                <button
                  className="primary"
                  disabled={onlineLocked}
                  onClick={enemyTurn}
                >
                  {multiplayerSocket
                    ? onlineLocked
                      ? `Waiting for ${activePlayerName}`
                      : actions > 0
                        ? `End turn now · ${actions} unused`
                        : "Finish attack turn"
                    : actions > 0
                      ? `End turn · ${actions} unused`
                      : "Resolve enemy turn"}
                </button>
              ) : phase === "reposition" ? (
                <button
                  className="primary"
                  disabled={repositions !== 0 || repositionLocked}
                  onClick={nextRound}
                >
                  {multiplayerSocket
                    ? repositionLocked
                      ? "Waiting for opponent"
                      : "Lock repositioning"
                    : "Start next round"}
                </button>
              ) : null}
              <button className="forfeit-button" onClick={forfeit}>
                <Skull size={15} /> Forfeit match
              </button>
            </RailPanel>
            {phase === "combat" && (
              <>
                <RailPanel title="Selected character">
                  {interaction?.actor !== undefined &&
                  board[interaction.actor] ? (
                    <div className="selected-unit">
                      <CharacterCard unit={board[interaction.actor]!} small />
                      <button
                        className="ability-button"
                        disabled={!abilityReady(board[interaction.actor]!)}
                        onClick={() => activateAbility(interaction.actor!)}
                      >
                        <Sparkles /> Use ability{" "}
                        <small>
                          {board[interaction.actor]!.abilityUses} use(s)
                        </small>
                      </button>
                      <button
                        className="deselect-button"
                        onClick={() => setInteraction(null)}
                      >
                        Deselect
                      </button>
                      <p>{displayedAbility(board[interaction.actor]!)}</p>
                      {interaction.kind === "rhinox" && (
                        <div className="rhinox-choices">
                          {scrap
                            .filter((unit) => unit.faction === "Maximal")
                            .map((unit) => (
                              <button
                                key={unit.id}
                                onClick={() => resolveRhinox(unit.id)}
                              >
                                {unit.name} · revive at{" "}
                                {Math.ceil(unit.max / 2)} HP
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  ) : (
                    <p className="empty-copy">
                      {onlineLocked
                        ? "Controls are locked until your opponent finishes."
                        : "Select one of your deployed cards."}
                    </p>
                  )}
                </RailPanel>
                <RailPanel
                  title="Battle Cards"
                  status={battleWindow ? "WINDOW OPEN" : "CLOSED"}
                >
                  <div className="battle-hand">
                    {battleHand.map((name, i) => (
                      <button
                        key={`${name}-${i}`}
                        className={
                          interaction?.cardIndex === i ? "selected-battle" : ""
                        }
                        disabled={!battleWindow && interaction?.cardIndex !== i}
                        onMouseEnter={() =>
                          setInspectedUnit({
                            name,
                            image: battleCards[name].image,
                            effect: battleCards[name].effect,
                            rarity: battleCards[name].rarity,
                          })
                        }
                        onMouseLeave={() => setInspectedUnit(null)}
                        onClick={() => playBattleCard(name, i)}
                        title={battleCards[name].effect}
                      >
                        {battleCards[name].image ? (
                          <img src={battleCards[name].image} alt={name} />
                        ) : (
                          <BattleCardFace name={name} />
                        )}
                        <span>{name}</span>
                      </button>
                    ))}
                  </div>
                </RailPanel>
              </>
            )}
            <RailPanel title="Backups" status={`${backups.length} cards`}>
              <div
                className={`backup-strip ${interaction?.kind === "razor" ? "blind-backups" : ""}`}
              >
                {backups.map((u, i) => (
                  <button
                    key={u.id}
                    aria-label={
                      interaction?.kind === "razor"
                        ? `Choose hidden Backup ${i + 1}`
                        : u.name
                    }
                    draggable={
                      (phase === "reposition" || phase === "reinforce") &&
                      !repositionLocked
                    }
                    onDragStart={(e) => onDrag({ zone: "backup", index: i }, e)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop({ zone: "backup", index: i }, e)}
                    onClick={() => selectBackup(i)}
                    className={`${dragSource?.zone === "backup" && dragSource.index === i ? "selected-source" : ""} ${phase === "combat" && u.id === "galvatron" && u.abilityUses > 0 ? "backup-ability-ready" : ""}`}
                  >
                    <CharacterCard
                      unit={u}
                      hidden={interaction?.kind === "razor"}
                      small
                    />
                    {phase === "combat" &&
                      u.id === "galvatron" &&
                      u.abilityUses > 0 && (
                        <span className="backup-ability-tag">USE ABILITY</span>
                      )}
                  </button>
                ))}
              </div>
            </RailPanel>
            {enemyBackupsRevealed && (
              <RailPanel
                title="Revealed enemy Backups"
                status={`${enemyBackups.length} cards`}
              >
                <div className="backup-strip enemy-backups-revealed">
                  {enemyBackups.length ? (
                    enemyBackups.map((unit) => (
                      <div key={unit.id}>
                        <CharacterCard unit={unit} small />
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">
                      The enemy has no Backup characters remaining.
                    </p>
                  )}
                </div>
              </RailPanel>
            )}
          </aside>
        </div>
      )}
    </div>,
  );
}

function FeedbackBar({ feedback }: { feedback: Feedback }) {
  return (
    <div key={feedback.key} className={`feedback ${feedback.tone}`}>
      <Zap />
      <b>{feedback.text}</b>
    </div>
  );
}
function TurnTimer({
  remaining,
  duration,
  label,
}: {
  remaining: number;
  duration: number;
  label: string;
}) {
  if (remaining <= 0) return null;
  const percent = Math.max(0, Math.min(100, (remaining / duration) * 100)),
    seconds = Math.ceil(remaining / 1000);
  return (
    <div
      className="turn-timer"
      aria-label={`${label}: ${seconds} seconds remain`}
    >
      <div className="turn-timer-label">
        <span>{label}</span>
        <b>{seconds}s</b>
      </div>
      <div className="fuse-track">
        <div className="fuse-fill" style={{ width: `${percent}%` }}>
          <Flame aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
function StageHeader({
  phase,
  round,
  playerLeft,
  enemyLeft,
  turnRemainingMs,
  turnDurationMs,
}: {
  phase: Phase;
  round: number;
  playerLeft: number;
  enemyLeft: number;
  turnRemainingMs: number;
  turnDurationMs: number;
}) {
  return (
    <header className="stage-header">
      <div>
        <p className="eyebrow">HIDDEN FRONT</p>
        <h1>
          {phase === "deploy"
            ? "Manual deployment"
            : phase === "reinforce"
              ? "Mandatory reinforcements"
              : phase === "reposition"
                ? "Secret repositioning"
                : "Battle in progress"}
        </h1>
      </div>
      <TurnTimer
        remaining={turnRemainingMs}
        duration={turnDurationMs}
        label={phase === "combat" ? "TURN FUSE" : "REPOSITION FUSE"}
      />
      <div className="team-count you">
        <small>YOUR CARDS</small>
        <b>{playerLeft}/9</b>
      </div>
      <div className="round">
        <small>ROUND</small>
        <b>{round}</b>
      </div>
      <div className="team-count enemy">
        <small>ENEMY CARDS</small>
        <b>{enemyLeft}/9</b>
      </div>
    </header>
  );
}
function Board({
  board,
  enemy,
  phase,
  traps,
  mines,
  revealed,
  concealed,
  used,
  onClick,
  onDrop,
  onDrag,
}: {
  board: Slot[];
  enemy: boolean;
  phase: Phase;
  traps: number[];
  mines: number[];
  revealed: number[];
  concealed: number[];
  used: string[];
  onClick: (i: number) => void;
  onDrop: (t: DragSource, e: React.DragEvent) => void;
  onDrag: (s: DragSource, e: React.DragEvent) => void;
}) {
  return (
    <div className={`full-board ${enemy ? "enemy-board" : "player-board"}`}>
      {board.map((u, i) => (
        <button
          key={i}
          className={`${!u && !enemy ? "vacant" : ""} ${revealed.includes(i) ? "revealed" : ""} ${!enemy && revealed.includes(i) ? "friendly-hit" : ""} ${concealed.includes(i) ? "concealed-space" : ""}`}
          onClick={() => onClick(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop({ zone: "board", index: i }, e)}
          draggable={!enemy && !!u && phase === "reposition"}
          onDragStart={(e) => onDrag({ zone: "board", index: i }, e)}
        >
          <span className="slot-number">{i + 1}</span>
          {enemy ? (
            <div className="character-card card-back">
              <Shield />
              <b>HIDDEN</b>
            </div>
          ) : u ? (
            <>
              <CharacterCard unit={u} used={used.includes(u.id)} />
              {traps.includes(i) && (
                <span className="trap-marker">
                  <Crosshair /> TRAP ARMED
                </span>
              )}
              {mines.includes(i) && (
                <span className="mine-marker">
                  <Bomb /> MINE ARMED
                </span>
              )}
            </>
          ) : traps.includes(i) ? (
            <TrapCard />
          ) : mines.includes(i) ? (
            <MineCard />
          ) : (
            <span className="vacant-label">VACANT</span>
          )}
          {concealed.includes(i) && (
            <span className="conceal-tag">
              <Eye /> CONCEALED
            </span>
          )}
          {revealed.includes(i) && (
            <span className="reveal-tag">
              {enemy ? (
                <>
                  <Eye /> {u ? "OCCUPIED" : "ATTACKED"}
                </>
              ) : (
                <>
                  <Crosshair /> {u ? "HIT" : "ATTACKED"}
                </>
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

# Hidden Front

Hidden Front is a two-player hidden-position tactical card game featuring Autobots, Decepticons, Maximals, and Predacons. Each player builds a nine-character team, secretly deploys six characters to a 3×3 grid, and tries to eliminate every opposing character by attacking unknown coordinates, using character abilities, and repositioning between rounds.

The browser game supports solo play against an automated opponent and private online matches through a small Socket.IO server.

## Objective

Defeat all nine characters on the opposing team. A character at 0 Health is moved to the defeated pile unless an ability saves or revives it. The player with no surviving deployed or Backup characters loses.

If neither team takes damage for four complete rounds, the stalemate rule decides the result:

1. The team with more surviving characters wins.
2. If tied, the team with more combined remaining Health wins.
3. If both are still tied, the match is a draw.

## Building a legal team

Every deck contains exactly nine unique Character Cards:

| Class | Required |
|---|---:|
| Commander | 2 |
| Scout | 3 |
| Trooper | 2 |
| Tactician | 2 |

Factions can be mixed. The faction filters are only deck-building tools; they do not prevent a mixed team. Hover over a card to open a larger side preview with its faction, class, current Health, Damage, and complete ability text. Click a selected card again to remove it from the deck.

In online play, the server waits until both players have locked legal nine-card decks. Only then does each player see the opponent's nine-card roster. Exact starting positions and Backup choices stay secret.

## Deployment

Choose six of your nine characters and place them anywhere on your 3×3 grid. The three unplaced characters become Backups. You can drag a card or click it and then click a destination. Clicking a selected card again cancels the selection.

Both online players must finish deployment before battle begins. The server then randomly chooses the first attacker.

## Round sequence

Each round follows this order:

1. Draw one Battle Card.
2. The first player completes their entire attack turn.
3. The second player completes their entire attack turn.
4. Both players deploy any required free reinforcements from Backup.
5. Both players secretly complete their Reposition Phase.
6. A new round begins and the first attacker is chosen again at random.

The randomly selected first player gets two combat actions on the opening turn of round 1. Every later attack turn normally has three actions.

An online attack turn lasts one minute. The shrinking fuse bar shows the remaining time. When it reaches zero, the server automatically ends that player's turn. A player may also end early with unused actions, which prevents a match from getting stuck when no useful move remains. The combined Reinforcement and Reposition Phase has its own 30-second fuse; when it expires, required replacements are filled and unfinished positions lock automatically so an absent player cannot stall the match.

Either player may forfeit. A forfeit immediately awards victory to the opponent.

## Combat actions

During your attack turn, one action can be used to:

- attack an enemy coordinate;
- activate an eligible active Character Ability; or
- play a Battle Card during the opening Battle Card window.

Normally each deployed character attacks once per round. If fewer than three attack-capable characters remain deployed, the survivors may attack more than once so the team can still use all three actions. Printed abilities can also change attack limits. For example, Airrazor can attack twice when her deck contains at least three Maximals, while Grimlock can gain a special three-attack turn after defeating a Commander.

To attack, select one of your deployed characters and then select an enemy grid position. An empty position is a miss. An occupied position takes the attacker's Damage. A surviving card stays unidentified, but the coordinate is marked occupied for the rest of the round. Defeated characters are revealed. Incoming hits appear immediately on both players' screens, and your own damaged space receives a strong red hit effect.

Cards and pending actions can be deselected by clicking the same selected card again or by using the Deselect control.

## Hidden information

Players know the opponent's complete nine-card roster once both decks are locked, but do not know which six began on the board, which three are in Backup, or where deployed cards are positioned.

Some effects reveal positions temporarily or permanently. Cheetor, for example, permanently reveals the current position of the character that defeats him. If that character later repositions, the reveal follows the character. Other effects can conceal positions from detection.

The combat history deliberately records a living target as an unknown enemy. Identity is only included when the rules reveal or defeat that card.

## Battle Cards

The Battle Deck contains 30 cards with no more than eight Rare cards. One card is drawn at the start of each round. A Battle Card normally costs one combat action and must be played before any other combat action that turn. Normally only one Battle Card may be played per round.

Examples include:

- **Armor Plating:** reduces the next damage to a chosen friendly character.
- **War Dawn:** damages vulnerable characters in a selected enemy row.
- **Surprise:** checks whether two selected positions are occupied.
- **Ambush Trap:** arms an empty friendly space and cancels the next enemy attack against that coordinate.
- **Reinforce:** exchanges a Backup and deployed character without spending a Reposition Action.

Printed card wording overrides the general rules. Tigatron is immune to enemy Battle Card effects.

## Character abilities

Abilities are active, passive, or triggered. An active ability normally replaces an attack and costs one combat action. Limited abilities display their remaining uses. Passive and triggered abilities resolve automatically.

The full roster and exact wording are shown inside the game, so this guide uses only stable examples:

- **Depthcharge** can leave one hidden mine when a deployed Maximal dies. The mine deals 10 Damage to the next attacker targeting that space and is then removed.
- **Dinobot** restores to full Health after two consecutive attacks, subject to remaining uses.
- **Maximal Grimlock** increases Dinobot's available restoration uses while both are deployed.
- **Rhinox** can revive a defeated Maximal at half Health while Rhinox remains above half Health.
- **Rattrap** can prevent both teams from repositioning during the current round.
- **Silverbolt** ignores opposing Predacon abilities.
- **Galvatron** can grant shields from Backup.
- **Ravage** blocks the first hit after repositioning.

All registered character abilities, stats, and artwork paths are covered by automated regression tests.

## Reinforcement and repositioning

After both players finish attacking, empty deployed positions must be refilled from Backup until the board has six characters or no Backups remain. Required reinforcements are free.

After reinforcement, each team normally receives two Reposition Actions. One action can:

- move a deployed character into an empty space;
- swap two deployed characters; or
- exchange a deployed character with a Backup.

The board may never contain more than six characters. Dragging shows a floating image of the moving card. Click-to-select controls provide the same actions for touch devices. If Rattrap blocked repositioning, required reinforcements still occur, but both players receive zero Reposition Actions and may lock in immediately.

## Multiplayer setup

The production client is hosted on GitHub Pages and the multiplayer server is hosted on Render.

1. Open the game and choose **Multiplayer**.
2. Leave the Render server address as `https://hidden-front-server.onrender.com`.
3. Choose **Quick Match** to join the first available waiting player, or enter a player name and shared room code for a private room.
4. Both players press **I am ready**.
5. Build and lock decks, study the revealed opponent roster, and secretly deploy six characters.

Render's free service may sleep when inactive. The first connection after a quiet period can take roughly a minute while the server wakes up. Both players should keep the game page open during a match.

## Online co-op Quintesson Raid

Choose **Quintesson Raid** from the main menu and share a Raid room code with
one friend. This is a separate two-player PvE Boss Rush: both players build
legal nine-character decks, then take turns placing six characters onto their
own 3-by-3 board. The two player boards sit side by side, with each player's
board highlighted for them and locked to that player's controls. The boss
court is visible beside both boards at the same time: the Judge occupies a
larger leader space, while the boss faction's 2-by-3 troop board shows
concealed enemy cards.

Each round gives the first player two actions and the second player two actions,
then the server runs the boss turn. Player order reverses for the next round.
One shared Battle Card is drawn for the round and only one may be played across
both player turns. Each player gets one Reposition move; after attacking, the
boss court uses two Reposition moves of its own.
The Bailiff halves damage to the Judge, the Prosecutor marks the lowest-Health
player character for +10 damage on the next Quintesson strike, the Executor
deals +10 to characters at half Health or lower, and additional Allicons gain up
to +10 damage from their pack. The Judge begins at 700 Health and, at the start
of each boss turn, revives one defeated Quintesson troop at half Health; if none
are defeated, he places one Allicon, with no more than two Allicons on the
board. Defeat the Judge to win. The Boss Rush viewport keeps both compact 3×3
player boards and the Judge's larger court panel visible together. Solo
minimax targets a face-down belief state: it remembers only confirmed occupied
or empty coordinates, forgets that knowledge after secret repositioning, and
never reads concealed card identities. Boss Rush minimax similarly evaluates
the court as anonymous hidden slots while retaining the boss's private rules.

## Development

Requirements:

- Node.js 22.13 or newer
- npm

Install dependencies and run the verified test suite:

```bash
npm ci
npm test
```

Run the web client for local development:

```bash
npm run dev
```

Run the multiplayer server:

```bash
CLIENT_ORIGIN=http://localhost:3000 npm start
```

The server listens on `PORT` when provided and exposes `/health`. `CLIENT_ORIGIN` accepts a comma-separated list of allowed browser origins. `TURN_DURATION_MS` defaults to `60000` and can be shortened only for automated tests.

Important project files:

- `app/page.tsx` — game interface and match interaction logic
- `app/globals.css` — responsive layouts, effects, and selectable themes
- `lib/card-data.ts` — character and Battle Card registry
- `lib/combat-engine.mjs` — reusable and tested combat rules
- `server.mjs` — private PvP and Raid rooms, phase gating, boss AI, live events, turn timers, and forfeits
- `tests/` — engine, roster, ability, and multiplayer integration tests

## Deployment

Pushing the production branch updates the GitHub Pages client and triggers Render to rebuild the Node server from the same repository. Render should use:

- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`
- `CLIENT_ORIGIN=https://pugtimusprime.github.io`

The server is intentionally authoritative for room readiness, deck and deployment gates, attack-turn order, the one-minute attack timer, the 30-second Reposition Phase timer, phase entry, and forfeits. Combat results are sent immediately to the opponent so both boards remain synchronized.

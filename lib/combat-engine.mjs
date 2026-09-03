export const ROLE_LIMITS = { Commander: 2, Scout: 3, Trooper: 2, Tactician: 2 };
export const BOARD_LIMIT = 6;

export function validateDeck(units) {
  if (units.length !== 9) return false;
  return Object.entries(ROLE_LIMITS).every(
    ([role, needed]) => units.filter((unit) => unit.role === role).length === needed,
  );
}

export function canPlayBattleCard({ phase, actionsLeft, battleCardPlayed }) {
  return phase === "combat" && actionsLeft === 3 && !battleCardPlayed;
}

export function applyDamage(unit, amount, reduction = 0) {
  const damage = Math.max(0, amount - reduction);
  return { unit: { ...unit, hp: Math.max(0, unit.hp - damage) }, damage };
}

export function applyAttackDamage(unit, amount, reduction = 0) {
  if (unit.ravageGuard) {
    return {
      unit: { ...unit, ravageGuard: false },
      damage: 0,
      blocked: true,
    };
  }
  if ((unit.shield ?? 0) > 0) {
    return {
      unit: {
        ...unit,
        shield: unit.shield - 1,
        timedShield: unit.timedShield ? false : unit.timedShield,
        shieldUntil: unit.timedShield ? undefined : unit.shieldUntil,
        abilityUses: unit.timedShield ? unit.abilityUses : Math.max(0, (unit.abilityUses ?? 1) - 1),
      },
      damage: 0,
      blocked: true,
    };
  }
  return { ...applyDamage(unit, amount, reduction), blocked: false };
}

export function canEndCombat(actionsLeft) {
  return actionsLeft === 0;
}

export function resolveTrap(trapPositions, targetPosition) {
  const triggered = trapPositions.includes(targetPosition);
  return {
    triggered,
    traps: triggered ? trapPositions.filter((position) => position !== targetPosition) : [...trapPositions],
  };
}

export function hiddenAttackMessage({ attackerName, target, damage, hit, defeatedName }) {
  if (!hit) return `${attackerName} attacked position ${target + 1} — empty.`;
  if (defeatedName) return `Enemy defeated at position ${target + 1}: ${defeatedName} revealed.`;
  return `${attackerName} hit an unknown enemy at position ${target + 1} for ${damage}.`;
}

export function reposition(board, backups, source, target) {
  const nextBoard = [...board];
  const nextBackups = [...backups];
  if (source.zone === target.zone && source.index === target.index) {
    return { board: nextBoard, backups: nextBackups, moved: false, reason: "same_position" };
  }
  if (source.zone === "board" && target.zone === "board") {
    if (!nextBoard[source.index]) return { board: nextBoard, backups: nextBackups, moved: false, reason: "empty_source" };
    [nextBoard[source.index], nextBoard[target.index]] = [nextBoard[target.index], nextBoard[source.index]];
  } else if (source.zone === "backup" && target.zone === "board") {
    const incoming = nextBackups[source.index];
    const outgoing = nextBoard[target.index];
    if (!incoming) return { board: nextBoard, backups: nextBackups, moved: false, reason: "empty_source" };
    if (!outgoing && nextBoard.filter(Boolean).length >= BOARD_LIMIT) {
      return { board: nextBoard, backups: nextBackups, moved: false, reason: "board_limit" };
    }
    nextBoard[target.index] = incoming ?? null;
    if (outgoing) nextBackups[source.index] = outgoing;
    else nextBackups.splice(source.index, 1);
  } else if (source.zone === "board" && target.zone === "backup") {
    const outgoing = nextBoard[source.index];
    const incoming = nextBackups[target.index];
    if (!outgoing || !incoming) return { board: nextBoard, backups: nextBackups, moved: false, reason: "empty_source" };
    nextBoard[source.index] = incoming ?? null;
    if (outgoing) nextBackups[target.index] = outgoing;
  } else {
    return { board: nextBoard, backups: nextBackups, moved: false, reason: "invalid_move" };
  }
  return { board: nextBoard, backups: nextBackups, moved: true, reason: null };
}

export function stalemateResult(playerBoard, playerBackups, enemyBoard, enemyBackups) {
  const playerUnits = [...playerBoard, ...playerBackups].filter(Boolean);
  const enemyUnits = [...enemyBoard, ...enemyBackups].filter(Boolean);
  if (playerUnits.length !== enemyUnits.length) return playerUnits.length > enemyUnits.length ? "victory" : "defeat";
  const playerHealth = playerUnits.reduce((sum, unit) => sum + unit.hp, 0);
  const enemyHealth = enemyUnits.reduce((sum, unit) => sum + unit.hp, 0);
  return playerHealth === enemyHealth ? "draw" : playerHealth > enemyHealth ? "victory" : "defeat";
}

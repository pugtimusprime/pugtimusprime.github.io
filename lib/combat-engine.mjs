export const ROLE_LIMITS = { Commander: 2, Scout: 3, Trooper: 2, Tactician: 2 };
export const BOARD_LIMIT = 6;

export function validateDeck(units) {
  if (units.length !== 9) return false;
  const standard = Object.entries(ROLE_LIMITS).every(
    ([role, needed]) =>
      units.filter((unit) => unit.role === role).length === needed,
  );
  const barrageFormation =
    units.some((unit) => unit.id === "barrage") &&
    units.filter((unit) => unit.role === "Commander").length === 3 &&
    units.filter((unit) => unit.role === "Scout").length === 2 &&
    units.filter((unit) => unit.role === "Trooper").length === 2 &&
    units.filter((unit) => unit.role === "Tactician").length === 2;
  return standard || barrageFormation;
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
        abilityUses: unit.timedShield
          ? unit.abilityUses
          : Math.max(0, (unit.abilityUses ?? 1) - 1),
      },
      damage: 0,
      blocked: true,
    };
  }
  return { ...applyDamage(unit, amount, reduction), blocked: false };
}

export function canEndCombat(actionsLeft) {
  return actionsLeft >= 0;
}

function abilityKey(unit) {
  return unit?.copiedCommanderId || unit?.id;
}

export function attackLimit({ unit, board, deck, grimlockFrenzyRound, round }) {
  if (!unit) return 0;
  const deployedAttackers = board.filter((card) => card?.canAttack).length;
  if (abilityKey(unit) === "grimlock" && grimlockFrenzyRound === round)
    return 3;
  if (deployedAttackers < 3) return 3;
  if (
    unit.id === "airrazor" &&
    deck.filter((card) => card.faction === "Maximal").length >= 3
  )
    return 2;
  if (
    unit.id === "sun" &&
    board.some((card) => card?.id === "side") &&
    unit.abilityUses > 0
  )
    return 2;
  return 1;
}

export function applyCharacterAttackDamage(unit, amount, reduction = 0) {
  const result = applyAttackDamage(unit, amount, reduction);
  if (result.damage === 0 || abilityKey(unit) !== "dinobot") {
    return { ...result, restored: false };
  }
  const hitStreak = (unit.dinobotHitStreak || 0) + 1;
  if (hitStreak >= 2 && unit.abilityUses > 0) {
    return {
      unit: {
        ...result.unit,
        hp: unit.max,
        abilityUses: unit.abilityUses - 1,
        dinobotHitStreak: 0,
      },
      damage: result.damage,
      blocked: result.blocked,
      restored: true,
    };
  }
  return {
    ...result,
    unit: { ...result.unit, dinobotHitStreak: hitStreak },
    restored: false,
  };
}

export function applyBoardAuras(slots) {
  const divebombActive = slots.some((unit) => unit?.id === "dive");
  const rumbleActive = slots.some((unit) => unit?.id === "rumble");
  const maximalGrimlockActive = slots.some(
    (unit) => unit?.id === "maxgrimlock",
  );
  const optimalSupport = slots.some(
    (unit) => unit?.id === "primal" || unit?.id === "optimus",
  );
  const quickstrikeRows = new Set(
    slots
      .map((unit, index) =>
        unit?.id === "quickstrike" ? Math.floor(index / 3) : -1,
      )
      .filter((row) => row >= 0),
  );
  return slots.map((unit, index) => {
    if (!unit) return null;
    let next = unit;
    const diveShouldApply =
      divebombActive && unit.faction === "Predacon" && unit.id !== "dive";
    if (diveShouldApply && !next.diveBonus)
      next = { ...next, max: next.max + 10, hp: next.hp + 10, diveBonus: true };
    else if (!diveShouldApply && next.diveBonus)
      next = {
        ...next,
        max: next.max - 10,
        hp: Math.max(1, next.hp - 10),
        diveBonus: false,
      };
    const frenzyShouldApply = rumbleActive && next.id === "frenzy";
    if (frenzyShouldApply && !next.frenzyBonus)
      next = {
        ...next,
        max: next.max + 20,
        hp: next.hp + 20,
        frenzyBonus: true,
      };
    else if (!frenzyShouldApply && next.frenzyBonus)
      next = {
        ...next,
        max: next.max - 20,
        hp: Math.max(1, next.hp - 20),
        frenzyBonus: false,
      };
    const dinobotShouldGain = maximalGrimlockActive && next.id === "dinobot";
    if (dinobotShouldGain && !next.dinobotBonus)
      next = { ...next, abilityUses: next.abilityUses + 1, dinobotBonus: true };
    else if (!dinobotShouldGain && next.dinobotBonus)
      next = {
        ...next,
        abilityUses: Math.min(next.abilityUses, 1),
        dinobotBonus: false,
      };
    if (optimalSupport && abilityKey(next) === "optimal" && !next.optimalBoost)
      next = { ...next, dmg: 30, optimalBoost: true };
    const quickstrikeShouldApply = quickstrikeRows.has(Math.floor(index / 3));
    if (quickstrikeShouldApply && !next.quickstrikeBonus)
      next = { ...next, dmg: next.dmg + 5, quickstrikeBonus: true };
    else if (!quickstrikeShouldApply && next.quickstrikeBonus)
      next = {
        ...next,
        dmg: Math.max(0, next.dmg - 5),
        quickstrikeBonus: false,
      };
    return next;
  });
}

export function healTransmetalTarantulas(slots, defeated) {
  if (defeated?.faction !== "Predacon") return [...slots];
  return slots.map((unit) =>
    unit?.id === "transmetal-tarantulas"
      ? { ...unit, hp: Math.min(unit.max, unit.hp + 15) }
      : unit,
  );
}

export function healFaction(slots, faction, amount) {
  return slots.map((unit) =>
    unit?.faction === faction
      ? { ...unit, hp: Math.min(unit.max, unit.hp + amount) }
      : unit,
  );
}

export function hasTarantulasDraw(board, enemyBoard) {
  return (
    board.some((unit) => unit?.id === "tarantulas") &&
    enemyBoard.filter((unit) => unit?.role === "Commander").length >= 2
  );
}

export function isFullFactionTeam(units, faction) {
  return units.length === 9 && units.every((unit) => unit?.faction === faction);
}

export function isBattleCardImmune(unit) {
  return abilityKey(unit) === "tigatron";
}

export function isPredaconAbilityImmune(unit) {
  return abilityKey(unit) === "silverbolt";
}

export function canRhinoxRevive(rhinox, defeated) {
  return (
    abilityKey(rhinox) === "rhinox" &&
    rhinox.hp > rhinox.max / 2 &&
    rhinox.abilityUses > 0 &&
    defeated.some((unit) => unit.faction === "Maximal")
  );
}

export function reviveAtHalf(unit) {
  return {
    ...unit,
    hp: Math.ceil(unit.max / 2),
    canAttack: true,
    poison: 0,
    dinobotHitStreak: 0,
  };
}

export function shouldLayDepthchargeMine(board, defeated) {
  return (
    defeated?.faction === "Maximal" &&
    board.some((unit) => abilityKey(unit) === "depthcharge")
  );
}

export function resolveTrap(trapPositions, targetPosition) {
  const triggered = trapPositions.includes(targetPosition);
  return {
    triggered,
    traps: triggered
      ? trapPositions.filter((position) => position !== targetPosition)
      : [...trapPositions],
  };
}

export function hiddenAttackMessage({
  attackerName,
  target,
  damage,
  hit,
  defeatedName,
}) {
  if (!hit) return `${attackerName} attacked position ${target + 1} — empty.`;
  if (defeatedName)
    return `Enemy defeated at position ${target + 1}: ${defeatedName} revealed.`;
  return `${attackerName} hit an unknown enemy at position ${target + 1} for ${damage}.`;
}

export function reposition(board, backups, source, target) {
  const nextBoard = [...board];
  const nextBackups = [...backups];
  if (source.zone === target.zone && source.index === target.index) {
    return {
      board: nextBoard,
      backups: nextBackups,
      moved: false,
      reason: "same_position",
    };
  }
  if (source.zone === "board" && target.zone === "board") {
    if (!nextBoard[source.index])
      return {
        board: nextBoard,
        backups: nextBackups,
        moved: false,
        reason: "empty_source",
      };
    [nextBoard[source.index], nextBoard[target.index]] = [
      nextBoard[target.index],
      nextBoard[source.index],
    ];
  } else if (source.zone === "backup" && target.zone === "board") {
    const incoming = nextBackups[source.index];
    const outgoing = nextBoard[target.index];
    if (!incoming)
      return {
        board: nextBoard,
        backups: nextBackups,
        moved: false,
        reason: "empty_source",
      };
    if (!outgoing && nextBoard.filter(Boolean).length >= BOARD_LIMIT) {
      return {
        board: nextBoard,
        backups: nextBackups,
        moved: false,
        reason: "board_limit",
      };
    }
    nextBoard[target.index] = incoming ?? null;
    if (outgoing) nextBackups[source.index] = outgoing;
    else nextBackups.splice(source.index, 1);
  } else if (source.zone === "board" && target.zone === "backup") {
    const outgoing = nextBoard[source.index];
    const incoming = nextBackups[target.index];
    if (!outgoing || !incoming)
      return {
        board: nextBoard,
        backups: nextBackups,
        moved: false,
        reason: "empty_source",
      };
    nextBoard[source.index] = incoming ?? null;
    if (outgoing) nextBackups[target.index] = outgoing;
  } else {
    return {
      board: nextBoard,
      backups: nextBackups,
      moved: false,
      reason: "invalid_move",
    };
  }
  return { board: nextBoard, backups: nextBackups, moved: true, reason: null };
}

export function stalemateResult(
  playerBoard,
  playerBackups,
  enemyBoard,
  enemyBackups,
) {
  const playerUnits = [...playerBoard, ...playerBackups].filter(Boolean);
  const enemyUnits = [...enemyBoard, ...enemyBackups].filter(Boolean);
  if (playerUnits.length !== enemyUnits.length)
    return playerUnits.length > enemyUnits.length ? "victory" : "defeat";
  const playerHealth = playerUnits.reduce((sum, unit) => sum + unit.hp, 0);
  const enemyHealth = enemyUnits.reduce((sum, unit) => sum + unit.hp, 0);
  return playerHealth === enemyHealth
    ? "draw"
    : playerHealth > enemyHealth
      ? "victory"
      : "defeat";
}

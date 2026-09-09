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

export function matchesRole(unit, role) {
  return Boolean(unit && (unit.role === role || unit.allClasses));
}

export function matchesFaction(unit, faction) {
  return Boolean(unit && (unit.faction === faction || unit.allFactions));
}

export function empowerBreakdown(attacker, defeated) {
  if (
    attacker?.id !== "breakdown" ||
    attacker.abilityUses <= 0 ||
    !matchesRole(defeated, "Scout")
  )
    return attacker;
  return {
    ...attacker,
    max: attacker.max + 10,
    hp: attacker.hp + 10,
    abilityUses: attacker.abilityUses - 1,
  };
}

export function triggerBrawlLastStand(unit) {
  if (unit?.id !== "brawl" || unit.abilityUses <= 0 || unit.brawlLastStand)
    return null;
  return {
    ...unit,
    hp: 1,
    abilityUses: unit.abilityUses - 1,
    brawlLastStand: true,
    canAttack: true,
  };
}

export function rescueOnslaught(unit, allies) {
  if (unit?.id !== "onslaught") return null;
  const blastOff = allies.find(
    (ally) => ally?.id === "blast-off" && ally.abilityUses > 0,
  );
  if (!blastOff) return null;
  return {
    revived: { ...unit, hp: Math.ceil(unit.max / 2) },
    blastOffId: blastOff.id,
  };
}

export function applyDamage(unit, amount, reduction = 0) {
  if (unit.damageImmune) return { unit: { ...unit }, damage: 0, blocked: true };
  const damage = Math.max(0, amount - reduction);
  return { unit: { ...unit, hp: Math.max(0, unit.hp - damage) }, damage };
}

export function applyAttackDamage(unit, amount, reduction = 0) {
  if (unit.damageImmune) {
    return {
      unit: { ...unit },
      damage: 0,
      blocked: true,
    };
  }
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
  if (unit.id === "ultra-mammoth" && unit.ultraMammothRushRound === round)
    return 4;
  if (
    unit.id === "mixmaster" &&
    board.some((card) => card?.id === "bonecrusher")
  )
    return 2;
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

export function applyDeckPassives(units) {
  const alphaTrion = units.some((unit) => unit.id === "alpha-trion");
  const blaster = units.some((unit) => unit.id === "blaster");
  return units.map((unit) => {
    let next = { ...unit };
    if (alphaTrion && unit.faction === "Autobot")
      next = { ...next, max: next.max + 5, hp: next.hp + 5 };
    if (blaster && (unit.id === "eject" || unit.id === "steeljaw"))
      next = { ...next, dmg: next.dmg + 10 };
    if (unit.id === "beachcomber") next = { ...next, canAttack: false };
    return next;
  });
}

export function applyRoundPassives(slots, round, reserves = []) {
  let next = slots.map((unit) => {
    if (!unit) return unit;
    if (unit.id === "dirge")
      return { ...unit, hp: Math.min(unit.max, unit.hp + 5) };
    return unit;
  });
  const livingScouts = [...next, ...reserves].filter(
    (unit) => unit?.role === "Scout" && unit.hp > 0,
  );
  next = next.map((unit) => {
    if (!unit || unit.id !== "dropshot") return unit;
    const shouldBoost = livingScouts.length === 1;
    if (shouldBoost && !unit.dropshotBoosted)
      return {
        ...unit,
        max: unit.max + 15,
        hp: unit.hp + 15,
        dropshotBoosted: true,
      };
    if (!shouldBoost && unit.dropshotBoosted)
      return {
        ...unit,
        max: unit.max - 15,
        hp: Math.min(unit.hp, unit.max - 15),
        dropshotBoosted: false,
      };
    return unit;
  });
  const chromia = next.find(
    (unit) => unit?.id === "chromia" && unit.chromiaHealUntil >= round,
  );
  if (chromia && Number.isInteger(chromia.chromiaHealSlot)) {
    const target = next[chromia.chromiaHealSlot];
    if (target)
      next[chromia.chromiaHealSlot] = {
        ...target,
        hp: Math.min(target.max, target.hp + 10),
      };
  }
  const brainstormIndex = next.findIndex(
    (unit) =>
      unit?.id === "brainstorm" &&
      !unit.brainstormTurretPlaced &&
      round - (unit.brainstormDeployedRound ?? round) >= 3,
  );
  const vacancy = next.findIndex((unit) => !unit);
  if (brainstormIndex >= 0 && vacancy >= 0) {
    const brainstorm = next[brainstormIndex];
    next[brainstormIndex] = { ...brainstorm, brainstormTurretPlaced: true };
    next[vacancy] = {
      id: `brainstorm-turret-${round}`,
      name: "Brainstorm Turret",
      faction: brainstorm.faction,
      role: "Trooper",
      max: 20,
      hp: 20,
      dmg: 15,
      ability: "Locked emplacement: cannot be repositioned.",
      image: brainstorm.image,
      abilityUses: 0,
      canAttack: true,
      locked: true,
    };
  }
  return next;
}

export function repositionBlurr(slots, round, random = Math.random) {
  const from = slots.findIndex(
    (unit) => unit?.id === "blurr" && unit.blurrLastMovedRound !== round,
  );
  const vacancies = slots
    .map((unit, index) => (!unit ? index : -1))
    .filter((index) => index >= 0);
  if (from < 0 || !vacancies.length) return [...slots];
  const to = vacancies[Math.floor(random() * vacancies.length)];
  const next = [...slots];
  next[to] = { ...next[from], blurrLastMovedRound: round };
  next[from] = null;
  return next;
}

export function isCharacterAbilityImmune(unit, actorFaction, round) {
  return (
    unit?.id === "ramjet" &&
    actorFaction !== "Decepticon" &&
    (unit.ramjetImmuneUntil ?? 0) >= round
  );
}

export function lastStandDamage(unit, livingCount) {
  return unit?.id === "blight" && livingCount === 1 ? 40 : unit?.dmg || 0;
}

export function healFrontRow(slots, amount = 5) {
  return slots.map((unit, index) =>
    unit && index < 3
      ? { ...unit, hp: Math.min(unit.max, unit.hp + amount) }
      : unit,
  );
}

export function transferHealth(source, target) {
  const missing = Math.max(0, target.max - target.hp);
  const amount = Math.min(missing, Math.max(0, source.hp - 1));
  return {
    amount,
    source: { ...source, hp: source.hp - amount },
    target: { ...target, hp: target.hp + amount },
  };
}

export function hunGrrrWins(slots, round, requiredRound = 5) {
  return slots.some(
    (unit) =>
      unit?.id === "hun-grrr" &&
      unit.hunGrrrEligible &&
      unit.hp === unit.max &&
      round >= requiredRound,
  );
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

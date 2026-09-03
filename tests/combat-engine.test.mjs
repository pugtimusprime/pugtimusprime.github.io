import assert from "node:assert/strict";
import test from "node:test";
import { applyAttackDamage, applyDamage, canEndCombat, canPlayBattleCard, hiddenAttackMessage, reposition, resolveTrap, stalemateResult, validateDeck } from "../lib/combat-engine.mjs";

const unit = (role, hp = 50, name = role) => ({ id: name, name, role, hp, max: hp, dmg: 10 });

test("accepts the required nine-character class structure", () => {
  const deck = [unit("Commander"),unit("Commander"),unit("Scout"),unit("Scout"),unit("Scout"),unit("Trooper"),unit("Trooper"),unit("Tactician"),unit("Tactician")];
  assert.equal(validateDeck(deck), true);
});

test("rejects illegal class structures", () => {
  assert.equal(validateDeck(Array.from({ length: 9 }, () => unit("Scout"))), false);
});

test("Battle Cards only open before any combat action", () => {
  assert.equal(canPlayBattleCard({ phase:"combat", actionsLeft:3, battleCardPlayed:false }), true);
  assert.equal(canPlayBattleCard({ phase:"combat", actionsLeft:2, battleCardPlayed:false }), false);
  assert.equal(canPlayBattleCard({ phase:"combat", actionsLeft:3, battleCardPlayed:true }), false);
});

test("damage cannot reduce Health below zero", () => {
  assert.equal(applyDamage(unit("Scout", 10), 25).unit.hp, 0);
});

test("armour reduction is applied once to damage", () => {
  const result = applyDamage(unit("Scout", 50), 25, 10);
  assert.equal(result.damage, 15);
  assert.equal(result.unit.hp, 35);
});

test("Terrorsaur's shield fully blocks the first attack and is then spent", () => {
  const result = applyAttackDamage({ ...unit("Tactician", 70, "Terrorsaur"), shield:1, abilityUses:1 }, 30);
  assert.equal(result.damage, 0);
  assert.equal(result.unit.hp, 70);
  assert.equal(result.unit.shield, 0);
  assert.equal(result.blocked, true);
});

test("Ravage blocks the first hit after repositioning without losing Health", () => {
  const result = applyAttackDamage({ ...unit("Scout", 50, "Ravage"), ravageGuard:true }, 30);
  assert.equal(result.damage, 0);
  assert.equal(result.unit.hp, 50);
  assert.equal(result.unit.ravageGuard, false);
  assert.equal(result.blocked, true);
});

test("Galvatron's timed shield blocks one hit without spending the target ability", () => {
  const result = applyAttackDamage({ ...unit("Scout", 50, "Shielded"), shield:1, timedShield:true, shieldUntil:2, abilityUses:1 }, 30);
  assert.equal(result.damage, 0);
  assert.equal(result.unit.hp, 50);
  assert.equal(result.unit.shield, 0);
  assert.equal(result.unit.timedShield, false);
  assert.equal(result.unit.abilityUses, 1);
  assert.equal(result.blocked, true);
});

test("combat may end early when no useful action remains", () => {
  assert.equal(canEndCombat(3), true);
  assert.equal(canEndCombat(1), true);
  assert.equal(canEndCombat(0), true);
});

test("an Ambush Trap cancels only the attack on its exact position", () => {
  assert.deepEqual(resolveTrap([2,7],2), { triggered:true, traps:[7] });
  assert.deepEqual(resolveTrap([2,7],4), { triggered:false, traps:[2,7] });
});

test("a trap protects a friendly character that later moves onto its space", () => {
  const friendly=unit("Scout",50,"Protected Scout");
  const trap=resolveTrap([4],4);
  const after=trap.triggered?friendly:applyAttackDamage(friendly,25).unit;
  assert.equal(after.hp,50);
  assert.deepEqual(trap.traps,[]);
});

test("living enemy identity never leaks into hit messages", () => {
  const message = hiddenAttackMessage({ attackerName:"Optimus", target:2, damage:15, hit:true });
  assert.equal(message.includes("Megatron"), false);
  assert.match(message, /unknown enemy/);
});

test("defeated enemy identity is revealed", () => {
  assert.match(hiddenAttackMessage({ attackerName:"Optimus", target:2, damage:15, hit:true, defeatedName:"Megatron" }), /Megatron revealed/);
});

test("board reposition can move into a vacancy", () => {
  const a=unit("Scout",50,"A"); const result=reposition([a,null],[unit("Scout",50,"B")],{zone:"board",index:0},{zone:"board",index:1});
  assert.equal(result.board[0],null); assert.equal(result.board[1].name,"A");
});

test("Backup swaps with the selected deployed character", () => {
  const a=unit("Scout",50,"A"),b=unit("Trooper",60,"B"); const result=reposition([a],[b],{zone:"backup",index:0},{zone:"board",index:0});
  assert.equal(result.board[0].name,"B"); assert.equal(result.backups[0].name,"A");
});

test("a seventh character cannot enter the board", () => {
  const board=Array.from({length:6},(_,i)=>unit("Scout",50,`Board ${i}`)).concat([null,null,null]);
  const result=reposition(board,[unit("Trooper",60,"Backup")],{zone:"backup",index:0},{zone:"board",index:7});
  assert.equal(result.moved,false);
  assert.equal(result.reason,"board_limit");
  assert.equal(result.board.filter(Boolean).length,6);
});

test("swapping a Backup with a deployed card keeps six characters deployed", () => {
  const board=Array.from({length:6},(_,i)=>unit("Scout",50,`Board ${i}`)).concat([null,null,null]);
  const result=reposition(board,[unit("Trooper",60,"Backup")],{zone:"backup",index:0},{zone:"board",index:2});
  assert.equal(result.moved,true);
  assert.equal(result.board.filter(Boolean).length,6);
  assert.equal(result.backups[0].name,"Board 2");
});

test("selecting the same position does not spend a reposition", () => {
  const result=reposition([unit("Scout")],[],{zone:"board",index:0},{zone:"board",index:0});
  assert.equal(result.moved,false);
  assert.equal(result.reason,"same_position");
});

test("stalemate checks surviving cards before total Health", () => {
  assert.equal(stalemateResult([unit("Scout")],[unit("Scout")],[unit("Scout")],[]),"victory");
  assert.equal(stalemateResult([unit("Scout",20)],[],[unit("Scout",10)],[]),"victory");
  assert.equal(stalemateResult([unit("Scout",20)],[],[unit("Scout",20)],[]),"draw");
});

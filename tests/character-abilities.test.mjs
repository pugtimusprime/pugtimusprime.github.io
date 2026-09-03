import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { allUnits } from "../lib/card-data.ts";
import {
  applyBoardAuras,
  applyCharacterAttackDamage,
  attackLimit,
  canRhinoxRevive,
  isBattleCardImmune,
  isPredaconAbilityImmune,
  reviveAtHalf,
  shouldLayDepthchargeMine,
} from "../lib/combat-engine.mjs";

const abilitySignals = {
  optimus:/avoid death/i, grimlock:/all 3 attacks/i, bee:/\+5 Damage/i,
  wheelie:/cannot be revealed/i, eject:/swap Eject/i, sun:/attack twice/i,
  side:/returns to full Health/i, ratchet:/row heals 15/i, wheeljack:/Scouts gain \+5/i,
  elita:/disables enemy Commander/i, brawn:/scraps 2 Battle Cards/i,
  getaway:/copy it/i, grapple:/every Autobot in your Backups/i,
  highbrow:/Tactician abilities/i, hoist:/replace every Battle Card/i,
  megatron:/heal any Decepticon/i, overlord:/scrap 4 Battle Cards/i,
  soundwave:/draw 3 Battle Cards/i, bombshell:/damages itself/i,
  shrapnel:/Kickback attacks once more/i, starscream:/restore Starscream/i,
  thunder:/heals Thundercracker for 20/i, dreadwing:/deny any Battle Card/i,
  shockwave:/30-Damage attack/i, skywarp:/freely move Skywarp/i,
  fangry:/remain with 20 Health/i, kickback:/heal any deployed character/i,
  bludgeon:/select 3 spaces/i, frenzy:/Health becomes 60/i,
  galvatron:/give 2 deployed characters a shield/i, jhiaxus:/reveal all characters in their Backups/i,
  laserbeak:/Megatron and Soundwave cannot be detected/i, ravage:/first enemy attack/i,
  rumble:/draw 1 Battle Card/i, razor:/combine with one Backup/i,
  pmega:/reorder their deployed cards/i, dive:/other Predacons gain 10 Health/i,
  scorp:/lethal hit for a Commander/i, wasp:/positions of all 3 Scouts/i,
  rampage:/draw 2 Battle Cards/i, rampagebw:/heal 15 every 3 turns/i,
  head:/both cards die/i, arachnia:/poison damage for 3 rounds/i,
  terror:/blocks the first attack/i, primal:/permanently gains \+10 Health/i,
  airrazor:/attack twice each round/i, cheetor:/position revealed permanently/i,
  depthcharge:/10-Damage mine/i, dinobot:/attacked twice in a row/i,
  maxgrimlock:/Dinobot's ability has 2 uses/i, optimal:/30 Damage/i,
  tigatron:/immune to enemy Battle Card/i, rattrap:/neither team may reposition/i,
  rhinox:/revive a defeated Maximal/i, silverbolt:/Predacon abilities have no effect/i,
};

test("every character ability has an explicit regression case", async (t) => {
  assert.deepEqual(Object.keys(abilitySignals).sort(), allUnits.map(unit=>unit.id).sort());
  for (const unit of allUnits) {
    await t.test(`${unit.name}: ability text and artwork`, () => {
      assert.match(unit.ability, abilitySignals[unit.id]);
      const imageUrl = new URL(`../public${unit.image}`, import.meta.url);
      assert.equal(existsSync(imageUrl), true, `${unit.name} artwork exists at ${unit.image}`);
    });
  }
});

const maximal = (id) => ({...allUnits.find(unit=>unit.id===id)});

test("small deployed teams can spend all three actions with surviving attackers", () => {
  const airrazor=maximal("airrazor"), cheetor=maximal("cheetor");
  assert.equal(attackLimit({unit:cheetor,board:[cheetor,airrazor],deck:[cheetor,airrazor],round:2}),3);
});

test("Airrazor attacks twice when the deck contains three Maximals", () => {
  const airrazor=maximal("airrazor"), deck=[airrazor,maximal("cheetor"),maximal("rhinox")];
  const board=[airrazor,maximal("cheetor"),maximal("rhinox"),maximal("tigatron")];
  assert.equal(attackLimit({unit:airrazor,board,deck,round:2}),2);
});

test("Dinobot restores to full Health on the second consecutive hit", () => {
  const first=applyCharacterAttackDamage(maximal("dinobot"),10).unit;
  const second=applyCharacterAttackDamage(first,10);
  assert.equal(second.restored,true);
  assert.equal(second.unit.hp,second.unit.max);
  assert.equal(second.unit.abilityUses,0);
});

test("Maximal Grimlock grants Dinobot a second restoration use", () => {
  const board=applyBoardAuras([maximal("dinobot"),maximal("maxgrimlock")]);
  assert.equal(board[0].abilityUses,2);
  assert.equal(board[0].dinobotBonus,true);
});

test("Optimal Optimus permanently reaches 30 Damage with either Optimus support", () => {
  const board=applyBoardAuras([maximal("optimal"),maximal("primal")]);
  assert.equal(board[0].dmg,30);
  assert.equal(board[0].optimalBoost,true);
});

test("Tigatron and Silverbolt apply their printed immunities", () => {
  assert.equal(isBattleCardImmune(maximal("tigatron")),true);
  assert.equal(isPredaconAbilityImmune(maximal("silverbolt")),true);
  assert.equal(isBattleCardImmune(maximal("silverbolt")),false);
});

test("Rhinox can revive a defeated Maximal at half Health only while healthy", () => {
  const rhinox=maximal("rhinox"), fallen={...maximal("cheetor"),hp:0};
  assert.equal(canRhinoxRevive(rhinox,[fallen]),true);
  assert.equal(reviveAtHalf(fallen).hp,20);
  assert.equal(canRhinoxRevive({...rhinox,hp:35},[fallen]),false);
});

test("Depthcharge leaves a mine only for a defeated Maximal", () => {
  assert.equal(shouldLayDepthchargeMine([maximal("depthcharge")],maximal("cheetor")),true);
  assert.equal(shouldLayDepthchargeMine([maximal("depthcharge")],allUnits.find(unit=>unit.id==="bee")),false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { allUnits, rosters, starterDeck } from "../lib/card-data.ts";
import { validateDeck } from "../lib/combat-engine.mjs";

const expected = {
  getaway:["Getaway","Autobot","Trooper",80,20],
  grapple:["Grapple","Autobot","Tactician",50,15],
  highbrow:["Highbrow","Autobot","Tactician",50,15],
  hoist:["Hoist","Autobot","Tactician",70,10],
  bludgeon:["Bludgeon","Decepticon","Trooper",60,5],
  frenzy:["Frenzy","Decepticon","Scout",40,5],
  galvatron:["Galvatron","Decepticon","Commander",80,20],
  jhiaxus:["Jhiaxus","Decepticon","Tactician",70,10],
  laserbeak:["Laserbeak","Decepticon","Scout",40,5],
  ravage:["Ravage","Decepticon","Scout",50,10],
  rumble:["Rumble","Decepticon","Scout",50,10],
  airrazor:["Airrazor","Maximal","Trooper",80,20],
  cheetor:["Cheetor","Maximal","Scout",40,5],
  depthcharge:["Depthcharge","Maximal","Commander",70,10],
  dinobot:["Dinobot","Maximal","Trooper",60,25],
  maxgrimlock:["Maximal Grimlock","Maximal","Scout",50,10],
  optimal:["Optimal Optimus","Maximal","Commander",80,20],
  tigatron:["Tigatron","Maximal","Tactician",50,15],
  rattrap:["Rattrap","Maximal","Scout",50,10],
  rhinox:["Rhinox","Maximal","Tactician",70,10],
  silverbolt:["Silverbolt","Maximal","Trooper",80,20],
};

test("all newly supplied characters have the printed names, teams, classes and stats", () => {
  for (const [id,[name,faction,role,max,dmg]] of Object.entries(expected)) {
    const unit = allUnits.find(card => card.id === id);
    assert.ok(unit, `${name} is in the roster`);
    assert.deepEqual([unit.name,unit.faction,unit.role,unit.max,unit.dmg],[name,faction,role,max,dmg]);
    const imageName={maxgrimlock:"maximal-grimlock",optimal:"optimal-optimus"}[id]||id;
    assert.equal(unit.image, `/cards/characters/${imageName}.png`);
  }
});

test("the expanded faction totals stay correct", () => {
  assert.equal(rosters.Autobot.length, 15);
  assert.equal(rosters.Decepticon.length, 19);
  assert.equal(rosters.Maximal.length, 11);
});

test("Bludgeon is registered as a Trooper", () => {
  const bludgeon = allUnits.find(card => card.id === "bludgeon");
  assert.equal(bludgeon?.role, "Trooper");
});

test("expanded faction starter decks remain legal nine-card decks", () => {
  assert.equal(validateDeck(starterDeck("Autobot")), true);
  assert.equal(validateDeck(starterDeck("Decepticon")), true);
  assert.equal(validateDeck(starterDeck("Maximal")), true);
});

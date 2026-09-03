import assert from "node:assert/strict";
import test from "node:test";
import { allUnits, rosters, starterDeck } from "../lib/card-data.ts";
import { validateDeck } from "../lib/combat-engine.mjs";

const expected = {
  getaway:["Getaway","Autobot","Trooper",80,20],
  grapple:["Grapple","Autobot","Tactician",50,15],
  highbrow:["Highbrow","Autobot","Tactician",50,15],
  hoist:["Hoist","Autobot","Tactician",70,10],
  bludgeon:["Bludgeon","Decepticon","Scout",60,5],
  frenzy:["Frenzy","Decepticon","Scout",40,5],
  galvatron:["Galvatron","Decepticon","Commander",80,20],
  jhiaxus:["Jhiaxus","Decepticon","Tactician",70,10],
  laserbeak:["Laserbeak","Decepticon","Scout",40,5],
  ravage:["Ravage","Decepticon","Scout",50,10],
  rumble:["Rumble","Decepticon","Scout",50,10],
};

test("the eleven supplied characters have the printed names, teams, classes and stats", () => {
  for (const [id,[name,faction,role,max,dmg]] of Object.entries(expected)) {
    const unit = allUnits.find(card => card.id === id);
    assert.ok(unit, `${name} is in the roster`);
    assert.deepEqual([unit.name,unit.faction,unit.role,unit.max,unit.dmg],[name,faction,role,max,dmg]);
    assert.equal(unit.image, `/cards/characters/${id}.png`);
  }
});

test("the roster gained exactly four Autobots and seven Decepticons", () => {
  assert.equal(rosters.Autobot.length, 15);
  assert.equal(rosters.Decepticon.length, 19);
});

test("Autobot and Decepticon starter decks remain legal nine-card decks", () => {
  assert.equal(validateDeck(starterDeck("Autobot")), true);
  assert.equal(validateDeck(starterDeck("Decepticon")), true);
});

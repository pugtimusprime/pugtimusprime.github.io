import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(
  new URL("../app/page.tsx", import.meta.url),
  "utf8",
);
const css = await readFile(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const server = await readFile(
  new URL("../server.mjs", import.meta.url),
  "utf8",
);

test("card details are hover-driven without the redundant deck preview", () => {
  assert.doesNotMatch(page, /className="deck-ability-preview"/);
  assert.match(page, /battleDeck\.map\(\(name\) =>/);
  assert.match(page, /onMouseLeave=\{\(\) => setInspectedUnit\(null\)\}/);
});

test("deck filter counts react to the opposite filter", () => {
  assert.match(page, /classFilterPool = allUnits\.filter/);
  assert.match(page, /factionFilterPool = allUnits\.filter/);
  assert.match(page, /poolRoleCount/);
  assert.match(page, /poolFactionCount/);
  assert.match(page, /\{classFilterPool\.length\}/);
  assert.match(page, /\{factionFilterPool\.length\}/);
});

test("settings contains the theme picker and optional filter counts", () => {
  assert.match(page, /className="settings-menu"/);
  assert.match(page, /Show available-card counts/);
  assert.match(page, /hidden-front-filter-counts/);
  assert.match(page, /\["nemesis", "Nemesis Flight Deck"\]/);
  assert.match(css, /html\[data-theme="nemesis"\]/);
});

test("settings saves five Character Card borders and the new update theme", () => {
  assert.match(page, /hidden-front-card-border/);
  assert.match(page, /data-card-border=\{cardBorder\}/);
  for (const id of [
    "energon-edge",
    "matrix-relic",
    "decepticon-alloy",
    "beast-claw",
    "cybertron-neon",
  ])
    assert.match(page, new RegExp(`\\["${id}",`));
  assert.match(page, /\["vectorsigma", "Vector Sigma Vault"\]/);
  assert.match(css, /html\[data-theme="vectorsigma"\]/);
  for (const id of [
    "energon-edge",
    "matrix-relic",
    "decepticon-alloy",
    "beast-claw",
    "cybertron-neon",
  ])
    assert.match(css, new RegExp(`data-card-border="${id}"`));
});

test("combat history is unlimited while its badge caps at 99+", () => {
  assert.doesNotMatch(page, /\.slice\(0,100\)/);
  assert.match(page, /log\.length > 99 \? "99\+" : log\.length/);
});

test("rules and history modals are centered and viewport-height", () => {
  assert.match(
    css,
    /\[data-slot="dialog-content"\]\.rules-modal,\[data-slot="dialog-content"\]\.log-modal\{position:fixed!important;inset:auto!important;top:50dvh!important;left:50dvw!important;[^}]*translate:-50% -50%!important;transform:none!important/,
  );
  assert.match(page, /\["metroplex", "Metroplex Grid"\]/);
});

test("the server owns a 30-second reposition deadline", () => {
  assert.match(server, /REPOSITION_DURATION_MS \|\| 30_000/);
  assert.match(server, /reposition-start/);
  assert.match(server, /completeReposition\(room, true\)/);
});

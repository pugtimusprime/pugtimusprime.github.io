import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");

test("card details are hover-driven without the redundant deck preview", () => {
  assert.doesNotMatch(page, /className="deck-ability-preview"/);
  assert.match(page, /battleDeck\.map\(name=><figure[^>]*onMouseEnter/);
  assert.match(page, /onMouseLeave=\{\(\)=>setInspectedUnit\(null\)\}/);
});

test("deck filters show total pool, class, faction and visible-result counts", () => {
  assert.match(page, /poolRoleCount/);
  assert.match(page, /poolFactionCount/);
  assert.match(page, /CHARACTERS TOTAL/);
  assert.match(page, /Showing <b>\{filtered\.length\}<\/b> of <b>\{allUnits\.length\}<\/b> characters/);
});

test("Omega Sentinel remains available as the update theme", () => {
  assert.match(page, /\["omega","Omega Sentinel"\]/);
  assert.match(css, /html\[data-theme="omega"\]/);
});

test("combat history is unlimited while its badge caps at 99+", () => {
  assert.doesNotMatch(page, /\.slice\(0,100\)/);
  assert.match(page, /log\.length>99\?"99\+":log\.length/);
});

test("rules and history modals are centered and viewport-height", () => {
  assert.match(css, /\.rules-modal,\.log-modal\{position:fixed!important;top:50%!important;left:50%!important;transform:translate\(-50%,-50%\)!important;[^}]*height:calc\(100dvh - 16px\)!important/);
});

test("the server owns a 30-second reposition deadline", () => {
  assert.match(server, /REPOSITION_DURATION_MS \|\| 30_000/);
  assert.match(server, /reposition-start/);
  assert.match(server, /completeReposition\(room, true\)/);
});

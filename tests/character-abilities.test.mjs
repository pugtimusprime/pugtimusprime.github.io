import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { allUnits } from "../lib/card-data.ts";
const source=fs.readFileSync(path.join(process.cwd(),"app/page.tsx"),"utf8");
test("all characters have ability data and renderable character asset references",()=>{for(const u of allUnits){assert.ok(u.ability.trim(),`${u.id} ability`);assert.match(u.image,/^\/cards\/characters\//,`${u.id} asset`)}});
test("all limited-use abilities are represented in gameplay code",()=>{for(const u of allUnits.filter(x=>x.abilityUses>0)){assert.ok(source.includes(`"${u.id}"`),`${u.id} implementation reference`)}});

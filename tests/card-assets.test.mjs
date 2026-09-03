import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { allUnits, battleCards } from "../lib/card-data.ts";

const root = new URL("..", import.meta.url);

function readAsset(assetPath) {
  return readFileSync(new URL(`.${assetPath}`, root));
}

function validatePng(assetPath) {
  const data = readAsset(assetPath);
  assert.equal(data.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${assetPath} has a PNG signature`);
  const idat = [];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString("ascii");
    const end = offset + 12 + length;
    assert.ok(end <= data.length, `${assetPath} contains a complete ${type} chunk`);
    if (type === "IDAT") idat.push(data.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") { ended = true; break; }
    offset = end;
  }
  assert.equal(ended, true, `${assetPath} ends cleanly`);
  assert.doesNotThrow(() => inflateSync(Buffer.concat(idat)), `${assetPath} image data decompresses`);
}

test("every referenced Character Card image is complete", async (t) => {
  for (const unit of allUnits) {
    await t.test(unit.name, () => validatePng(`/public${unit.image}`));
  }
});

test("every referenced Battle Card asset is complete", async (t) => {
  for (const [name, card] of Object.entries(battleCards)) {
    if (!card.image) continue;
    await t.test(name, () => {
      const path = `/public${card.image}`;
      if (card.image.endsWith(".png")) validatePng(path);
      else {
        const svg = readAsset(path).toString("utf8");
        assert.match(svg, /^<svg[\s\S]*<\/svg>\s*$/);
      }
    });
  }
});

test("the repaired large cards also exist in the GitHub Pages root", () => {
  assert.deepEqual(readAsset("/public/cards/characters/depthcharge.png"), readAsset("/cards/characters/depthcharge.png"));
  assert.deepEqual(readAsset("/public/cards/battle/war-dawn.svg"), readAsset("/cards/battle/war-dawn.svg"));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { intents, placeIn, templateAnswer, verdict, acceptOpener, isHindi } from "../web/lib/advisor.js";
import { band } from "../web/lib/report.js";

const report = {
  place: "New Delhi",
  pm25: { now: 140, avg24h: 132, band: band(132) },
  windows: [
    { date: "2026-10-20", best: { from: "2026-10-20T15:00", to: "2026-10-20T16:00", pm25: 98 }, worst: { t: "2026-10-20T20:00", pm25: 190 } },
    { date: "2026-10-21", best: { from: "2026-10-21T14:00", to: "2026-10-21T15:00", pm25: 80 }, worst: { t: "2026-10-21T21:00", pm25: 170 } },
  ],
  smoke: { shareLast24h: 0.31, shareNext24h: 0.22, firesLast24h: 400 },
};

test("intents and places", () => {
  assert.ok(intents("Can my kids play outside?").activity);
  assert.ok(intents("Do I need a mask").mask);
  assert.ok(intents("इस धुएँ में पराली का कितना हिस्सा है?").fires);
  assert.equal(placeIn("Is it safe to walk in Lucknow tomorrow?"), "Lucknow");
  assert.equal(placeIn("लखनऊ में हवा कैसी है?"), "लखनऊ");
  assert.equal(placeIn("can my kids play outside"), null);
});

test("template answers use the report's numbers and the asker's language", () => {
  const en = templateAnswer("Can my kids play outside this evening?", report);
  assert.match(en, /132/);
  assert.match(en, /Very Poor/);
  assert.match(en, /15:00 to 17:00/);
  assert.match(en, /children/);
  const hi = templateAnswer("क्या आज मास्क पहनना चाहिए?", report);
  assert.ok(isHindi(hi));
  assert.match(hi, /N95/);
  const tomorrow = templateAnswer("When should I walk tomorrow?", report);
  assert.match(tomorrow, /14:00 to 16:00/);
});

test("the model's opener must agree with the verdict and carry no numbers", () => {
  const q = "Can my kids play outside?";
  assert.equal(verdict(q, report).level, "avoid");
  assert.ok(acceptOpener("It is better to keep the kids indoors today and avoid long play outside.", q, report));
  assert.ok(!acceptOpener("Yes, it is a great evening for the kids to play!", q, report));
  assert.ok(!acceptOpener("Keep them in, PM2.5 is 87.", q, report));
  assert.equal(verdict("How much is from stubble burning?", report).level, "info");
  assert.ok(!acceptOpener("Yes", "Do I need a mask today?", report));
  assert.ok(acceptOpener("Yes, please wear a fitted N95 mask when you go out.", "Do I need a mask today?", report));
});

test("a question about part of the day is judged on those hours", () => {
  const hourly = [];
  for (const d of ["2026-10-20", "2026-10-21"]) for (let h = 0; h < 24; h++) hourly.push({ t: `${d}T${String(h).padStart(2, "0")}:00`, pm25: h >= 6 && h < 10 ? 110 : 40 });
  const r = { ...report, pm25: { now: 40, avg24h: 50, band: band(50) }, hourly };
  assert.equal(verdict("Can I go for a walk in the afternoon?", r).level, "ok");
  assert.equal(verdict("Is it safe to walk tomorrow morning?", r).level, "caution");
});

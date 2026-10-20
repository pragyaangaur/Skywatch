// Turns a report and a question into an answer. Everything here is deterministic: the
// numbers always come from the report, and the on-device model in helper.js only rewords them.

import { band } from "./report.js";

export const isHindi = (s) => /[ऀ-ॿ]/.test(s);

// What the person is asking about. Several can be true at once.
export function intents(q) {
  const s = q.toLowerCase();
  return {
    activity: /\b(kid|kids|child|children|play|walk|run|jog|exercise|gym|cycle|cricket|school|outside|outdoor|out)\b|बच्च|खेल|टहल|दौड़|सैर|बाहर|स्कूल|व्यायाम/.test(s),
    mask: /\b(mask|n95|n99|purifier)\b|मास्क|प्यूरीफायर/.test(s),
    fires: /\b(stubble|parali|farm|fire|fires|crop|burning|punjab|haryana)\b|पराली|आग|खेत|फसल|जल/.test(s),
    when: /\b(when|time|hour|morning|evening|tomorrow|today)\b|कब|समय|सुबह|शाम|कल|आज/.test(s),
    health: /\b(asthma|cough|breath|breathless|chest|heart|lung|pregnan|elderly|old)\b|दमा|खांसी|साँस|सांस|दिल|फेफड़|बुज़ुर्ग|बुजुर्ग|गर्भ/.test(s),
  };
}

// A place named in the question, if any. Kept simple on purpose: "in Lucknow", "for Agra", "लखनऊ में".
export function placeIn(q) {
  const en = q.match(/\b(?:in|at|for|near|around)\s+([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+)?)/);
  if (en) return en[1];
  // \b only knows ASCII letters, so the end of the Hindi word is matched by hand.
  const hi = q.match(/([ऀ-ॿ]{2,})\s+(?:में|मे)(?=$|[\s?।,!])/);
  if (hi && !/(हवा|शहर|बाहर|घर|आज|कल|सुबह|शाम)/.test(hi[1])) return hi[1];
  return null;
}

const pct = (x) => (x == null ? null : Math.round(100 * x));
const hhmm = (t) => t.slice(11, 16);

// A day's cleanest window, and its worst hour when that hour is clearly worse and not part of the window.
function windowFacts(w) {
  const from = hhmm(w.best.from), to = `${String(+w.best.to.slice(11, 13) + 1).padStart(2, "0")}:00`;
  const worstH = +w.worst.t.slice(11, 13), fromH = +from.slice(0, 2), toH = +to.slice(0, 2);
  const clear = (worstH < fromH - 1 || worstH > toH) && w.worst.pm25 > 1.15 * w.best.pm25;
  return { from, to, pm: Math.round(w.best.pm25), worst: clear ? hhmm(w.worst.t) : null, worstPm: Math.round(w.worst.pm25) };
}

// The numbers an answer may use, in a flat form that both the templates and the model read.
export function facts(r) {
  const b = band(r.pm25.avg24h);
  const w = r.windows;
  return {
    place: r.place,
    pm24: Math.round(r.pm25.avg24h),
    pmNow: r.pm25.now == null ? null : Math.round(r.pm25.now),
    band: b,
    sensitiveRisk: ["Poor", "Very Poor", "Severe"].includes(b.name),
    everyoneRisk: ["Very Poor", "Severe"].includes(b.name),
    today: w[0] ? windowFacts(w[0]) : null,
    tomorrow: w[1] ? windowFacts(w[1]) : null,
    fireNow: r.smoke ? pct(r.smoke.shareLast24h) : null,
    fireNext: r.smoke ? pct(r.smoke.shareNext24h) : null,
    fireCount: r.smoke ? r.smoke.firesLast24h : null,
  };
}

// The template answer. It is shown at once and is the whole answer when no model is loaded.
export function templateAnswer(q, r) {
  const f = facts(r);
  const it = intents(q);
  const general = !Object.values(it).some(Boolean);
  const wantsTomorrow = /tomorrow|कल/.test(q.toLowerCase());
  const win = wantsTomorrow && f.tomorrow ? f.tomorrow : f.today || f.tomorrow;
  const winDay = win === f.tomorrow && (wantsTomorrow || !f.today);
  if (isHindi(q)) {
    const out = [`${f.place} में पिछले 24 घंटे का औसत PM2.5 लगभग ${f.pm24} µg/m³ है, जो CPCB पैमाने पर "${f.band.hi}" है।`];
    const per = askedPeriod(q, r);
    if (per) out.push(`${per.tomorrow ? "कल" : "आज"} ${per.hi} का औसत PM2.5 लगभग ${per.pm} है ("${per.band.hi}")।`);
    if ((it.activity || it.when || general) && win) out.push(`${winDay ? "कल" : "आज"} बाहर जाने का सबसे साफ़ समय ${win.from} से ${win.to} बजे तक है (PM2.5 लगभग ${win.pm})${win.worst ? `; ${win.worst} बजे के आसपास हवा सबसे खराब रहेगी` : ""}।`);
    if ((it.fires || general) && f.fireNow != null) out.push(`इस PM2.5 का लगभग ${f.fireNow}% हिस्सा पराली और खेतों की आग के धुएँ से है; कल के लिए अनुमान ${f.fireNext}% है।`);
    if (it.activity || it.health || general) out.push(f.everyoneRisk ? "सभी लोग लंबी या भारी बाहरी गतिविधि से बचें, और बच्चे, बुज़ुर्ग और दमा या दिल के मरीज़ जितना हो सके घर के अंदर रहें।" : f.sensitiveRisk ? "बच्चे, बुज़ुर्ग और दमा, दिल या फेफड़ों के मरीज़ लंबी या भारी बाहरी गतिविधि से बचें।" : "ज़्यादातर लोगों के लिए बाहर रहना ठीक है; दमा या दिल के मरीज़ ध्यान रखें।");
    if (it.mask) out.push(f.sensitiveRisk ? "बाहर ठीक से फिट होने वाला N95 या N99 मास्क पहनें; कपड़े या सर्जिकल मास्क से ज़्यादा फ़ायदा नहीं होता।" : "आज ज़्यादातर लोगों को मास्क की ज़रूरत नहीं है; संवेदनशील लोग चाहें तो N95 पहनें।");
    if (it.health) out.push("साँस फूलना या सीने में दर्द हो तो डॉक्टर को दिखाएँ।");
    return out.join(" ");
  }
  const out = [`${f.place}: the 24 hour average PM2.5 is about ${f.pm24} µg/m³, which is ${f.band.name} on the CPCB scale.`];
  const per = askedPeriod(q, r);
  if (per) out.push(`${per.tomorrow ? "Tomorrow" : "This"} ${per.en} averages about ${per.pm} µg/m³ (${per.band.name}).`);
  if ((it.activity || it.when || general) && win) out.push(`The cleanest time to be outside ${winDay ? "tomorrow" : "today"} is ${win.from} to ${win.to} (PM2.5 about ${win.pm}).${win.worst ? ` Avoid the hours around ${win.worst}, when it reaches about ${win.worstPm}.` : ""}`);
  if ((it.fires || general) && f.fireNow != null) out.push(`About ${f.fireNow}% of this PM2.5 is smoke from farm fires, and about ${f.fireNext}% is expected tomorrow.`);
  if (it.activity || it.health || general) out.push(f.everyoneRisk ? "Everyone should avoid long or hard exercise outdoors, and children, older people and anyone with asthma or heart disease should stay indoors as much as they can." : f.sensitiveRisk ? "Children, older people and anyone with asthma, heart or lung disease should avoid long or hard exercise outdoors." : "Most people can be outside normally. People with asthma or heart disease should take it easier.");
  if (it.mask) out.push(f.sensitiveRisk ? "Outdoors, wear an N95 or N99 mask that fits well. Cloth and surgical masks do little against PM2.5." : "Most people do not need a mask today. Sensitive people can wear an N95 if they like.");
  if (it.health) out.push("If you have breathlessness or chest pain, see a doctor.");
  return out.join(" ");
}

const PERIODS = [
  { re: /\bmorning\b|सुबह/, from: 6, to: 10, en: "morning", hi: "सुबह" },
  { re: /\bafternoon\b|दोपहर/, from: 12, to: 16, en: "afternoon", hi: "दोपहर" },
  { re: /\bevening\b|शाम/, from: 17, to: 21, en: "evening", hi: "शाम" },
  { re: /\bnight\b|रात/, from: 21, to: 24, en: "night", hi: "रात" },
];

// The hours the question asks about, such as "tomorrow morning", with their average PM2.5.
export function askedPeriod(q, r) {
  const s = q.toLowerCase();
  const p = PERIODS.find((x) => x.re.test(s));
  if (!p || !r.hourly?.length) return null;
  const day0 = r.hourly[0].t.slice(0, 10);
  const days = [...new Set(r.hourly.map((h) => h.t.slice(0, 10)))];
  const day = /tomorrow|कल/.test(s) ? days[days.indexOf(day0) + 1] : day0;
  const hrs = r.hourly.filter((h) => h.t.slice(0, 10) === day && +h.t.slice(11, 13) >= p.from && +h.t.slice(11, 13) < p.to && h.pm25 != null);
  if (!hrs.length) return null;
  const pm = hrs.reduce((x, h) => x + h.pm25, 0) / hrs.length;
  return { ...p, day, tomorrow: day !== day0, pm: Math.round(pm), band: band(pm) };
}

// The verdict SkyWatch has already reached for the question. The model only puts it in words.
export function verdict(q, r) {
  const f = facts(r);
  const it = intents(q);
  if (it.fires && !it.activity && !it.mask) {
    if (f.fireNow == null) return { level: "unknown", kind: "fires", text: "SkyWatch cannot estimate the farm-fire share for this place." };
    return { level: "info", kind: "fires", text: `A ${f.fireNow >= 30 ? "large" : f.fireNow >= 15 ? "noticeable" : "small"} part of the smoke here comes from farm fires.` };
  }
  if (it.mask) return f.sensitiveRisk ? { level: "caution", kind: "mask", text: "Yes, wear a fitted N95 mask outdoors today." } : { level: "ok", kind: "mask", text: "No, most people do not need a mask today." };
  // A question about a part of the day is judged on those hours, not on the daily average.
  const per = askedPeriod(q, r);
  const name = per ? per.band.name : f.band.name;
  const when = per ? `${per.tomorrow ? "tomorrow" : "this"} ${per.en}` : "today";
  if (["Very Poor", "Severe"].includes(name)) return { level: "avoid", kind: "activity", text: `No. The air ${when} is very poor, so keep outdoor time short and keep children indoors as much as possible.` };
  if (name === "Poor") return { level: "caution", kind: "activity", text: `Not the best time. The air ${when} is poor, so keep it short and easy, or go at the cleanest hour instead.` };
  if (name === "Moderate") return { level: "caution", kind: "activity", text: `Yes for most people, but take it easy. The air ${when} is moderate, and children or anyone with asthma should not overdo it.` };
  return { level: "ok", kind: "activity", text: `Yes, the air ${when} is fine for most people.` };
}

// Messages for the on-device model, which only writes the opening sentence of an English
// answer. Small browser models lose numbers and write poor Hindi, so the facts always come
// from the template and Hindi questions are answered by the Hindi template alone.
export function modelMessages(q, r) {
  const v = verdict(q, r);
  return [
    {
      role: "system",
      content: "You write the first sentence of a reply for SkyWatch, a clean-air helper in India. You are given a question and SkyWatch's verdict. Write one short, warm sentence that answers the question with that verdict. Keep the verdict's meaning exactly. Do not use any numbers, times or place names. Do not add advice that is not in the verdict. Write only the sentence.",
    },
    { role: "user", content: `Question: ${q}\nVerdict: ${v.text}` },
  ];
}

// The opening sentence is kept only if it has no numbers, is a real sentence and does not
// contradict the verdict. For masks "yes" means "wear one", so the check is done separately.
export function acceptOpener(text, q, r) {
  const s = text.trim();
  if (!s || s.length > 220 || /\d/.test(s.replace(/\b(N95|N99|PM2\.5)\b/gi, "")) || s.split(/\s+/).length < 4) return false;
  const v = verdict(q, r);
  const says = (re) => re.test(s);
  if (v.kind === "mask") {
    const wear = says(/\b(yes|wear|should|need to|must)\b/i) && !says(/\b(no|not|don't|do not|needn't)\b/i);
    return v.level === "ok" ? !wear : wear;
  }
  const positive = says(/\b(yes|safe|fine|okay|ok|go ahead|no problem|perfect|great|good)\b/i);
  const negative = says(/\b(no|not|avoid|indoors|limit|short|careful|caution|easy|don't|poor)\b/i);
  if (v.level === "avoid" && !negative) return false;
  if (v.level === "caution" && positive && !negative) return false;
  if (v.level === "ok" && negative && !positive) return false;
  return true;
}

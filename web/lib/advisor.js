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
    today: w[0] ? { from: hhmm(w[0].best.from), to: `${String(+w[0].best.to.slice(11, 13) + 1).padStart(2, "0")}:00`, pm: Math.round(w[0].best.pm25), worst: hhmm(w[0].worst.t), worstPm: Math.round(w[0].worst.pm25) } : null,
    tomorrow: w[1] ? { from: hhmm(w[1].best.from), to: `${String(+w[1].best.to.slice(11, 13) + 1).padStart(2, "0")}:00`, pm: Math.round(w[1].best.pm25), worst: hhmm(w[1].worst.t), worstPm: Math.round(w[1].worst.pm25) } : null,
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
    if ((it.activity || it.when || general) && win) out.push(`${winDay ? "कल" : "आज"} बाहर जाने का सबसे साफ़ समय ${win.from} से ${win.to} बजे तक है (PM2.5 लगभग ${win.pm}); ${win.worst} बजे के आसपास हवा सबसे खराब रहेगी।`);
    if ((it.fires || general) && f.fireNow != null) out.push(`इस PM2.5 का लगभग ${f.fireNow}% हिस्सा पराली और खेतों की आग के धुएँ से है; कल के लिए अनुमान ${f.fireNext}% है।`);
    if (it.activity || it.health || general) out.push(f.everyoneRisk ? "सभी लोग लंबी या भारी बाहरी गतिविधि से बचें, और बच्चे, बुज़ुर्ग और दमा या दिल के मरीज़ जितना हो सके घर के अंदर रहें।" : f.sensitiveRisk ? "बच्चे, बुज़ुर्ग और दमा, दिल या फेफड़ों के मरीज़ लंबी या भारी बाहरी गतिविधि से बचें।" : "ज़्यादातर लोगों के लिए बाहर रहना ठीक है; दमा या दिल के मरीज़ ध्यान रखें।");
    if (it.mask) out.push(f.sensitiveRisk ? "बाहर ठीक से फिट होने वाला N95 या N99 मास्क पहनें; कपड़े या सर्जिकल मास्क से ज़्यादा फ़ायदा नहीं होता।" : "आज ज़्यादातर लोगों को मास्क की ज़रूरत नहीं है; संवेदनशील लोग चाहें तो N95 पहनें।");
    if (it.health) out.push("साँस फूलना या सीने में दर्द हो तो डॉक्टर को दिखाएँ।");
    return out.join(" ");
  }
  const out = [`${f.place}: the 24 hour average PM2.5 is about ${f.pm24} µg/m³, which is ${f.band.name} on the CPCB scale.`];
  if ((it.activity || it.when || general) && win) out.push(`The cleanest time to be outside ${winDay ? "tomorrow" : "today"} is ${win.from} to ${win.to} (PM2.5 about ${win.pm}). Avoid the hours around ${win.worst}, when it reaches about ${win.worstPm}.`);
  if ((it.fires || general) && f.fireNow != null) out.push(`About ${f.fireNow}% of this PM2.5 is smoke from farm fires, and about ${f.fireNext}% is expected tomorrow.`);
  if (it.activity || it.health || general) out.push(f.everyoneRisk ? "Everyone should avoid long or hard exercise outdoors, and children, older people and anyone with asthma or heart disease should stay indoors as much as they can." : f.sensitiveRisk ? "Children, older people and anyone with asthma, heart or lung disease should avoid long or hard exercise outdoors." : "Most people can be outside normally. People with asthma or heart disease should take it easier.");
  if (it.mask) out.push(f.sensitiveRisk ? "Outdoors, wear an N95 or N99 mask that fits well. Cloth and surgical masks do little against PM2.5." : "Most people do not need a mask today. Sensitive people can wear an N95 if they like.");
  if (it.health) out.push("If you have breathlessness or chest pain, see a doctor.");
  return out.join(" ");
}

// Messages for the on-device model. The model gets the facts and the template answer and is
// asked only to answer the question in a natural way with those numbers.
export function modelMessages(q, r) {
  const f = facts(r);
  const hi = isHindi(q);
  const lines = [
    `Place: ${f.place}`,
    `PM2.5, 24 hour average: ${f.pm24} µg/m3, CPCB category ${f.band.name}${hi ? ` (${f.band.hi})` : ""}`,
    f.pmNow != null ? `PM2.5 right now: ${f.pmNow}` : null,
    f.today ? `Cleanest time today: ${f.today.from} to ${f.today.to}, PM2.5 about ${f.today.pm}. Worst around ${f.today.worst}, about ${f.today.worstPm}.` : "No daylight hours left today.",
    f.tomorrow ? `Cleanest time tomorrow: ${f.tomorrow.from} to ${f.tomorrow.to}, PM2.5 about ${f.tomorrow.pm}. Worst around ${f.tomorrow.worst}, about ${f.tomorrow.worstPm}.` : null,
    f.fireNow != null ? `Share of PM2.5 from farm-fire smoke: ${f.fireNow}% in the last 24 hours, about ${f.fireNext}% expected in the next 24 hours.` : "Farm-fire share is not available for this place.",
    `Health advice: ${f.everyoneRisk ? "everyone should avoid long or hard outdoor exercise; wear a fitted N95 outdoors" : f.sensitiveRisk ? "children, older people and people with asthma, heart or lung disease should avoid long or hard outdoor exercise; a fitted N95 helps outdoors" : "most people can be outside normally; people with asthma or heart disease should take it easier"}.`,
  ].filter(Boolean);
  return [
    {
      role: "system",
      content: `You are SkyWatch, a clean-air helper for North India. Answer the question in 2 to 4 short sentences using only the facts given. Copy numbers exactly. Do not invent any number, place or time. ${hi ? "Reply in Hindi, in Devanagari script." : "Reply in simple English."} You are not a doctor.`,
    },
    { role: "user", content: `Facts:\n${lines.join("\n")}\n\nQuestion: ${q}` },
  ];
}

// Every number in the model's reply must appear in the facts or in the template answer.
// If one does not, the reply is dropped and the template answer is shown instead.
export function grounded(reply, q, r) {
  const allowed = new Set([...JSON.stringify(facts(r)).matchAll(/\d+/g), ...templateAnswer(q, r).matchAll(/\d+/g)].map((m) => m[0]));
  ["2", "4", "24", "5", "10", "95", "99", "48", "1"].forEach((n) => allowed.add(n));
  const nums = [...reply.replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d)).matchAll(/\d+/g)].map((m) => m[0]);
  return nums.every((n) => allowed.has(n));
}

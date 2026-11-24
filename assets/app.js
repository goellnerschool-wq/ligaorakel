/* Ligaorakel – Bundesliga-Prognosen aus Statistik */
import { spieleAufbereiten, anpassen, prognose, simulieren, rueckblick } from "./modell.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pz = (v, d = 0) => (v * 100).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const zahl = (n, d = 0) => Number(n).toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const API = "https://api.openligadb.de";
const jetzt = new Date(), SAISON = jetzt.getMonth() >= 6 ? jetzt.getFullYear() : jetzt.getFullYear() - 1;
let alle = [], teams = [], T = {}, modell = null, tabelle = [], gezeigt = 1, maxSpieltag = 34;
const modellCache = new Map();

async function holen(pfad) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 25000);
  try { const r = await fetch(API + pfad, { signal: ctl.signal }); if (!r.ok) throw new Error(`Antwort ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
const logo = (id, gross) => T[id]?.icon ? `<img src="${esc(T[id].icon)}" alt="" loading="lazy" ${gross ? "" : 'width="34" height="34"'} onerror="this.outerHTML='<span class=&quot;initial&quot;>${esc((T[id].kurz || "?").slice(0, 2))}</span>'">` : `<span class="initial">${esc((T[id]?.kurz || "?").slice(0, 2))}</span>`;
const datum = ms => new Date(ms).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

/* ---------- Modell zu einem Spieltag (nur Daten davor) ---------- */
function modellFuer(spieltag) {
  if (modellCache.has(spieltag)) return modellCache.get(spieltag);
  const tag = alle.filter(s => s.saison === SAISON && s.spieltag === spieltag);
  const fertig = tag.length && tag.every(s => s.fertig);
  const stich = fertig || tag.some(s => s.fertig) ? Math.min(...tag.map(s => s.zeit)) - 36e5 : Date.now();
  const m = anpassen(alle, teams, stich, SAISON);
  modellCache.set(spieltag, m); return m;
}
function form(team, vor = Infinity) {
  return alle.filter(s => s.fertig && s.zeit < vor && (s.heim === team || s.gast === team)).sort((a, b) => b.zeit - a.zeit).slice(0, 5).reverse()
    .map(s => { const eigen = s.heim === team ? s.th : s.tg, fremd = s.heim === team ? s.tg : s.th; return eigen > fremd ? "S" : eigen === fremd ? "U" : "N"; });
}
const platzVon = id => tabelle.findIndex(t => t.teamInfoId === id || t.teamId === id) + 1;

/* ================= Held: Topspiel ================= */
function heldZeigen(st) {
  const tag = alle.filter(s => s.saison === SAISON && s.spieltag === st), m = modellFuer(st);
  if (!tag.length) return;
  const top = tag.filter(s => !s.fertig).sort((a, b) => (platzVon(a.heim) + platzVon(a.gast)) - (platzVon(b.heim) + platzVon(b.gast)))[0] || tag[0];
  const p = prognose(m, top.heim, top.gast), erster = Math.min(...tag.filter(s => !s.fertig).map(s => s.zeit));
  $("#held-saison").textContent = `1. Bundesliga ${SAISON}/${String(SAISON + 1).slice(2)} · ${st}. Spieltag`;
  $("#held-karte").innerHTML = `<div class="top-spiel zeige">
    <div class="label"><span>Topspiel des ${st}. Spieltags</span><b>${isFinite(erster) ? "Anstoß " + datum(top.zeit) : ""}</b></div>
    <div class="top-team">${logo(top.heim, true)}<strong>${esc(T[top.heim].kurz)}</strong><span style="color:var(--heim)">${pz(p.ph)} %</span></div>
    <div class="top-mitte"><div class="tipp">${p.tipp[0]}:${p.tipp[1]}</div><small>wahrscheinlichstes Ergebnis · Remis ${pz(p.pu)} %</small></div>
    <div class="top-team">${logo(top.gast, true)}<strong>${esc(T[top.gast].kurz)}</strong><span style="color:var(--gast)">${pz(p.pg)} %</span></div></div>`;
}

/* ================= Spieltag ================= */
function spieltagZeigen(st) {
  gezeigt = st; $("#st-name").textContent = `${st}. Spieltag`;
  $("#st-zurueck").disabled = st <= 1; $("#st-vor").disabled = st >= maxSpieltag;
  const tag = alle.filter(s => s.saison === SAISON && s.spieltag === st).sort((a, b) => a.zeit - b.zeit), m = modellFuer(st);
  const fertig = tag.filter(s => s.fertig).length;
  $("#spieltag-titel").textContent = fertig === tag.length && tag.length ? "Prognose vs. Ergebnis" : "Prognosen";
  $("#spiele").innerHTML = tag.map(s => {
    const p = prognose(m, s.heim, s.gast), w = [p.ph, p.pu, p.pg], vorher = w.indexOf(Math.max(...w));
    const echt = s.fertig ? (s.th > s.tg ? 0 : s.th === s.tg ? 1 : 2) : null;
    const fh = form(s.heim, s.zeit), fg = form(s.gast, s.zeit);
    const duelle = alle.filter(x => x.fertig && x.zeit < s.zeit && ((x.heim === s.heim && x.gast === s.gast) || (x.heim === s.gast && x.gast === s.heim))).sort((a, b) => b.zeit - a.zeit).slice(0, 4);
    const seg = (v, f) => `<span style="flex:${Math.max(v, .001)};background:var(--${f})" title="${pz(v)} %">${v > .12 ? pz(v) + " %" : ""}</span>`;
    return `<details class="spiel zeige">
      <summary>
        <div class="sp-kopf"><span>${datum(s.zeit)}</span>${s.fertig ? `<span class="erg">Ergebnis ${s.th}:${s.tg} <span class="${echt === vorher ? "treffer" : "daneben"}">${echt === vorher ? "✓ Tendenz richtig" : "✗ daneben"}</span></span>` : `<span>Platz ${platzVon(s.heim) || "–"} gegen ${platzVon(s.gast) || "–"}</span>`}</div>
        <div class="sp-teams">
          <div class="sp-team">${logo(s.heim)}<div><strong>${esc(T[s.heim].kurz)}</strong><div class="form" aria-label="Form: ${fh.join(" ")}">${fh.map(x => `<i class="${x}">${x}</i>`).join("")}</div></div></div>
          <div class="sp-tipp"><b>${p.tipp[0]}:${p.tipp[1]}</b><small>Tipp</small></div>
          <div class="sp-team gast">${logo(s.gast)}<div><strong>${esc(T[s.gast].kurz)}</strong><div class="form" aria-label="Form: ${fg.join(" ")}">${fg.map(x => `<i class="${x}">${x}</i>`).join("")}</div></div></div>
        </div>
        <div class="balken3" role="img" aria-label="Heimsieg ${pz(p.ph)} Prozent, Unentschieden ${pz(p.pu)} Prozent, Auswärtssieg ${pz(p.pg)} Prozent">${seg(p.ph, "heim")}${seg(p.pu, "remis")}${seg(p.pg, "gast")}</div>
      </summary>
      <div class="sp-mehr">
        <h4>Wahrscheinlichste Ergebnisse</h4>
        <div class="ergebnisse">${p.top.slice(0, 6).map(([x, y, v]) => `<div><b>${x}:${y}</b><small>${pz(v, 1)} %</small></div>`).join("")}</div>
        <h4>Kennzahlen</h4>
        <dl class="werte"><div><dt>Erwartete Tore ${esc(T[s.heim].kurz)}</dt><dd>${zahl(p.l, 2)}</dd></div><div><dt>Erwartete Tore ${esc(T[s.gast].kurz)}</dt><dd>${zahl(p.k, 2)}</dd></div>
          <div><dt>Mehr als 2,5 Tore</dt><dd>${pz(p.ueber)} %</dd></div><div><dt>Beide treffen</dt><dd>${pz(p.beide)} %</dd></div></dl>
        <h4>Letzte direkte Duelle</h4>
        ${duelle.length ? `<ul class="duelle">${duelle.map(d => `<li><span>${new Date(d.zeit).toLocaleDateString("de-DE", { month: "short", year: "numeric" })} · ${esc(T[d.heim].kurz)} – ${esc(T[d.gast].kurz)}</span><b>${d.th}:${d.tg}</b></li>`).join("")}</ul>` : `<p class="hinweis">Keine Duelle in den letzten zwei Spielzeiten.</p>`}
        ${s.ort ? `<p class="hinweis">Stadion: ${esc(s.ort)}</p>` : ""}
      </div></details>`;
  }).join("") || `<p>Für diesen Spieltag gibt es noch keine Ansetzungen.</p>`;
  beobachten();
}

/* ================= Saison-Prognose ================= */
function tabelleZeigen() {
  const offen = alle.filter(s => s.saison === SAISON && !s.fertig);
  const sim = simulieren(modell, alle.filter(s => s.saison === SAISON), teams, 5000);
  $("#tabelle-text").textContent = `Die ${offen.length} restlichen Spiele 5.000-mal simuliert: So wahrscheinlich ist jeder Tabellenplatz am Saisonende.`;
  const reihen = tabelle.map(t => ({ t, id: t.teamInfoId ?? t.teamId }));
  const feld = v => { if (v < .005) return `<td class="feld"><span></span></td>`; const a = Math.min(1, .12 + v * 1.4); return `<td class="feld"><span style="background:rgba(198,244,50,${a.toFixed(2)});color:${a > .55 ? "#07100c" : "var(--tinte)"}" title="${pz(v, 1)} %">${v >= .1 ? pz(v) : ""}</span></td>`; };
  $("#prognose-tabelle").innerHTML = `<table><thead><tr><th>#</th><th class="team">Verein</th><th>Sp.</th><th>Pkt.</th><th>Tore</th><th>Ø Pkt. Ende</th><th>Meister</th><th>Top 4</th><th>Abstieg</th>${teams.map((_, i) => `<th class="zone-kopf">${i + 1}.</th>`).join("")}</tr></thead>
    <tbody>${reihen.map(({ t, id }, i) => `<tr><td class="nr">${i + 1}</td><td class="team">${logo(id)}${esc(T[id]?.kurz || t.shortName)}</td><td>${t.matches}</td><td class="wert">${t.points}</td><td>${t.goals}:${t.opponentGoals}</td><td class="wert">${zahl(sim.punkte[id], 1)}</td>
      <td class="wert">${pz(sim.platz[id][0], sim.platz[id][0] < .1 ? 1 : 0)} %</td><td>${pz(sim.platz[id].slice(0, 4).reduce((a, b) => a + b, 0))} %</td><td>${pz(sim.platz[id][16] + sim.platz[id][17])} %</td>${sim.platz[id].map(feld).join("")}</tr>`).join("")}</tbody></table>`;
}

/* ================= Teamstärken (Streudiagramm) ================= */
function staerkenZeigen() {
  const ziel = $("#staerken-diagramm"), B = Math.max(320, Math.round(ziel.clientWidth || 1000)), H = B < 600 ? 360 : 480, l = 52, r = 24, o = 24, u = 48;
  const pkt = teams.map(t => ({ t, x: modell.A[t], y: 1 / modell.D[t] }));
  const xs = pkt.map(p => p.x), ys = pkt.map(p => p.y), x0 = Math.min(...xs) * .9, x1 = Math.max(...xs) * 1.06, y0 = Math.min(...ys) * .9, y1 = Math.max(...ys) * 1.06;
  const X = v => l + (v - x0) / (x1 - x0) * (B - l - r), Y = v => o + (1 - (v - y0) / (y1 - y0)) * (H - o - u), gr = B < 600 ? 26 : 36;
  let g = `<line class="mittel-linie" x1="${X(1)}" x2="${X(1)}" y1="${o}" y2="${H - u}"/><line class="mittel-linie" x1="${l}" x2="${B - r}" y1="${Y(1)}" y2="${Y(1)}"/>
    <text class="achsen-titel" x="${B - r}" y="${H - 12}" text-anchor="end">Angriff stärker →</text><text class="achsen-titel" x="${l}" y="${o - 8}">↑ Abwehr stärker</text>
    <text class="achse" x="${X(1) + 6}" y="${H - u + 16}">Liga-Schnitt</text>`;
  g += pkt.map(p => `<g class="punkt" data-t="${p.t}"><circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${gr / 2 + 4}" fill="rgba(255,255,255,.06)" stroke="rgba(255,255,255,.14)"/>${T[p.t].icon ? `<image href="${esc(T[p.t].icon)}" x="${X(p.x) - gr / 2}" y="${Y(p.y) - gr / 2}" width="${gr}" height="${gr}" preserveAspectRatio="xMidYMid meet" onerror="this.remove()"/>` : ""}<text x="${X(p.x)}" y="${Y(p.y) + gr / 2 + 18}" text-anchor="middle" class="achse">${esc(T[p.t].kurz)}</text><circle class="fang-p" cx="${X(p.x)}" cy="${Y(p.y)}" r="${gr / 2 + 6}" fill="transparent"/></g>`).join("");
  ziel.innerHTML = `<svg viewBox="0 0 ${B} ${H}" role="img" aria-label="Angriffs- und Abwehrstärke aller Bundesligateams">${g}</svg><div class="tooltip" hidden></div>`;
  const svg = $("svg", ziel), tip = $(".tooltip", ziel);
  $$(".punkt", svg).forEach(el => {
    const zeige = () => { const t = +el.dataset.t, b = svg.getBoundingClientRect(), p = pkt.find(q => q.t === t); tip.innerHTML = `<strong>${esc(T[t].name)}</strong>Angriff ${zahl(p.x * 100)} · Abwehr ${zahl(p.y * 100)}<br><small>100 = Liga-Schnitt</small>`; tip.hidden = false; tip.style.left = X(p.x) / B * b.width + "px"; tip.style.top = (Y(p.y) - gr / 2) / H * b.height + "px"; };
    el.addEventListener("pointerenter", zeige); el.addEventListener("pointerdown", zeige); el.addEventListener("pointerleave", () => tip.hidden = true);
  });
  $("#staerken-tabelle").innerHTML = `<table><thead><tr><th class="team">Verein</th><th>Angriff</th><th>Abwehr</th><th>Erwartete Tore daheim gg. Schnitt</th></tr></thead><tbody>${pkt.sort((a, b) => b.x / (1 / b.y) - a.x / (1 / a.y)).map(p => `<tr><td class="team">${esc(T[p.t].name)}</td><td>${zahl(p.x * 100)}</td><td>${zahl(p.y * 100)}</td><td>${zahl(modell.mu * modell.H * p.x, 2)}</td></tr>`).join("")}</tbody></table>`;
}

/* ================= Trefferquote ================= */
function bilanzZeigen() {
  const r = rueckblick(alle, teams, SAISON);
  if (!r.n) { $("#bilanz").hidden = true; return; }
  $("#bilanz-zahlen").innerHTML = [
    ["Tendenz richtig", `${pz(r.tendenz)} %`, `Sieg/Remis/Niederlage in ${r.n} Spielen`, true],
    ["Zum Vergleich: immer Heimsieg", `${pz(r.heimImmer)} %`, "einfachste Tipp-Strategie"],
    ["Exaktes Ergebnis", `${pz(r.exakt)} %`, "schon 10 % gelten als stark"],
    ["Genauer als Zufallsverteilung", `${pz(1 - r.brier / r.brierBasis)} %`, "Brier-Score gegenüber Langzeit-Schnitt"]
  ].map(([a, b, c, l]) => `<li class="zeige"><span>${a}</span><strong class="${l ? "lime" : ""}">${b}</strong><small>${c}</small></li>`).join("");
  const ziel = $("#bilanz-diagramm"), d = r.proSpieltag, B = Math.max(320, Math.round(ziel.clientWidth || 1000)), H = 230, l = 40, rr = 10, o = 16, u = 30, bw = (B - l - rr) / d.length, Y = v => o + (1 - v) * (H - o - u);
  let g = ""; [0, .25, .5, .75, 1].forEach(v => g += `<line class="raster" x1="${l}" x2="${B - rr}" y1="${Y(v)}" y2="${Y(v)}"/><text class="achse" x="${l - 6}" y="${Y(v) + 4}" text-anchor="end">${v * 100}%</text>`);
  d.forEach((x, i) => { const xa = l + i * bw + bw * .18, w = bw * .64; g += `<rect class="saeule" data-i="${i}" x="${xa}" y="${Y(x.quote)}" width="${w}" height="${Y(0) - Y(x.quote)}" rx="4"/><text class="achse" x="${xa + w / 2}" y="${H - 10}" text-anchor="middle">${x.spieltag}.</text><rect class="fang" data-i="${i}" x="${l + i * bw}" y="${o}" width="${bw}" height="${H - o - u}" fill="transparent"/>`; });
  g += `<line class="basis-linie" x1="${l}" x2="${B - rr}" y1="${Y(r.heimImmer)}" y2="${Y(r.heimImmer)}"/><text class="achse" x="${l + 6}" y="${Y(r.heimImmer) - 6}">immer Heimsieg: ${pz(r.heimImmer)} %</text>`;
  ziel.innerHTML = `<svg viewBox="0 0 ${B} ${H}" role="img" aria-label="Anteil richtiger Tendenzen je Spieltag">${g}</svg><div class="tooltip" hidden></div>`;
  const svg = $("svg", ziel), tip = $(".tooltip", ziel);
  $$(".fang", svg).forEach(f => { const i = +f.dataset.i, zeige = () => { const b = svg.getBoundingClientRect(); $$(".saeule", svg).forEach(s => s.classList.toggle("aktiv", +s.dataset.i === i)); tip.innerHTML = `<strong>${d[i].spieltag}. Spieltag</strong>${Math.round(d[i].quote * d[i].n)} von ${d[i].n} Tendenzen richtig`; tip.hidden = false; tip.style.left = (l + i * bw + bw / 2) / B * b.width + "px"; tip.style.top = Y(d[i].quote) / H * b.height + "px"; };
    f.addEventListener("pointerenter", zeige); f.addEventListener("pointerdown", zeige); f.addEventListener("pointerleave", () => { tip.hidden = true; $$(".saeule", svg).forEach(s => s.classList.remove("aktiv")); }); });
}

/* ---------- Einblenden ---------- */
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add("da"); io.unobserve(e.target); } }), { threshold: .08 });
const beobachten = () => $$(".zeige:not(.da)").forEach(el => io.observe(el));

/* ================= Start ================= */
async function start() {
  try {
    const [jetzigeSaison, vorsaison, tab] = await Promise.all([holen(`/getmatchdata/bl1/${SAISON}`), holen(`/getmatchdata/bl1/${SAISON - 1}`).catch(() => []), holen(`/getbltable/bl1/${SAISON}`).catch(() => [])]);
    [...vorsaison, ...jetzigeSaison].forEach(m => [m.team1, m.team2].forEach(t => { T[t.teamId] = { name: t.teamName, kurz: t.shortName || t.teamName, icon: t.teamIconUrl }; }));
    alle = spieleAufbereiten([...vorsaison, ...jetzigeSaison]);
    teams = [...new Set(alle.filter(s => s.saison === SAISON).flatMap(s => [s.heim, s.gast]))];
    tabelle = tab.length ? tab : teams.map(id => ({ teamInfoId: id, shortName: T[id].kurz, matches: 0, points: 0, goals: 0, opponentGoals: 0 }));
    maxSpieltag = Math.max(...alle.filter(s => s.saison === SAISON).map(s => s.spieltag));
    const naechster = alle.filter(s => s.saison === SAISON && !s.fertig).sort((a, b) => a.zeit - b.zeit)[0];
    const st = naechster ? naechster.spieltag : maxSpieltag;
    modell = anpassen(alle, teams, Date.now(), SAISON); modellCache.set(st, modell);
    heldZeigen(st); spieltagZeigen(st);
    $("#st-zurueck").onclick = () => spieltagZeigen(Math.max(1, gezeigt - 1));
    $("#st-vor").onclick = () => spieltagZeigen(Math.min(maxSpieltag, gezeigt + 1));
    setTimeout(() => { tabelleZeigen(); staerkenZeigen(); bilanzZeigen(); beobachten(); }, 30);
    $("#stand").textContent = `Stand: ${new Date().toLocaleString("de-DE", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })} Uhr.`;
    let rz; addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { staerkenZeigen(); bilanzZeigen(); }, 250); });
  } catch (e) {
    $("#held-karte").innerHTML = `<div class="fehlerbox">Die Spieldaten von OpenLigaDB konnten gerade nicht geladen werden (${esc(e.message)}).<br><button type="button" onclick="location.reload()">Erneut versuchen</button></div>`;
  }
  beobachten();
}
start();

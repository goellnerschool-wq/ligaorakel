/*
 * Ligaorakel – Statistikmodell für Bundesliga-Prognosen
 * Poisson-Modell nach Maher (1982) mit Dixon-Coles-Korrektur (1997):
 *   erwartete Heimtore  λ = μ · Heimvorteil · Angriff(Heim) · Abwehrschwäche(Gast)
 *   erwartete Gasttore  κ = μ · Angriff(Gast) · Abwehrschwäche(Heim)
 * Ältere Spiele zählen weniger (Halbwertszeit 180 Tage), die Vorsaison zusätzlich nur halb.
 * Jede Mannschaft bekommt drei „Durchschnittsspiele“ als Vorwissen, damit Aufsteiger und kleine Stichproben nicht ausreißen.
 */
const HALBWERT = 180, VORSAISON = .5, VORWISSEN = 3, RHO = -.07, MAXTORE = 9;

export function spieleAufbereiten(roh) {
  return roh.map(m => {
    const end = (m.matchResults || []).find(r => r.resultTypeID === 2) || (m.matchResults || []).slice(-1)[0];
    return {
      id: m.matchID, saison: m.leagueSeason, spieltag: m.group?.groupOrderID, zeit: new Date(m.matchDateTimeUTC || m.matchDateTime).getTime(),
      heim: m.team1.teamId, gast: m.team2.teamId, fertig: !!m.matchIsFinished && !!end,
      th: end ? end.pointsTeam1 : null, tg: end ? end.pointsTeam2 : null, ort: m.location?.locationStadium || "",
      // Live-Stand aus den Toren (OpenLigaDB trägt sie während des Spiels ein)
      lh: (m.goals || []).reduce((a, g) => Math.max(a, g.scoreTeam1 ?? 0), 0), lg: (m.goals || []).reduce((a, g) => Math.max(a, g.scoreTeam2 ?? 0), 0),
      tore: (m.goals || []).map(g => ({ minute: g.matchMinute, name: g.goalGetterName, team: g.scoringTeamId, eigentor: !!g.isOwnGoal, elfmeter: !!g.isPenalty }))
    };
  });
}

/* ---------- Modell anpassen ---------- */
export function anpassen(spiele, teams, stichtag, aktuelleSaison) {
  const daten = spiele.filter(s => s.fertig && s.zeit < stichtag).map(s => ({ ...s, w: Math.pow(.5, (stichtag - s.zeit) / 864e5 / HALBWERT) * (s.saison < aktuelleSaison ? VORSAISON : 1) }));
  const A = {}, D = {}; teams.forEach(t => { A[t] = 1; D[t] = 1; });
  // μ = Auswärtstore im Schnitt, H = Verhältnis Heim- zu Auswärtstoren (Heimvorteil)
  let sw = 0, th = 0, tg = 0;
  daten.forEach(s => { sw += s.w; th += s.w * s.th; tg += s.w * s.tg; });
  const mu = sw ? tg / sw : 1.4;
  let H = tg ? th / tg : 1.25;
  for (let it = 0; it < 60; it++) {
    const ga = {}, ea = {}, gd = {}, ed = {}; teams.forEach(t => { ga[t] = gd[t] = 0; ea[t] = ed[t] = 0; });
    let gh = 0, eh = 0;
    for (const s of daten) {
      if (!(s.heim in A) || !(s.gast in A)) continue;
      ga[s.heim] += s.w * s.th; ea[s.heim] += s.w * mu * H * D[s.gast];
      ga[s.gast] += s.w * s.tg; ea[s.gast] += s.w * mu * D[s.heim];
      gd[s.heim] += s.w * s.tg; ed[s.heim] += s.w * mu * A[s.gast];
      gd[s.gast] += s.w * s.th; ed[s.gast] += s.w * mu * H * A[s.heim];
      gh += s.w * s.th; eh += s.w * mu * A[s.heim] * D[s.gast];
    }
    const vor = VORWISSEN * mu * Math.sqrt(H);
    teams.forEach(t => { A[t] = (ga[t] + vor) / (ea[t] + vor); D[t] = (gd[t] + vor) / (ed[t] + vor); });
    const ma = teams.reduce((a, t) => a + A[t], 0) / teams.length, md = teams.reduce((a, t) => a + D[t], 0) / teams.length;
    teams.forEach(t => { A[t] /= ma; D[t] /= md; });
    if (eh) H = Math.min(1.6, Math.max(1, (gh + 25 * mu * 1.25) / (eh + 25 * mu)));   // leicht Richtung Bundesliga-Schnitt (1,25) gezogen
  }
  return { mu, H, A, D, n: daten.length };
}

/* ---------- Prognose eines Spiels ---------- */
const fak = n => { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; };
const poisson = (k, l) => Math.exp(-l) * Math.pow(l, k) / fak(k);
function tau(x, y, l, k) {   // Dixon-Coles: knappe Ergebnisse (0:0, 1:0, 0:1, 1:1) realistischer gewichten
  if (x === 0 && y === 0) return 1 - l * k * RHO;
  if (x === 0 && y === 1) return 1 + l * RHO;
  if (x === 1 && y === 0) return 1 + k * RHO;
  if (x === 1 && y === 1) return 1 - RHO;
  return 1;
}
export function prognose(m, heim, gast) {
  const l = m.mu * m.H * (m.A[heim] ?? .9) * (m.D[gast] ?? 1.1), k = m.mu * (m.A[gast] ?? .9) * (m.D[heim] ?? 1.1);
  const mat = []; let ph = 0, pu = 0, pg = 0, ueber = 0, beide = 0, summe = 0, best = [0, 0, 0];
  for (let x = 0; x <= MAXTORE; x++) { mat[x] = []; for (let y = 0; y <= MAXTORE; y++) { const p = poisson(x, l) * poisson(y, k) * tau(x, y, l, k); mat[x][y] = p; summe += p; } }
  for (let x = 0; x <= MAXTORE; x++) for (let y = 0; y <= MAXTORE; y++) {
    const p = mat[x][y] /= summe;
    if (x > y) ph += p; else if (x === y) pu += p; else pg += p;
    if (x + y > 2.5) ueber += p; if (x > 0 && y > 0) beide += p;
    if (p > best[2]) best = [x, y, p];
  }
  const top = []; for (let x = 0; x <= 5; x++) for (let y = 0; y <= 5; y++) top.push([x, y, mat[x][y]]);
  top.sort((a, b) => b[2] - a[2]);
  return { l, k, ph, pu, pg, ueber, beide, tipp: best, top: top.slice(0, 6), mat };
}

/* ---------- Saison zu Ende simulieren ---------- */
function ziehen(l) { const L = Math.exp(-l); let k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
export function simulieren(m, spiele, teams, laeufe = 5000) {
  const basis = {}; teams.forEach(t => basis[t] = { p: 0, td: 0, t: 0 });
  for (const s of spiele) if (s.fertig) {
    basis[s.heim].t += s.th; basis[s.heim].td += s.th - s.tg; basis[s.gast].t += s.tg; basis[s.gast].td += s.tg - s.th;
    if (s.th > s.tg) basis[s.heim].p += 3; else if (s.th < s.tg) basis[s.gast].p += 3; else { basis[s.heim].p++; basis[s.gast].p++; }
  }
  const offen = spiele.filter(s => !s.fertig).map(s => ({ s, l: m.mu * m.H * m.A[s.heim] * m.D[s.gast], k: m.mu * m.A[s.gast] * m.D[s.heim] }));
  const platz = {}, punkte = {}; teams.forEach(t => { platz[t] = new Array(teams.length).fill(0); punkte[t] = 0; });
  for (let r = 0; r < laeufe; r++) {
    const tab = {}; teams.forEach(t => tab[t] = { ...basis[t] });
    for (const o of offen) {
      const x = ziehen(o.l), y = ziehen(o.k), h = tab[o.s.heim], g = tab[o.s.gast];
      h.t += x; g.t += y; h.td += x - y; g.td += y - x;
      if (x > y) h.p += 3; else if (x < y) g.p += 3; else { h.p++; g.p++; }
    }
    const reihe = teams.slice().sort((a, b) => tab[b].p - tab[a].p || tab[b].td - tab[a].td || tab[b].t - tab[a].t || Math.random() - .5);
    reihe.forEach((t, i) => { platz[t][i]++; punkte[t] += tab[t].p; });
  }
  teams.forEach(t => { platz[t] = platz[t].map(v => v / laeufe); punkte[t] /= laeufe; });
  return { platz, punkte, offen: offen.length };
}

/* ---------- Rückblick: Wie gut lag das Modell in dieser Saison? ---------- */
export function rueckblick(alle, teams, saison) {
  const gespielt = [...new Set(alle.filter(s => s.saison === saison && s.fertig).map(s => s.spieltag))].sort((a, b) => a - b).filter(st => st >= 3);
  let n = 0, tendenz = 0, exakt = 0, heimImmer = 0, brier = 0, brierBasis = 0; const proSpieltag = [];
  const basisVerteilung = [.44, .25, .31];   // langjähriger Bundesliga-Schnitt: Heimsieg / Remis / Auswärtssieg
  for (const st of gespielt) {
    const tag = alle.filter(s => s.saison === saison && s.spieltag === st && s.fertig);
    const stich = Math.min(...tag.map(s => s.zeit)) - 36e5, m = anpassen(alle, teams, stich, saison);
    let treffer = 0;
    for (const s of tag) {
      const p = prognose(m, s.heim, s.gast), w = [p.ph, p.pu, p.pg], echt = s.th > s.tg ? 0 : s.th === s.tg ? 1 : 2, vorher = w.indexOf(Math.max(...w));
      n++; if (vorher === echt) { tendenz++; treffer++; } if (p.tipp[0] === s.th && p.tipp[1] === s.tg) exakt++; if (echt === 0) heimImmer++;
      brier += w.reduce((a, v, i) => a + (v - (i === echt ? 1 : 0)) ** 2, 0); brierBasis += basisVerteilung.reduce((a, v, i) => a + (v - (i === echt ? 1 : 0)) ** 2, 0);
    }
    proSpieltag.push({ spieltag: st, quote: treffer / tag.length, n: tag.length });
  }
  return { n, tendenz: n ? tendenz / n : 0, exakt: n ? exakt / n : 0, heimImmer: n ? heimImmer / n : 0, brier: n ? brier / n : 0, brierBasis: n ? brierBasis / n : 0, proSpieltag };
}

/* ---------- Live-Prognose: aktueller Stand + Poisson für die Restspielzeit ---------- */
export function liveChancen(p, lh, lg, minute) {
  const rest = Math.max(0, 90 - Math.min(90, minute)) / 90, l = p.l * rest, k = p.k * rest;
  let ph = 0, pu = 0, pg = 0;
  for (let x = 0; x <= MAXTORE; x++) for (let y = 0; y <= MAXTORE; y++) {
    const w = poisson(x, l) * poisson(y, k), a = lh + x, b = lg + y;
    if (a > b) ph += w; else if (a === b) pu += w; else pg += w;
  }
  const s = ph + pu + pg; return { ph: ph / s, pu: pu / s, pg: pg / s };
}

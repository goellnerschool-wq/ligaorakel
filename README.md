# Ligaorakel

Bundesliga-Prognosen aus Statistik (Poisson-Modell nach Dixon-Coles), Live-Modus und Ausfälle.

- `public/` – die Website (wird von Cloudflare Workers ausgeliefert, siehe `wrangler.jsonc`)
- `public/assets/ausfaelle.json` – Ausfälle für den kommenden Spieltag

## Ausfälle pflegen (`public/assets/ausfaelle.json`)

```json
{
  "spieltag": 12,
  "stand": "27.11.2026",
  "quellen": ["https://www.kicker.de/..."],
  "teams": {
    "Dortmund": { "spieler": ["Felix Nmecha"], "abwehr": 1 }
  }
}
```

- Teamnamen wie auf der Seite (Kurzname aus OpenLigaDB, z. B. `Dortmund`, `Bayern`, `Leverkusen`, `HSV`, `S04`, `Gladbach`).
- `spieler`: verletzte oder gesperrte Spieler mit Toren in dieser Saison – Abgleich über den Nachnamen.
- `abwehr`: Anzahl weiterer fehlender Stammspieler (Abwehr, Tor, Mittelfeld), höchstens 4.
- Ist `spieltag` kleiner als der nächste anstehende Spieltag, ignoriert die Seite die Liste.

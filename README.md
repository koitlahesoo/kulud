# Kulud

Isiklik kulude ja tulude arvestus. Andmebaas on Supabase'is (PostgreSQL), rakendus on staatiline veebileht (GitHub Pages).

## Seadistamine

1. Supabase'i SQL Editoris käivita järjest `schema_postgres_v3.sql` ja `02_funktsioonid.sql`.
2. Loo Authentication → Users all endale kasutaja ja lülita uute kasutajate registreerimine välja.
3. Kirjuta `config.js` faili projekti URL ja anon (publishable) võti (Settings → API).
4. Avalda kaust GitHub Pagesis (Settings → Pages → Deploy from branch).

## Lehed

- **Ülevaade**: kontode seis, kuu tulud ja kulud gruppide kaupa, planeeritud tehingud.
- **Tehingud**: kuu tehingud, otsing ja filtrid, sisestamine ja muutmine (kulu, tulu, ülekanne).
- **Kontod**, **Kululiigid**: loendite haldus.
- **Tasakaalustus**: panga saldo kontrollpunktid ja erinevus arvutatud saldost.

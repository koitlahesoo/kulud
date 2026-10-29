import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById('app');

// ------------------------------------------------------------
// Abifunktsioonid
// ------------------------------------------------------------

function h(tag, attrs = {}, ...lapsed) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const l of lapsed.flat(Infinity)) {
    if (l == null || l === false) continue;
    el.append(l instanceof Node ? l : document.createTextNode(String(l)));
  }
  return el;
}

const rahaFmt = new Intl.NumberFormat('et-EE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const raha = (n) => rahaFmt.format(Number(n) || 0);
const rahaEl = (n, tag = 'span') =>
  h(tag, { class: Number(n) < 0 ? 'kulu' : Number(n) > 0 ? 'tulu' : '' }, raha(n));

function kp(s) {
  if (!s) return '';
  const [a, k, p] = s.split('-');
  return `${p}.${k}.${a}`;
}
const tana = () => new Date().toLocaleDateString('sv-SE');
const kuuTana = () => tana().slice(0, 7);
function kuuVahemik(kuu) {
  const [a, k] = kuu.split('-').map(Number);
  const lopp = new Date(a, k, 0).getDate();
  return [`${kuu}-01`, `${kuu}-${String(lopp).padStart(2, '0')}`];
}
const kuuNimed = ['jaanuar', 'veebruar', 'märts', 'aprill', 'mai', 'juuni', 'juuli',
  'august', 'september', 'oktoober', 'november', 'detsember'];
const kuuNimi = (kuu) => `${kuuNimed[Number(kuu.slice(5)) - 1]} ${kuu.slice(0, 4)}`;
function nihutaKuu(kuu, n) {
  const [a, k] = kuu.split('-').map(Number);
  const d = new Date(a, k - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function arv(s) {
  if (s == null) return null;
  const t = String(s).replace(/\s/g, '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// Olek 3 ("makstud") on kasutusest kõrvaldatud; selle asemel on "kinnitatud".
const OLEKUD = { 0: 'kinnitatud', 1: 'planeeritud', 2: 'arve saabunud', 4: 'broneering' };
const OLEKU_VALIK = Object.entries(OLEKUD).map(([k, n]) => [Number(k), n]);
// Saldosse ja kuu kokkuvõttesse lähevad kinnitatud ja broneeringus tehingud
const SALDOSSE = [0, 4];
const KONTO_TYYBID = ['sularaha', 'pangakonto', 'krediitkaart', 'kogumiskonto'];

function teade(tekst, viga = false) {
  const el = h('div', { class: 'teade' + (viga ? ' viga' : '') }, tekst);
  document.body.append(el);
  setTimeout(() => el.remove(), viga ? 6000 : 2500);
}

async function paring(p) {
  const { data, error } = await p;
  if (error) {
    teade('Viga: ' + error.message, true);
    throw error;
  }
  return data;
}

// ------------------------------------------------------------
// Andmed, mida läheb igal pool vaja
// ------------------------------------------------------------

const vahemalu = { kontod: [], kululiigid: [] };
const kontoNimi = (id) => vahemalu.kontod.find((k) => k.konto_id === id)?.nimi ?? '?';
const kululiik = (id) => vahemalu.kululiigid.find((k) => k.kululiigi_id === id);
const kululiigiNimi = (id) => {
  const k = kululiik(id);
  return k ? `${k.grupp} / ${k.nimi}` : '';
};

async function laeYldandmed() {
  const [kontod, kululiigid] = await Promise.all([
    paring(sb.from('kontod').select('*').order('jrk').order('nimi')),
    paring(sb.from('kululiigid').select('*').order('grupp').order('kululiigi_id')),
  ]);
  vahemalu.kontod = kontod;
  vahemalu.kululiigid = kululiigid;
}

function kontoValik(valitud, { koigis = false, tyhi = false } = {}) {
  return h('select', {},
    tyhi && h('option', { value: '' }, tyhi === true ? '' : tyhi),
    vahemalu.kontod
      .filter((k) => koigis || k.aktiivne || k.konto_id === valitud)
      .map((k) => h('option', { value: k.konto_id, selected: k.konto_id === valitud }, k.nimi)));
}

function kululiigiValik(valitud, tyhiTekst = '— vali —') {
  const grupid = {};
  for (const k of vahemalu.kululiigid) {
    if (!k.aktiivne && k.kululiigi_id !== valitud) continue;
    (grupid[k.grupp || '(grupita)'] ??= []).push(k);
  }
  return h('select', {},
    h('option', { value: '' }, tyhiTekst),
    Object.entries(grupid).map(([g, liigid]) =>
      h('optgroup', { label: g },
        liigid.map((k) => h('option', { value: k.kululiigi_id, selected: k.kululiigi_id === valitud }, `${k.kululiigi_id} ${k.nimi}`)))));
}

// Kululiigi valik klaviatuurilt: number viib grupi (nt 2 → "02 ALKOHOL")
// või ID-ni (nt 203), tekst otsib nime ja grupi järgi.
function liigiKombo(valitud) {
  let val = valitud ?? null;
  let tabamused = [];
  let aktiivne = 0;
  const silt = (id) => {
    const k = kululiik(id);
    return k ? `${k.kululiigi_id} ${k.nimi}` : '';
  };
  const grupiNr = (g) => Number((g.match(/^\d+/) || [])[0]);
  const sisend = h('input', { autocomplete: 'off', placeholder: 'nr või nimi', value: silt(val) });
  const loend = h('div', { class: 'kombo-loend', hidden: true });
  const umbris = h('div', { class: 'kombo' }, sisend, loend);

  function otsi(q) {
    q = q.trim().toLowerCase();
    const liigid = vahemalu.kululiigid.filter((k) => k.aktiivne || k.kululiigi_id === val);
    if (!q) return liigid;
    if (/^\d+$/.test(q)) {
      const n = Number(q);
      return [...new Set([
        ...liigid.filter((k) => k.kululiigi_id === n),
        ...liigid.filter((k) => grupiNr(k.grupp) === n),
        ...liigid.filter((k) => String(k.kululiigi_id).startsWith(q)),
      ])];
    }
    return liigid.filter((k) => `${k.nimi} ${k.grupp}`.toLowerCase().includes(q));
  }

  function joonista() {
    let eelmineGrupp = null;
    loend.replaceChildren(...tabamused.flatMap((k, i) => {
      const read = [];
      if (k.grupp !== eelmineGrupp) read.push(h('div', { class: 'kombo-grupp' }, k.grupp));
      eelmineGrupp = k.grupp;
      read.push(h('div', {
        class: 'kombo-rida' + (i === aktiivne ? ' aktiivne' : ''),
        onmousedown: (e) => { e.preventDefault(); vali(k.kululiigi_id); },
      }, h('span', { class: 'hall' }, k.kululiigi_id), ' ', k.nimi));
      return read;
    }));
    if (tabamused.length === 0) loend.append(h('div', { class: 'kombo-grupp' }, 'ei leitud'));
    loend.querySelector('.aktiivne')?.scrollIntoView({ block: 'nearest' });
  }

  function ava(q) {
    tabamused = otsi(q);
    aktiivne = q ? 0 : Math.max(0, tabamused.findIndex((k) => k.kululiigi_id === val));
    loend.hidden = false;
    // fixed-positsioon, et dialoogi kerimisala loendit ära ei lõikaks
    const r = sisend.getBoundingClientRect();
    const all = window.innerHeight - r.bottom - 8;
    loend.style.left = r.left + 'px';
    loend.style.minWidth = r.width + 'px';
    loend.style.maxHeight = Math.min(320, Math.max(all, r.top - 8)) + 'px';
    if (all >= 200 || all >= r.top) { loend.style.top = r.bottom + 2 + 'px'; loend.style.bottom = ''; }
    else { loend.style.bottom = window.innerHeight - r.top + 2 + 'px'; loend.style.top = ''; }
    joonista();
  }
  const sulge = () => { loend.hidden = true; };

  function vali(id) {
    val = id;
    sisend.value = silt(val);
    sulge();
    umbris.dispatchEvent(new Event('change'));
  }

  sisend.addEventListener('focus', () => { sisend.select(); ava(''); });
  sisend.addEventListener('input', () => ava(sisend.value));
  sisend.addEventListener('keydown', (e) => {
    if (loend.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      aktiivne = Math.min(tabamused.length - 1, Math.max(0, aktiivne + (e.key === 'ArrowDown' ? 1 : -1)));
      joonista();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (tabamused[aktiivne]) vali(tabamused[aktiivne].kululiigi_id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      sisend.value = silt(val);
      sulge();
    }
  });
  sisend.addEventListener('blur', () => {
    if (loend.hidden) return;
    const tekst = sisend.value.trim();
    if (!tekst) vali(null);
    else if (tekst !== silt(val) && tabamused[aktiivne]) vali(tabamused[aktiivne].kululiigi_id);
    else { sisend.value = silt(val); sulge(); }
  });

  Object.defineProperty(umbris, 'value', {
    get: () => (val == null ? '' : String(val)),
    set: (v) => { val = v ? Number(v) : null; sisend.value = silt(val); },
  });
  umbris.focus = () => sisend.focus();
  return umbris;
}

// Kuupäev kujul pp.kk.aaaa. Lubab ka lühendeid: "29" (selle kuu 29.),
// "29.10", "29.10.26" ja ISO kuju "2026-10-29". value annab ISO kuupäeva.
function loeKuupaev(tekst) {
  const t = tekst.trim();
  if (!t) return '';
  let p, k, a;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [, a, k, p] = m.map(Number);
  else {
    m = t.match(/^(\d{1,2})(?:[.\/-](\d{1,2})(?:[.\/-](\d{2}|\d{4})?)?)?\.?$/);
    if (!m) return null;
    const praegu = new Date();
    p = Number(m[1]);
    k = m[2] ? Number(m[2]) : praegu.getMonth() + 1;
    a = m[3] ? Number(m[3]) : praegu.getFullYear();
    if (a < 100) a += 2000;
  }
  const d = new Date(a, k - 1, p);
  if (d.getFullYear() !== a || d.getMonth() !== k - 1 || d.getDate() !== p) return null;
  return `${a}-${String(k).padStart(2, '0')}-${String(p).padStart(2, '0')}`;
}

function kuupaevaVali(iso = '', { required = false } = {}) {
  let val = iso || '';
  const sisend = h('input', { value: kp(val), placeholder: 'pp.kk.aaaa', inputmode: 'numeric', required });
  const valija = h('input', { type: 'date', tabindex: '-1', class: 'peidetud-valija', value: val });
  const nupp = h('button', { type: 'button', class: 'ikoon', tabindex: '-1', title: 'Kalender',
    onclick: () => { valija.value = val; try { valija.showPicker(); } catch { valija.focus(); } } }, '📅');
  valija.addEventListener('change', () => { if (valija.value) { val = valija.value; sisend.value = kp(val); sisend.classList.remove('vigane'); } });
  sisend.addEventListener('blur', () => {
    const v = loeKuupaev(sisend.value);
    if (v === null) { sisend.classList.add('vigane'); return; }
    sisend.classList.remove('vigane');
    val = v;
    sisend.value = kp(val);
  });
  const umbris = h('div', { class: 'kuupaev' }, sisend, nupp, valija);
  Object.defineProperty(umbris, 'value', {
    // null = kuupäev on sisestatud, aga vigane
    get: () => { const v = loeKuupaev(sisend.value); return v === null ? null : v; },
  });
  umbris.focus = () => sisend.focus();
  return umbris;
}

// Kas tehingu rida on ülekande osa: liigita rida, mille vastas on
// sama tehingu teisel kontol vastupidise märgiga liigita rida.
function ulekandeRead(read) {
  const liigita = read.filter((r) => r.kululiigi_id == null);
  return new Set(liigita.filter((r) =>
    liigita.some((t) => t !== r && t.konto_id !== r.konto_id && Math.sign(t.summa) === -Math.sign(r.summa))));
}

function tehinguTyyp(t) {
  const read = t.tehingu_read || [];
  const ul = ulekandeRead(read);
  if (ul.size >= 2) return 'ulekanne';
  if (read.length && read.every((r) => Number(r.summa) >= 0)) return 'tulu';
  return 'kulu';
}

// ------------------------------------------------------------
// Sisselogimine ja raam
// ------------------------------------------------------------

function naitaLogin(viga) {
  const email = h('input', { type: 'email', autocomplete: 'username', required: true });
  const parool = h('input', { type: 'password', autocomplete: 'current-password', required: true });
  const vigaEl = h('div', { class: 'viga-tekst' }, viga || '');
  const vorm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      vigaEl.textContent = '';
      const { error } = await sb.auth.signInWithPassword({ email: email.value, password: parool.value });
      if (error) vigaEl.textContent = 'Sisselogimine ebaõnnestus: ' + error.message;
    },
  },
  h('div', { class: 'read', style: 'grid-template-columns:1fr' },
    h('div', {}, h('label', {}, 'E-post'), email),
    h('div', {}, h('label', {}, 'Parool'), parool)),
  h('button', { class: 'pohi', type: 'submit' }, 'Logi sisse'),
  vigaEl);
  app.replaceChildren(h('div', { class: 'login' }, h('div', { class: 'kaart' }, h('h1', {}, 'Kulud'), vorm)));
  email.focus();
}

const LEHED = {
  ylevaade: { nimi: 'Ülevaade', f: lehtYlevaade },
  tehingud: { nimi: 'Tehingud', f: lehtTehingud },
  kontod: { nimi: 'Kontod', f: lehtKontod },
  kululiigid: { nimi: 'Kululiigid', f: lehtKululiigid },
  tasakaalustus: { nimi: 'Tasakaalustus', f: lehtTasakaalustus },
};

let sisu;
let kasutajaEpost = '';

function joonistaRaam() {
  const leht = location.hash.replace(/^#\/?/, '').split('?')[0] || 'ylevaade';
  sisu = h('main', { class: 'sisu' });
  const kylg = h('nav', { class: 'kylg' },
    h('div', { class: 'logo' }, 'Kulud'),
    Object.entries(LEHED).map(([k, v]) =>
      h('a', { href: '#/' + k, class: k === leht ? 'aktiivne' : '' }, v.nimi)),
    h('div', { class: 'alumine' },
      h('div', {}, kasutajaEpost),
      h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await sb.auth.signOut(); } }, 'Logi välja')));
  app.replaceChildren(h('div', { class: 'raam' }, kylg, sisu));
  (LEHED[leht] || LEHED.ylevaade).f().catch((e) => console.error(e));
}

function pais(pealkiri, ...lisad) {
  return h('div', { class: 'pais' }, h('h1', {}, pealkiri), lisad,
    h('button', { class: 'pohi', onclick: () => tehinguDialoog(null) }, '+ Uus tehing'));
}

function kuuValija(kuu, muuda) {
  return h('div', { class: 'nupud' },
    h('button', { class: 'ikoon', title: 'Eelmine kuu', onclick: () => muuda(nihutaKuu(kuu, -1)) }, '‹'),
    (() => {
      const valija = h('input', { type: 'month', tabindex: '-1', class: 'peidetud-valija', value: kuu,
        onchange: (e) => e.target.value && muuda(e.target.value) });
      return h('button', { class: 'kuu-nupp', title: 'Vali kuu',
        onclick: () => { try { valija.showPicker(); } catch { valija.focus(); } } }, kuuNimi(kuu), valija);
    })(),
    h('button', { class: 'ikoon', title: 'Järgmine kuu', onclick: () => muuda(nihutaKuu(kuu, 1)) }, '›'));
}

// Lehtede vahel jäetakse valitud kuu meelde
let valitudKuu = kuuTana();

// ------------------------------------------------------------
// Ülevaade
// ------------------------------------------------------------

async function lehtYlevaade() {
  const [algus, lopp] = kuuVahemik(valitudKuu);
  const [saldod, tehingud, plaanis] = await Promise.all([
    paring(sb.from('v_konto_saldo').select('*')),
    paring(sb.from('tehingud').select('*, tehingu_read(*)').gte('kuupaev', algus).lte('kuupaev', lopp)),
    paring(sb.from('tehingud').select('*, tehingu_read(*)').in('olek', [1, 2, 4]).order('kuupaev')),
  ]);
  const jrk = Object.fromEntries(vahemalu.kontod.map((k) => [k.konto_id, k.jrk]));
  saldod.sort((a, b) => (jrk[a.konto_id] ?? 0) - (jrk[b.konto_id] ?? 0) || a.nimi.localeCompare(b.nimi));

  // Kuu kokkuvõte kululiikide gruppide kaupa
  const grupid = {};
  let liigitamata = 0;
  for (const t of tehingud) {
    if (!SALDOSSE.includes(t.olek)) continue;
    const ul = ulekandeRead(t.tehingu_read);
    for (const r of t.tehingu_read) {
      if (ul.has(r)) continue;
      if (r.kululiigi_id == null) { liigitamata += Number(r.summa); continue; }
      const kl = kululiik(r.kululiigi_id);
      const g = (grupid[kl?.grupp || '(grupita)'] ??= { summa: 0, liigid: {} });
      g.summa += Number(r.summa);
      const l = (g.liigid[r.kululiigi_id] ??= { nimi: kl?.nimi || '?', summa: 0 });
      l.summa += Number(r.summa);
    }
  }
  const kuluGrupid = Object.entries(grupid).filter(([, g]) => g.summa < 0).sort((a, b) => a[0].localeCompare(b[0], 'et'));
  const tuluGrupid = Object.entries(grupid).filter(([, g]) => g.summa >= 0).sort((a, b) => a[0].localeCompare(b[0], 'et'));
  const kuludKokku = kuluGrupid.reduce((s, [, g]) => s + g.summa, 0);
  const tuludKokku = tuluGrupid.reduce((s, [, g]) => s + g.summa, 0);
  const suurim = Math.max(1, ...kuluGrupid.map(([, g]) => -g.summa));

  const lahti = new Set();
  const kuluTabel = h('tbody');
  function joonistaKulud() {
    kuluTabel.replaceChildren(
      ...kuluGrupid.flatMap(([nimi, g]) => [
        h('tr', { class: 'klikitav', onclick: () => { lahti.has(nimi) ? lahti.delete(nimi) : lahti.add(nimi); joonistaKulud(); } },
          h('td', {}, (lahti.has(nimi) ? '▾ ' : '▸ ') + nimi,
            h('div', { class: 'riba' }, h('div', { style: `width:${(-g.summa / suurim) * 100}%` }))),
          h('td', { class: 'nr' }, rahaEl(g.summa))),
        ...(lahti.has(nimi)
          ? Object.entries(g.liigid).sort((a, b) => a[0] - b[0]).map(([, { nimi: ln, summa: s }]) =>
            h('tr', {}, h('td', { class: 'hall', style: 'padding-left:28px' }, ln), h('td', { class: 'nr hall' }, raha(s))))
          : []),
      ]),
      ...(kuluGrupid.length === 0 ? [h('tr', {}, h('td', { colspan: 2, class: 'tyhi' }, 'Selles kuus kulusid pole.'))] : []),
    );
  }
  joonistaKulud();

  sisu.replaceChildren(
    pais('Ülevaade', kuuValija(valitudKuu, (k) => { valitudKuu = k; lehtYlevaade(); })),
    h('div', { class: 'vork' },
      h('div', { class: 'kaart' },
        h('h2', {}, 'Kontode seis täna'),
        h('div', { class: 'tabel-umbris' }, h('table', {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Konto'), h('th', { class: 'nr' }, 'Saldo'), h('th', { class: 'nr' }, 'Planeeritud'))),
          h('tbody', {},
            saldod.map((s) => h('tr', {},
              h('td', {}, s.nimi, s.valuuta !== 'EUR' && h('span', { class: 'silt', style: 'margin-left:6px' }, s.valuuta),
                s.konto_tyyp === 2 && s.limiit != null && h('div', { class: 'hall vaike' }, 'vaba ' + raha(Number(s.limiit) + Number(s.hetke_saldo)))),
              h('td', { class: 'nr' }, rahaEl(s.hetke_saldo)),
              h('td', { class: 'nr hall' }, Number(s.planeeritud) ? raha(s.planeeritud) : ''))),
            saldod.length === 0 && h('tr', {}, h('td', { colspan: 3, class: 'tyhi' }, 'Kontosid pole veel. Lisa need lehel Kontod.')))))),
      h('div', { class: 'kaart' },
        h('h2', {}, 'Kuu kokkuvõte: ' + kuuNimi(valitudKuu)),
        h('table', {}, h('tbody', {},
          h('tr', {}, h('td', {}, 'Tulud'), h('td', { class: 'nr' }, rahaEl(tuludKokku))),
          h('tr', {}, h('td', {}, 'Kulud'), h('td', { class: 'nr' }, rahaEl(kuludKokku))),
          liigitamata !== 0 && h('tr', {}, h('td', {}, h('span', { class: 'silt hoiatus' }, 'liigitamata')), h('td', { class: 'nr' }, rahaEl(liigitamata))),
          h('tr', { class: 'kokku' }, h('td', {}, 'Vahe'), h('td', { class: 'nr' }, rahaEl(tuludKokku + kuludKokku + liigitamata))))),
        tuluGrupid.length > 1 && h('div', { style: 'margin-top:12px' },
          h('table', {}, h('tbody', {}, tuluGrupid.map(([n, g]) =>
            h('tr', {}, h('td', { class: 'hall' }, n), h('td', { class: 'nr' }, rahaEl(g.summa))))))))),
    h('div', { class: 'vork' },
      h('div', { class: 'kaart' }, h('h2', {}, 'Kulud gruppide kaupa'), h('table', {}, kuluTabel)),
      h('div', { class: 'kaart' },
        h('h2', {}, 'Planeeritud ja ootel'),
        plaanis.length === 0 ? h('div', { class: 'tyhi' }, 'Ootel tehinguid pole.')
          : h('table', {}, h('tbody', {}, plaanis.map((t) => {
            const summa = t.tehingu_read.reduce((s, r) => s + Number(r.eeldatav_summa ?? r.summa), 0);
            // Kui summa on veel sisestamata (ainult eeldatav), avame kinnitamiseks dialoogi
            const summaPuudu = t.tehingu_read.some((r) => Number(r.summa) === 0 && r.eeldatav_summa != null);
            return h('tr', { class: 'klikitav', onclick: () => tehinguDialoog(t) },
              h('td', {}, kp(t.kuupaev)),
              h('td', {}, t.koht, ' ', h('span', { class: 'silt' }, OLEKUD[t.olek])),
              h('td', { class: 'nr' }, rahaEl(summa)),
              h('td', { style: 'width:1%' }, h('button', { class: 'ikoon', title: 'Märgi kinnitatuks',
                onclick: async (e) => {
                  e.stopPropagation();
                  if (summaPuudu) { tehinguDialoog({ ...t, olek: 0 }); return; }
                  await paring(sb.from('tehingud').update({ olek: 0, muudetud_aeg: new Date().toISOString() }).eq('tehing_id', t.tehing_id));
                  teade('Kinnitatud');
                  lehtYlevaade();
                } }, '✓')));
          }))))),
  );
}

// ------------------------------------------------------------
// Tehingud
// ------------------------------------------------------------

const tehinguFilter = { konto: '', kululiik: '', otsing: '', olek: '' };

async function lehtTehingud() {
  const [algus, lopp] = kuuVahemik(valitudKuu);
  const koik = await paring(sb.from('tehingud').select('*, tehingu_read(*)')
    .gte('kuupaev', algus).lte('kuupaev', lopp)
    .order('kuupaev', { ascending: false }).order('tehing_id', { ascending: false }));

  const tbody = h('tbody');
  const kokkuEl = h('span', { class: 'hall' });

  function joonista() {
    const f = tehinguFilter;
    const otsing = f.otsing.trim().toLowerCase();
    const naha = koik.filter((t) =>
      (!f.konto || t.tehingu_read.some((r) => r.konto_id === Number(f.konto))) &&
      (!f.kululiik || t.tehingu_read.some((r) => r.kululiigi_id === Number(f.kululiik))) &&
      (f.olek === '' || t.olek === Number(f.olek)) &&
      (!otsing || [t.koht, t.kommentaar, ...t.tehingu_read.flatMap((r) => [r.kommentaar, r.lisakommentaar, kululiigiNimi(r.kululiigi_id)])]
        .some((s) => s && s.toLowerCase().includes(otsing))));

    let kokku = 0;
    tbody.replaceChildren(...naha.map((t) => {
      const read = [...t.tehingu_read].sort((a, b) => a.rida - b.rida);
      const tyyp = tehinguTyyp(t);
      const kontoRead = f.konto ? read.filter((r) => r.konto_id === Number(f.konto)) : read;
      const summa = tyyp === 'ulekanne' && !f.konto
        ? read.filter((r) => r.summa < 0).reduce((s, r) => s + Number(r.summa), 0)
        : kontoRead.reduce((s, r) => s + Number(r.summa), 0);
      if (SALDOSSE.includes(t.olek)) {
        const ul = ulekandeRead(read);
        kokku += kontoRead.filter((r) => !ul.has(r)).reduce((s, r) => s + Number(r.summa), 0);
      }
      const kontod = [...new Set(read.map((r) => r.konto_id))].map(kontoNimi);
      const liigid = [...new Set(read.filter((r) => r.kululiigi_id != null).map((r) => kululiik(r.kululiigi_id)?.nimi ?? '?'))];
      return h('tr', { class: 'klikitav', onclick: () => tehinguDialoog(t) },
        h('td', { style: 'white-space:nowrap' }, kp(t.kuupaev)),
        h('td', {}, t.koht || h('span', { class: 'hall' }, '—'),
          t.kommentaar && h('div', { class: 'hall vaike' }, t.kommentaar)),
        h('td', {}, tyyp === 'ulekanne' ? kontod.join(' → ') : kontod.join(', ')),
        h('td', {}, tyyp === 'ulekanne' ? h('span', { class: 'silt' }, 'ülekanne') : liigid.join(', ') ||
          h('span', { class: 'silt hoiatus' }, 'liigitamata'),
        read.length > 1 && tyyp !== 'ulekanne' && h('span', { class: 'hall vaike' }, ` (${read.length} rida)`)),
        h('td', {}, t.olek !== 0 && h('span', { class: 'silt' }, OLEKUD[t.olek])),
        h('td', { class: 'nr' }, rahaEl(summa)));
    }));
    if (naha.length === 0) tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'tyhi' }, 'Tehinguid ei leitud.')));
    kokkuEl.replaceChildren(`${naha.length} tehingut, kokku (ilma ülekanneteta) `, rahaEl(kokku));
  }

  const filtrid = h('div', { class: 'read' },
    h('div', {}, h('label', {}, 'Otsing'),
      h('input', { type: 'search', value: tehinguFilter.otsing, placeholder: 'koht, kommentaar, liik',
        oninput: (e) => { tehinguFilter.otsing = e.target.value; joonista(); } })),
    h('div', {}, h('label', {}, 'Konto'), (() => {
      const s = kontoValik(Number(tehinguFilter.konto) || null, { koigis: true, tyhi: 'kõik kontod' });
      s.onchange = () => { tehinguFilter.konto = s.value; joonista(); };
      return s;
    })()),
    h('div', {}, h('label', {}, 'Kululiik'), (() => {
      const s = kululiigiValik(Number(tehinguFilter.kululiik) || null, 'kõik liigid');
      s.onchange = () => { tehinguFilter.kululiik = s.value; joonista(); };
      return s;
    })()),
    h('div', {}, h('label', {}, 'Olek'), (() => {
      const s = h('select', {}, h('option', { value: '' }, 'kõik'),
        OLEKU_VALIK.map(([i, o]) => h('option', { value: i, selected: String(i) === tehinguFilter.olek }, o)));
      s.onchange = () => { tehinguFilter.olek = s.value; joonista(); };
      return s;
    })()));

  sisu.replaceChildren(
    pais('Tehingud', kuuValija(valitudKuu, (k) => { valitudKuu = k; lehtTehingud(); })),
    h('div', { class: 'kaart' }, filtrid,
      h('div', { class: 'tabel-umbris' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Kuupäev', 'Koht', 'Konto', 'Kululiik', 'Olek'].map((x) => h('th', {}, x)), h('th', { class: 'nr' }, 'Summa'))),
        tbody)),
      h('div', { style: 'margin-top:10px' }, kokkuEl)));
  joonista();
}

// ------------------------------------------------------------
// Tehingu sisestamine ja muutmine
// ------------------------------------------------------------

function avaDialoog(sisuEl) {
  const d = h('dialog', {}, h('div', { class: 'dsisu' }, sisuEl));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
  return d;
}

function tehinguDialoog(t) {
  const read = t ? [...t.tehingu_read].sort((a, b) => a.rida - b.rida) : [];
  let tyyp = t ? tehinguTyyp(t) : 'kulu';
  const viimaneKonto = Number(localStorage.getItem('kulud.viimaneKonto')) || vahemalu.kontod.find((k) => k.aktiivne)?.konto_id;

  const kuupaev = kuupaevaVali(t?.kuupaev ?? tana(), { required: true });
  const koht = h('input', { value: t?.koht ?? '', placeholder: 'nt Rimi, palk, üür' });
  const olek = h('select', {}, OLEKU_VALIK.map(([i, o]) => h('option', { value: i, selected: i === (t?.olek ?? 0) }, o)));
  const kommentaar = h('input', { value: t?.kommentaar ?? '' });

  // Kulu/tulu: üks konto ja mitu liigiga rida
  const kontoKT = kontoValik(read[0]?.konto_id ?? viimaneKonto);
  const ktRead = [];
  const ktTbody = h('tbody');
  const ktKokku = h('span');
  function lisaKtRida(r = {}) {
    const rida = {
      liik: liigiKombo(r.kululiigi_id ?? null),
      summa: h('input', { class: 'nr', inputmode: 'decimal', value: r.summa != null ? raha(Math.abs(r.summa)) : '', placeholder: '0,00' }),
      eeldatav: h('input', { class: 'nr', inputmode: 'decimal', value: r.eeldatav_summa != null ? raha(Math.abs(r.eeldatav_summa)) : '', placeholder: 'eeldatav' }),
      kommentaar: h('input', { value: r.kommentaar ?? '', placeholder: 'rea kommentaar' }),
      lisakommentaar: r.lisakommentaar ?? null,
      valine_id: r.valine_id ?? null,
    };
    rida.summa.addEventListener('input', arvutaKt);
    rida.tr = h('tr', {},
      h('td', { style: 'min-width:200px' }, rida.liik),
      h('td', { style: 'width:120px' }, rida.summa),
      h('td', { style: 'width:120px' }, rida.eeldatav),
      h('td', {}, rida.kommentaar),
      h('td', {}, h('button', { type: 'button', class: 'ikoon', title: 'Eemalda rida',
        onclick: () => { ktRead.splice(ktRead.indexOf(rida), 1); rida.tr.remove(); arvutaKt(); } }, '×')));
    ktRead.push(rida);
    ktTbody.append(rida.tr);
    return rida;
  }
  function arvutaKt() {
    const s = ktRead.reduce((a, r) => a + (arv(r.summa.value) || 0), 0);
    ktKokku.textContent = 'Kokku ' + raha(s);
  }
  const ktOsa = h('div', {},
    h('div', { class: 'read' }, h('div', {}, h('label', {}, 'Konto'), kontoKT)),
    h('table', { class: 'reaTabel' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Kululiik'), h('th', { class: 'nr' }, 'Summa'), h('th', { class: 'nr' }, 'Eeldatav'), h('th', {}, 'Rea kommentaar'), h('th'))),
      ktTbody),
    h('div', { class: 'nupud', style: 'margin-top:6px' },
      h('button', { type: 'button', class: 'vasak', onclick: () => lisaKtRida().liik.focus() }, '+ Lisa rida'),
      ktKokku));

  // Ülekanne: kahe konto vahel, valikuliselt teenustasu
  const ul = t && tyyp === 'ulekanne' ? ulekandeRead(read) : new Set();
  const ulVälja = [...ul].find((r) => r.summa < 0);
  const ulSisse = [...ul].find((r) => r.summa > 0);
  const tasuRida = read.find((r) => !ul.has(r));
  const kontoVälja = kontoValik(ulVälja?.konto_id ?? viimaneKonto);
  const kontoSisse = kontoValik(ulSisse?.konto_id ?? null, { tyhi: '— vali —' });
  const ulSumma = h('input', { class: 'nr', inputmode: 'decimal', value: ulVälja ? raha(-ulVälja.summa) : '', placeholder: '0,00' });
  const ulSaabus = h('input', { class: 'nr', inputmode: 'decimal', value: ulSisse && ulVälja && Number(ulSisse.summa) !== -Number(ulVälja.summa) ? raha(ulSisse.summa) : '', placeholder: 'sama' });
  const tasu = h('input', { class: 'nr', inputmode: 'decimal', value: tasuRida ? raha(-tasuRida.summa) : '', placeholder: '0,00' });
  const tasuLiik = liigiKombo(tasuRida?.kululiigi_id ?? null);
  const ulOsa = h('div', {},
    h('div', { class: 'read' },
      h('div', {}, h('label', {}, 'Kontolt'), kontoVälja),
      h('div', {}, h('label', {}, 'Kontole'), kontoSisse),
      h('div', {}, h('label', {}, 'Summa'), ulSumma),
      h('div', {}, h('label', {}, 'Saabunud summa (kui erineb, nt valuuta)'), ulSaabus)),
    h('div', { class: 'read' },
      h('div', {}, h('label', {}, 'Teenustasu'), tasu),
      h('div', {}, h('label', {}, 'Teenustasu kululiik'), tasuLiik)));

  if (tyyp !== 'ulekanne' && read.length) read.forEach((r) => lisaKtRida(r));
  else lisaKtRida();
  arvutaKt();

  const tyybiNupud = {};
  const tyybiValik = h('div', { class: 'valik' },
    [['kulu', 'Kulu'], ['tulu', 'Tulu'], ['ulekanne', 'Ülekanne']].map(([k, n]) =>
      (tyybiNupud[k] = h('button', { type: 'button', onclick: () => { tyyp = k; naitaTyyp(); } }, n))));
  const tyybiSisu = h('div');
  function naitaTyyp() {
    for (const [k, b] of Object.entries(tyybiNupud)) b.classList.toggle('valitud', k === tyyp);
    tyybiSisu.replaceChildren(tyyp === 'ulekanne' ? ulOsa : ktOsa);
  }
  naitaTyyp();

  const vigaEl = h('div', { class: 'viga-tekst' });

  function koostaRead() {
    if (tyyp === 'ulekanne') {
      const summa = arv(ulSumma.value);
      const saabus = arv(ulSaabus.value) ?? summa;
      const tasuSumma = arv(tasu.value);
      if (!summa || summa <= 0 || Number.isNaN(summa)) throw new Error('Sisesta ülekande summa.');
      if (Number.isNaN(saabus) || Number.isNaN(tasuSumma)) throw new Error('Summa ei ole arv.');
      if (!kontoSisse.value) throw new Error('Vali, millisele kontole raha läks.');
      if (kontoSisse.value === kontoVälja.value) throw new Error('Kontolt ja kontole peavad olema erinevad.');
      const r = [
        { konto_id: Number(kontoVälja.value), summa: -summa, valine_id: ulVälja?.valine_id ?? null },
        { konto_id: Number(kontoSisse.value), summa: saabus, valine_id: ulSisse?.valine_id ?? null },
      ];
      if (tasuSumma) r.push({ konto_id: Number(kontoVälja.value), summa: -Math.abs(tasuSumma), kululiigi_id: tasuLiik.value || null, valine_id: tasuRida?.valine_id ?? null });
      return r;
    }
    const mark = tyyp === 'kulu' ? -1 : 1;
    const r = ktRead
      .map((x) => ({ x, summa: arv(x.summa.value), eeldatav: arv(x.eeldatav.value) }))
      .filter(({ summa, eeldatav, x }) => summa != null || eeldatav != null || x.liik.value);
    if (r.length === 0) throw new Error('Sisesta vähemalt ühe rea summa.');
    if (r.some(({ summa, eeldatav }) => Number.isNaN(summa) || Number.isNaN(eeldatav))) throw new Error('Summa ei ole arv.');
    return r.map(({ x, summa, eeldatav }) => ({
      konto_id: Number(kontoKT.value),
      summa: mark * Math.abs(summa ?? 0),
      eeldatav_summa: eeldatav == null ? null : mark * Math.abs(eeldatav),
      kululiigi_id: x.liik.value || null,
      kommentaar: x.kommentaar.value,
      lisakommentaar: x.lisakommentaar,
      valine_id: x.valine_id,
    }));
  }

  async function salvesta(e, uusPeale = false) {
    e.preventDefault();
    vigaEl.textContent = '';
    if (!kuupaev.value) { vigaEl.textContent = 'Kuupäev on vale (kuju pp.kk.aaaa).'; kuupaev.focus(); return; }
    let tRead;
    try { tRead = koostaRead(); } catch (err) { vigaEl.textContent = err.message; return; }
    await paring(sb.rpc('salvesta_tehing', {
      p: {
        tehing_id: t?.tehing_id ?? null,
        kuupaev: kuupaev.value,
        koht: koht.value.trim(),
        kommentaar: kommentaar.value.trim(),
        olek: Number(olek.value),
        read: tRead,
      },
    }));
    localStorage.setItem('kulud.viimaneKonto', tyyp === 'ulekanne' ? kontoVälja.value : kontoKT.value);
    teade('Salvestatud');
    d.close();
    joonistaRaam();
    if (uusPeale) tehinguDialoog(null);
  }

  async function kustuta() {
    if (!confirm('Kas kustutan selle tehingu?')) return;
    await paring(sb.from('tehingud').delete().eq('tehing_id', t.tehing_id));
    teade('Kustutatud');
    d.close();
    joonistaRaam();
  }

  const vorm = h('form', { onsubmit: (e) => salvesta(e) },
    h('div', { class: 'nupud', style: 'margin-bottom:16px' },
      h('h2', { class: 'vasak', style: 'margin:0' }, t ? 'Muuda tehingut' : 'Uus tehing'), tyybiValik),
    h('div', { class: 'read' },
      h('div', {}, h('label', {}, 'Kuupäev'), kuupaev),
      h('div', { style: 'grid-column: span 2' }, h('label', {}, 'Koht / kellelt'), koht),
      h('div', {}, h('label', {}, 'Olek'), olek)),
    tyybiSisu,
    h('div', { class: 'read', style: 'margin-top:12px' },
      h('div', {}, h('label', {}, 'Kommentaar'), kommentaar)),
    t?.allikas && t.allikas !== 'kasitsi' && h('p', { class: 'hall vaike' }, 'Allikas: ' + t.allikas),
    vigaEl,
    h('div', { class: 'nupud', style: 'margin-top:16px' },
      t && h('button', { type: 'button', class: 'oht', onclick: kustuta }, 'Kustuta'),
      h('span', { class: 'vasak' }),
      h('button', { type: 'button', onclick: () => d.close() }, 'Loobu'),
      !t && h('button', { type: 'button', onclick: (e) => salvesta(e, true) }, 'Salvesta ja uus'),
      h('button', { class: 'pohi', type: 'submit' }, 'Salvesta')));

  const d = avaDialoog(vorm);
  (t ? koht : (tyyp === 'ulekanne' ? ulSumma : koht)).focus();
}

// ------------------------------------------------------------
// Kontod
// ------------------------------------------------------------

async function lehtKontod() {
  await laeYldandmed();
  const saldod = Object.fromEntries((await paring(sb.from('v_konto_saldo').select('konto_id, hetke_saldo')))
    .map((s) => [s.konto_id, s.hetke_saldo]));
  sisu.replaceChildren(
    h('div', { class: 'pais' }, h('h1', {}, 'Kontod'),
      h('button', { class: 'pohi', onclick: () => kontoDialoog(null) }, '+ Uus konto')),
    h('div', { class: 'kaart' }, h('div', { class: 'tabel-umbris' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Jrk', 'Nimi', 'Pank', 'Number', 'Tüüp', 'Valuuta'].map((x) => h('th', {}, x)),
        h('th', { class: 'nr' }, 'Algsaldo'), h('th', { class: 'nr' }, 'Saldo'))),
      h('tbody', {},
        vahemalu.kontod.map((k) => h('tr', { class: 'klikitav', onclick: () => kontoDialoog(k) },
          h('td', { class: 'hall' }, k.jrk),
          h('td', {}, k.nimi, !k.aktiivne && h('span', { class: 'silt', style: 'margin-left:6px' }, 'suletud')),
          h('td', {}, k.pank ?? ''),
          h('td', { class: 'hall' }, k.number ?? ''),
          h('td', {}, KONTO_TYYBID[k.konto_tyyp]),
          h('td', {}, k.valuuta),
          h('td', { class: 'nr' }, raha(k.alg_saldo), k.alg_kuupaev && h('div', { class: 'hall vaike' }, kp(k.alg_kuupaev))),
          h('td', { class: 'nr' }, k.aktiivne ? rahaEl(saldod[k.konto_id]) : ''))),
        vahemalu.kontod.length === 0 && h('tr', {}, h('td', { colspan: 8, class: 'tyhi' }, 'Kontosid pole veel.')))))));
}

function kontoDialoog(k) {
  const v = {
    nimi: h('input', { value: k?.nimi ?? '', required: true }),
    pank: h('input', { value: k?.pank ?? '', list: 'pangad' }),
    number: h('input', { value: k?.number ?? '' }),
    konto_tyyp: h('select', {}, KONTO_TYYBID.map((n, i) => h('option', { value: i, selected: i === (k?.konto_tyyp ?? 1) }, n))),
    valuuta: h('input', { value: k?.valuuta ?? 'EUR', maxlength: 3, required: true }),
    jrk: h('input', { type: 'number', value: k?.jrk ?? (vahemalu.kontod.length + 1) }),
    alg_saldo: h('input', { class: 'nr', inputmode: 'decimal', value: raha(k?.alg_saldo ?? 0) }),
    alg_kuupaev: kuupaevaVali(k?.alg_kuupaev ?? ''),
    limiit: h('input', { class: 'nr', inputmode: 'decimal', value: k?.limiit != null ? raha(k.limiit) : '' }),
    aktiivne: h('input', { type: 'checkbox', checked: k ? k.aktiivne : true, style: 'width:auto' }),
  };
  const vigaEl = h('div', { class: 'viga-tekst' });
  const vali = (silt, el) => h('div', {}, h('label', {}, silt), el);
  const vorm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const alg = arv(v.alg_saldo.value) ?? 0;
      const limiit = arv(v.limiit.value);
      if (Number.isNaN(alg) || Number.isNaN(limiit)) { vigaEl.textContent = 'Summa ei ole arv.'; return; }
      if (v.alg_kuupaev.value === null) { vigaEl.textContent = 'Algsaldo kuupäev on vale (kuju pp.kk.aaaa).'; return; }
      const rida = {
        nimi: v.nimi.value.trim(), pank: v.pank.value.trim() || null, number: v.number.value.trim() || null,
        konto_tyyp: Number(v.konto_tyyp.value), valuuta: v.valuuta.value.trim().toUpperCase(),
        jrk: Number(v.jrk.value) || 0, alg_saldo: alg, alg_kuupaev: v.alg_kuupaev.value || null,
        limiit, aktiivne: v.aktiivne.checked,
      };
      await paring(k ? sb.from('kontod').update(rida).eq('konto_id', k.konto_id) : sb.from('kontod').insert(rida));
      teade('Salvestatud');
      d.close();
      joonistaRaam();
    },
  },
  h('h2', {}, k ? 'Muuda kontot' : 'Uus konto'),
  h('datalist', { id: 'pangad' }, ['Swedbank', 'Bigbank', 'Wise', 'SEB', 'LHV'].map((p) => h('option', { value: p }))),
  h('div', { class: 'read' }, vali('Nimi', v.nimi), vali('Pank', v.pank), vali('Number (IBAN)', v.number)),
  h('div', { class: 'read' }, vali('Tüüp', v.konto_tyyp), vali('Valuuta', v.valuuta), vali('Järjekord', v.jrk)),
  h('div', { class: 'read' }, vali('Algsaldo', v.alg_saldo), vali('Algsaldo kuupäev', v.alg_kuupaev), vali('Limiit (krediitkaart)', v.limiit)),
  h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:14px;color:inherit' }, v.aktiivne, 'Konto on kasutusel'),
  vigaEl,
  h('div', { class: 'nupud', style: 'margin-top:16px' }, h('span', { class: 'vasak' }),
    h('button', { type: 'button', onclick: () => d.close() }, 'Loobu'),
    h('button', { class: 'pohi', type: 'submit' }, 'Salvesta')));
  const d = avaDialoog(vorm);
  v.nimi.focus();
}

// ------------------------------------------------------------
// Kululiigid
// ------------------------------------------------------------

async function lehtKululiigid() {
  await laeYldandmed();
  const grupid = {};
  for (const k of vahemalu.kululiigid) (grupid[k.grupp || '(grupita)'] ??= []).push(k);
  sisu.replaceChildren(
    h('div', { class: 'pais' }, h('h1', {}, 'Kululiigid'),
      h('button', { class: 'pohi', onclick: () => kululiigiDialoog(null) }, '+ Uus kululiik')),
    h('div', { class: 'kaart' }, h('div', { class: 'tabel-umbris' }, h('table', {},
      h('thead', {}, h('tr', {}, ['ID', 'Nimi', 'Kommentaar', ''].map((x) => h('th', {}, x)))),
      h('tbody', {},
        Object.entries(grupid).map(([g, liigid]) => [
          h('tr', { class: 'grupp' }, h('td', { colspan: 4 }, g)),
          liigid.map((k) => h('tr', { class: 'klikitav', onclick: () => kululiigiDialoog(k) },
            h('td', { class: 'hall' }, k.kululiigi_id),
            h('td', {}, k.nimi),
            h('td', { class: 'hall' }, k.kommentaar ?? ''),
            h('td', {}, k.on_pysikulu && h('span', { class: 'silt' }, 'püsikulu'),
              !k.aktiivne && h('span', { class: 'silt', style: 'margin-left:4px' }, 'peidetud')))),
        ]),
        vahemalu.kululiigid.length === 0 && h('tr', {}, h('td', { colspan: 4, class: 'tyhi' }, 'Kululiike pole veel.')))))));
}

function kululiigiDialoog(k) {
  const jargmine = Math.max(0, ...vahemalu.kululiigid.map((x) => x.kululiigi_id)) + 1;
  const grupid = [...new Set(vahemalu.kululiigid.map((x) => x.grupp))];
  const v = {
    id: h('input', { type: 'number', value: k?.kululiigi_id ?? jargmine, required: true, disabled: !!k }),
    grupp: h('input', { value: k?.grupp ?? '', list: 'grupid', required: true }),
    nimi: h('input', { value: k?.nimi ?? '', required: true }),
    kommentaar: h('input', { value: k?.kommentaar ?? '' }),
    on_pysikulu: h('input', { type: 'checkbox', checked: k?.on_pysikulu ?? false, style: 'width:auto' }),
    aktiivne: h('input', { type: 'checkbox', checked: k ? k.aktiivne : true, style: 'width:auto' }),
  };
  const vali = (silt, el) => h('div', {}, h('label', {}, silt), el);
  const linnuke = (el, tekst) => h('label', { style: 'display:flex;gap:8px;align-items:center;font-size:14px;color:inherit' }, el, tekst);
  const vorm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const rida = {
        grupp: v.grupp.value.trim(), nimi: v.nimi.value.trim(), kommentaar: v.kommentaar.value.trim() || null,
        on_pysikulu: v.on_pysikulu.checked, aktiivne: v.aktiivne.checked,
      };
      await paring(k
        ? sb.from('kululiigid').update(rida).eq('kululiigi_id', k.kululiigi_id)
        : sb.from('kululiigid').insert({ kululiigi_id: Number(v.id.value), ...rida }));
      teade('Salvestatud');
      d.close();
      joonistaRaam();
    },
  },
  h('h2', {}, k ? 'Muuda kululiiki' : 'Uus kululiik'),
  h('datalist', { id: 'grupid' }, grupid.map((g) => h('option', { value: g }))),
  h('div', { class: 'read' }, vali('ID', v.id), vali('Grupp', v.grupp), vali('Nimi', v.nimi)),
  h('div', { class: 'read' }, vali('Kommentaar', v.kommentaar)),
  linnuke(v.on_pysikulu, 'Püsikulu'),
  linnuke(v.aktiivne, 'Kasutusel (peidetud liike valikus ei näidata)'),
  h('div', { class: 'nupud', style: 'margin-top:16px' }, h('span', { class: 'vasak' }),
    h('button', { type: 'button', onclick: () => d.close() }, 'Loobu'),
    h('button', { class: 'pohi', type: 'submit' }, 'Salvesta')));
  const d = avaDialoog(vorm);
  (k ? v.nimi : v.grupp).focus();
}

// ------------------------------------------------------------
// Tasakaalustus
// ------------------------------------------------------------

async function lehtTasakaalustus() {
  const punktid = await paring(sb.from('v_tasakaalustus').select('*')
    .order('kuupaev', { ascending: false }).order('konto_nimi'));

  const konto = kontoValik(null);
  const kuupaev = kuupaevaVali(tana(), { required: true });
  const saldo = h('input', { class: 'nr', inputmode: 'decimal', required: true, placeholder: '0,00' });
  const kommentaar = h('input');
  const vigaEl = h('div', { class: 'viga-tekst' });
  const vorm = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const s = arv(saldo.value);
      if (s == null || Number.isNaN(s)) { vigaEl.textContent = 'Sisesta panga saldo.'; return; }
      if (!kuupaev.value) { vigaEl.textContent = 'Kuupäev on vale (kuju pp.kk.aaaa).'; return; }
      await paring(sb.from('tasakaalustus').upsert(
        { konto_id: Number(konto.value), kuupaev: kuupaev.value, panga_saldo: s, kommentaar: kommentaar.value.trim() || null },
        { onConflict: 'konto_id,kuupaev' }));
      teade('Salvestatud');
      lehtTasakaalustus();
    },
  },
  h('h2', {}, 'Lisa kontrollpunkt'),
  h('p', { class: 'hall', style: 'margin-top:0' },
    'Sisesta, mis oli panga järgi konto saldo valitud päeva lõpus. Erinevus näitab, kui palju tehinguid on puudu või valesti sisestatud.'),
  h('div', { class: 'read' },
    h('div', {}, h('label', {}, 'Konto'), konto),
    h('div', {}, h('label', {}, 'Kuupäev'), kuupaev),
    h('div', {}, h('label', {}, 'Panga saldo'), saldo),
    h('div', {}, h('label', {}, 'Kommentaar'), kommentaar)),
  vigaEl,
  h('button', { class: 'pohi', type: 'submit' }, 'Lisa'));

  sisu.replaceChildren(
    pais('Tasakaalustus'),
    h('div', { class: 'kaart' }, vorm),
    h('div', { class: 'kaart' }, h('div', { class: 'tabel-umbris' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Kuupäev'), h('th', {}, 'Konto'),
        h('th', { class: 'nr' }, 'Pank'), h('th', { class: 'nr' }, 'Arvutatud'), h('th', { class: 'nr' }, 'Erinevus'),
        h('th', {}, 'Kommentaar'), h('th', {}))),
      h('tbody', {},
        punktid.map((p) => {
          const korras = Number(p.erinevus) === 0;
          return h('tr', {},
            h('td', {}, kp(p.kuupaev)),
            h('td', {}, p.konto_nimi),
            h('td', { class: 'nr' }, raha(p.panga_saldo)),
            h('td', { class: 'nr' }, raha(p.arvutatud_saldo)),
            h('td', { class: 'nr' }, korras ? h('span', { class: 'tulu' }, '✓ 0,00') : rahaEl(p.erinevus)),
            h('td', { class: 'hall' }, p.kommentaar ?? ''),
            h('td', { class: 'nupud', style: 'justify-content:flex-end' },
              !korras && h('label', { style: 'display:flex;gap:6px;align-items:center;margin:0', title: 'Erinevus on üle vaadatud ja teadlikult jäetud' },
                h('input', { type: 'checkbox', style: 'width:auto', checked: p.on_kinnitatud,
                  onchange: async (e) => {
                    await paring(sb.from('tasakaalustus').update({ on_kinnitatud: e.target.checked }).eq('tasakaal_id', p.tasakaal_id));
                  } }), 'üle vaadatud'),
              h('button', { class: 'ikoon oht', title: 'Kustuta',
                onclick: async () => {
                  if (!confirm('Kas kustutan selle kontrollpunkti?')) return;
                  await paring(sb.from('tasakaalustus').delete().eq('tasakaal_id', p.tasakaal_id));
                  lehtTasakaalustus();
                } }, '×')));
        }),
        punktid.length === 0 && h('tr', {}, h('td', { colspan: 7, class: 'tyhi' }, 'Kontrollpunkte pole veel.')))))));
}

// ------------------------------------------------------------
// Käivitus
// ------------------------------------------------------------

let sisseLogitud = false;

sb.auth.onAuthStateChange((syndmus, sessioon) => {
  // Supabase ei luba siin otse päringuid teha, seepärast setTimeout
  setTimeout(async () => {
    if (SUPABASE_URL.includes('SINU-PROJEKT')) {
      app.replaceChildren(h('p', { class: 'laeb' }, 'Ava config.js ja sisesta Supabase\'i projekti URL ja võti.'));
      return;
    }
    if (!sessioon) {
      sisseLogitud = false;
      naitaLogin();
      return;
    }
    kasutajaEpost = sessioon.user?.email ?? '';
    if (sisseLogitud) return;
    sisseLogitud = true;
    try {
      await laeYldandmed();
      joonistaRaam();
    } catch {
      app.replaceChildren(h('p', { class: 'laeb' }, 'Andmete laadimine ebaõnnestus.'));
    }
  }, 0);
});

window.addEventListener('hashchange', () => sisseLogitud && joonistaRaam());

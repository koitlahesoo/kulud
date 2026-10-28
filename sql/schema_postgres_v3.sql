-- ============================================================
-- KULUD — andmebaasiskeem, versioon 3.0 (PostgreSQL / Supabase)
-- Kavand, mis põhineb v2.0 (SQL Server) skeemil.
--
-- Peamised muudatused v2.0-ga võrreldes:
--  1. Konto on tehingu REAL, mitte päises. Ülekanne = kaks rida
--     (−100 kontolt A, +100 kontole B), teenustasu on kolmas rida.
--     Nii kaob SihtKontoID ja saldo on lihtsalt ridade summa konto kaupa.
--  2. Summa on märgiga (negatiivne = raha välja, positiivne = sisse).
--     Suund-veergu pole vaja ja pangaväljavõtte summad sobivad otse.
--  3. Tasakaalustus = kontrollpunkt: "panga järgi oli kuupäeval X saldo Y".
--     Vaade näitab, kui palju arvutatud saldo sellest erineb.
--     Saldo arvutus lähtub alati AlgSaldost, mitte viimasest punktist.
--  4. Impordi jaoks: rea juures panga viitenumber (valine_id),
--     mis ei lase sama tehingut kaks korda sisse tuua.
--  5. Kontol on valuuta (Wise jaoks).
-- ============================================================

-- ------------------------------------------------------------
-- 1. kontod — pangakontod, krediitkaardid, sularaha jne
-- ------------------------------------------------------------
-- konto_tyyp: 0=sularaha, 1=pangakonto, 2=krediitkaart, 3=kogumiskonto
create table kontod (
    konto_id    integer generated always as identity primary key,
    nimi        text        not null,
    number      text,
    pank        text,                         -- Swedbank, Bigbank, Wise ...
    valuuta     char(3)     not null default 'EUR',
    jrk         integer     not null default 0,
    konto_tyyp  smallint    not null default 1 check (konto_tyyp between 0 and 3),
    alg_saldo   numeric(12,2) not null default 0,
    alg_kuupaev date,                         -- millise päeva seisuga alg_saldo kehtib
    limiit      numeric(12,2),                -- ainult krediitkaardil
    aktiivne    boolean     not null default true
);

-- ------------------------------------------------------------
-- 2. kululiigid — kulu- ja tuluklassid gruppide kaupa
-- ------------------------------------------------------------
create table kululiigid (
    kululiigi_id integer    primary key,      -- jääb käsitsi antavaks, et vanad numbrid säiliksid
    grupp        text       not null default '',
    nimi         text       not null default '',
    kommentaar   text,
    on_pysikulu  boolean    not null default false,
    aktiivne     boolean    not null default true
);
create index ix_kululiigid_grupp on kululiigid (grupp, nimi);

-- ------------------------------------------------------------
-- 3. tehingud — tehingu päis
-- ------------------------------------------------------------
-- olek: 0=kinnitatud, 1=planeeritud, 2=arve saabunud,
--       3=makstud, 4=broneering (krediitkaart)
create table tehingud (
    tehing_id    integer    generated always as identity primary key,
    kuupaev      date       not null default current_date,
    koht         text       not null default '',
    kommentaar   text,
    olek         smallint   not null default 0 check (olek between 0 and 4),
    allikas      text       not null default 'kasitsi',   -- 'kasitsi' või 'import:swedbank' jne
    lisatud_aeg  timestamptz not null default now(),
    muudetud_aeg timestamptz not null default now()
);
create index ix_tehingud_kuupaev on tehingud (kuupaev desc);
create index ix_tehingud_olek    on tehingud (olek, kuupaev desc);

-- ------------------------------------------------------------
-- 4. tehingu_read — (v2.0 eKulud) iga rida liigutab raha ühel kontol
-- ------------------------------------------------------------
-- summa < 0: raha läheb kontolt välja (kulu, ülekanne välja)
-- summa > 0: raha tuleb kontole (tulu, ülekanne sisse)
-- kululiigi_id on ülekande ridadel tühi.
create table tehingu_read (
    rea_id           integer    generated always as identity primary key,
    tehing_id        integer    not null references tehingud on delete cascade,
    rida             integer    not null default 1,
    konto_id         integer    not null references kontod,
    summa            numeric(12,2) not null,
    eeldatav_summa   numeric(12,2),            -- püsikulu eeldatav summa enne arvet
    kululiigi_id     integer    references kululiigid,
    kommentaar       text,
    lisakommentaar   text,
    valine_id        text,                     -- panga arhiivi-/viitenumber impordil
    unique (konto_id, valine_id)
);
create index ix_tehingu_read_tehing on tehingu_read (tehing_id, rida);
create index ix_tehingu_read_konto  on tehingu_read (konto_id);

-- ------------------------------------------------------------
-- 5. tasakaalustus — saldo kontrollpunktid
-- ------------------------------------------------------------
-- "Panga järgi oli konto saldo kuupäeva lõpus X."
create table tasakaalustus (
    tasakaal_id     integer    generated always as identity primary key,
    konto_id        integer    not null references kontod,
    kuupaev         date       not null,
    panga_saldo     numeric(12,2) not null,
    on_kinnitatud   boolean    not null default false,  -- true = erinevus on üle vaadatud
    kommentaar      text,
    lisatud_aeg     timestamptz not null default now(),
    unique (konto_id, kuupaev)
);

-- ============================================================
-- VAATED
-- ============================================================

-- Kontode hetkesaldo (arvestab ainult olekuid 0 ja 3)
create view v_konto_saldo as
select
    k.konto_id, k.nimi, k.number, k.pank, k.valuuta, k.konto_tyyp, k.limiit,
    k.alg_saldo,
    coalesce(sum(r.summa) filter (where t.olek in (0, 3)), 0)              as liikumised,
    k.alg_saldo + coalesce(sum(r.summa) filter (where t.olek in (0, 3)), 0) as hetke_saldo,
    coalesce(sum(coalesce(r.eeldatav_summa, r.summa)) filter (where t.olek in (1, 2)), 0)
                                                                            as planeeritud
from kontod k
left join tehingu_read r on r.konto_id = k.konto_id
left join tehingud t     on t.tehing_id = r.tehing_id
where k.aktiivne
group by k.konto_id;

-- Kontrollpunktid: arvutatud saldo samal kuupäeval ja erinevus pangast
create view v_tasakaalustus as
select
    ts.tasakaal_id, ts.konto_id, k.nimi as konto_nimi, ts.kuupaev,
    ts.panga_saldo,
    k.alg_saldo + coalesce((
        select sum(r.summa)
        from tehingu_read r join tehingud t on t.tehing_id = r.tehing_id
        where r.konto_id = ts.konto_id and t.kuupaev <= ts.kuupaev and t.olek in (0, 3)
    ), 0)                                                      as arvutatud_saldo,
    ts.panga_saldo - (k.alg_saldo + coalesce((
        select sum(r.summa)
        from tehingu_read r join tehingud t on t.tehing_id = r.tehing_id
        where r.konto_id = ts.konto_id and t.kuupaev <= ts.kuupaev and t.olek in (0, 3)
    ), 0))                                                     as erinevus,
    ts.on_kinnitatud, ts.kommentaar
from tasakaalustus ts
join kontod k on k.konto_id = ts.konto_id;

-- Tehingute nimekiri koos summadega
create view v_tehingud as
select
    t.tehing_id, t.kuupaev, t.koht, t.kommentaar, t.olek, t.allikas,
    string_agg(distinct k.nimi, ', ')                        as kontod,
    count(r.rea_id)                                          as ridade_arv,
    coalesce(sum(r.summa), 0)                                as neto_summa,
    coalesce(sum(r.summa) filter (where r.summa < 0 and r.kululiigi_id is not null), 0) as kulu_summa,
    coalesce(sum(r.summa) filter (where r.summa > 0 and r.kululiigi_id is not null), 0) as tulu_summa,
    bool_and(r.kululiigi_id is null)                         as on_ulekanne
from tehingud t
left join tehingu_read r on r.tehing_id = t.tehing_id
left join kontod k       on k.konto_id = r.konto_id
group by t.tehing_id;

-- ============================================================
-- LIGIPÄÄS (Supabase): ainult sisselogitud kasutaja.
-- Uute kasutajate registreerimine lülitatakse Supabase'is välja,
-- seega on ainus sisselogitud kasutaja Koit ise.
-- ============================================================
alter table kontod        enable row level security;
alter table kululiigid    enable row level security;
alter table tehingud      enable row level security;
alter table tehingu_read  enable row level security;
alter table tasakaalustus enable row level security;

create policy koik on kontod        for all to authenticated using (true) with check (true);
create policy koik on kululiigid    for all to authenticated using (true) with check (true);
create policy koik on tehingud      for all to authenticated using (true) with check (true);
create policy koik on tehingu_read  for all to authenticated using (true) with check (true);
create policy koik on tasakaalustus for all to authenticated using (true) with check (true);

alter view v_konto_saldo   set (security_invoker = on);
alter view v_tasakaalustus set (security_invoker = on);
alter view v_tehingud      set (security_invoker = on);

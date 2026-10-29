-- ============================================================
-- KULUD — olekute muudatus (2026-10-29)
--  * "makstud" (3) kaotatakse, olemasolevad tehingud muutuvad "kinnitatud" (0)
--  * "broneering" (4) läheb nüüd saldosse (nagu panga kasutatav jääk)
-- ============================================================

update tehingud set olek = 0 where olek = 3;

alter table tehingud drop constraint if exists tehingud_olek_check;
alter table tehingud add constraint tehingud_olek_check check (olek in (0, 1, 2, 4));

drop view if exists v_konto_saldo;
create view v_konto_saldo as
select
    k.konto_id, k.nimi, k.number, k.pank, k.valuuta, k.konto_tyyp, k.limiit,
    k.alg_saldo,
    coalesce(sum(r.summa) filter (where t.olek in (0, 4)), 0)              as liikumised,
    k.alg_saldo + coalesce(sum(r.summa) filter (where t.olek in (0, 4)), 0) as hetke_saldo,
    coalesce(sum(coalesce(r.eeldatav_summa, r.summa)) filter (where t.olek in (1, 2)), 0)
                                                                            as planeeritud
from kontod k
left join tehingu_read r on r.konto_id = k.konto_id
left join tehingud t     on t.tehing_id = r.tehing_id
where k.aktiivne
group by k.konto_id;

drop view if exists v_tasakaalustus;
create view v_tasakaalustus as
select
    ts.tasakaal_id, ts.konto_id, k.nimi as konto_nimi, ts.kuupaev,
    ts.panga_saldo,
    k.alg_saldo + coalesce((
        select sum(r.summa)
        from tehingu_read r join tehingud t on t.tehing_id = r.tehing_id
        where r.konto_id = ts.konto_id and t.kuupaev <= ts.kuupaev and t.olek in (0, 4)
    ), 0)                                                      as arvutatud_saldo,
    ts.panga_saldo - (k.alg_saldo + coalesce((
        select sum(r.summa)
        from tehingu_read r join tehingud t on t.tehing_id = r.tehing_id
        where r.konto_id = ts.konto_id and t.kuupaev <= ts.kuupaev and t.olek in (0, 4)
    ), 0))                                                     as erinevus,
    ts.on_kinnitatud, ts.kommentaar
from tasakaalustus ts
join kontod k on k.konto_id = ts.konto_id;

alter view v_konto_saldo   set (security_invoker = on);
alter view v_tasakaalustus set (security_invoker = on);

grant select on v_konto_saldo, v_tasakaalustus to authenticated;

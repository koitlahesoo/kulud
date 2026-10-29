-- ============================================================
-- KULUD — panga kirjendamise kuupäev (2026-10-29)
--  * tehingud.kuupaev = tegeliku ostu/tehingu päev (nagu tšekil)
--  * tehingud.kirjendatud = päev, mil pank tehingu saldost maha võttis
--    (impordil täidetakse; käsitsi sisestatud tehingul tühi = sama mis kuupaev)
--  * tasakaalustus võrdleb panga saldot kirjendamise päeva järgi
-- Võib käivitada mitu korda.
-- ============================================================

alter table tehingud add column if not exists kirjendatud date;

drop view if exists v_tasakaalustus;
create view v_tasakaalustus as
select
    ts.tasakaal_id, ts.konto_id, k.nimi as konto_nimi, ts.kuupaev,
    ts.panga_saldo,
    k.alg_saldo + coalesce((
        select sum(r.summa)
        from tehingu_read r join tehingud t on t.tehing_id = r.tehing_id
        where r.konto_id = ts.konto_id and coalesce(t.kirjendatud, t.kuupaev) <= ts.kuupaev and t.olek = 0
    ), 0)                                                      as arvutatud_saldo,
    ts.panga_saldo - (k.alg_saldo + coalesce((
        select sum(r.summa)
        from tehingu_read r join tehingud t on t.tehing_id = r.tehing_id
        where r.konto_id = ts.konto_id and coalesce(t.kirjendatud, t.kuupaev) <= ts.kuupaev and t.olek = 0
    ), 0))                                                     as erinevus,
    ts.on_kinnitatud, ts.kommentaar
from tasakaalustus ts
join kontod k on k.konto_id = ts.konto_id;

alter view v_tasakaalustus set (security_invoker = on);
grant select on v_tasakaalustus to authenticated;

create or replace function salvesta_tehing(p jsonb)
returns integer
language plpgsql
security invoker
as $$
declare
    v_id integer := nullif(p->>'tehing_id', '')::integer;
begin
    if jsonb_array_length(coalesce(p->'read', '[]'::jsonb)) = 0 then
        raise exception 'Tehingul peab olema vähemalt üks rida';
    end if;

    if v_id is null then
        insert into tehingud (kuupaev, kirjendatud, koht, kommentaar, olek, allikas)
        values (
            coalesce((p->>'kuupaev')::date, current_date),
            nullif(p->>'kirjendatud', '')::date,
            coalesce(p->>'koht', ''),
            nullif(p->>'kommentaar', ''),
            coalesce((p->>'olek')::smallint, 0),
            coalesce(nullif(p->>'allikas', ''), 'kasitsi')
        )
        returning tehing_id into v_id;
    else
        update tehingud set
            kuupaev      = coalesce((p->>'kuupaev')::date, kuupaev),
            kirjendatud  = coalesce(nullif(p->>'kirjendatud', '')::date, kirjendatud),
            koht         = coalesce(p->>'koht', ''),
            kommentaar   = nullif(p->>'kommentaar', ''),
            olek         = coalesce((p->>'olek')::smallint, olek),
            muudetud_aeg = now()
        where tehing_id = v_id;
        if not found then
            raise exception 'Tehingut % ei leitud', v_id;
        end if;
        delete from tehingu_read where tehing_id = v_id;
    end if;

    insert into tehingu_read (tehing_id, rida, konto_id, summa, eeldatav_summa,
                              kululiigi_id, kommentaar, lisakommentaar, valine_id)
    select v_id,
           r.nr,
           (r.v->>'konto_id')::integer,
           (r.v->>'summa')::numeric,
           nullif(r.v->>'eeldatav_summa', '')::numeric,
           nullif(r.v->>'kululiigi_id', '')::integer,
           nullif(r.v->>'kommentaar', ''),
           nullif(r.v->>'lisakommentaar', ''),
           nullif(r.v->>'valine_id', '')
    from jsonb_array_elements(p->'read') with ordinality as r(v, nr);

    return v_id;
end;
$$;

revoke execute on function salvesta_tehing(jsonb) from public, anon;
grant  execute on function salvesta_tehing(jsonb) to authenticated;

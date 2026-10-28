-- ============================================================
-- KULUD — funktsioonid (käivita pärast schema_postgres_v3.sql)
-- ============================================================

-- Salvestab tehingu koos ridadega ühe korraga (kõik või mitte midagi).
-- p = {"tehing_id": null|int, "kuupaev": "2026-10-28", "koht": "...",
--      "kommentaar": "...", "olek": 0, "allikas": "kasitsi",
--      "read": [{"konto_id": 1, "summa": -12.50, "kululiigi_id": 10,
--                "eeldatav_summa": null, "kommentaar": null,
--                "lisakommentaar": null, "valine_id": null}, ...]}
-- Muutmisel asendatakse tehingu read tervikuna.
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
        insert into tehingud (kuupaev, koht, kommentaar, olek, allikas)
        values (
            coalesce((p->>'kuupaev')::date, current_date),
            coalesce(p->>'koht', ''),
            nullif(p->>'kommentaar', ''),
            coalesce((p->>'olek')::smallint, 0),
            coalesce(nullif(p->>'allikas', ''), 'kasitsi')
        )
        returning tehing_id into v_id;
    else
        update tehingud set
            kuupaev      = coalesce((p->>'kuupaev')::date, kuupaev),
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

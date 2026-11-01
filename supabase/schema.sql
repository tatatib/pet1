-- Run the whole file in Supabase Dashboard → SQL Editor.
-- It can be run again; existing accounts and workouts are preserved.
begin;

create or replace function public.valid_workout_history(payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  item record;
  exercise jsonb;
  workout jsonb;
  count_days integer := 0;
begin
  if payload is null or jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 2000000 then return false; end if;
  for item in select * from jsonb_each(payload) loop
    count_days := count_days + 1;
    if count_days > 10000 or item.key !~ '^\d{4}-\d{2}-\d{2}$' or to_char(item.key::date, 'YYYY-MM-DD') <> item.key then return false; end if;
    workout := item.value;
    if jsonb_typeof(workout) <> 'object'
      or jsonb_typeof(workout->'name') is distinct from 'string'
      or length(workout->>'name') > 80
      or jsonb_typeof(workout->'notes') is distinct from 'string'
      or length(workout->>'notes') > 2000
      or jsonb_typeof(workout->'completed') is distinct from 'boolean'
      or jsonb_typeof(workout->'exercises') is distinct from 'array'
    then return false; end if;
    if jsonb_array_length(workout->'exercises') not between 1 and 100 then return false; end if;
    for exercise in select * from jsonb_array_elements(workout->'exercises') loop
      if jsonb_typeof(exercise) <> 'object'
        or jsonb_typeof(exercise->'muscle') is distinct from 'string'
        or length(exercise->>'muscle') not between 1 and 120
        or jsonb_typeof(exercise->'exercise') is distinct from 'string'
        or length(exercise->>'exercise') not between 1 and 120
        or jsonb_typeof(exercise->'sets') is distinct from 'number'
        or (exercise->>'sets')::numeric not between 1 and 100
        or trunc((exercise->>'sets')::numeric) <> (exercise->>'sets')::numeric
        or jsonb_typeof(exercise->'reps') is distinct from 'number'
        or (exercise->>'reps')::numeric not between 1 and 1000
        or trunc((exercise->>'reps')::numeric) <> (exercise->>'reps')::numeric
        or jsonb_typeof(exercise->'weight') is distinct from 'number'
        or (exercise->>'weight')::numeric not between 0 and 2000
      then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.valid_workout_history(jsonb) from public, anon, authenticated;

create table if not exists public.workout_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workouts jsonb not null default '{}'::jsonb,
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now(),
  constraint valid_history check (public.valid_workout_history(workouts))
);
alter table public.workout_state enable row level security;
revoke all on public.workout_state from public, anon, authenticated;
grant select on public.workout_state to authenticated;
drop policy if exists own_workout_history on public.workout_state;
create policy own_workout_history on public.workout_state
  for select to authenticated using ((select auth.uid()) = user_id);

-- No user_id parameter: identity is taken only from the verified access token.
-- Writes go through this transaction, so stale clients cannot overwrite new data.
create or replace function public.save_workouts(p_workouts jsonb, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  next_revision bigint;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = 'PT401'; end if;
  if p_expected_revision is null or p_expected_revision < 0 or not public.valid_workout_history(p_workouts) then
    raise exception 'Invalid workout history' using errcode = 'PT400';
  end if;
  insert into public.workout_state(user_id) values (owner_id) on conflict (user_id) do nothing;
  update public.workout_state
    set workouts = p_workouts, revision = revision + 1, updated_at = now()
    where user_id = owner_id and revision = p_expected_revision
    returning revision into next_revision;
  if next_revision is null then raise exception 'History changed on another device' using errcode = 'PT409'; end if;
  return jsonb_build_object('revision', next_revision);
end;
$$;
revoke all on function public.save_workouts(jsonb, bigint) from public, anon;
grant execute on function public.save_workouts(jsonb, bigint) to authenticated;
commit;

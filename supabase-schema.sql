-- QuizDesk database setup for Supabase (PostgreSQL)
-- Run this entire file once in Supabase Dashboard > SQL Editor > New query.
-- It creates role-based access, keeps answer keys private, and records timing on the server.

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.teachers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Teacher',
  created_at timestamptz not null default now()
);

create table if not exists public.quizzes (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text not null default '',
  is_published boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  question_text text not null check (char_length(btrim(question_text)) between 1 and 2000),
  options jsonb not null check (
    jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) between 2 and 6
  ),
  position integer not null default 1 check (position > 0),
  created_at timestamptz not null default now(),
  unique (quiz_id, position)
);

-- Correct answers are deliberately separated from the student-readable questions table.
create table if not exists public.answer_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_option_index integer not null check (correct_option_index between 0 and 5)
);

create table if not exists public.attempts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete restrict,
  student_name text not null check (char_length(btrim(student_name)) between 1 and 100),
  student_code text not null check (char_length(btrim(student_code)) between 1 and 60),
  contact text not null default '',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  elapsed_seconds integer,
  score integer,
  total_questions integer not null check (total_questions > 0),
  created_at timestamptz not null default now(),
  check (
    (submitted_at is null and elapsed_seconds is null and score is null)
    or
    (submitted_at is not null and elapsed_seconds is not null and score is not null)
  )
);

create table if not exists public.answers (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete restrict,
  selected_option_index integer not null check (selected_option_index between 0 and 5),
  is_correct boolean not null,
  unique (attempt_id, question_id)
);

create index if not exists questions_quiz_position_idx on public.questions(quiz_id, position);
create index if not exists attempts_quiz_submitted_idx on public.attempts(quiz_id, submitted_at desc);
create index if not exists answers_attempt_idx on public.answers(attempt_id);

-- -----------------------------------------------------------------------------
-- Teacher role helper
-- -----------------------------------------------------------------------------

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.teachers t
    where t.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.teachers enable row level security;
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.answer_keys enable row level security;
alter table public.attempts enable row level security;
alter table public.answers enable row level security;

drop policy if exists "Teacher can read own teacher record" on public.teachers;
create policy "Teacher can read own teacher record"
on public.teachers for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "Published quizzes and own teacher quizzes are readable" on public.quizzes;
create policy "Published quizzes and own teacher quizzes are readable"
on public.quizzes for select to anon, authenticated
using (
  is_published = true
  or (public.is_teacher() and created_by = (select auth.uid()))
);

drop policy if exists "Teacher can insert own quizzes" on public.quizzes;
drop policy if exists "Teacher can update own quizzes" on public.quizzes;
create policy "Teacher can update own quizzes"
on public.quizzes for update to authenticated
using (public.is_teacher() and created_by = (select auth.uid()))
with check (public.is_teacher() and created_by = (select auth.uid()));

drop policy if exists "Teacher can delete own quizzes" on public.quizzes;
create policy "Teacher can delete own quizzes"
on public.quizzes for delete to authenticated
using (public.is_teacher() and created_by = (select auth.uid()));

drop policy if exists "Students see questions in published quizzes and teachers see own" on public.questions;
create policy "Students see questions in published quizzes and teachers see own"
on public.questions for select to anon, authenticated
using (
  exists (
    select 1 from public.quizzes q
    where q.id = questions.quiz_id
      and (
        q.is_published = true
        or (public.is_teacher() and q.created_by = (select auth.uid()))
      )
  )
);

drop policy if exists "Only quiz owner can read answer keys" on public.answer_keys;
create policy "Only quiz owner can read answer keys"
on public.answer_keys for select to authenticated
using (
  public.is_teacher()
  and exists (
    select 1
    from public.questions q
    join public.quizzes z on z.id = q.quiz_id
    where q.id = answer_keys.question_id
      and z.created_by = (select auth.uid())
  )
);

drop policy if exists "Only quiz owner can read attempts" on public.attempts;
create policy "Only quiz owner can read attempts"
on public.attempts for select to authenticated
using (
  public.is_teacher()
  and exists (
    select 1 from public.quizzes q
    where q.id = attempts.quiz_id and q.created_by = (select auth.uid())
  )
);

drop policy if exists "Only quiz owner can read submitted answers" on public.answers;
create policy "Only quiz owner can read submitted answers"
on public.answers for select to authenticated
using (
  public.is_teacher()
  and exists (
    select 1
    from public.attempts a
    join public.quizzes q on q.id = a.quiz_id
    where a.id = answers.attempt_id
      and q.created_by = (select auth.uid())
      and a.submitted_at is not null
  )
);

-- -----------------------------------------------------------------------------
-- Least-privilege Data API grants. No student role receives answer-key or results access.
-- -----------------------------------------------------------------------------

revoke all on public.teachers, public.quizzes, public.questions,
  public.answer_keys, public.attempts, public.answers from anon, authenticated;

grant usage on schema public to anon, authenticated;
grant select on public.quizzes, public.questions to anon, authenticated;
grant select on public.teachers to authenticated;
grant update, delete on public.quizzes to authenticated;
grant select on public.answer_keys, public.attempts, public.answers to authenticated;

-- -----------------------------------------------------------------------------
-- Teacher-only quiz creation (one transaction, including private answer keys)
-- -----------------------------------------------------------------------------

create or replace function public.create_quiz(
  p_title text,
  p_description text,
  p_is_published boolean,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quiz_id uuid;
  v_question_id uuid;
  v_item jsonb;
  v_position integer := 0;
  v_option_count integer;
  v_correct_index integer;
begin
  if not public.is_teacher() then
    raise exception 'Teacher access required.' using errcode = '42501';
  end if;

  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) = 0
     or pg_catalog.char_length(p_title) > 100 then
    raise exception 'Enter a quiz title of 1 to 100 characters.';
  end if;

  if p_questions is null or pg_catalog.jsonb_typeof(p_questions) <> 'array'
     or pg_catalog.jsonb_array_length(p_questions) < 1
     or pg_catalog.jsonb_array_length(p_questions) > 100 then
    raise exception 'A quiz must contain between 1 and 100 questions.';
  end if;

  insert into public.quizzes (title, description, is_published, created_by)
  values (
    pg_catalog.btrim(p_title),
    coalesce(p_description, ''),
    coalesce(p_is_published, false),
    (select auth.uid())
  )
  returning id into v_quiz_id;

  for v_item in
    select value from pg_catalog.jsonb_array_elements(p_questions) as e(value)
  loop
    v_position := v_position + 1;

    if v_item->>'question_text' is null
       or pg_catalog.char_length(pg_catalog.btrim(v_item->>'question_text')) = 0
       or pg_catalog.char_length(v_item->>'question_text') > 2000 then
      raise exception 'Question % must contain text (maximum 2000 characters).', v_position;
    end if;

    if pg_catalog.jsonb_typeof(v_item->'options') is distinct from 'array' then
      raise exception 'Question % must have an options array.', v_position;
    end if;

    v_option_count := pg_catalog.jsonb_array_length(v_item->'options');
    if v_option_count < 2 or v_option_count > 6 then
      raise exception 'Question % must have between 2 and 6 options.', v_position;
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_item->'options') as o(value)
      where pg_catalog.jsonb_typeof(o.value) <> 'string'
         or pg_catalog.char_length(pg_catalog.btrim(o.value #>> '{}')) = 0
         or pg_catalog.char_length(o.value #>> '{}') > 500
    ) then
      raise exception 'Question % contains an empty or overly long option.', v_position;
    end if;

    begin
      v_correct_index := (v_item->>'correct_option_index')::integer;
    exception when others then
      raise exception 'Question % needs a valid correct answer.', v_position;
    end;

    if v_correct_index < 0 or v_correct_index >= v_option_count then
      raise exception 'Question % has an invalid correct-answer selection.', v_position;
    end if;

    insert into public.questions (quiz_id, question_text, options, position)
    values (
      v_quiz_id,
      pg_catalog.btrim(v_item->>'question_text'),
      v_item->'options',
      v_position
    )
    returning id into v_question_id;

    insert into public.answer_keys (question_id, correct_option_index)
    values (v_question_id, v_correct_index);
  end loop;

  return v_quiz_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Student attempt start: timestamp and question count are generated by PostgreSQL.
-- -----------------------------------------------------------------------------

create or replace function public.start_quiz(
  p_quiz_id uuid,
  p_student_name text,
  p_student_code text,
  p_contact text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_started_at timestamptz;
  v_total integer;
begin
  if p_student_name is null or pg_catalog.char_length(pg_catalog.btrim(p_student_name)) not between 1 and 100
     or p_student_code is null or pg_catalog.char_length(pg_catalog.btrim(p_student_code)) not between 1 and 60
     or coalesce(pg_catalog.char_length(p_contact), 0) > 120 then
    raise exception 'Please check the name, student ID and contact details.';
  end if;

  if not exists (
    select 1 from public.quizzes q
    where q.id = p_quiz_id and q.is_published = true
  ) then
    raise exception 'This quiz is not available.';
  end if;

  select pg_catalog.count(*)::integer into v_total
  from public.questions q where q.quiz_id = p_quiz_id;

  if v_total < 1 then
    raise exception 'This quiz has no questions yet.';
  end if;

  v_started_at := pg_catalog.clock_timestamp();

  insert into public.attempts (quiz_id, total_questions, started_at, student_name, student_code, contact)
  values (p_quiz_id, v_total, v_started_at, pg_catalog.btrim(p_student_name), pg_catalog.btrim(p_student_code), coalesce(pg_catalog.btrim(p_contact), ''))
  returning id into v_attempt_id;

  return pg_catalog.jsonb_build_object(
    'attempt_id', v_attempt_id,
    'started_at', v_started_at,
    'total_questions', v_total
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Student submission: validates every question, grades server-side, and returns no score.
-- -----------------------------------------------------------------------------

create or replace function public.submit_quiz(
  p_attempt_id uuid,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts%rowtype;
  v_answer_count integer;
  v_unique_count integer;
  v_score integer;
  v_elapsed integer;
begin
  select * into v_attempt
  from public.attempts a
  where a.id = p_attempt_id
  for update;

  if not found then
    raise exception 'Quiz attempt not found.';
  end if;

  if v_attempt.submitted_at is not null then
    raise exception 'This quiz has already been submitted.';
  end if;

  if p_answers is null or pg_catalog.jsonb_typeof(p_answers) <> 'array' then
    raise exception 'No answers were received.';
  end if;

  v_answer_count := pg_catalog.jsonb_array_length(p_answers);
  select pg_catalog.count(distinct (x.value->>'question_id'))::integer
  into v_unique_count
  from pg_catalog.jsonb_array_elements(p_answers) as x(value);

  if v_answer_count <> v_attempt.total_questions or v_unique_count <> v_attempt.total_questions then
    raise exception 'Please answer every question exactly once.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_answers) as x(value)
    where x.value->>'question_id' is null
       or x.value->>'selected_option_index' is null
       or not exists (
         select 1 from public.questions q
         where q.id = (x.value->>'question_id')::uuid
           and q.quiz_id = v_attempt.quiz_id
           and (x.value->>'selected_option_index')::integer >= 0
           and (x.value->>'selected_option_index')::integer < pg_catalog.jsonb_array_length(q.options)
       )
  ) then
    raise exception 'One or more submitted answers are invalid.';
  end if;

  insert into public.answers (attempt_id, question_id, selected_option_index, is_correct)
  select
    v_attempt.id,
    q.id,
    (x.value->>'selected_option_index')::integer,
    ak.correct_option_index = (x.value->>'selected_option_index')::integer
  from pg_catalog.jsonb_array_elements(p_answers) as x(value)
  join public.questions q
    on q.id = (x.value->>'question_id')::uuid and q.quiz_id = v_attempt.quiz_id
  join public.answer_keys ak on ak.question_id = q.id;

  select pg_catalog.count(*)::integer into v_score
  from public.answers a
  where a.attempt_id = v_attempt.id and a.is_correct = true;

  v_elapsed := greatest(0, floor(extract(epoch from (pg_catalog.clock_timestamp() - v_attempt.started_at)))::integer);

  update public.attempts
  set submitted_at = pg_catalog.clock_timestamp(),
      elapsed_seconds = v_elapsed,
      score = v_score
  where id = v_attempt.id;

  -- Deliberately do not return score, correct answers, or student answers to the browser.
  return pg_catalog.jsonb_build_object('submitted', true);
end;
$$;

-- Restrict callable functions explicitly. Student-facing RPCs return no private answer data.
revoke all on function public.create_quiz(text, text, boolean, jsonb) from public, anon;
revoke all on function public.start_quiz(uuid, text, text, text) from public;
revoke all on function public.submit_quiz(uuid, jsonb) from public, anon;

grant execute on function public.create_quiz(text, text, boolean, jsonb) to authenticated;
grant execute on function public.start_quiz(uuid, text, text, text) to anon, authenticated;
grant execute on function public.submit_quiz(uuid, jsonb) to anon, authenticated;

-- Reload PostgREST schema cache so the new RPCs are visible.
notify pgrst, 'reload schema';

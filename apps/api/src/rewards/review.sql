-- Rewards review queries. Run against production a few weeks after launch (psql $DATABASE_URL -f this file) before changing any point value in rules.ts.
-- Rough guide from the rules as written: a student who only opens the app earns 35 a week; an active social one about 85; a newcomer's first week about 125 (setup bonuses);
-- the hard ceiling on repeatable activity is 420 a week (60 a day); a full month of invites adds up to 300. Retune from these results, not from these guesses.

-- 1. Where the points come from (last 28 days): if one kind dominates, retune it.
select kind, count(*) as awards, sum(points) as points
from point_events where reversed_at is null and day >= (now() at time zone 'Africa/Lagos')::date - 28
group by kind order by points desc;

-- 2. How many students hit the 60-a-day cap, and how often (a cap that bites often is too tight).
select count(distinct user_id) as students, count(*) as capped_days from (
  select user_id, day from point_events
  where reversed_at is null and kind in ('checkin','connection','room_joined','meetup_accepted') and day >= (now() at time zone 'Africa/Lagos')::date - 28
  group by user_id, day having sum(points) >= 60) t;

-- 3. The spread of this week's points among everyone who earned any (median and top should not be 10x apart).
select count(*) as students, percentile_cont(0.5) within group (order by pts) as median, max(pts) as top
from (select user_id, sum(points) as pts from point_events
      where reversed_at is null and day >= date_trunc('week', (now() at time zone 'Africa/Lagos')::date) group by user_id) t;

-- 4. Do invites convert? Joined through a link vs paid out the inviter.
select (select count(*) from users where referred_by is not null) as joined_by_link,
       (select count(*) from point_events where kind = 'invite_friend' and reversed_at is null) as paid_out;

-- 5. How many have opted in to the leaderboard, and how many streaks are alive.
select count(*) filter (where leaderboard_opt_in) as on_leaderboard, count(*) filter (where streak_current >= 3) as streak_3_plus, count(*) as with_progress from user_progress;

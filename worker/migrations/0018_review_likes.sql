-- A like on a review: the cheapest social loop there is.
--
-- A fact, not a counter — primary key (review_id, user_id) means liking twice
-- is one row, so like and unlike are idempotent and a retry can never inflate
-- the count. Counts are read with count(*): at this volume a denormalised
-- counter is a bug farm bought to solve a problem we don't have (the same call
-- docs/social.md already made for rating_count/rating_sum).
--
-- It also feeds ordering: event pages list reviews most-liked first, which is
-- "popular reviews" the moment there are enough likes for popular to mean
-- anything, and newest-first until then (created_at is the tiebreak).

create table if not exists review_likes (
  review_id text not null references reviews(id),
  user_id text not null references users(id),
  created_at text not null,
  primary key (review_id, user_id)
);

-- DICE events hydrated and found unusable (no billed acts): remembered so the
-- sweep's bounded hydration budget isn't re-spent on them every six hours.
CREATE TABLE `dice_skips` (
	`id` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL
);

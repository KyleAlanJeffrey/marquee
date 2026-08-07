import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { apiDelete } from '@/lib/api';
import { useAttendances } from '@/lib/attendances-store';
import { useAuth } from '@/lib/auth';
import { usePastRsvps, type PastRsvp } from '@/lib/reviews';

/**
 * Turns "I'm going" into "I went", once the night has happened.
 *
 * Saying you're going to a show and then having to log the same show by hand
 * afterwards is asking the same question twice; the answer was already given
 * (Kyle, 2026-08-07). So a going-RSVP whose date has passed becomes a log
 * entry — unrated, exactly as if it had been logged by hand, ready for the
 * stars whenever the user gets to them.
 *
 * Only `going`. "Interested" is a maybe, and turning a maybe into a claim that
 * somebody attended would put shows in their history they never went to.
 *
 * **The RSVP is consumed, and that's the idempotency.** After the log row is
 * written the answer is deleted server-side, so:
 *
 * - the same show can't be logged twice;
 * - removing the entry from the log afterwards *stays* removed — nothing
 *   remains to re-convert it on the next launch, which is the failure mode
 *   that would make the log feel haunted.
 *
 * Deleting loses nothing: a past RSVP is already invisible everywhere (My
 * Shows lists only upcoming plans, the activity stream only streams future
 * ones), so its whole remaining purpose is to become this log row. The write
 * happens before the delete, so a crash in between costs a repeat attempt
 * next launch rather than a lost night.
 */
export function RsvpSettler() {
  const { signedIn, userId } = useAuth();
  const { ready, wasThere, log } = useAttendances();
  const queryClient = useQueryClient();
  const past = usePastRsvps(signedIn);
  // Which event ids this session already handled, so a re-render between the
  // log write and the list refetch can't start a second pass over the same row.
  const handled = useRef(new Set<string>());
  // …and whose they were. Two people sharing a phone can hold a going-RSVP for
  // the same night; without this the second one's would be skipped as already
  // handled and never reach their log.
  const handledFor = useRef<string | null>(null);

  const items = past.data?.items;

  useEffect(() => {
    if (handledFor.current !== (userId ?? null)) {
      handledFor.current = userId ?? null;
      handled.current = new Set();
    }
    // `ready` matters: the log is read off disk asynchronously, and converting
    // before it lands would re-add shows that are already in there.
    if (!signedIn || !ready || !items?.length) return;

    let cancelled = false;
    const settle = async (rsvp: PastRsvp) => {
      handled.current.add(rsvp.event_id);
      const show = {
        eventId: rsvp.event_id,
        name: rsvp.event_name,
        startsAt: rsvp.starts_at,
        artistId: rsvp.artist_id,
        artistName: rsvp.artist_name,
        artistImageUrl: rsvp.artist_image_url,
        venueId: rsvp.venue_id,
        venueName: rsvp.venue_name,
        venueCity: rsvp.venue_city,
        venueTimezone: rsvp.venue_timezone,
      };
      // Already logged by hand? Then only the stale RSVP needs clearing.
      if (!wasThere({ eventId: rsvp.event_id })) log(show);
      try {
        await apiDelete(`/events/${encodeURIComponent(rsvp.event_id)}/rsvp`);
      } catch (err) {
        // The log row stands either way; the RSVP just gets another go next
        // launch, and the `wasThere` check above makes that harmless.
        console.warn('clearing a settled rsvp failed:', err);
        handled.current.delete(rsvp.event_id);
      }
    };

    (async () => {
      const fresh = items.filter((r) => !handled.current.has(r.event_id));
      if (!fresh.length) return;
      for (const rsvp of fresh) {
        if (cancelled) return;
        await settle(rsvp);
      }
      if (cancelled) return;
      // The counts on My Shows and the event pages just changed.
      queryClient.invalidateQueries({ queryKey: ['my-rsvps'] });
      queryClient.invalidateQueries({ queryKey: ['my-rsvps-past'] });
    })();

    return () => {
      cancelled = true;
    };
  }, [signedIn, userId, ready, items, wasThere, log, queryClient]);

  return null;
}

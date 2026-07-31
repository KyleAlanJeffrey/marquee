import { describe, expect, it } from 'vitest';

import { representative } from '../src/data';
import {
  agreesWithCluster,
  bestVenueMatch,
  dashBillingVenueName,
  guessUtcOffsetHours,
  isPlaceholderPoint,
  looksLikeEventTitle,
  looksLikeTourName,
  mergeField,
  metersBetween,
  parseSources,
  prefersSource,
  sameShow,
  sameVenue,
  venueNameTokens,
  venueNamesAgree,
  venueNamesConflict,
  venueNamesMatchStrongly,
  type VenuePoint,
} from '../src/dedupe';

const at = (name: string, lat: number, lng: number, city?: string, id = name): VenuePoint => ({
  id,
  name,
  lat,
  lng,
  city,
});

describe('venue identity', () => {
  it('measures real distances', () => {
    // The Fillmore to Great American Music Hall, ~1.3km apart in SF.
    const m = metersBetween({ lat: 37.7842, lng: -122.4332 }, { lat: 37.7849, lng: -122.4187 });
    expect(m).toBeGreaterThan(1_200);
    expect(m).toBeLessThan(1_400);
  });

  it('matches the same room at the same coordinates whatever it is called', () => {
    expect(sameVenue(at('The Independent', 37.7756, -122.4376), at('Independent SF', 37.7756, -122.4376))).toBe(true);
  });

  it('separates two different rooms on the same block', () => {
    // ~150m apart, no shared distinguishing word.
    expect(sameVenue(at('Bottom of the Hill', 37.7654, -122.3961), at('Thee Parkside', 37.7667, -122.3961))).toBe(false);
  });

  // Measured pairs where Ticketmaster's coordinates sit on the city, not the door.
  it.each([
    ['Franklin Music Hall', 'Franklin Music Hall', 39.9589, -75.15, 39.9662, -75.1443, 'Philadelphia'],
    ['Royal Oak Music Theatre', 'Royal Oak Music Theatre', 42.4877, -83.1475, 42.4934, -83.1441, 'Royal Oak'],
    ['The Eastern-GA', 'The Eastern', 33.7452, -84.3606, 33.7501, -84.3123, 'Atlanta'],
    ['Agora Theatre', 'Agora Theater & Ballroom', 41.5037, -81.654, 41.4993, -81.6549, 'Cleveland'],
  ])('joins "%s" and "%s" across a city-centroid coordinate', (n1, n2, la1, ln1, la2, ln2, city) => {
    expect(sameVenue(at(n1, la1, ln1, city, '1'), at(n2, la2, ln2, city, '2'))).toBe(true);
  });

  it('will not join look-alike names in different towns', () => {
    expect(
      sameVenue(at('The Fillmore', 37.7842, -122.4332, 'San Francisco'), at('The Fillmore', 38.9907, -77.0261, 'Silver Spring')),
    ).toBe(false);
  });

  it('will not join two rooms whose names merely share a word', () => {
    expect(sameVenue(at('Brooklyn Bowl', 40.7219, -73.9575, 'Brooklyn'), at('Brooklyn Steel', 40.7126, -73.9366, 'Brooklyn'))).toBe(
      false,
    );
  });

  it("does not let the town's own name count as a distinguishing word", () => {
    // "Metro Chicago" and "Radius Chicago" are two different rooms that agree on
    // nothing but the word "chicago" — which every venue in Chicago may carry. The
    // coordinates here are pinned ~145m apart, inside the window where a shared
    // word used to be enough to merge them.
    const metro = at('Metro Chicago', 41.9397, -87.6589, 'Chicago');
    const radius = at('Radius Chicago', 41.941, -87.6589, 'Chicago');
    expect(venueNamesAgree('Metro Chicago', 'Radius Chicago', 'Chicago')).toBe(false);
    expect(sameVenue(metro, radius)).toBe(false);
  });

  it('uses whichever side knows the town when only one does', () => {
    const metro = at('Metro Chicago', 41.9397, -87.6589, 'Chicago');
    const radius = { id: 'r', name: 'Radius Chicago', lat: 41.941, lng: -87.6589 };
    expect(sameVenue(metro, radius)).toBe(false);
  });

  it('answers the same whichever side is asked first when the cities disagree', () => {
    // Two nearby rows claiming different towns — the borough spelling against the
    // city proper. Neither city may be dropped: dropping whichever side happened to
    // come first made the verdict depend on argument order, and ingest calls this
    // both ways round. One room under two city labels still joins…
    const bowlBk = at('Brooklyn Bowl', 40.7219, -73.9575, 'Brooklyn');
    const bowlNy = at('Brooklyn Bowl', 40.7221, -73.9573, 'New York');
    expect(sameVenue(bowlBk, bowlNy)).toBe(sameVenue(bowlNy, bowlBk));
    expect(sameVenue(bowlBk, bowlNy)).toBe(true);

    // …and two different rooms on the block stay apart, from either direction.
    const hill = at('Bottom of the Hill', 37.7654, -122.3961, 'San Francisco');
    const parkside = at('Thee Parkside', 37.7667, -122.3961, 'Frisco');
    expect(sameVenue(hill, parkside)).toBe(sameVenue(parkside, hill));
    expect(sameVenue(hill, parkside)).toBe(false);
  });

  it('still joins two spellings of one room once the town is dropped', () => {
    // The city word goes, the identifying word stays: "Metro" is what matches.
    expect(venueNamesAgree('Metro Chicago', 'Metro', 'Chicago')).toBe(true);
    expect(
      sameVenue(at('Metro Chicago', 41.9397, -87.6589, 'Chicago'), at('Metro', 41.9408, -87.6589, 'Chicago')),
    ).toBe(true);
  });

  it('still joins a town-named venue to its identical twin across a centroid', () => {
    // The escape hatch the city-drop needs: "Royal Oak Music Theatre" in Royal Oak
    // is nothing but city words and stopwords, so dropping the town would empty it
    // — but token-identical names in one town are one room, and the rule above
    // (12km, same town) exists exactly for these centroid-stamped pairs.
    expect(venueNamesMatchStrongly('Royal Oak Music Theatre', 'Royal Oak Music Theatre', 'Royal Oak')).toBe(true);
    expect(venueNamesAgree('Royal Oak Music Theatre', 'Royal Oak Music Theatre', 'Royal Oak')).toBe(true);
  });

  it('keeps a venue whose whole identity is the town name mergeable at the same spot', () => {
    // Dropping the town can empty a name ("Chicago Theatre" in Chicago is all
    // stopwords and city). Empty claims nothing, so it cannot conflict — the
    // same-spot rule still joins it, same as any all-generic name.
    expect(venueNamesConflict('Chicago Theatre', 'The Chicago Theatre', 'Chicago')).toBe(false);
    expect(
      sameVenue(at('Chicago Theatre', 41.8855, -87.6275, 'Chicago'), at('The Chicago Theatre', 41.8855, -87.6275, 'Chicago')),
    ).toBe(true);
  });

  it('needs coordinates on both sides', () => {
    expect(sameVenue(at('Somewhere', 1, 1), { id: 'x', name: 'Somewhere', lat: null, lng: null })).toBe(false);
  });

  it('picks the nearest of several candidates', () => {
    const target = at('The Independent', 37.7756, -122.4376, 'San Francisco', 'target');
    const best = bestVenueMatch(target, [
      at('The Independent', 37.78, -122.44, 'San Francisco', 'far'),
      at('The Independent', 37.7757, -122.4377, 'San Francisco', 'near'),
    ]);
    expect(best?.id).toBe('near');
  });

  it('treats a tour title as no name at all, so it still finds its real room', () => {
    // Bandsintown files some shows under the tour rather than the venue, but with
    // the venue's real coordinates — so the junk-named row must still be absorbed
    // by the room it is sitting on, exactly as it was before names could conflict.
    for (const junk of [
      'Brunette World Tour',
      'AUTUMNAL RITES TOUR',
      'BILMURI presents: The KINDA HARD Tour',
      'Supporting Tame Impala',
      'Atlanta w/ Bleachers',
    ]) {
      expect(looksLikeTourName(junk), junk).toBe(true);
      expect(venueNameTokens(junk).size, junk).toBe(0);
      expect(venueNamesConflict(junk, 'Paper Tiger'), junk).toBe(false);
      expect(sameVenue(at(junk, 37.7756, -122.4376), at('Paper Tiger', 37.7756, -122.4376)), junk).toBe(true);
    }
  });

  it('refuses to publish an event title as a venue name', () => {
    // Every one of these is a real production venue row, taken from the 1,054 that
    // carry an event title. The first two are why this predicate exists at all:
    // neither says "tour", so `looksLikeTourName` passes them straight through.
    for (const junk of [
      'Horse Jumper of Love: playing their Self Titled Debut in its entirety',
      'Drops of Jupiter: 25 Years in the Atmosphere',
      'The Constellation Tour: Thee Sacred Souls, LA LOM & The Womack Sisters',
      'Billy Currington & Kip Moore: Live in Concert',
      '"This Might Be Useful" Tour',
    ]) {
      expect(looksLikeEventTitle(junk), junk).toBe(true);
    }
  });

  it('lets through an event title that is punctuated like a venue', () => {
    // Pinned as a known miss for the *string* rule, not an aspiration. It has no
    // colon, no "tour" and no "presents" — it separates with a dash, and so do
    // real rooms ("The Eastern-GA", "Stage AE - Outdoors"). A dash rule here
    // would cost more true names than it saves false ones. The source-side fix
    // is `dashBillingVenueName`, judged with the listing's own context — and
    // this exact row escapes even that (see its tests below).
    expect(looksLikeEventTitle('PROGRESSIVE HOUSE NEVER DIED - Seattle')).toBe(false);
  });

  it('publishes real venue names, festivals and long-but-plausible ones included', () => {
    for (const real of [
      'The Warfield',
      'Paper Tiger',
      'Golden Gate Park',
      'Aftershock 2026',
      // 61 characters — under the ceiling, and a genuine room.
      'Infosys Theater at Madison Square Garden Entertainment Complex',
      'MGM Music Hall at Fenway',
      'Red Rocks Amphitheatre',
    ]) {
      expect(looksLikeEventTitle(real), real).toBe(false);
    }
    // Absent is not the same as wrong; callers handle the two differently.
    for (const empty of [null, undefined, '', '   ']) {
      expect(looksLikeEventTitle(empty), JSON.stringify(empty)).toBe(false);
    }
  });

  it('leaves real venue names alone, festivals included', () => {
    // A festival is where the show actually is, unlike a tour, so its name has to
    // keep identifying a place.
    for (const real of [
      'Aftershock 2026',
      'Austin City Limits Music Festival 2026',
      'The Warfield',
      'Paper Tiger',
      'Golden Gate Park',
      'Detour Bar',
    ]) {
      expect(looksLikeTourName(real), real).toBe(false);
      expect(venueNameTokens(real).size, real).toBeGreaterThan(0);
    }
  });

  it('reads a name conflict only when both names claim something', () => {
    expect(venueNamesConflict('Warfield', 'Golden Gate Park')).toBe(true);
    // A shared distinguishing word is agreement, not conflict.
    expect(venueNamesConflict('Fox Theater', 'Fox Theater - Oakland')).toBe(false);
    // Neither name claims anything, so there is nothing to disagree about.
    expect(venueNamesConflict('The Theatre', 'Music Hall')).toBe(false);
    expect(venueNamesConflict('', 'Warfield')).toBe(false);
  });

  it('ignores generic words when comparing names', () => {
    // Both names are nothing but generic words, so neither can vouch for a match
    // — and at 50-300m apart that's several different rooms, not one.
    expect(venueNamesAgree('The Music Hall', 'Music Hall Theatre')).toBe(false);
    expect(venueNamesMatchStrongly('The Music Hall', 'Music Hall Theatre')).toBe(false);
    expect(venueNamesAgree('Roadrunner', 'Roadrunner-Boston')).toBe(true);
    expect(venueNamesMatchStrongly('Roadrunner', 'Roadrunner-Boston')).toBe(true);
  });

  // The production failure. Ticketmaster returns a city centroid for venues it has
  // no address for, and the *same* centroid for all of them, so five unrelated San
  // Francisco rooms arrived zero metres apart and merged into one venue — after
  // which the feed showed Interpol and Dimmu Borgir at Davies Symphony Hall.
  const CENTROID: [number, number] = [37.779499, -122.419502];
  const onCentroid = (name: string, id = name) => at(name, CENTROID[0], CENTROID[1], 'San Francisco', id);

  it('will not merge unrelated rooms a source stacked on one coordinate', () => {
    const names = ['Warfield', 'Golden Gate Park', 'Davies Symphony Hall', 'Rickshaw Stop'];
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        expect(sameVenue(onCentroid(a), onCentroid(b)), `${a} vs ${b}`).toBe(false);
      }
    }
  });

  it('sends a centroid-stamped venue to its real row instead of its neighbours', () => {
    // Warfield-on-the-centroid must lose to the actual Warfield 900m away, or its
    // shows are filed under whichever room shares the placeholder point.
    const best = bestVenueMatch(onCentroid('Warfield', 'tm-warfield'), [
      onCentroid('Golden Gate Park', 'tm-ggp'),
      onCentroid('Davies Symphony Hall', 'tm-davies'),
      at('The Warfield', 37.7827, -122.41, 'San Francisco', 'sg-warfield'),
    ]);
    expect(best?.id).toBe('sg-warfield');
  });

  it('still joins two spellings of one room stacked on that coordinate', () => {
    // The rule keys on disagreement, not on distance alone, so a real duplicate
    // that happens to share the placeholder still collapses.
    expect(sameVenue(onCentroid('Fox Theater', 'a'), onCentroid('Fox Theater - Oakland', 'b'))).toBe(true);
  });

  it('still joins a same-spot pair whose names are all generic', () => {
    // The ≤50m rule does not consult the name, which is what keeps the stricter
    // `venueNamesAgree` from losing real duplicates.
    expect(sameVenue(at('The Theatre', 37.7756, -122.4376), at('Music Hall', 37.7757, -122.4376))).toBe(true);
  });
});

describe('dash-separated billings', () => {
  // Every case below is a real production row from the 2026-07-31 measurement —
  // the spec is the data, not what we assume a billing looks like.

  it('catches a billing whose prefix carries the act, suffixed with its own city', () => {
    expect(dashBillingVenueName('MGMT DJ SET - San Francisco ', 'San Francisco', 'MGMT')).toBe(true);
    expect(dashBillingVenueName('JOURNEY OF A LIFETIME - MIAMI', 'Miami', 'Journey')).toBe(true);
  });

  it('catches a tour-shaped prefix suffixed with its own city, whoever is playing', () => {
    expect(dashBillingVenueName('TASHA UNSCRIPTED NIGHTS TOUR - BOSTON', 'Boston', 'Tasha Cobbs')).toBe(true);
  });

  it('spares real rooms that suffix their own city', () => {
    // SeatGeek writes this shape on legitimate venues — the whole reason the
    // string rule refused a dash rule.
    expect(dashBillingVenueName('Fox Theater - Oakland', 'Oakland', 'MGMT')).toBe(false);
    expect(dashBillingVenueName('Bottom of the Hill - San Francisco', 'San Francisco', 'Wednesday')).toBe(false);
  });

  it('spares dash-named rooms whose suffix is not the city', () => {
    expect(dashBillingVenueName('PALAIS DES CONGRES - SALLE MAURICE RAVEL', 'Le Touquet-paris-plage', 'Anyone')).toBe(false);
    expect(dashBillingVenueName('Williams Center - Black Box - Rutherford', 'Rutherford', 'Anyone')).toBe(false);
    // "Rutherford" IS the suffix here — but "Williams Center - Black Box" is
    // neither tour-shaped nor the act, so the second guard holds.
  });

  it('needs the spaced dash — "The Eastern-GA" is one word to it', () => {
    expect(dashBillingVenueName('The Eastern-GA', 'Atlanta', 'The Eastern')).toBe(false);
  });

  it('matches the artist as whole tokens, so War cannot claim Warlord Theater', () => {
    expect(dashBillingVenueName('Warlord Theater - Oakland', 'Oakland', 'War')).toBe(false);
    expect(dashBillingVenueName('WAR LIVE SET - Oakland', 'Oakland', 'War')).toBe(true);
  });

  it('compares a non-Latin city raw instead of never matching it', () => {
    // Normalisation strips CJK to nothing; the fallback compares the strings
    // themselves so a billing suffixed with 東京 is still tellable in Tokyo.
    expect(dashBillingVenueName('BABYMETAL WORLD TOUR - 東京', '東京', 'Babymetal')).toBe(true);
    expect(dashBillingVenueName('Zepp DiverCity - 東京', '東京', 'Babymetal')).toBe(false);
  });

  it('still misses the club-night brand, knowingly', () => {
    // No artist token, no tour word: nothing in the listing separates this from
    // a room. Pinned as the residual the todo entry accepts.
    expect(dashBillingVenueName('PROGRESSIVE HOUSE NEVER DIED - Seattle', 'Seattle', 'Some DJ')).toBe(false);
  });
});

describe('cluster membership', () => {
  // The measured Dallas chain: The Factory In Deep Ellum and The Bomb Factory are
  // one room (renamed), and Three Links is a different bar up the street that
  // shares only the neighbourhood words with the first name.
  const factory = at('The Factory In Deep Ellum', 32.7841, -96.7846, 'Dallas');
  const bomb = at('The Bomb Factory', 32.7841, -96.7846, 'Dallas');
  const links = at('Three Links Deep Ellum', 32.7846, -96.7823, 'Dallas');

  it('lets the renamed room in and keeps the neighbour out', () => {
    // Pairwise, Three Links matches the Factory on "deep ellum" — that is the
    // chain forming. Against the whole cluster it fails on The Bomb Factory, which
    // it shares nothing with and does not sit on.
    expect(sameVenue(links, factory)).toBe(true);
    expect(agreesWithCluster(bomb, [factory])).toBe(true);
    expect(agreesWithCluster(links, [factory, bomb])).toBe(false);
  });

  it('gives no veto to members that cannot be judged', () => {
    // A tour-title member has no tokens to disagree with; a row with no
    // coordinates cannot be distance-checked. Neither should keep a real twin out.
    const tourRow = at('JOJI: SOLARIS TOUR w/ special guests', 32.9, -96.9, 'Dallas');
    const noCoords = { id: 'n', name: 'The Bomb Factory', lat: null, lng: null };
    expect(agreesWithCluster(bomb, [factory, tourRow, noCoords])).toBe(true);
  });

  it('lets a token-less candidate join on location alone', () => {
    // The candidate side of the same rule: a tour-title row matched by coordinates
    // claims nothing the cluster could contradict, and stranding it would strand
    // its show.
    const tourRow = at('Brunette World Tour', 32.7841, -96.7846, 'Dallas');
    expect(agreesWithCluster(tourRow, [factory, bomb])).toBe(true);
  });
});

describe('show identity', () => {
  const base = { artistId: 'a1', venueId: 'v1', startsAt: '2026-08-06T03:00:00Z' };

  it('joins listings hours apart at one venue', () => {
    // Ticketmaster in UTC vs Bandsintown local-ish for the same San Francisco gig.
    expect(sameShow(base, { ...base, startsAt: '2026-08-05T23:30:00Z' })).toBe(true);
  });

  it('keeps a two-night run as two shows', () => {
    expect(sameShow(base, { ...base, startsAt: '2026-08-07T03:00:00Z' })).toBe(false);
  });

  it('needs the same artist and a known venue', () => {
    expect(sameShow(base, { ...base, artistId: 'a2' })).toBe(false);
    expect(sameShow({ ...base, venueId: null }, { ...base, venueId: null })).toBe(false);
  });

  it('lets a noon placeholder reach a real evening time on the same local day', () => {
    // A time_tbd listing is pinned to noon at the venue; the same show's 8pm
    // Ticketmaster row is 8 hours away — outside the clock window, inside the
    // same-local-day one. Without the flag, 8 hours stays two separate shows.
    const noon = { ...base, startsAt: '2026-08-05T19:00:00Z', timeUnknown: true }; // noon PDT
    const evening = { ...base, startsAt: '2026-08-06T03:00:00Z' }; // 8pm PDT
    expect(sameShow(noon, evening)).toBe(true);
    expect(sameShow({ ...noon, timeUnknown: false }, evening)).toBe(false);
  });

  it('keeps a placeholder off the previous night of a two-night run', () => {
    // Saturday's noon placeholder is 16h from Friday's 8pm — beyond the widened
    // window, so a two-night run cannot collapse through a TBD listing.
    const saturdayNoon = { ...base, startsAt: '2026-08-08T19:00:00Z', timeUnknown: true };
    const fridayEvening = { ...base, startsAt: '2026-08-08T03:00:00Z' };
    expect(sameShow(saturdayNoon, fridayEvening)).toBe(false);
    // The sharp edge: a real 11pm show the night before is 13h from noon —
    // a different calendar day, so it must stay outside the window too.
    const fridayLate = { ...base, startsAt: '2026-08-08T06:00:00Z' }; // 11pm PDT Friday
    expect(sameShow(saturdayNoon, fridayLate)).toBe(false);
    // While midnight on the day itself — 12h exactly — is still the same day.
    const saturdayMidnight = { ...base, startsAt: '2026-08-08T07:00:00Z' };
    expect(sameShow(saturdayNoon, saturdayMidnight)).toBe(true);
  });
});

describe('field ownership', () => {
  it('lets Ticketmaster own price and time, Bandsintown own the lineup', () => {
    expect(prefersSource('price_from', 'ticketmaster', 'bandsintown')).toBe(true);
    expect(prefersSource('price_from', 'bandsintown', 'ticketmaster')).toBe(false);
    expect(prefersSource('starts_at', 'bandsintown', 'ticketmaster')).toBe(false);
    expect(prefersSource('lineup', 'bandsintown', 'ticketmaster')).toBe(true);
  });

  it('lets a source correct itself', () => {
    expect(prefersSource('price_from', 'bandsintown', 'bandsintown')).toBe(true);
  });

  it('fills an empty field regardless of ownership', () => {
    expect(mergeField('price_from', 42, null, 'bandsintown', 'ticketmaster')).toBe(42);
    expect(mergeField('sold_out', null, true, 'ticketmaster', 'bandsintown')).toBe(true);
  });

  it('keeps the owner value in a contest', () => {
    expect(mergeField('price_from', 99, 42, 'bandsintown', 'ticketmaster')).toBe(42);
    expect(mergeField('sold_out', true, false, 'bandsintown', 'ticketmaster')).toBe(true);
  });

  it('lets SeatGeek correct a guessed time but not a face-value price', () => {
    // SeatGeek publishes true UTC, so it may overwrite Bandsintown's conversion.
    expect(prefersSource('starts_at', 'seatgeek', 'bandsintown')).toBe(true);
    // Its price is the cheapest *resale* listing, which is not the same claim as
    // Ticketmaster's minimum face value — so it fills a gap and nothing more.
    expect(prefersSource('price_from', 'seatgeek', 'ticketmaster')).toBe(false);
    expect(mergeField('price_from', 250, 42, 'seatgeek', 'ticketmaster')).toBe(42);
    expect(mergeField('price_from', 250, null, 'seatgeek', 'ticketmaster')).toBe(250);
    // Nor should a resale link displace the box office.
    expect(prefersSource('ticket_url', 'seatgeek', 'ticketmaster')).toBe(false);
    // Its titles carry booking noise ("Johnny Dynamite (21+)").
    expect(prefersSource('name', 'seatgeek', 'ticketmaster')).toBe(false);
  });

  it('never lets SeatGeek write an end time, since it templates them', () => {
    expect(prefersSource('ends_at', 'seatgeek', 'bandsintown')).toBe(false);
  });
});

describe('timezone guess', () => {
  it.each([
    [-122.4, -8], // San Francisco
    [-74, -5], // New York
    [0, 0], // London
    [13.4, 1], // Berlin
    [139.7, 9], // Tokyo
  ])('maps longitude %s to offset %s', (lng, expected) => {
    expect(guessUtcOffsetHours(lng)).toBe(expected);
  });

  it('falls back to UTC without a longitude', () => {
    expect(guessUtcOffsetHours(null)).toBe(0);
    expect(guessUtcOffsetHours(Number.NaN)).toBe(0);
  });
});

describe('parseSources', () => {
  it('survives anything the column might hold', () => {
    expect(parseSources(null)).toEqual({});
    expect(parseSources('not json')).toEqual({});
    expect(parseSources('[1,2]')).toEqual({});
    expect(parseSources('{"ticketmaster":"abc"}')).toEqual({ ticketmaster: 'abc' });
    // Values feed a `json_extract(...) = ?` lookup, so a non-string would be a
    // provenance entry that can never match anything.
    expect(parseSources('{"ticketmaster":123,"bandsintown":{"id":"x"},"seed":null,"ok":"y"}')).toEqual({
      ok: 'y',
    });
  });
});

describe('cluster representative', () => {
  it('is the same id whichever member asks, so no two-cycle can form', () => {
    // The production failure: two venues at one set of coordinates were resolved
    // in a single batch, each against a candidate row read before either write
    // landed. Following "the match's canonical" made A point at B and B at A, so
    // neither was canonical, the cluster never collapsed, and ENHYPEN showed up
    // twice in the San Francisco feed.
    const a = '0b1fad0b-oakland-arena';
    const b = '59105b6a-yoshis-oakland';
    expect(representative([a, b, b])).toBe(representative([b, a, a]));
    expect(representative([a, b, b])).toBe(a);
  });

  it('ignores the empty slots a fresh row has', () => {
    expect(representative(['zeta', null, undefined, 'alpha'])).toBe('alpha');
    expect(representative(['solo'])).toBe('solo');
  });

  it('will not let a tour title name a real room', () => {
    // Bandsintown files some shows under the tour, on the venue's own coordinates,
    // so the junk row joins the cluster. Every event is repointed at the head, so if
    // the head is "Final Frontier Tour" that is what the arena's page is called —
    // and ids are uuids, so the smallest one is a coin toss.
    const junk = '0a000000-final-frontier-tour';
    const real = 'ff000000-cfg-bank-arena';
    const nameOf = (id: string) => (id === junk ? 'Final Frontier Tour' : 'CFG Bank Arena');
    expect(representative([junk, real])).toBe(junk); // no names: unchanged behaviour
    expect(representative([junk, real], nameOf)).toBe(real);
    // Still order-independent, which is what stops a two-cycle forming.
    expect(representative([real, junk], nameOf)).toBe(real);
  });

  it('falls back to id order when every name is a tour title', () => {
    const nameOf = () => 'Some World Tour';
    expect(representative(['b', 'a', 'c'], nameOf)).toBe('a');
  });

  it('is stable once a cluster has settled', () => {
    // Re-running must not re-point anything, or every pass writes the whole table.
    const ids = ['b', 'c', 'a'];
    const first = representative(ids);
    expect(representative([...ids, first])).toBe(first);
  });
});

describe('isPlaceholderPoint', () => {
  it('accepts a complex that files its rooms at one point', () => {
    // Three names, one room: they agree with each other, so they are one group.
    expect(
      isPlaceholderPoint([
        'The Salt Shed Indoors (Shed)',
        'The Salt Shed Outdoors (Fairgrounds)',
        'Three Top Lounge at The Salt Shed',
      ]),
    ).toBe(false);
  });

  it("flags a town's fallback coordinate", () => {
    // Ticketmaster's real answer for San Francisco: unrelated rooms, one point.
    expect(
      isPlaceholderPoint(['Golden Gate Park', 'Rickshaw Stop', 'Davies Symphony Hall']),
    ).toBe(true);
  });

  it('ignores tour titles, which vouch for nothing either way', () => {
    expect(
      isPlaceholderPoint(['Brunette World Tour', 'The Forever Now Tour', 'Warped Tour Montreal']),
    ).toBe(false);
    expect(isPlaceholderPoint(['The Van Buren', 'BILMURI presents: The KINDA HARD Tour'])).toBe(
      false,
    );
  });

  it('merges every group a name touches, not just the first', () => {
    // "Fox Oakland" ties the first two together, leaving two groups, not three.
    expect(isPlaceholderPoint(['Fox Theater', 'Oakland Arena', 'Fox Oakland', 'Great American'])).toBe(
      false,
    );
  });

  it('needs three unrelated names, not two', () => {
    expect(isPlaceholderPoint(['Golden Gate Park', 'Rickshaw Stop'])).toBe(false);
  });
});

describe('representative', () => {
  const ids = ['aaa', 'bbb', 'ccc'];

  it('prefers a real name over a tour title, whatever the ids', () => {
    const names: Record<string, string> = {
      aaa: 'Brunette World Tour',
      bbb: 'The Warfield',
      ccc: 'Another Tour',
    };
    expect(representative(ids, (id) => names[id])).toBe('bbb');
  });

  it('prefers trustworthy coordinates when the names are equally good', () => {
    const names: Record<string, string> = { aaa: 'Golden Gate Park', bbb: 'Golden Gate Park' };
    expect(representative(['aaa', 'bbb'], (id) => names[id], (id) => id === 'aaa')).toBe('bbb');
  });

  it('still takes a real name on a placeholder point over a tour title', () => {
    const names: Record<string, string> = { aaa: 'The Warfield', bbb: 'Brunette World Tour' };
    expect(representative(['aaa', 'bbb'], (id) => names[id], (id) => id === 'aaa')).toBe('aaa');
  });

  it('is a total order: every member picks the same winner', () => {
    const names: Record<string, string> = { aaa: 'Some Tour', bbb: 'The Fillmore', ccc: 'The Fillmore' };
    const placeholder = (id: string) => id === 'bbb';
    const orders = [ids, [...ids].reverse(), ['bbb', 'aaa', 'ccc']];
    const winners = orders.map((o) => representative(o, (id) => names[id], placeholder));
    expect(new Set(winners).size).toBe(1);
    expect(winners[0]).toBe('ccc');
  });
});

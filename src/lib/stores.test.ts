import { describe, expect, it } from 'vitest';

import { isFollowedVenue, sameFollowedVenue, type FollowedVenue } from './followed-venues-store';
import { mergeStored } from './local-collection';
import { isFollowedArtist, sameArtist, type FollowedArtist } from './follows-store';
import { isSavedShow, sameSavedShow, type SavedShow } from './saved-shows-store';

/**
 * These guard the boundary between the device's stored JSON and the UI. A partial
 * write, a hand-edited localStorage entry or a list written by an older build all
 * arrive here as `unknown`, and anything that gets through renders.
 */

const artist: FollowedArtist = {
  artistId: 'a1',
  spotifyId: null,
  name: 'Interpol',
  imageUrl: null,
  genres: ['indie rock'],
  followedAt: 1,
};

const venue: FollowedVenue = {
  venueId: 'v1',
  name: 'The Warfield',
  city: 'San Francisco',
  region: 'CA',
  lat: 37.7827,
  lng: -122.41,
  followedAt: 1,
};

const show: SavedShow = {
  eventId: 'e1',
  name: 'Interpol',
  startsAt: '2026-08-12T03:00:00Z',
  artistId: 'a1',
  artistName: 'Interpol',
  artistImageUrl: null,
  venueId: 'v1',
  venueName: 'The Warfield',
  venueCity: 'San Francisco',
  venueTimezone: 'America/Los_Angeles',
  priceFrom: 42,
  savedAt: 1,
};

describe('followed artists', () => {
  it('accepts a well-formed entry', () => {
    expect(isFollowedArtist(artist)).toBe(true);
    expect(isFollowedArtist({ ...artist, artistId: null, spotifyId: 'sp1' })).toBe(true);
  });

  it('rejects an entry with no identity to match events against', () => {
    expect(isFollowedArtist({ ...artist, artistId: null, spotifyId: null })).toBe(false);
  });

  it('rejects the shapes a bad write actually produces', () => {
    expect(isFollowedArtist(null)).toBe(false);
    expect(isFollowedArtist('Interpol')).toBe(false);
    expect(isFollowedArtist({ ...artist, name: undefined })).toBe(false);
    expect(isFollowedArtist({ ...artist, genres: 'indie rock' })).toBe(false);
    expect(isFollowedArtist({ ...artist, genres: [1, 2] })).toBe(false);
    expect(isFollowedArtist({ ...artist, followedAt: '1' })).toBe(false);
  });

  it('matches on either identity, and never on a missing one', () => {
    expect(sameArtist(artist, { artistId: 'a1' })).toBe(true);
    expect(sameArtist(artist, { artistId: 'a2' })).toBe(false);
    // A null id on both sides must not read as a match, or one unidentified
    // follow would swallow every other.
    expect(sameArtist(artist, { spotifyId: null })).toBe(false);
    expect(sameArtist({ ...artist, artistId: null, spotifyId: 'sp1' }, { spotifyId: 'sp1' })).toBe(true);
  });
});

describe('followed venues', () => {
  it('accepts a well-formed entry, coordinates optional', () => {
    expect(isFollowedVenue(venue)).toBe(true);
    expect(isFollowedVenue({ ...venue, lat: null, lng: null, city: null, region: null })).toBe(true);
  });

  it('requires a venue id, since that is the only identity there is', () => {
    expect(isFollowedVenue({ ...venue, venueId: '' })).toBe(false);
    expect(isFollowedVenue({ ...venue, venueId: null })).toBe(false);
    expect(isFollowedVenue({ ...venue, lat: '37.78' })).toBe(false);
  });

  it('matches by id and ignores an empty ref', () => {
    expect(sameFollowedVenue(venue, { venueId: 'v1' })).toBe(true);
    expect(sameFollowedVenue(venue, { venueId: 'v2' })).toBe(false);
    expect(sameFollowedVenue(venue, {})).toBe(false);
  });
});

describe('saved shows', () => {
  it('accepts a well-formed entry', () => {
    expect(isSavedShow(show)).toBe(true);
    expect(isSavedShow({ ...show, priceFrom: null, artistId: null, venueTimezone: null })).toBe(true);
  });

  it('rejects an entry that could not be rendered or reconciled', () => {
    expect(isSavedShow({ ...show, eventId: '' })).toBe(false);
    expect(isSavedShow({ ...show, startsAt: undefined })).toBe(false);
    expect(isSavedShow({ ...show, priceFrom: '42' })).toBe(false);
    expect(isSavedShow({ ...show, savedAt: null })).toBe(false);
  });

  it('matches by event id', () => {
    expect(sameSavedShow(show, { eventId: 'e1' })).toBe(true);
    expect(sameSavedShow(show, { eventId: 'e2' })).toBe(false);
    expect(sameSavedShow(show, {})).toBe(false);
  });
});

describe('merging a stored list into memory', () => {
  const merge = (current: FollowedVenue[], stored: unknown[], dropped: { venueId?: string | null }[] = []) =>
    mergeStored(current, stored, dropped, isFollowedVenue, sameFollowedVenue);

  const other: FollowedVenue = { ...venue, venueId: 'v2', name: 'The Fillmore' };

  it('keeps what is already in memory ahead of what was on disk', () => {
    expect(merge([other], [venue]).map((v) => v.venueId)).toEqual(['v2', 'v1']);
  });

  it('skips entries the user removed before the read landed', () => {
    // The window between mount and the disk read is real: a follow toggled off in
    // it would otherwise come straight back.
    expect(merge([], [venue, other], [{ venueId: 'v1' }]).map((v) => v.venueId)).toEqual(['v2']);
  });

  it('does not duplicate an entry present in both, or twice on disk', () => {
    expect(merge([venue], [{ ...venue, name: 'stale name' }])).toEqual([venue]);
    expect(merge([], [venue, { ...venue, name: 'stale name' }])).toEqual([venue]);
  });

  it('drops malformed entries and keeps the rest of the list', () => {
    expect(merge([], [null, 'nope', { venueId: 'v3' }, venue])).toEqual([venue]);
  });
});

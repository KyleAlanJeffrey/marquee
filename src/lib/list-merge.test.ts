import { describe, expect, it } from 'vitest';

import { mergeLists } from './list-merge';

/**
 * Folding a device's list together with the account's copy.
 *
 * Tested on its own because this runs exactly once per device — on the sign-in that
 * migrates a month of local use into a new account — and a bug in it is a bug
 * nobody gets a second chance to notice.
 */

type Entry = { id: string; at: number; note?: string };

const same = (a: Entry, b: Entry) => a.id === b.id;
const stamp = (e: Entry) => e.at;
const merge = (local: Entry[], remote: Entry[]) => mergeLists(local, remote, same, stamp);

describe('mergeLists', () => {
  it('keeps everything from both sides', () => {
    const out = merge(
      [{ id: 'a', at: 1 }],
      [{ id: 'b', at: 2 }],
    );
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('takes the newer of an entry that is in both', () => {
    const out = merge(
      [{ id: 'a', at: 10, note: 'device' }],
      [{ id: 'a', at: 20, note: 'account' }],
    );
    expect(out).toEqual([{ id: 'a', at: 20, note: 'account' }]);
  });

  it('keeps the local one when it is newer', () => {
    const out = merge(
      [{ id: 'a', at: 30, note: 'device' }],
      [{ id: 'a', at: 20, note: 'account' }],
    );
    expect(out).toEqual([{ id: 'a', at: 30, note: 'device' }]);
  });

  it('keeps the local one on an exact tie', () => {
    // Only strictly-newer wins. A tie means the two are the same entry stamped once
    // and copied, and preferring the remote there would churn the list on every
    // sign-in for no change in content.
    const out = merge(
      [{ id: 'a', at: 5, note: 'device' }],
      [{ id: 'a', at: 5, note: 'account' }],
    );
    expect(out).toEqual([{ id: 'a', at: 5, note: 'device' }]);
  });

  it('leaves the local order alone and appends what only the account had', () => {
    // The user has been looking at this list. Sorting it by timestamp here would
    // reshuffle something they already know the shape of, for no benefit.
    const out = merge(
      [
        { id: 'c', at: 1 },
        { id: 'a', at: 9 },
      ],
      [
        { id: 'z', at: 5 },
        { id: 'a', at: 2 },
      ],
    );
    expect(out.map((e) => e.id)).toEqual(['c', 'a', 'z']);
  });

  it('handles either side being empty', () => {
    expect(merge([], [{ id: 'a', at: 1 }])).toEqual([{ id: 'a', at: 1 }]);
    expect(merge([{ id: 'a', at: 1 }], [])).toEqual([{ id: 'a', at: 1 }]);
    expect(merge([], [])).toEqual([]);
  });

  it('collapses a duplicate that was already inside one side', () => {
    // Neither side should contain one, but if a bad write produced one, merging is
    // where it gets fixed rather than doubled.
    const out = merge(
      [
        { id: 'a', at: 1 },
        { id: 'a', at: 2 },
      ],
      [],
    );
    expect(out).toEqual([{ id: 'a', at: 1 }]);
  });

  it('does not mutate either input', () => {
    const local = [{ id: 'a', at: 1 }];
    const remote = [{ id: 'b', at: 2 }];
    mergeLists(local, remote, same, stamp);
    expect(local).toEqual([{ id: 'a', at: 1 }]);
    expect(remote).toEqual([{ id: 'b', at: 2 }]);
  });

  it('cannot express a deletion, which is why it only runs once', () => {
    // Documenting the limitation as a test so it can't be mistaken for a bug later.
    // The device deleted 'a'; the account still has it; the union brings it back.
    // That is why `list-sync.tsx` merges on the first sign-in only and pushes whole
    // lists afterwards, where a removal stays removed.
    const out = merge([], [{ id: 'a', at: 1 }]);
    expect(out.map((e) => e.id)).toEqual(['a']);
  });
});

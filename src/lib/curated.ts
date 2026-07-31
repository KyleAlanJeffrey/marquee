import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';

/**
 * Curated lists, client side — phase E. Named `curated` because `lists-store`
 * territory is taken by the private follows/saved/log storage; these are the
 * public shelves.
 */

export type ListSummary = {
  id: string;
  title: string;
  description: string | null;
  visibility: 'public' | 'private';
  updatedAt: string;
  itemCount: number;
};

export type ListItem = {
  refKind: 'artist' | 'venue' | 'event';
  refId: string;
  note: string | null;
  name: string;
  imageUrl: string | null;
  /** City for venues, start date for events, null for artists. */
  detail: string | null;
};

export type ListDetail = {
  list: { id: string; title: string; description: string | null; visibility: string; ownerId: string; updatedAt: string };
  items: ListItem[];
  isOwner: boolean;
};

const listKey = (id: string) => ['curated-list', id] as const;
const shelfKey = (ownerKey: string) => ['curated-shelf', ownerKey] as const;

export function usePersonLists(ownerKey: string, enabled = true) {
  return useQuery({
    queryKey: shelfKey(ownerKey),
    enabled: !!ownerKey && enabled,
    queryFn: (): Promise<{ lists: ListSummary[] }> =>
      apiGet(`/users/${encodeURIComponent(ownerKey)}/lists`),
  });
}

export function useList(id: string) {
  return useQuery({
    queryKey: listKey(id),
    enabled: !!id,
    queryFn: (): Promise<ListDetail> => apiGet(`/curated-lists/${encodeURIComponent(id)}`),
  });
}

/** Everything a list mutation could have made stale, cheaply. */
function invalidateShelves(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['curated-shelf'] });
  queryClient.invalidateQueries({ queryKey: ['curated-list'] });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description?: string | null; visibility?: 'public' | 'private' }) =>
      apiPost<{ ok: boolean; id: string }>('/curated-lists', body),
    onSettled: () => invalidateShelves(queryClient),
  });
}

export function useUpdateList(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { title?: string; description?: string | null; visibility?: 'public' | 'private' }) =>
      apiPut(`/curated-lists/${encodeURIComponent(id)}`, patch),
    onSettled: () => invalidateShelves(queryClient),
  });
}

export function useDeleteList(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiDelete(`/curated-lists/${encodeURIComponent(id)}`),
    onSettled: () => invalidateShelves(queryClient),
  });
}

export function useAddToList() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ listId, refKind, refId }: { listId: string; refKind: ListItem['refKind']; refId: string }) =>
      apiPost(`/curated-lists/${encodeURIComponent(listId)}/items`, { refKind, refId }),
    onSettled: () => invalidateShelves(queryClient),
  });
}

export function useRemoveFromList(listId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ refKind, refId }: { refKind: string; refId: string }) =>
      apiDelete(`/curated-lists/${encodeURIComponent(listId)}/items/${refKind}/${encodeURIComponent(refId)}`),
    onSettled: () => invalidateShelves(queryClient),
  });
}

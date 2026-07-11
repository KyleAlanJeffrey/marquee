import { EmptyState } from '@/components/empty-state';

type Props = {
  /** Optional retry handler (e.g. a query's refetch). */
  onRetry?: () => void;
  message?: string;
};

/**
 * Shown when a data query fails (offline, backend unreachable) so a network
 * hiccup doesn't masquerade as an empty "no results" state.
 */
export function ErrorState({ onRetry, message }: Props) {
  return (
    <EmptyState
      icon="cloud-offline-outline"
      title="Something went wrong"
      message={message ?? "We couldn't load this right now. Check your connection and try again."}
      actionLabel={onRetry ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}

import { trpc } from '@/lib/trpc';

export function useDailyAlmanac(date: string | null | undefined) {
  return trpc.almanac.today.useQuery(
    { date: date ?? '' },
    {
      enabled: Boolean(date),
      staleTime: 6 * 60 * 60 * 1000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  );
}

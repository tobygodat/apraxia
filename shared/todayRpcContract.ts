/** Wire contract for the generated-type Supabase adapter; never an ownership input. */
export const TODAY_PAGE_SIZE = 200;
export const TODAY_RANK_STEP = 1024;
export const TODAY_SNAPSHOT_RESTARTS = 2;

export interface TodayPageRequest {
  readonly p_local_date: string;
  readonly p_offset: number;
  readonly p_limit: number;
  readonly p_snapshot_token: string | null;
}

export interface TodayPageEnvelope {
  readonly local_date: string;
  readonly offset: number;
  readonly total_count: number;
  readonly snapshot_token: string;
  readonly items: readonly unknown[];
}

import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../supabase/supabase.service";

export interface CursorRecord {
  id: string;
  paging_token: string;
  ledger_sequence: number | null;
  updated_at: string;
}

/**
 * Prefix used for contract event stream cursors. Ingestion and backfill both
 * persist cursors as `contract:<contractId>`.
 */
export const CONTRACT_CURSOR_PREFIX = "contract:";

/**
 * Manages ingestion cursors (last processed Horizon paging token) in Supabase.
 * Uses an UPSERT so a missing cursor row is created on first write.
 */
@Injectable()
export class CursorRepository {
  private readonly logger = new Logger(CursorRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Return the stored paging token for a stream, or null if none exists yet.
   */
  async getCursor(streamId: string): Promise<string | null> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from("cursors")
      .select("paging_token")
      .eq("id", streamId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to read cursor for ${streamId}: ${error.message}`,
      );
      throw error;
    }

    return data?.paging_token ?? null;
  }

  /**
   * Return the most recently updated contract cursor (full record), or null if
   * no contract stream has been ingested yet.
   *
   * Health checks need the cursor's `updated_at` timestamp and last processed
   * ledger, which `getCursor` does not expose. The id is matched by prefix
   * because the concrete contract id is not known ahead of time; a previous
   * implementation passed the literal string "contract:*" to `getCursor`,
   * which performs an exact match and therefore never resolved a real row.
   */
  async getLatestContractCursor(): Promise<CursorRecord | null> {
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from("cursors")
      .select("id, paging_token, ledger_sequence, updated_at")
      // PostgREST's `like` uses `*` (not SQL's `%`) as the wildcard.
      .like("id", `${CONTRACT_CURSOR_PREFIX}*`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `Failed to read latest contract cursor: ${error.message}`,
      );
      throw error;
    }

    return (data as CursorRecord | null) ?? null;
  }

  /**
   * Persist the latest paging token for a stream (upsert).
   */
  async saveCursor(
    streamId: string,
    pagingToken: string,
    ledgerSequence?: number,
  ): Promise<void> {
    const client = this.supabase.getClient();
    const { error } = await client.from("cursors").upsert(
      {
        id: streamId,
        paging_token: pagingToken,
        ledger_sequence: ledgerSequence ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );

    if (error) {
      this.logger.error(
        `Failed to save cursor for ${streamId}: ${error.message}`,
      );
      throw error;
    }

    this.logger.debug(`Cursor saved: ${streamId} → ${pagingToken}`);
  }
}

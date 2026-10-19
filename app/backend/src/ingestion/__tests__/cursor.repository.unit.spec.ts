import { CursorRepository } from "../cursor.repository";
import { SupabaseService } from "../../supabase/supabase.service";

function makeSupabaseMock(getData: unknown, error: unknown = null) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: getData, error });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });

  const upsertResult = jest.fn().mockResolvedValue({ error: null });

  const from = jest.fn().mockImplementation((table: string) => {
    if (table === "cursors") {
      return { select, upsert: upsertResult };
    }
    return {};
  });

  return {
    getClient: () => ({ from }),
    _upsertResult: upsertResult,
    _eq: eq,
  };
}

/**
 * Mock for the getLatestContractCursor query chain:
 * select -> like -> order -> limit -> maybeSingle
 */
function makeSupabaseLatestCursorMock(
  getData: unknown,
  error: unknown = null,
) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: getData, error });
  const limit = jest.fn().mockReturnValue({ maybeSingle });
  const order = jest.fn().mockReturnValue({ limit });
  const like = jest.fn().mockReturnValue({ order });
  const select = jest.fn().mockReturnValue({ like });

  const from = jest.fn().mockReturnValue({ select });

  return {
    getClient: () => ({ from }),
    _select: select,
    _like: like,
    _order: order,
    _limit: limit,
  };
}

describe("CursorRepository", () => {
  it("returns null when no cursor row exists", async () => {
    const supabase = makeSupabaseMock(null) as unknown as SupabaseService;
    const repo = new CursorRepository(supabase);

    const result = await repo.getCursor("contract:CTEST");
    expect(result).toBeNull();
  });

  it("returns the stored paging_token", async () => {
    const supabase = makeSupabaseMock({
      paging_token: "99-5",
    }) as unknown as SupabaseService;
    const repo = new CursorRepository(supabase);

    const result = await repo.getCursor("contract:CTEST");
    expect(result).toBe("99-5");
  });

  it("upserts the cursor on save", async () => {
    const mock = makeSupabaseMock(null);
    const repo = new CursorRepository(mock as unknown as SupabaseService);

    await repo.saveCursor("contract:CTEST", "101-2", 101);

    expect(mock._upsertResult).toHaveBeenCalled();
  });

  it("throws when Supabase returns an error on getCursor", async () => {
    const supabase = makeSupabaseMock(null, {
      message: "DB error",
    }) as unknown as SupabaseService;
    const repo = new CursorRepository(supabase);

    await expect(repo.getCursor("contract:CTEST")).rejects.toMatchObject({
      message: "DB error",
    });
  });

  it("matches getCursor by exact stream id", async () => {
    const mock = makeSupabaseMock({ paging_token: "99-5" });
    const repo = new CursorRepository(mock as unknown as SupabaseService);

    await repo.getCursor("contract:CTEST");

    expect(mock._eq).toHaveBeenCalledWith("id", "contract:CTEST");
  });
});

describe("CursorRepository.getLatestContractCursor", () => {
  const record = {
    id: "contract:CTEST",
    paging_token: "12345-3",
    ledger_sequence: 12345,
    updated_at: "2026-01-01T00:00:00.000Z",
  };

  it("returns the full cursor record including updated_at", async () => {
    const supabase = makeSupabaseLatestCursorMock(
      record,
    ) as unknown as SupabaseService;
    const repo = new CursorRepository(supabase);

    const result = await repo.getLatestContractCursor();

    expect(result).toEqual(record);
  });

  it("selects the columns required to compute lag", async () => {
    const mock = makeSupabaseLatestCursorMock(record);
    const repo = new CursorRepository(mock as unknown as SupabaseService);

    await repo.getLatestContractCursor();

    expect(mock._select).toHaveBeenCalledWith(
      "id, paging_token, ledger_sequence, updated_at",
    );
  });

  it("matches the contract prefix using the PostgREST wildcard", async () => {
    // Regression guard: PostgREST's `like` uses `*`, not SQL's `%`. Using `%`
    // here would silently match nothing and reintroduce the "no cursor" bug.
    const mock = makeSupabaseLatestCursorMock(record);
    const repo = new CursorRepository(mock as unknown as SupabaseService);

    await repo.getLatestContractCursor();

    expect(mock._like).toHaveBeenCalledWith("id", "contract:*");
  });

  it("orders by newest update first and returns a single row", async () => {
    const mock = makeSupabaseLatestCursorMock(record);
    const repo = new CursorRepository(mock as unknown as SupabaseService);

    await repo.getLatestContractCursor();

    expect(mock._order).toHaveBeenCalledWith("updated_at", {
      ascending: false,
    });
    expect(mock._limit).toHaveBeenCalledWith(1);
  });

  it("returns null when no contract cursor exists", async () => {
    const supabase = makeSupabaseLatestCursorMock(
      null,
    ) as unknown as SupabaseService;
    const repo = new CursorRepository(supabase);

    const result = await repo.getLatestContractCursor();

    expect(result).toBeNull();
  });

  it("throws when Supabase returns an error", async () => {
    const supabase = makeSupabaseLatestCursorMock(null, {
      message: "DB error",
    }) as unknown as SupabaseService;
    const repo = new CursorRepository(supabase);

    await expect(repo.getLatestContractCursor()).rejects.toMatchObject({
      message: "DB error",
    });
  });
});

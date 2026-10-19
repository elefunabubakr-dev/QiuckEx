import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchEscrowDetail,
  isEscrowNotFoundError,
  type EscrowDetail,
} from "../services/escrow";

export type EscrowDetailState =
  | { status: "loading" }
  | { status: "error"; error: string; notFound: boolean }
  | { status: "success"; detail: EscrowDetail };

/** Load one escrow summary, with the same loading/error/success contract as marketplace detail. */
export function useEscrowDetail(escrowId: string | undefined) {
  const [state, setState] = useState<EscrowDetailState>({ status: "loading" });
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestVersion.current;
    const id = escrowId?.trim();

    if (!id) {
      setState({
        status: "error",
        error: "An escrow ID is required.",
        notFound: true,
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const detail = await fetchEscrowDetail(id);
      if (request === requestVersion.current) {
        setState({ status: "success", detail });
      }
    } catch (err) {
      if (request !== requestVersion.current) return;

      const message = err instanceof Error ? err.message : "Failed to load escrow.";
      setState({
        status: "error",
        error: message,
        notFound: isEscrowNotFoundError(err),
      });
    }
  }, [escrowId]);

  useEffect(() => {
    void load();
    return () => {
      // Ignore a slow response from an earlier ID or an unmounted screen.
      requestVersion.current += 1;
    };
  }, [load]);

  return { state, refresh: load };
}

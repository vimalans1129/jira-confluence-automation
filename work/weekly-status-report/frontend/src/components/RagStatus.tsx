import type { RagResult } from "@contract";
import { RagBadge } from "./RagBadge";

// Shows the effective status and, for an override, its reason and the calculated status (FR-022).
export function RagStatus({ rag }: { rag: RagResult }) {
  return (
    <>
      <RagBadge rag={rag.effective} />
      {rag.overridden && (
        <span className="override-note">
          {" "}
          Overridden (calculated {rag.calculated}): {rag.overrideReason}
        </span>
      )}
    </>
  );
}

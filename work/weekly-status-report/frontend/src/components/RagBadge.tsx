import type { Rag } from "@contract";

const ICON: Record<Rag, string> = { Green: "\u25cf", Amber: "\u25b2", Red: "\u25a0" };

// Colour is never the only signal: the level is always written out and has its own shape.
export function RagBadge({ rag }: { rag: Rag }) {
  return (
    <span className={`rag rag-${rag.toLowerCase()}`}>
      <span aria-hidden="true">{ICON[rag]} </span>
      {rag}
    </span>
  );
}

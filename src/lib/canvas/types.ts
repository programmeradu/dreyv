/**
 * Canvas — the Living Dashboard primitive.
 *
 * A `CanvasBlock` is the unit the dashboard renders. Anything the user does
 * (asks the CommandBar a question, an agent finds something, the user opens
 * a capability from the palette) becomes a block. Blocks stack vertically,
 * can be reordered, pinned, or dismissed. Pinned blocks survive reload;
 * ephemeral ones do not.
 *
 * Block payloads are intentionally loose Records — every block type has its
 * own renderer that knows what it expects. Tightening this would force a
 * schema migration every time we add a capability.
 */

export type CanvasBlockSource = "commandbar" | "agent" | "user" | "page" | "capability";
export type CanvasBlockType =
  | "narrative"
  | "metric"
  | "chart"
  | "plan"
  | "watcher"
  | "decision"
  | "capability-result"
  | "suggestion"
  | "artifact"
  | "research-brief"
  | "tokens-table"
  | "wallets-roster"
  | "runway"
  | "mass-send"
  | "policy-approvals"
  | "recurring-payouts"
  | "gas-tank"
  | "invoice-inbox"
  | "yield-routing"
  | "reports-share"
  | "wallet-security"
  | "empty-bucket";

export interface CanvasBlockBase<T extends CanvasBlockType = CanvasBlockType> {
  id: string;
  type: T;
  source: CanvasBlockSource;
  /** Originating route (e.g. /app/treasury) so provenance is traceable. */
  origin?: string;
  /** Human title shown in BlockShell. */
  title: string;
  /** Optional 1-line subtitle. */
  subtitle?: string;
  createdAt: number;
  pinned: boolean;
  /** Renderer-specific payload. */
  payload: Record<string, unknown>;
}

export type CanvasBlock = CanvasBlockBase;

export interface CanvasState {
  blocks: CanvasBlock[];
}

export interface CanvasActions {
  addBlock: (
    block: Omit<CanvasBlock, "id" | "createdAt" | "pinned"> & {
      id?: string;
      pinned?: boolean;
    },
  ) => string;
  updateBlock: (
    id: string,
    patch:
      | Partial<Omit<CanvasBlock, "id" | "createdAt" | "payload">> & {
          payload?: Record<string, unknown>;
        },
  ) => void;
  removeBlock: (id: string) => void;
  pinBlock: (id: string, pinned?: boolean) => void;
  reorderBlocks: (ids: string[]) => void;
  clearEphemeral: () => void;
}

export type CanvasContextValue = CanvasState & CanvasActions;

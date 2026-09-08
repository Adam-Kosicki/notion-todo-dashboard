// Phase 1 (docs/plans/burner-board-roadmap.md, section 7): runtime schemas, command/query
// types, limits, and error codes shared by the browser API and (from phase 4) MCP. This file
// has no D1/Notion access of its own - see lib/server/repository.ts and commands.ts.
import { z } from "zod";

export const API_VERSION = 1 as const;

export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "CONFLICT",
  "SCOPE_EXPIRED",
  "LIMIT_EXCEEDED",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  SCOPE_EXPIRED: 403,
  LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
};

/** Thrown by the command layer. Callers map this to the API's {ok:false, error} shape. */
export class CommandError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }
}

export type StorageMode = "legacy_notion" | "d1_primary";
export type ReviewState = "needs_review" | "reviewed";
export type ActorKind = "owner" | "ai" | "system";

// --- Command envelope (section 7: POST /api/board's versioned envelope) ---

export const CommandEnvelopeSchema = z.object({
  apiVersion: z.literal(API_VERSION),
  requestId: z.string().min(1).max(200),
  expectedBoardRevision: z.number().int().nonnegative().optional(),
  action: z.string().min(1),
  payload: z.unknown(),
});
export type CommandEnvelope = z.infer<typeof CommandEnvelopeSchema>;

export type CommandSuccess<T = unknown> = {
  ok: true;
  requestId: string;
  boardRevision: number;
  result: T;
  changedItemIds: string[];
  changedListIds: string[];
};
export type CommandFailure = {
  ok: false;
  error: { code: ErrorCode; message: string; details?: unknown };
};
export type CommandResult<T = unknown> = CommandSuccess<T> | CommandFailure;

// --- Per-command payload schemas (Phase 1 subset only - items/lists lifecycle) ---

const idSchema = z.string().min(1).max(200);
const versionSchema = z.number().int().nonnegative();

export const ItemsCreateSchema = z.object({
  title: z.string().min(1).max(2000),
  listId: idSchema.nullable().optional(),
});
export type ItemsCreateInput = z.infer<typeof ItemsCreateSchema>;

// Deliberately narrow allowlist - matches the roadmap's "reject unknown command fields" and
// keeps this command from becoming a second, uncontrolled edit surface next to board-store.ts.
export const ItemsUpdateSchema = z.object({
  id: idSchema,
  expectedVersion: versionSchema,
  changes: z
    .object({
      title: z.string().min(1).max(2000).optional(),
      priority: z.number().int().min(0).max(10).nullable().optional(),
      reviewState: z.enum(["needs_review", "reviewed"]).optional(),
    })
    .strict(),
});
export type ItemsUpdateInput = z.infer<typeof ItemsUpdateSchema>;

export const ItemsCompleteSchema = z.object({ id: idSchema, expectedVersion: versionSchema });
export const ItemsReopenSchema = z.object({ id: idSchema, expectedVersion: versionSchema });
export type ItemsCompleteInput = z.infer<typeof ItemsCompleteSchema>;
export type ItemsReopenInput = z.infer<typeof ItemsReopenSchema>;

export const ItemsMoveSchema = z.object({
  id: idSchema,
  expectedVersion: versionSchema,
  listId: idSchema.nullable(),
});
export type ItemsMoveInput = z.infer<typeof ItemsMoveSchema>;

export const ItemsReviewSchema = z.object({
  id: idSchema,
  expectedVersion: versionSchema,
  reviewState: z.enum(["needs_review", "reviewed"]),
});
export type ItemsReviewInput = z.infer<typeof ItemsReviewSchema>;

export const ItemsDeleteSchema = z.object({ id: idSchema, expectedVersion: versionSchema });
export const ItemsRestoreSchema = z.object({ id: idSchema, expectedVersion: versionSchema });
export type ItemsDeleteInput = z.infer<typeof ItemsDeleteSchema>;
export type ItemsRestoreInput = z.infer<typeof ItemsRestoreSchema>;

export const ListsCreateSchema = z.object({ name: z.string().min(1).max(200) });
export const ListsUpdateSchema = z.object({
  id: idSchema,
  changes: z.object({ name: z.string().min(1).max(200).optional() }).strict(),
});
export const ListsDeleteSchema = z.object({ id: idSchema });
export type ListsCreateInput = z.infer<typeof ListsCreateSchema>;
export type ListsUpdateInput = z.infer<typeof ListsUpdateSchema>;
export type ListsDeleteInput = z.infer<typeof ListsDeleteSchema>;

// --- Phase 3: Focus and weekly commitments ---
// Toggle semantics (one item at a time) rather than a batch "replace the whole focus set" -
// this matches focus_items' per-item review_until column (each focus item can carry its own
// optional date) and maps directly onto a UI checkbox. A routine implementation choice, not
// an escalated one - the roadmap's command table only says "explicit selected IDs."
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const FocusSetSchema = z.object({
  itemId: idSchema,
  focused: z.boolean(),
  reviewUntil: dateOnlySchema.nullable().optional(),
});
export type FocusSetInput = z.infer<typeof FocusSetSchema>;

export const WeekCommitSchema = z.object({ weekId: idSchema, itemId: idSchema });
export type WeekCommitInput = z.infer<typeof WeekCommitSchema>;

export const WeekWithdrawSchema = z.object({
  weekId: idSchema,
  itemId: idSchema,
  reason: z.string().max(500).nullable().optional(),
});
export type WeekWithdrawInput = z.infer<typeof WeekWithdrawSchema>;

export const WeekCloseSchema = z.object({ weekId: idSchema });
export type WeekCloseInput = z.infer<typeof WeekCloseSchema>;

// --- Phase 3 extension: generic Today/Month/Year periods (see db/schema.ts's planningPeriods
// comment and docs/adr/local/time-horizon-quick-actions.md) - same commit/withdraw shape as
// week.commit/week.withdraw, plus periodType so the handler knows which boundary helper to use
// when the periodId needs to be resolved/created. No period.close yet (v1 periods never close).
export const PeriodTypeSchema = z.enum(["day", "month", "year"]);

export const PeriodCommitSchema = z.object({ periodType: PeriodTypeSchema, periodId: idSchema, itemId: idSchema });
export type PeriodCommitInput = z.infer<typeof PeriodCommitSchema>;

export const PeriodWithdrawSchema = z.object({
  periodType: PeriodTypeSchema,
  periodId: idSchema,
  itemId: idSchema,
  reason: z.string().max(500).nullable().optional(),
});
export type PeriodWithdrawInput = z.infer<typeof PeriodWithdrawSchema>;

export const COMMAND_SCHEMAS = {
  "items.create": ItemsCreateSchema,
  "items.update": ItemsUpdateSchema,
  "items.complete": ItemsCompleteSchema,
  "items.reopen": ItemsReopenSchema,
  "items.move": ItemsMoveSchema,
  "items.review": ItemsReviewSchema,
  "items.delete": ItemsDeleteSchema,
  "items.restore": ItemsRestoreSchema,
  "lists.create": ListsCreateSchema,
  "lists.update": ListsUpdateSchema,
  "lists.delete": ListsDeleteSchema,
  "focus.set": FocusSetSchema,
  "week.commit": WeekCommitSchema,
  "week.withdraw": WeekWithdrawSchema,
  "week.close": WeekCloseSchema,
  "period.commit": PeriodCommitSchema,
  "period.withdraw": PeriodWithdrawSchema,
} as const;
export type CommandAction = keyof typeof COMMAND_SCHEMAS;

export function isKnownCommand(action: string): action is CommandAction {
  return Object.prototype.hasOwnProperty.call(COMMAND_SCHEMAS, action);
}

// --- Limits (tunable engineering defaults, not subscription-quota estimates - section 7) ---
export const LIMITS = {
  maxCleanupScopeItems: 50,
  maxProposalOperations: 25,
  maxQueryPageSize: 100,
  maxProposalBodyBytes: 64 * 1024,
} as const;

// Errors whose message is safe and useful to show to the user. Anything else is reported generically.
export class UserError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code = "invalid_request", status = 400) {
    super(message);
    this.name = "UserError";
    this.code = code;
    this.status = status;
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

export function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new CancelledError();
}

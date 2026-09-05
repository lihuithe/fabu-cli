export class AppError extends Error {
  constructor(code, message, { status = 400, retryable = false, nextAction = null, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.next_action = nextAction;
    this.details = details;
  }
}

export function errorBody(error) {
  const code = error.code || (error.status === 404 ? 'NOT_FOUND' : 'INTERNAL_ERROR');
  return {
    schema_version: 1, success: false, detail: error.message,
    error: { code, message: error.message, retryable: Boolean(error.retryable), next_action: error.next_action ?? null, ...(error.details ? { details: error.details } : {}) }
  };
}

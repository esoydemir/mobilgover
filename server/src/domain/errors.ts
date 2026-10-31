/** Errors with a stable machine code and a Turkish message for the user. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} bulunamadı.`);
// Unauthorized access to another tenant's record looks the same as "not found", so ids cannot be probed.
export const forbiddenAsNotFound = (what: string) => notFound(what);
export const forbidden = (message = 'Bu işlem için yetkin yok.') => new AppError(403, 'FORBIDDEN', message);
export const invalid = (message: string, details?: unknown) => new AppError(422, 'INVALID', message, details);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, details);

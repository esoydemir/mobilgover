/** The server answered with an error. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: any) {
    super(message);
  }
}

/** The request never reached the server, or its answer was lost (offline, DNS, timeout). Safe to retry. */
export class NetworkError extends Error {}

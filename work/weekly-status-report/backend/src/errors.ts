export interface ErrorDetail {
  path: string;
  message: string;
}

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    correlationId: string;
    details?: ErrorDetail[];
  };
}

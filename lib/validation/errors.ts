export class ValidationError extends Error {
  name = "ValidationError";

  constructor(
    message: string,
    public status = 400,
    public code?: string,
  ) {
    super(message);
  }
}

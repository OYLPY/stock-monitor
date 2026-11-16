export function logInternalApiError(
  requestId: string,
  code: string = "INTERNAL_ERROR",
): void {
  console.error(JSON.stringify({ requestId, code }));
}

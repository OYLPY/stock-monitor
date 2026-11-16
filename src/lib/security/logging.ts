export function logInternalApiError(requestId: string): void {
  console.error(JSON.stringify({ requestId, code: "INTERNAL_ERROR" }));
}

function normalizeTrpcUrl(): string {
  const explicitTrpcUrl = process.env.NEXT_PUBLIC_API_TRPC_URL;
  if (explicitTrpcUrl) return explicitTrpcUrl;

  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (apiUrl) return `${apiUrl.replace(/\/+$/, "")}/trpc`;

  return "http://localhost:4000/trpc";
}

export const env = {
  trpcUrl: normalizeTrpcUrl(),
  realtimeUrl:
    process.env.NEXT_PUBLIC_REALTIME_URL ??
    "http://localhost:4001",
  useMocks:
    process.env.NODE_ENV !== "production" &&
    process.env.NEXT_PUBLIC_USE_MOCKS === "true",
  allowMockFallback: process.env.NODE_ENV !== "production",
};

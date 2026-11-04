/**
 * Mock data is only ever served by `next dev` with NEXT_PUBLIC_DEV_MOCKS=1.
 * Both values are inlined at build time, so production bundles fold this to `false`
 * and drop the mock module entirely.
 */
export const DEV_MOCKS =
  process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DEV_MOCKS === "1";

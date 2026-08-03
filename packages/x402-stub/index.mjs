/**
 * Inert stub for optional @x402/* packages that @coinbase/cdp-sdk lazily
 * imports but that we never install. Resolves the specifier so bundlers
 * (esbuild / OpenNext) can build; any actual use throws.
 */
const err = () => { throw new Error("@x402 Solana payment path is not enabled in this deployment."); };
export const createPaymentHeader = err;
export const preparePaymentHeader = err;
export const signPaymentHeader = err;
export const createPayment = err;
export default new Proxy({}, { get: () => err });

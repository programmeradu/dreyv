const webCrypto = globalThis.crypto;
export const subtle = webCrypto.subtle;
export const randomUUID = () => webCrypto.randomUUID();
export const getRandomValues = (array) => webCrypto.getRandomValues(array);
const _crypto = {
  randomUUID,
  getRandomValues,
  subtle
};
export default _crypto;

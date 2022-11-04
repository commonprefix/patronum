import { InvalidParamsError } from './errors';

// Most of the validations are taken from:
// https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/client/lib/rpc/validation.ts

/**
 * @memberof module:rpc
 */
export const validators = {
  /**
   * address validator to ensure has `0x` prefix and 20 bytes length
   * @param params parameters of method
   * @param index index of parameter
   */
  address(params: any[], index: number) {
    this.hex(params, index);

    const address = params[index].substr(2);

    if (!/^[0-9a-fA-F]+$/.test(address) || address.length !== 40) {
      throw new InvalidParamsError(
        `invalid argument ${index}: invalid address`,
      );
    }
  },

  /**
   * hex validator to ensure has `0x` prefix
   * @param params parameters of method
   * @param index index of parameter
   */
  hex(params: any[], index: number) {
    if (typeof params[index] !== 'string') {
      throw new InvalidParamsError(
        `invalid argument ${index}: argument must be a hex string`,
      );
    }

    if (params[index].substr(0, 2) !== '0x') {
      throw new InvalidParamsError(
        `invalid argument ${index}: hex string without 0x prefix`,
      );
    }
  },

  /**
   * hex validator to validate block hash
   * @param params parameters of method
   * @param index index of parameter
   */
  blockHash(params: any[], index: number) {
    this.hex(params, index);

    const blockHash = params[index].substring(2);

    if (!/^[0-9a-fA-F]+$/.test(blockHash) || blockHash.length !== 64) {
      throw new InvalidParamsError(
        `invalid argument ${index}: invalid block hash`,
      );
    }
  },
  /**
   * validator to ensure valid block integer or hash, or string option ["latest", "earliest", "pending"]
   * @param params parameters of method
   * @param index index of parameter
   */
  blockOption(params: any[], index: number) {
    const blockOption = params[index];

    if (typeof blockOption !== 'string') {
      throw new InvalidParamsError(
        `invalid argument ${index}: argument must be a string`,
      );
    }

    try {
      if (['latest', 'earliest', 'pending'].includes(blockOption)) {
        return;
      }
      return this.hex([blockOption], 0);
    } catch (e) {
      throw new InvalidParamsError(
        `invalid argument ${index}: block option must be a valid hex block number, or "latest", "earliest" or "pending"`,
      );
    }
  },

  /**
   * bool validator to check if type is boolean
   * @param params parameters of method
   * @param index index of parameter
   */
  bool(params: any[], index: number) {
    if (typeof params[index] !== 'boolean') {
      throw new InvalidParamsError(
        `invalid argument ${index}: argument is not boolean`,
      );
    }
  },

  /**
   * params length validator
   * @param params parameters of method
   * @requiredParamsLength required length of parameters
   */
  paramsLength(
    params: any[],
    requiredParamsCount: number,
    maxParamsCount: number = requiredParamsCount,
  ) {
    if (params.length < requiredParamsCount || params.length > maxParamsCount) {
      throw new InvalidParamsError(
        `missing value for required argument ${params.length}`,
      );
    }
  },

  transaction(params: any[], index: number) {
    const tx = params[index];

    if (typeof tx !== 'object') {
      throw new InvalidParamsError(
        `invalid argument ${index}: argument must be an object`,
      );
    }

    // validate addresses
    for (const field of [tx.to, tx.from]) {
      // TODO: the below will create an error with incorrect index if the tx is not at index 0
      if (field !== undefined) this.address([field], 0);
    }

    // validate hex
    for (const field of [tx.gas, tx.gasPrice, tx.value, tx.data]) {
      // TODO: the below will create an error with incorrect index if the tx is not at index 0
      if (field !== undefined) this.hex([field], 0);
    }
  },
};

import { InvalidParamsError } from './errors';

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
    if (typeof params[index] !== 'string') {
      throw new InvalidParamsError(`invalid argument ${index}: argument must be a hex string`);
    }

    if (params[index].substr(0, 2) !== '0x') {
      throw new InvalidParamsError(`invalid argument ${index}: missing 0x prefix`);
    }

    const address = params[index].substr(2);

    if (!/^[0-9a-fA-F]+$/.test(address) || address.length !== 40) {
      throw new InvalidParamsError(`invalid argument ${index}: invalid address`);
    }
  },

  /**
   * hex validator to ensure has `0x` prefix
   * @param params parameters of method
   * @param index index of parameter
   */
  hex(params: any[], index: number) {
    if (typeof params[index] !== 'string') {
      throw new InvalidParamsError(`invalid argument ${index}: argument must be a hex string`);
    }

    if (params[index].substr(0, 2) !== '0x') {
      throw new InvalidParamsError(`invalid argument ${index}: hex string without 0x prefix`);
    }
  },

  /**
   * hex validator to validate block hash
   * @param params parameters of method
   * @param index index of parameter
   */
  blockHash(params: any[], index: number) {
    if (typeof params[index] !== 'string') {
      throw new InvalidParamsError(`invalid argument ${index}: argument must be a hex string`);
    }

    if (params[index].substr(0, 2) !== '0x') {
      throw new InvalidParamsError(`invalid argument ${index}: hex string without 0x prefix`);
    }

    const blockHash = params[index].substring(2);

    if (!/^[0-9a-fA-F]+$/.test(blockHash) || blockHash.length !== 64) {
      throw new InvalidParamsError(`invalid argument ${index}: invalid block hash`);
    }
  },
  /**
   * validator to ensure valid block integer or hash, or string option ["latest", "earliest", "pending"]
   * @param params parameters of method
   * @param index index of parameter
   */
  blockOption(params: any[], index: number) {
    if (typeof params[index] !== 'string') {
      throw new InvalidParamsError(`invalid argument ${index}: argument must be a string`);
    }

    const blockOption = params[index];

    console.log(blockOption);
    if (['latest', 'earliest', 'pending'].includes(blockOption)) {
      return;
    }

    if (blockOption.substr(0, 2) === '0x') {
      const hash = this.blockHash([blockOption], 0);
      // todo: make integer validator?
      const integer = this.hex([blockOption], 0);
      // valid if undefined
      if (hash === undefined || integer === undefined) {
        return;
      }
    }

    throw new InvalidParamsError(
      `invalid argument ${index}: block option must be a valid 0x-prefixed block hash or hex integer, or "latest", "earliest" or "pending"`,
    );
  },

  /**
   * bool validator to check if type is boolean
   * @param params parameters of method
   * @param index index of parameter
   */
  bool(params: any[], index: number) {
    if (typeof params[index] !== 'boolean') {
      throw new InvalidParamsError(`invalid argument ${index}: argument is not boolean`);
    }
  },

  /**
   * params length validator
   * @param params parameters of method
   * @requiredParamsLength required length of parameters
   */
  paramsLength(params: any[], requiredParamsCount: number) {
    if (params.length < requiredParamsCount) {
      throw new InvalidParamsError(`missing value for required argument ${params.length}`);
    }
  },

  transaction(params: any[], index: number) {
    if (typeof params[index] !== 'object') {
      throw new InvalidParamsError(`invalid argument ${index}: argument must be an object`);
    }

    const tx = params[index];

    const validate = (field: any, validator: Function) => {
      if (field === undefined) return;
      const v = validator([field], 0);
      if (v !== undefined) return v;
    };

    // validate addresses
    for (const field of [tx.to, tx.from]) {
      const v = validate(field, this.address);
      if (v !== undefined) return v;
    }

    // validate hex
    for (const field of [tx.gas, tx.gasPrice, tx.value, tx.data]) {
      const v = validate(field, this.hex);
      if (v !== undefined) return v;
    }
  },
};

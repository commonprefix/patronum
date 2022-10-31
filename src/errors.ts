import { JSONRPCErrorCode, JSONRPCErrorException } from 'json-rpc-2.0';

export class InternalError extends JSONRPCErrorException {
  constructor(message: string) {
    super(message, JSONRPCErrorCode.InternalError);
  }
}

export class InvalidParamsError extends JSONRPCErrorException {
  constructor(message: string) {
    super(message, JSONRPCErrorCode.InvalidParams);
  }
}

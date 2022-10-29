const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export const PARSE_ERROR = -32700;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_REQUEST = -32600;

export class InternalError extends Error {
	public code = INTERNAL_ERROR
	constructor(message: string) {
	  super(message);
	}
}

export class InvalidParamsError extends Error {
	public code = INVALID_PARAMS
	constructor(message: string) {
	  super(message);
	}
}
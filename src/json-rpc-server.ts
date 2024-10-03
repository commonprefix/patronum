import { JSONRPCServer, JSONRPCServerMiddleware } from 'json-rpc-2.0';
import { JSONRPCLogFilter, RPCTx } from './types';
import log from './logger';
import { VerifyingProvider } from './provider';
import { validators } from './validation';

export function getJSONRPCServer(provider: VerifyingProvider) {
  const server = new JSONRPCServer();

  server.addMethod('eth_getBalance', async (params: [string, string]) => {
    validators.paramsLength(params, 1, 2);
    validators.address(params, 0);
    if (params[1]) validators.blockOption(params, 1);
    const [address, blockOpt] = params;

    return await provider.getBalance(address, blockOpt);
  });

  server.addMethod('eth_blockNumber', () => {
    return provider.blockNumber();
  });

  server.addMethod('eth_chainId', () => {
    return provider.chainId();
  });

  server.addMethod(
    'eth_getTransactionCount',
    async (params: [string, string]) => {
      validators.paramsLength(params, 1, 2);
      validators.address(params, 0);
      if (params[1]) validators.blockOption(params, 1);
      const [address, blockOpt] = params;

      return await provider.getTransactionCount(address, blockOpt);
    },
  );

  server.addMethod('eth_getCode', async (params: [string, string]) => {
    validators.paramsLength(params, 1, 2);
    validators.address(params, 0);
    if (params[1]) validators.blockOption(params, 1);
    const [address, blockOpt] = params;

    return await provider.getCode(address, blockOpt);
  });

  server.addMethod(
    'eth_getBlockByNumber',
    async (params: [string, boolean]) => {
      validators.paramsLength(params, 2);
      validators.blockOption(params, 0);
      validators.bool(params, 1);
      const [blockOpt, includeTx] = params;

      return await provider.getBlockByNumber(blockOpt, includeTx);
    },
  );

  server.addMethod('eth_getBlockByHash', async (params: [string, boolean]) => {
    validators.paramsLength(params, 2);
    validators.blockHash(params, 0);
    validators.bool(params, 1);
    const [blockHash, includeTx] = params;

    return await provider.getBlockByHash(blockHash, includeTx);
  });

  server.addMethod('eth_getLogs', async (params: [JSONRPCLogFilter]) => {
    // Validate the length of parameters (must have at least one parameter)
    validators.paramsLength(params, 1, 1);

    const [filter] = params;

    // If blockHash is provided, validate it and ensure fromBlock and toBlock are not present
    if (filter.blockHash) {
      validators.blockHash([filter.blockHash], 0);
      if (filter.fromBlock || filter.toBlock) {
        throw new Error(
          'blockHash is exclusive and cannot be used with fromBlock or toBlock.',
        );
      }
    } else {
      // Validate block options if they are present and blockHash is not
      if (filter.fromBlock) validators.blockOption([filter.fromBlock], 0);
      if (filter.toBlock) validators.blockOption([filter.toBlock], 0);
    }

    // Validate address if it is present
    if (filter.address) {
      if (Array.isArray(filter.address)) {
        filter.address.forEach(address => validators.address([address], 0));
      } else {
        validators.address([filter.address], 0);
      }
    }

    // Validate topics if they are present
    if (filter.topics) {
      filter.topics.forEach(topic => {
        if (Array.isArray(topic)) {
          topic.forEach(t => {
            if (t !== null) validators.hex([t], 0);
          });
        } else if (topic !== null) {
          validators.hex([topic], 0);
        }
      });
    }

    // Call the provider method to fetch logs with the validated filter
    return await provider.getLogs(filter);
  });

  server.addMethod('eth_call', async (params: [RPCTx, string]) => {
    validators.paramsLength(params, 1, 2);
    validators.transaction(params, 0);
    if (params[1]) validators.blockOption(params, 1);
    const [tx, blockOpt] = params;

    return await provider.call(tx, blockOpt);
  });

  server.addMethod('eth_estimateGas', async (params: [RPCTx, string]) => {
    validators.paramsLength(params, 1, 2);
    validators.transaction(params, 0);
    if (params[1]) validators.blockOption(params, 1);
    const [tx, blockOpt] = params;

    return await provider.estimateGas(tx, blockOpt);
  });

  server.addMethod('eth_getTransactionReceipt', async (params: [string]) => {
    validators.paramsLength(params, 1);
    validators.hex(params, 0);
    const [txHash] = params;

    return await provider.getTransactionReceipt(txHash);
  });

  server.addMethod('eth_sendRawTransaction', async (params: [string]) => {
    validators.paramsLength(params, 1);
    validators.hex(params, 0);
    const [tx] = params;

    return await provider.sendRawTransaction(tx);
  });

  server.addMethod('net_version', async () => {
    return BigInt(provider.chainId()).toString();
  });

  const logMiddleware: JSONRPCServerMiddleware<void> = async (
    next,
    request,
    serverParams,
  ) => {
    log.info(`RPC Request: ${request.method}`);
    return await next(request, serverParams);
  };

  server.applyMiddleware(logMiddleware);
  return server;
}

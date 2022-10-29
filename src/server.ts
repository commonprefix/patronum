import express from 'express';
import bodyParser from 'body-parser';
import { JSONRPCServer, JSONRPCServerMiddleware } from 'json-rpc-2.0';
import { RPCTx } from './types';
import { InvalidParamsError } from './errors';
import { VerifyingProvider } from './provider';
import { validators } from './validation';

export function getJSONRPCServer(provider: VerifyingProvider) {
  const server = new JSONRPCServer();

  server.addMethod('eth_getBalance', async (params: [string, string]) => {
    validators.paramsLength(params, 2);
    validators.address(params, 0);
    validators.blockOption(params, 1);
    const [address, blockOpt] = params;

    provider.getBalance(address, blockOpt);
  });

  server.addMethod('eth_blockNumber', () => {
    return provider.blockNumber();
  });

  server.addMethod('eth_chainId', () => {
    return provider.chainId();
  });

  server.addMethod('eth_getTransactionCount', async (params: [string, string]) => {
    validators.paramsLength(params, 2);
    validators.address(params, 0);
    validators.blockOption(params, 1);
    const [address, blockOpt] = params;

    return await provider.getTransactionCount(address, blockOpt);
  });

  server.addMethod('eth_getCode', async (params: [string, string]) => {
    validators.paramsLength(params, 2);
    validators.address(params, 0);
    validators.blockOption(params, 1);
    const [address, blockOpt] = params;

    return await provider.getCode(address, blockOpt);
  });

  server.addMethod('eth_getBlockByNumber', async (params: [string, boolean]) => {
    validators.paramsLength(params, 2);
    validators.blockOption(params, 0);
    validators.bool(params, 1);
    const [blockOpt, includeTx] = params;

    return await provider.getBlockByNumber(blockOpt, includeTx);
  });

  server.addMethod('eth_getBlockByHash', async (params: [string, boolean]) => {
    validators.paramsLength(params, 2);
    validators.blockHash(params, 0);
    validators.bool(params, 1);
    const [blockHash, includeTx] = params;

    return await provider.getBlockByHash(blockHash, includeTx);
  });

  server.addMethod('eth_call', async (params: [RPCTx, string]) => {
    validators.paramsLength(params, 2);
    validators.transaction(params, 0);
    validators.blockOption(params, 1);
    const [tx, blockOpt] = params;

    return await provider.call(tx, blockOpt);
  });

  server.addMethod('eth_estimateGas', async (params: [RPCTx, string]) => {
    validators.paramsLength(params, 2);
    validators.transaction(params, 0);
    validators.blockOption(params, 1);
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

  const exceptionMiddleware: JSONRPCServerMiddleware<void> = async (next, request, serverParams) => {
    try {
      console.log(`RPC Request ${request.method}`);
      return await next(request, serverParams);
    } catch (error) {
      console.log(error);
      return error.code ? error : new InvalidParamsError(error.message);
    }
  };

  server.applyMiddleware(exceptionMiddleware);
  return server;
}

export function getExpressApp(provider: VerifyingProvider) {
  const app = express();
  const server = getJSONRPCServer(provider);

  app.use(bodyParser.json({ limit: '100mb' }));

  app.use((_, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
  });

  app.post('/', async (req, res) => {
    const jsonRPCRequest = req.body;
    server.receive(jsonRPCRequest).then(jsonRPCResponse => {
      if (jsonRPCResponse) {
        res.json(jsonRPCResponse);
      } else {
        res.sendStatus(204);
      }
    });
  });

  return app;
}

export async function startServer(provider: VerifyingProvider, port: number) {
  const app = await getExpressApp(provider);
  app.listen(port);
  console.log(`RPC Server started at http://localhost:${port}`);
}

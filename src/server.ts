import express from 'express';
import bodyParser from 'body-parser';
import { JSONRPCServer, JSONRPCServerMiddleware } from 'json-rpc-2.0';
import { RPCTx } from './types';
import { INTERNAL_ERROR } from './constants';
import { VerifyingProvider } from './provider';

export function getJSONRPCServer(provider: VerifyingProvider) {
  const server = new JSONRPCServer();

  server.addMethod(
    'eth_getBalance',
    async ([address, blockNumber]: [string, string]) => {
      return await provider.getBalance(address, blockNumber);
    },
  );

  server.addMethod('eth_blockNumber', () => {
    return provider.blockNumber();
  });

  server.addMethod('eth_chainId', () => {
    return provider.chainId();
  });

  server.addMethod(
    'eth_getTransactionCount',
    async ([address, blockNumber]: [string, string]) => {
      return await provider.getTransactionCount(address, blockNumber);
    },
  );

  server.addMethod(
    'eth_getCode',
    async ([address, blockNumber]: [string, string]) => {
      return await provider.getCode(address, blockNumber);
    },
  );

  server.addMethod(
    'eth_getBlockByNumber',
    async ([blockNumber, includeTx]: [string, boolean]) => {
      return await provider.getBlockByNumber(blockNumber, includeTx);
    },
  );

  server.addMethod(
    'eth_getBlockByHash',
    async ([blockHash, includeTx]: [string, boolean]) => {
      return await provider.getBlockByHash(blockHash, includeTx);
    },
  );

  server.addMethod('eth_call', async ([tx, blockNumber]: [RPCTx, string]) => {
    return await provider.call(tx, blockNumber);
  });

  server.addMethod(
    'eth_estimateGas',
    async ([tx, blockNumber]: [RPCTx, string]) => {
      return await provider.estimateGas(tx, blockNumber);
    },
  );

  server.addMethod('eth_getTransactionReceipt', async ([txHash]: [string]) => {
    return await provider.getTransactionReceipt(txHash);
  });

  server.addMethod('eth_sendRawTransaction', async ([tx]: [string]) => {
    return await provider.sendRawTransaction(tx);
  });

  server.addMethod('net_version', async () => {
    return BigInt(provider.chainId()).toString();
  });

  const exceptionMiddleware: JSONRPCServerMiddleware<void> = async (
    next,
    request,
    serverParams,
  ) => {
    try {
      console.log(`RPC Request ${request.method}`);
      return await next(request, serverParams);
    } catch (error) {
      console.log(error);
      if (error.code) {
        return error;
      } else {
        return {
          message: error.message,
          code: INTERNAL_ERROR,
        };
      }
    }
  };

  server.applyMiddleware(exceptionMiddleware);
  return server;
}

export function getExpressApp(provider: VerifyingProvider) {
  const app = express();
  const server = getJSONRPCServer(provider);  

  app.use(bodyParser.json({limit: '100mb'}));

  app.use((_, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept',
    );
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

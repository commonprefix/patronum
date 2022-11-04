require('dotenv').config();
import { Express } from 'express';
import { getExpressApp, VerifyingProvider } from '../src/index';
import { MockRPC } from './mock';
import { RPCClient } from './utils';

const BLOCK_HEIGHT = 15898565;
const BLOCK_HEIGHT_HEX = '0x' + BigInt(BLOCK_HEIGHT).toString(16);
const BLOCK_HASH =
  '0x74c150632fd60c63e76ea556bddfb4ba8a491c9344e2ad9ec0c9928c74ff235d';
const RPC_URL = process.env.RPC_URL || '';

describe('Server', () => {
  let app: Express;
  let provider: VerifyingProvider;
  let requestRPC: ReturnType<typeof RPCClient>;

  beforeAll(() => {
    provider = new VerifyingProvider(RPC_URL, BLOCK_HEIGHT, BLOCK_HASH);
    provider.rpc = new MockRPC({ URL: RPC_URL });

    app = getExpressApp(provider);
    requestRPC = RPCClient(app);
  });

  describe('eth_getBalance', () => {
    it('fetches balance', async () => {
      const response = await requestRPC('eth_getBalance', [
        '0x1A0DfD0252700c79Fc54269577bBEed16773F17a',
        BLOCK_HEIGHT_HEX,
      ]);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 10,
        result: '0x60e74857f86c4',
      });
    });
  });

  describe('eth_chainId', () => {
    it('fetches chainId', async () => {
      const response = await requestRPC('eth_chainId', []);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({ jsonrpc: '2.0', id: 10, result: '0x1' });
    });
  });

  describe('net_version', () => {
    it('fetches net version', async () => {
      const response = await requestRPC('net_version', []);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({ jsonrpc: '2.0', id: 10, result: '1' });
    });
  });

  describe('eth_getTransactionReceipt', () => {
    it('fetches transaction receipt', async () => {
      const txHash =
        '0x49dcd5143d0efa73ab19cea38a51c183f2e30df7ba01d8375cd1d809ccdc8c28';
      const { status, body } = await requestRPC('eth_getTransactionReceipt', [
        txHash,
      ]);
      const { result, id } = body;
      expect(status).toEqual(200);
      expect(id).toEqual(10);
      expect(result['blockNumber']).toBe('0xf297c5');
      expect(result['blockHash']).toBe(
        '0x74c150632fd60c63e76ea556bddfb4ba8a491c9344e2ad9ec0c9928c74ff235d',
      );
      expect(result['from']).toBe('0xdafea492d9c6733ae3d56b7ed1adb60692c98bc5');
      expect(result['to']).toBe('0x388c818ca8b9251b393131c08a736a67ccb19297');
      expect(result['transactionHash']).toBe(txHash);
      expect(result['transactionIndex']).toBe('0x6f');
    });
  });

  describe('eth_sendRawTransaction', () => {
    it('sends transaction', async () => {
      const rawTx =
        '0x02f868010680808252089469ab92540340453d06366984d5b4be58e149fca9865af3107a400080c001a0f260142f8b2aca58a94fdb74c20329c6cc048b41b028970a030519f0b835442fa0307aba5866d9a18044f148bb76f509f63ea4e4a9ca9d9b951b270afcdb055137';
      const response = await requestRPC('eth_sendRawTransaction', [rawTx]);
      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 10,
        result:
          '0xb7bf2085c8b17a519fb420ca50d7a3d8c382058212c7eeba83344924a7455aa1',
      });
    });
  });

  describe('eth_call', () => {
    it('sends transaction', async () => {
      const tx = {
        to: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
        data: '0xcdca175300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000000422260fac5e5542a773aa44fbcfedf7c193bc2c5990001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8c944e90c64b2c07662a292be6244bdf05cda44a7000000000000000000000000000000000000000000000000000000000000',
      };
      const response = await requestRPC('eth_call', [tx, BLOCK_HEIGHT_HEX]);
      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 10,
        result:
          '0x0000000000000000000000000000000000000000000011ae8b43fcf2570410dd',
      });
    });
  });

  describe('eth_estimateGas', () => {
    it('estimates gas properly', async () => {
      const tx = {
        to: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
        data: '0xcdca175300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000000422260fac5e5542a773aa44fbcfedf7c193bc2c5990001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8c944e90c64b2c07662a292be6244bdf05cda44a7000000000000000000000000000000000000000000000000000000000000',
      };
      const response = await requestRPC('eth_estimateGas', [
        tx,
        BLOCK_HEIGHT_HEX,
      ]);
      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 10,
        result: '0x53a65',
      });
    });
  });

  describe('eth_blockNumber', () => {
    it('fetches blockNumber', async () => {
      const response = await requestRPC('eth_blockNumber', []);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 10,
        result: BLOCK_HEIGHT_HEX,
      });
    });
  });

  describe('eth_getTransactionCount', () => {
    it('fetches transaction count', async () => {
      const response = await requestRPC('eth_getTransactionCount', [
        '0x1A0DfD0252700c79Fc54269577bBEed16773F17a',
        BLOCK_HEIGHT_HEX,
      ]);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({ jsonrpc: '2.0', id: 10, result: '0x2' });
    });
  });

  describe('eth_getBlockByNumber', () => {
    it('fetches the block without full transactions', async () => {
      const response = await requestRPC('eth_getBlockByNumber', [
        BLOCK_HEIGHT_HEX,
        false,
      ]);
      expect(response.status).toEqual(200);
      expect(response.body.result.number).toEqual(BLOCK_HEIGHT_HEX);
      expect(response.body.result.hash).toEqual(BLOCK_HASH);
      expect(response.body.result.transactions).toBeInstanceOf(Array);
      expect(
        typeof response.body.result.transactions[0] == 'string',
      ).toBeTruthy();
    });

    it('fetches the block with full transactions', async () => {
      const response = await requestRPC('eth_getBlockByNumber', [
        BLOCK_HEIGHT_HEX,
        true,
      ]);
      expect(response.status).toEqual(200);
      expect(response.body.result.number).toEqual(BLOCK_HEIGHT_HEX);
      expect(response.body.result.hash).toEqual(BLOCK_HASH);
      expect(response.body.result.transactions).toBeInstanceOf(Array);
      expect(
        typeof response.body.result.transactions[0] == 'object',
      ).toBeTruthy();
    });
  });

  describe('eth_getBlockByHash', () => {
    it('fetches the block without full transactions', async () => {
      const response = await requestRPC('eth_getBlockByHash', [
        BLOCK_HASH,
        false,
      ]);
      expect(response.status).toEqual(200);
      expect(response.body.result.number).toEqual(BLOCK_HEIGHT_HEX);
      expect(response.body.result.hash).toEqual(BLOCK_HASH);
      expect(response.body.result.transactions).toBeInstanceOf(Array);
      expect(
        typeof response.body.result.transactions[0] == 'string',
      ).toBeTruthy();
    });

    it('fetches the block with full transactions', async () => {
      const response = await requestRPC('eth_getBlockByHash', [
        BLOCK_HASH,
        true,
      ]);
      expect(response.status).toEqual(200);
      expect(response.body.result.number).toEqual(BLOCK_HEIGHT_HEX);
      expect(response.body.result.hash).toEqual(BLOCK_HASH);
      expect(response.body.result.transactions).toBeInstanceOf(Array);
      expect(
        typeof response.body.result.transactions[0] == 'object',
      ).toBeTruthy();
    });
  });

  describe('eth_getCode', () => {
    it('fetches 0x for peer account', async () => {
      const response = await requestRPC('eth_getCode', [
        '0x1A0DfD0252700c79Fc54269577bBEed16773F17a',
        BLOCK_HEIGHT_HEX,
      ]);
      expect(response.body).toEqual({ jsonrpc: '2.0', id: 10, result: '0x' });
    });

    it('fetches bytecode for smart contract account', async () => {
      const fixture = require('./fixtures/356318cfda3f05ee7408a383a2c23fc9.json');
      const response = await requestRPC('eth_getCode', [
        '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552',
        BLOCK_HEIGHT_HEX,
      ]);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual({
        jsonrpc: '2.0',
        id: 10,
        result: fixture.responses[0].result,
      });
    });
  });
});

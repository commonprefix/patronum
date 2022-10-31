require('dotenv').config();
import { Express } from 'express';
import { getExpressApp, VerifyingProvider } from '../src/index';
import { MockRPC } from './mock';
import { RPCClient } from './utils';

const BLOCK_HEIGHT = 15862076;
const BLOCK_HEIGHT_HEX = '0x' + BigInt(BLOCK_HEIGHT).toString(16);
const BLOCK_HASH =
  '0xbee445ff49d7a72316d277371af43f01cd215a767a1fece92341362856b8c678';
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
      expect(response.body.result.number).toEqual('0xf2093c');
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
      expect(response.body.result.number).toEqual('0xf2093c');
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
      expect(response.body.result.number).toEqual('0xf2093c');
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
      expect(response.body.result.number).toEqual('0xf2093c');
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
      const fixture = require('./fixtures/9eaacae0f81fb4d470d471f4aa57e237.json');
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

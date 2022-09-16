// TODO: currently its just a demo script, make it a test
import * as dotenv from 'dotenv';
dotenv.config();

import Web3 from 'web3';
import { VerifyingProvider, startServer } from '../src';

const RPC_URL = process.env.RPC_URL || '';
const PORT = 8545;

async function main() {
  const web3 = new Web3(RPC_URL);
  const currentblockNumber = await web3.eth.getBlockNumber();
  const block = await web3.eth.getBlock(currentblockNumber);
  const provider = new VerifyingProvider(
    RPC_URL,
    currentblockNumber,
    block.hash,
  );
  await startServer(provider, PORT);
}

main();

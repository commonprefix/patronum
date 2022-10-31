// TODO: currently its just a demo script, make it a test
import * as dotenv from 'dotenv';
dotenv.config();

import Web3 from 'web3';
import { Chain } from '@ethereumjs/common';
import { VerifyingProvider, startServer } from '../src';

const RPC_URL = process.env.RPC_URL || '';
const RPC_URL_WS = process.env.RPC_URL_WS;
// Metamask doesn't allow same RPC URL for different networks
const PORT = process.env.CHAIN_ID === '5' ? 8547 : 8546;
const CHAIN = process.env.CHAIN_ID === '5' ? Chain.Goerli : Chain.Mainnet;
const POLLING_DELAY = 13 * 1000; //13s

async function main() {
  const web3 = new Web3(RPC_URL);
  const block = await web3.eth.getBlock('latest');
  const provider = new VerifyingProvider(RPC_URL, BigInt(block.number), block.hash, CHAIN);
  if (RPC_URL_WS) {
    const web3Sub = new Web3(RPC_URL_WS);
    web3Sub.eth
      .subscribe('newBlockHeaders')
      .on('connected', () => {
        console.log('Subscribed to new blockHeaders');
      })
      .on('data', blockHeader => {
        console.log(`Recieved a new blockheader: ${blockHeader.number} ${blockHeader.hash}`);
        provider.update(blockHeader.hash, BigInt(blockHeader.number));
      })
      .on('error', console.error);
  } else {
    setInterval(async () => {
      const block = await web3.eth.getBlock('latest');
      console.log(`Recieved a new blockheader: ${block.number} ${block.hash}`);
      provider.update(block.hash, BigInt(block.number));
    }, POLLING_DELAY);
  }
  await startServer(provider, PORT);
}

main();

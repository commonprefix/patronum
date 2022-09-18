require('dotenv').config()
import * as mocks from './mocks'
import { VerifyingProvider } from '../src';


const RPC_URL = process.env.RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/fgIGCmODwhgc7FQ93JdaTJWgSZ1WpiX4'

describe('Provider', () => {
  let provider: VerifyingProvider
  let currentBlockNumber = 15562535 // await web3.eth.getBlockNumber();

  beforeEach(async () => {
    const block = await mocks.getBlock(currentBlockNumber);
    provider = new VerifyingProvider(
      RPC_URL,
      currentBlockNumber,
      block.hash,
    )

    provider.rpc.getProof = mocks.getProof,
    provider.rpc.createAccessList =  mocks.createAccessList
    provider.rpc.fetchRequests =  mocks.fetchRequests
    provider.rpc.getBlock = mocks.getBlock;
  })

  it('verifies signatures on call', async () => {
    const tx = {
      to: '0xb27308f9f90d607463bb33ea1bebb41c27ce5ab6',
      data: '0xcdca175300000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000000000000000422260fac5e5542a773aa44fbcfedf7c193bc2c5990001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000bb8c944e90c64b2c07662a292be6244bdf05cda44a7000000000000000000000000000000000000000000000000000000000000',
    };

    const blockNumber = currentBlockNumber - 5

    const expectedRes = await mocks.call(tx, blockNumber);
    const actualRes = await provider.call(tx, blockNumber);
    expect(expectedRes).toBe(actualRes)
  })
})
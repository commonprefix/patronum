import type { GetProof } from 'web3-eth';
import type { BlockNumber } from 'web3-core';
import type { Method } from 'web3-core-method';
import type { JsonTx } from '@ethereumjs/tx';
export type { GetProof, BlockNumber, Method };

export type Bytes = string;
export type Bytes32 = string;
export type AddressHex = string;
export type ChainId = number;
export type HexString = string;

// Some of the types below are taken from:
// https://github.com/ethereumjs/ethereumjs-monorepo/blob/master/packages/client/lib/rpc/modules/eth.ts

export type ExecutionInfo = {
  blockhash: string;
  blockNumber: bigint;
};

export type AccessList = { address: AddressHex; storageKeys: Bytes32[] }[];

export interface RPCTx {
  from?: string;
  to?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  accessList?: AccessList;
  value?: string;
  data?: string;
}

export type AccountRequest = {
  type: 'account';
  blockNumber: bigint;
  addressHex: AddressHex;
  storageSlots: Bytes32[];
};

export type CodeRequest = {
  type: 'code';
  blockNumber: bigint;
  addressHex: AddressHex;
};

export type AccountResponse = GetProof;
export type CodeResponse = string;

export type Request = AccountRequest | CodeRequest;
export type Response = AccountResponse | CodeResponse;

export type RequestMethodCallback = (error: Error, data: Response) => void;

export type JSONRPCBlock = {
  number: string; // the block number. null when pending block.
  hash: string; // hash of the block. null when pending block.
  parentHash: string; // hash of the parent block.
  mixHash?: string; // bit hash which proves combined with the nonce that a sufficient amount of computation has been carried out on this block.
  nonce: string; // hash of the generated proof-of-work. null when pending block.
  sha3Uncles: string; // SHA3 of the uncles data in the block.
  logsBloom: string; // the bloom filter for the logs of the block. null when pending block.
  transactionsRoot: string; // the root of the transaction trie of the block.
  stateRoot: string; // the root of the final state trie of the block.
  receiptsRoot: string; // the root of the receipts trie of the block.
  miner: string; // the address of the beneficiary to whom the mining rewards were given.
  difficulty: string; // integer of the difficulty for this block.
  totalDifficulty: string; // integer of the total difficulty of the chain until this block.
  extraData: string; // the “extra data” field of this block.
  size: string; // integer the size of this block in bytes.
  gasLimit: string; // the maximum gas allowed in this block.
  gasUsed: string; // the total used gas by all transactions in this block.
  timestamp: string; // the unix timestamp for when the block was collated.
  transactions: Array<JSONRPCTx | string>; // Array of transaction objects, or 32 Bytes transaction hashes depending on the last given parameter.
  uncles: string[]; // Array of uncle hashes
  baseFeePerGas?: string; // If EIP-1559 is enabled for this block, returns the base fee per gas
};

export type JSONRPCTx = {
  blockHash: string | null; // DATA, 32 Bytes - hash of the block where this transaction was in. null when it's pending.
  blockNumber: string | null; // QUANTITY - block number where this transaction was in. null when it's pending.
  from: string; // DATA, 20 Bytes - address of the sender.
  gas: string; // QUANTITY - gas provided by the sender.
  gasPrice: string; // QUANTITY - gas price provided by the sender in wei. If EIP-1559 tx, defaults to maxFeePerGas.
  maxFeePerGas?: string; // QUANTITY - max total fee per gas provided by the sender in wei.
  maxPriorityFeePerGas?: string; // QUANTITY - max priority fee per gas provided by the sender in wei.
  type: string; // QUANTITY - EIP-2718 Typed Transaction type
  accessList?: JsonTx['accessList']; // EIP-2930 access list
  chainId?: string; // Chain ID that this transaction is valid on.
  hash: string; // DATA, 32 Bytes - hash of the transaction.
  input: string; // DATA - the data send along with the transaction.
  nonce: string; // QUANTITY - the number of transactions made by the sender prior to this one.
  to: string | null; /// DATA, 20 Bytes - address of the receiver. null when it's a contract creation transaction.
  transactionIndex: string | null; // QUANTITY - integer of the transactions index position in the block. null when it's pending.
  value: string; // QUANTITY - value transferred in Wei.
  v: string; // QUANTITY - ECDSA recovery id
  r: string; // DATA, 32 Bytes - ECDSA signature r
  s: string; // DATA, 32 Bytes - ECDSA signature s
};

export type JSONRPCReceipt = {
  transactionHash: string; // DATA, 32 Bytes - hash of the transaction.
  transactionIndex: string; // QUANTITY - integer of the transactions index position in the block.
  blockHash: string; // DATA, 32 Bytes - hash of the block where this transaction was in.
  blockNumber: string; // QUANTITY - block number where this transaction was in.
  from: string; // DATA, 20 Bytes - address of the sender.
  to: string | null; // DATA, 20 Bytes - address of the receiver. null when it's a contract creation transaction.
  cumulativeGasUsed: string; // QUANTITY  - The total amount of gas used when this transaction was executed in the block.
  effectiveGasPrice: string; // QUANTITY - The final gas price per gas paid by the sender in wei.
  gasUsed: string; // QUANTITY - The amount of gas used by this specific transaction alone.
  contractAddress: string | null; // DATA, 20 Bytes - The contract address created, if the transaction was a contract creation, otherwise null.
  logs: JSONRPCLog[]; // Array - Array of log objects, which this transaction generated.
  logsBloom: string; // DATA, 256 Bytes - Bloom filter for light clients to quickly retrieve related logs.
  // It also returns either:
  root?: string; // DATA, 32 bytes of post-transaction stateroot (pre Byzantium)
  status?: string; // QUANTITY, either 1 (success) or 0 (failure)
};

export type JSONRPCLog = {
  removed: boolean; // TAG - true when the log was removed, due to a chain reorganization. false if it's a valid log.
  logIndex: string | null; // QUANTITY - integer of the log index position in the block. null when it's pending.
  transactionIndex: string | null; // QUANTITY - integer of the transactions index position log was created from. null when it's pending.
  transactionHash: string | null; // DATA, 32 Bytes - hash of the transactions this log was created from. null when it's pending.
  blockHash: string | null; // DATA, 32 Bytes - hash of the block where this log was in. null when it's pending.
  blockNumber: string | null; // QUANTITY - the block number where this log was in. null when it's pending.
  address: string; // DATA, 20 Bytes - address from which this log originated.
  data: string; // DATA - contains one or more 32 Bytes non-indexed arguments of the log.
  topics: string[]; // Array of DATA - Array of 0 to 4 32 Bytes DATA of indexed log arguments.
  // (In solidity: The first topic is the hash of the signature of the event
  // (e.g. Deposit(address,bytes32,uint256)), except you declared the event with the anonymous specifier.)
};

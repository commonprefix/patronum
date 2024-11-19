import _ from 'lodash';
import Web3 from 'web3';
import { loadKZG } from 'kzg-wasm';
import { Trie } from '@ethereumjs/trie';
import rlp from 'rlp';
import { Common, Chain, Hardfork, CustomCrypto } from '@ethereumjs/common';
import {
  Address,
  Account,
  toType,
  bytesToHex,
  hexToBytes,
  TypeOutput,
  setLengthLeft,
  KECCAK256_RLP_S,
  KECCAK256_NULL_S,
  equalsBytes,
  KECCAK256_RLP,
  PrefixedHexString,
} from '@ethereumjs/util';
import { VM, encodeReceipt } from '@ethereumjs/vm';
import { BlockHeader, Block } from '@ethereumjs/block';
import { Blockchain } from '@ethereumjs/blockchain';
import { TransactionFactory, TransactionType, TxData } from '@ethereumjs/tx';
import { isInBloom, isTopicInBloom } from 'ethereum-bloom-filters';
import {
  AddressHex,
  Bytes32,
  RPCTx,
  AccountResponse,
  CodeResponse,
  Bytes,
  BlockNumber as BlockOpt,
  HexString,
  JSONRPCReceipt,
  AccessList,
  GetProof,
  JSONRPCLogFilter,
  JSONRPCLog,
} from './types';
import { InternalError, InvalidParamsError } from './errors';
import log from './logger';
import {
  ZERO_ADDR,
  ZERO_HASH,
  MAX_BLOCK_HISTORY,
  MAX_BLOCK_FUTURE,
  DEFAULT_BLOCK_PARAMETER,
} from './constants';
import {
  headerDataFromWeb3Response,
  blockDataFromWeb3Response,
  toJSONRPCBlock,
  txReceiptFromJSONRPCReceipt,
} from './utils';
import { RPC } from './rpc';

const bigIntToHex = (n: string | bigint | number) =>
  ('0x' + BigInt(n).toString(16)) as PrefixedHexString;

const emptyAccountRLP = new Account().serialize();

// TODO: handle fallback if RPC fails
// TODO: if anything is accessed outside the accesslist the provider
// should throw error
export class VerifyingProvider {
  common: Common;
  vm: VM | null = null;
  rpc: RPC;

  private blockHashes: { [blockNumberHex: string]: Bytes32 } = {};
  private blockPromises: {
    [blockNumberHex: string]: { promise: Promise<void>; resolve: () => void };
  } = {};
  private blockHeaders: { [blockHash: string]: BlockHeader } = {};
  private latestBlockNumber: bigint;

  constructor(
    providerURL: string,
    blockNumber: bigint | number,
    blockHash: Bytes32,
    chain: bigint | Chain = Chain.Mainnet,
    customCrypto: CustomCrypto,
  ) {
    this.rpc = new RPC({ URL: providerURL });
    const _blockNumber = BigInt(blockNumber);
    this.latestBlockNumber = _blockNumber;
    this.blockHashes[bigIntToHex(_blockNumber)] = blockHash;
    this.common = new Common({
      chain,
      hardfork: Hardfork.Cancun,
      customCrypto,
    });
  }

  static async create(
    providerURL: string,
    blockNumber: bigint | number,
    blockHash: Bytes32,
    chain: bigint | Chain = Chain.Mainnet,
  ): Promise<VerifyingProvider> {
    const kzg = await loadKZG();
    const customCrypto: CustomCrypto = { kzg };
    return new VerifyingProvider(
      providerURL,
      blockNumber,
      blockHash,
      chain,
      customCrypto,
    );
  }

  update(blockHash: Bytes32, blockNumber: bigint) {
    const blockNumberHex = bigIntToHex(blockNumber);
    if (
      blockNumberHex in this.blockHashes &&
      this.blockHashes[blockNumberHex] !== blockHash
    ) {
      log.warn(
        'Overriding an existing verified blockhash. Possibly the chain had a reorg',
      );
    }
    const latestBlockNumber = this.latestBlockNumber;
    this.latestBlockNumber = blockNumber;
    this.blockHashes[blockNumberHex] = blockHash;
    if (blockNumber > latestBlockNumber) {
      for (let b = latestBlockNumber + BigInt(1); b <= blockNumber; b++) {
        const bHex = bigIntToHex(b);
        if (bHex in this.blockPromises) {
          this.blockPromises[bHex].resolve();
        }
      }
    }
  }

  async getBalance(
    addressHex: AddressHex,
    blockOpt: BlockOpt = DEFAULT_BLOCK_PARAMETER,
  ) {
    const header = await this.getBlockHeader(blockOpt);
    const address = Address.fromString(addressHex);
    const { result: proof, success } = await this.rpc.request({
      method: 'eth_getProof',
      params: [addressHex, [], bigIntToHex(header.number)],
    });
    if (!success) {
      throw new InternalError(`RPC request failed`);
    }
    const isAccountCorrect = await this.verifyProof(
      address,
      [],
      header.stateRoot,
      proof,
    );
    if (!isAccountCorrect) {
      throw new InternalError('Invalid account proof provided by the RPC');
    }

    return bigIntToHex(proof.balance);
  }

  blockNumber(): HexString {
    return bigIntToHex(this.latestBlockNumber);
  }

  chainId(): HexString {
    return bigIntToHex(this.common.chainId());
  }

  async getLogs(filter: JSONRPCLogFilter): Promise<JSONRPCLog[]> {
    const res = await this.rpc.request({
      method: 'eth_getLogs',
      params: [filter],
    });
    if (!res.success) {
      throw new InternalError(`RPC request failed`);
    }

    const logs = res.result as JSONRPCLog[];
    const blockNumbers = new Set(
      logs
        .map(l => l.blockNumber)
        .filter(bn => bn && Number.isInteger(parseInt(bn, 16))),
    ) as Set<string>;

    // caches
    // blockNumber -> blockHeader
    const blockHeaders = new Map<string, BlockHeader>();
    // blockNumber -> block
    const blocks = new Map<string, Block>();
    // blockHash -> receipts
    const blockReceipts = new Map<string, JSONRPCReceipt[]>();

    // fetch blocks
    await Promise.all(
      Array.from(blockNumbers).map(async blockNumber => {
        if (!blockHeaders.has(blockNumber)) {
          const header = await this.getBlockHeader(blockNumber);
          blockHeaders.set(blockNumber, header);
        }
        if (!blocks.has(blockNumber)) {
          const header = blockHeaders.get(blockNumber)!;
          const block = await this.getBlock(header);
          blocks.set(blockNumber, block);
        }
      }),
    );

    // TODO parallelize
    for (const l of logs) {
      if (
        typeof l.logIndex !== 'string' ||
        typeof l.blockNumber !== 'string' ||
        typeof l.blockHash !== 'string' ||
        typeof l.transactionHash !== 'string' ||
        typeof l.transactionIndex !== 'string'
      ) {
        throw new InternalError(`"pending" logs are not supported`);
      }

      const block = blocks.get(l.blockNumber);
      if (!block) {
        throw new InternalError(`Block ${l.blockNumber} not found`);
      }
      const blockHash = bytesToHex(block.hash());

      // verify block hash matches
      if (blockHash !== l.blockHash.toLowerCase()) {
        throw new InternalError(
          'the log provided by the RPC is invalid: blockHash not matching',
        );
      }

      // verify transaction index and hash matches
      const txIndex = block.transactions.findIndex(
        tx => bytesToHex(tx.hash()) === l.transactionHash!.toLowerCase(),
      );
      if (txIndex === -1 || txIndex !== parseInt(l.transactionIndex, 16)) {
        throw new InternalError(
          'the log provided by the RPC is invalid: transactionHash not matching',
        );
      }

      // check if the log is not in the logsBloom
      const logsBloom = bytesToHex(block.header.logsBloom);
      if (
        !isInBloom(logsBloom, l.address) ||
        l.topics.some(topic => !isTopicInBloom(logsBloom, topic))
      ) {
        throw new InternalError('the log is not in the logsBloom');
      }

      // fetch all receipts in the block
      let receipts: JSONRPCReceipt[];
      if (blockReceipts.has(blockHash)) {
        receipts = blockReceipts.get(blockHash)!;
      } else {
        receipts = await this.getBlockReceipts(blockHash);
        blockReceipts.set(blockHash, receipts);
      }

      // reconstruct receipt trie
      const reconstructedReceiptTrie = new Trie();
      for (let i = 0; i < receipts.length; i++) {
        const receiptJson = receipts[i] as JSONRPCReceipt;
        const receipt = txReceiptFromJSONRPCReceipt(receiptJson);
        const type: TransactionType = parseInt(receiptJson.type, 16);
        const encoded = encodeReceipt(receipt, type);
        await reconstructedReceiptTrie.put(rlp.encode(i), encoded);
      }

      // check if it matches
      const computedReceiptRoot =
        reconstructedReceiptTrie !== undefined
          ? bytesToHex(reconstructedReceiptTrie.root())
          : KECCAK256_RLP;

      if (computedReceiptRoot !== bytesToHex(block.header.receiptTrie)) {
        throw new InternalError(
          'Receipt trie root does not match the block header receiptTrie',
        );
      }

      // check log is included in the receipt
      const receipt = receipts.find(
        r =>
          r.transactionHash.toLowerCase() === l.transactionHash!.toLowerCase(),
      );
      if (!receipt) {
        throw new InternalError('Receipt not found for the log');
      }
      const logFound = receipt.logs.some(
        log =>
          log.address.toLowerCase() === l.address.toLowerCase() &&
          log.data.toLowerCase() === l.data.toLowerCase() &&
          log.topics.length === l.topics.length &&
          log.topics.every(
            (topic, index) =>
              topic.toLowerCase() === l.topics[index].toLowerCase(),
          ),
      );
      if (!logFound) {
        throw new InternalError('Log not found in the receipt');
      }
    }

    return res.result;
  }

  // TODO expose as an RPC request (and verify)
  async getBlockReceipts(blockHash: Bytes32): Promise<JSONRPCReceipt[]> {
    try {
      const { result: receipts, success } = await this.rpc.request({
        method: 'eth_getBlockReceipts',
        params: [blockHash],
      });

      if (success) {
        return receipts;
      } else {
        throw new Error('eth_getBlockReceipts RPC request failed');
      }
    } catch (error) {
      // only fallback to eth_getTransactionReceipt if the method is not supported
      // otherwise fail
      if (!error?.message.includes('method not supported')) {
        throw error;
      }

      const header = await this.getBlockHeaderByHash(blockHash);
      const block = await this.getBlock(header);

      const receipts = await this.rpc.requestBatch(
        block.transactions.map(tx => ({
          method: 'eth_getTransactionReceipt',
          params: [bytesToHex(tx.hash())],
        })),
      );

      if (receipts.some(r => !r.success)) {
        throw new InternalError(`eth_getTransactionReceipt RPC request failed`);
      }

      return receipts.map(r => r.result);
    }
  }

  async getCode(
    addressHex: AddressHex,
    blockOpt: BlockOpt = DEFAULT_BLOCK_PARAMETER,
  ): Promise<HexString> {
    const header = await this.getBlockHeader(blockOpt);
    const res = await this.rpc.requestBatch([
      {
        method: 'eth_getProof',
        params: [addressHex, [], bigIntToHex(header.number)],
      },
      {
        method: 'eth_getCode',
        params: [addressHex, bigIntToHex(header.number)],
      },
    ]);

    if (res.some(r => !r.success)) {
      throw new InternalError(`RPC request failed`);
    }
    const [accountProof, code] = [res[0].result, res[1].result];

    const address = Address.fromString(addressHex);
    const isAccountCorrect = await this.verifyProof(
      address,
      [],
      header.stateRoot,
      accountProof,
    );
    if (!isAccountCorrect) {
      throw new InternalError(`invalid account proof provided by the RPC`);
    }

    const isCodeCorrect = this.verifyCodeHash(code, accountProof.codeHash);
    if (!isCodeCorrect) {
      throw new InternalError(
        `code provided by the RPC doesn't match the account's codeHash`,
      );
    }

    return code;
  }

  async getTransactionCount(
    addressHex: AddressHex,
    blockOpt: BlockOpt = DEFAULT_BLOCK_PARAMETER,
  ): Promise<HexString> {
    const header = await this.getBlockHeader(blockOpt);
    const address = Address.fromString(addressHex);
    const { result: proof, success } = await this.rpc.request({
      method: 'eth_getProof',
      params: [addressHex, [], bigIntToHex(header.number)],
    });
    if (!success) {
      throw new InternalError(`RPC request failed`);
    }

    const isAccountCorrect = await this.verifyProof(
      address,
      [],
      header.stateRoot,
      proof,
    );
    if (!isAccountCorrect) {
      throw new InternalError(`invalid account proof provided by the RPC`);
    }

    return bigIntToHex(proof.nonce.toString());
  }

  async call(transaction: RPCTx, blockOpt: BlockOpt = DEFAULT_BLOCK_PARAMETER) {
    try {
      this.validateTx(transaction);
    } catch (e) {
      throw new InvalidParamsError(e.message);
    }

    const header = await this.getBlockHeader(blockOpt);
    const vm = await this.getVM(transaction, header);
    const {
      from,
      to,
      gas: gasLimit,
      gasPrice,
      maxPriorityFeePerGas,
      value,
      data,
    } = transaction;
    try {
      const runCallOpts = {
        caller: from ? Address.fromString(from) : undefined,
        to: to ? Address.fromString(to) : undefined,
        gasLimit: toType(gasLimit, TypeOutput.BigInt),
        gasPrice: toType(gasPrice || maxPriorityFeePerGas, TypeOutput.BigInt),
        value: toType(value, TypeOutput.BigInt),
        data: data ? hexToBytes(data) : undefined,
        block: { header },
      };
      const { execResult } = await vm.evm.runCall(runCallOpts);

      return bytesToHex(execResult.returnValue);
    } catch (error: any) {
      throw new InternalError(error.message.toString());
    }
  }

  async estimateGas(
    transaction: RPCTx,
    blockOpt: BlockOpt = DEFAULT_BLOCK_PARAMETER,
  ) {
    try {
      this.validateTx(transaction);
    } catch (e) {
      throw new InvalidParamsError(e.message);
    }
    const header = await this.getBlockHeader(blockOpt);

    if (transaction.gas == undefined) {
      // If no gas limit is specified use the last block gas limit as an upper bound.
      transaction.gas = bigIntToHex(header.gasLimit);
    }

    const txType = BigInt(
      transaction.maxFeePerGas || transaction.maxPriorityFeePerGas
        ? 2
        : transaction.accessList
        ? 1
        : 0,
    );
    if (txType == BigInt(2)) {
      transaction.maxFeePerGas =
        transaction.maxFeePerGas || bigIntToHex(header.baseFeePerGas!);
    } else {
      if (
        transaction.gasPrice == undefined ||
        BigInt(transaction.gasPrice) === BigInt(0)
      ) {
        transaction.gasPrice = bigIntToHex(header.baseFeePerGas!);
      }
    }

    // TS not figuring out that the gasPrice is empty when txType is 2
    // @ts-ignore
    const txData:
      | TxData[TransactionType.Legacy]
      | TxData[TransactionType.AccessListEIP2930]
      | TxData[TransactionType.FeeMarketEIP1559] = {
      ...transaction,
      type: bigIntToHex(txType),
      gasLimit: transaction.gas as PrefixedHexString,
    };

    const tx = TransactionFactory.fromTxData(txData, {
      common: this.common,
      freeze: false,
    });

    const vm = await this.getVM(transaction, header);

    // set from address
    const from = transaction.from
      ? Address.fromString(transaction.from)
      : Address.zero();
    tx.getSenderAddress = () => {
      return from;
    };

    try {
      const { totalGasSpent } = await vm.runTx({
        tx,
        skipNonce: true,
        skipBalance: true,
        skipBlockGasLimitValidation: true,
        block: { header } as any,
      });
      return bigIntToHex(totalGasSpent);
    } catch (error: any) {
      throw new InternalError(error.message.toString());
    }
  }

  async getBlockByHash(blockHash: Bytes32, includeTransactions: boolean) {
    const header = await this.getBlockHeaderByHash(blockHash);
    const block = await this.getBlock(header);
    // TODO: fix total difficulty(TD), TD is not included in the header
    // and there is no way to verify TD
    return toJSONRPCBlock(block, BigInt(0), [], includeTransactions);
  }

  async getBlockByNumber(blockOpt: BlockOpt, includeTransactions: boolean) {
    const header = await this.getBlockHeader(blockOpt);
    const block = await this.getBlock(header);
    // TODO: fix total difficulty(TD), TD is not included in the header
    // and there is no way to verify TD
    return toJSONRPCBlock(block, BigInt(0), [], includeTransactions);
  }

  async sendRawTransaction(signedTx: string): Promise<string> {
    // TODO: broadcast tx directly to the mem pool?
    const { success } = await this.rpc.request({
      method: 'eth_sendRawTransaction',
      params: [signedTx],
    });

    if (!success) {
      throw new InternalError(`RPC request failed`);
    }

    const tx = TransactionFactory.fromSerializedData(hexToBytes(signedTx), {
      common: this.common,
    });
    return bytesToHex(tx.hash());
  }

  async getTransactionReceipt(txHash: Bytes32): Promise<JSONRPCReceipt | null> {
    const { result: receipt, success } = await this.rpc.request({
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    });
    if (!(success && receipt)) {
      return null;
    }
    const header = await this.getBlockHeader(receipt.blockNumber);
    const block = await this.getBlock(header);
    const index = block.transactions.findIndex(
      tx => bytesToHex(tx.hash()) === txHash.toLowerCase(),
    );
    if (index === -1) {
      throw new InternalError('the receipt provided by the RPC is invalid');
    }
    const tx = block.transactions[index];

    return {
      transactionHash: txHash,
      transactionIndex: bigIntToHex(index),
      blockHash: bytesToHex(block.hash()),
      blockNumber: bigIntToHex(block.header.number),
      from: tx.getSenderAddress().toString(),
      to: tx.to?.toString() ?? null,
      type: bigIntToHex(tx.type),
      // TODO: to verify the params below download all the tx receipts
      // of the block, compute the receipt root and verify the receipt
      // root matches that in the blockHeader
      cumulativeGasUsed: '0x0',
      effectiveGasPrice: '0x0',
      gasUsed: '0x0',
      contractAddress: null,
      logs: [],
      logsBloom: '0x0',
      status: BigInt(receipt.status) ? '0x1' : '0x0', // unverified!!
    };
  }

  private validateTx(tx: RPCTx) {
    if (tx.gasPrice !== undefined && tx.maxFeePerGas !== undefined) {
      throw new Error('Cannot send both gasPrice and maxFeePerGas params');
    }

    if (tx.gasPrice !== undefined && tx.maxPriorityFeePerGas !== undefined) {
      throw new Error('Cannot send both gasPrice and maxPriorityFeePerGas');
    }

    if (
      tx.maxFeePerGas !== undefined &&
      tx.maxPriorityFeePerGas !== undefined &&
      BigInt(tx.maxPriorityFeePerGas) > BigInt(tx.maxFeePerGas)
    ) {
      throw new Error(
        `maxPriorityFeePerGas (${tx.maxPriorityFeePerGas.toString()}) is bigger than maxFeePerGas (${tx.maxFeePerGas.toString()})`,
      );
    }
  }

  private async getBlock(header: BlockHeader) {
    const { result: blockInfo, success } = await this.rpc.request({
      method: 'eth_getBlockByNumber',
      params: [bigIntToHex(header.number), true],
    });

    if (!success) {
      throw new InternalError(`RPC request failed`);
    }
    // TODO: add support for uncle headers; First fetch all the uncles
    // add it to the blockData, verify the uncles and use it
    const blockData = blockDataFromWeb3Response(blockInfo);
    const block = Block.fromBlockData(blockData, { common: this.common });

    if (!equalsBytes(block.header.hash(), header.hash())) {
      throw new InternalError(
        `BN(${header.number}): blockhash doesn't match the blockData provided by the RPC`,
      );
    }

    // TODO: block.validateBlobTransactions(), etc.?
    if (!(await block.transactionsTrieIsValid())) {
      throw new InternalError(
        `transactionTree doesn't match the transactions provided by the RPC`,
      );
    }

    return block;
  }

  private async getBlockHeader(blockOpt: BlockOpt): Promise<BlockHeader> {
    const blockNumber = this.getBlockNumberByBlockOpt(blockOpt);
    await this.waitForBlockNumber(blockNumber);
    const blockHash = await this.getBlockHash(blockNumber);
    return this.getBlockHeaderByHash(blockHash);
  }

  private async waitForBlockNumber(blockNumber: bigint) {
    if (blockNumber <= this.latestBlockNumber) return;
    log.debug(`waiting for blockNumber ${blockNumber}`);
    const blockNumberHex = bigIntToHex(blockNumber);
    if (!(blockNumberHex in this.blockPromises)) {
      let r: () => void = () => {};
      const p = new Promise<void>(resolve => {
        r = resolve;
      });
      this.blockPromises[blockNumberHex] = {
        promise: p,
        resolve: r,
      };
    }
    return this.blockPromises[blockNumberHex].promise;
  }

  private getBlockNumberByBlockOpt(blockOpt: BlockOpt): bigint {
    // TODO: add support for blockOpts below
    if (
      typeof blockOpt === 'string' &&
      ['pending', 'earliest', 'finalized', 'safe'].includes(blockOpt)
    ) {
      throw new InvalidParamsError(`"pending" is not yet supported`);
    } else if (blockOpt === 'latest') {
      return this.latestBlockNumber;
    } else {
      const blockNumber = BigInt(blockOpt as any);
      if (blockNumber > this.latestBlockNumber + MAX_BLOCK_FUTURE) {
        throw new InvalidParamsError('specified block is too far in future');
      } else if (blockNumber + MAX_BLOCK_HISTORY < this.latestBlockNumber) {
        throw new InvalidParamsError(
          `specified block (${blockNumber}) cannot be older that ${MAX_BLOCK_HISTORY}`,
        );
      }
      return blockNumber;
    }
  }

  private async getVMCopy(): Promise<VM> {
    if (this.vm === null) {
      const blockchain = await Blockchain.create({ common: this.common });
      // path the blockchain to return the correct blockhash
      (blockchain as any).getBlock = async (blockId: number) => {
        const _hash = hexToBytes(await this.getBlockHash(BigInt(blockId)));
        return {
          hash: () => _hash,
        };
      };
      this.vm = await VM.create({ common: this.common, blockchain });
    }
    return await this.vm!.shallowCopy();
  }

  private async getVM(tx: RPCTx, header: BlockHeader): Promise<VM> {
    const _tx = {
      to: tx.to,
      from: tx.from ? tx.from : ZERO_ADDR,
      data: tx.data,
      value: tx.value,
      gasPrice: tx.gasPrice,
      gas: tx.gas ? tx.gas : bigIntToHex(header.gasLimit!),
    };
    const { result, success } = await this.rpc.request({
      method: 'eth_createAccessList',
      params: [_tx, bigIntToHex(header.number)],
    });

    if (!success) {
      throw new InternalError(`RPC request failed`);
    }

    const accessList = result.accessList as AccessList;
    accessList.push({ address: _tx.from, storageKeys: [] });
    if (_tx.to && !accessList.some(a => a.address.toLowerCase() === _tx.to)) {
      accessList.push({ address: _tx.to, storageKeys: [] });
    }

    const vm = await this.getVMCopy();
    await vm.stateManager.checkpoint();

    const requests = accessList
      .map(access => {
        return [
          {
            method: 'eth_getProof',
            params: [
              access.address,
              access.storageKeys,
              bigIntToHex(header.number),
            ],
          },
          {
            method: 'eth_getCode',
            params: [access.address, bigIntToHex(header.number)],
          },
        ];
      })
      .flat();
    const rawResponse = await this.rpc.requestBatch(requests);
    if (rawResponse.some(r => !r.success)) {
      throw new InternalError(`RPC request failed`);
    }
    const responses = _.chunk(
      rawResponse.map(r => r.result),
      2,
    ) as [AccountResponse, CodeResponse][];

    for (let i = 0; i < accessList.length; i++) {
      const { address: addressHex, storageKeys } = accessList[i];
      const [accountProof, code] = responses[i];
      const {
        nonce,
        balance,
        codeHash,
        storageProof: storageAccesses,
      } = accountProof;
      const address = Address.fromString(addressHex);

      const isAccountCorrect = await this.verifyProof(
        address,
        storageKeys,
        header.stateRoot,
        accountProof,
      );
      if (!isAccountCorrect) {
        throw new InternalError(`invalid account proof provided by the RPC`);
      }

      const isCodeCorrect = this.verifyCodeHash(code, codeHash);
      if (!isCodeCorrect) {
        throw new InternalError(
          `code provided by the RPC doesn't match the account's codeHash`,
        );
      }

      const account = Account.fromAccountData({
        nonce: BigInt(nonce),
        balance: BigInt(balance),
        codeHash: codeHash as PrefixedHexString,
      });

      await vm.stateManager.putAccount(address, account);

      for (let storageAccess of storageAccesses) {
        await vm.stateManager.putContractStorage(
          address,
          setLengthLeft(hexToBytes(storageAccess.key), 32),
          setLengthLeft(hexToBytes(storageAccess.value), 32),
        );
      }

      if (code !== '0x')
        await vm.stateManager.putContractCode(address, hexToBytes(code));
    }
    await vm.stateManager.commit();
    return vm;
  }

  private async getBlockHash(blockNumber: bigint) {
    if (blockNumber > this.latestBlockNumber)
      throw new Error('cannot return blockhash for a blocknumber in future');
    // TODO: fetch the blockHeader in batched request
    let lastVerifiedBlockNumber = this.latestBlockNumber;
    while (lastVerifiedBlockNumber > blockNumber) {
      const hash = this.blockHashes[bigIntToHex(lastVerifiedBlockNumber)];
      const header = await this.getBlockHeaderByHash(hash);
      lastVerifiedBlockNumber--;
      const parentBlockHash = bytesToHex(header.parentHash);
      const parentBlockNumberHex = bigIntToHex(lastVerifiedBlockNumber);
      if (
        parentBlockNumberHex in this.blockHashes &&
        this.blockHashes[parentBlockNumberHex] !== parentBlockHash
      ) {
        log.warn(
          'Overriding an existing verified blockhash. Possibly the chain had a reorg',
        );
      }
      this.blockHashes[parentBlockNumberHex] = parentBlockHash;
    }

    return this.blockHashes[bigIntToHex(blockNumber)];
  }

  private async getBlockHeaderByHash(blockHash: Bytes32) {
    if (!this.blockHeaders[blockHash]) {
      const { result: blockInfo, success } = await this.rpc.request({
        method: 'eth_getBlockByHash',
        params: [blockHash, true],
      });

      if (!success) {
        throw new InternalError(`RPC request failed`);
      }

      const headerData = headerDataFromWeb3Response(blockInfo);
      const header = new BlockHeader(headerData, { common: this.common });
      if (!equalsBytes(header.hash(), hexToBytes(blockHash))) {
        throw new InternalError(
          `blockhash doesn't match the blockInfo provided by the RPC`,
        );
      }
      this.blockHeaders[blockHash] = header;
    }
    return this.blockHeaders[blockHash];
  }

  private verifyCodeHash(code: Bytes, codeHash: Bytes32): boolean {
    return (
      (code === '0x' && codeHash === KECCAK256_NULL_S) ||
      (code === '0x' && codeHash === ZERO_HASH) || // TODO: add comment to explain
      Web3.utils.keccak256(code) === codeHash
    );
  }

  private async verifyProof(
    address: Address,
    storageKeys: Bytes32[],
    stateRoot: Uint8Array,
    proof: GetProof,
  ): Promise<boolean> {
    const trie = new Trie();
    const key = Web3.utils.keccak256(address.toString());
    const expectedAccountRLP = await trie.verifyProof(
      Buffer.from(stateRoot),
      hexToBytes(key),
      proof.accountProof.map(a => hexToBytes(a)),
    );
    const account = Account.fromAccountData({
      nonce: BigInt(proof.nonce),
      balance: BigInt(proof.balance),
      storageRoot: (proof.storageHash === ZERO_HASH
        ? KECCAK256_RLP_S
        : proof.storageHash) as PrefixedHexString,
      codeHash: (proof.codeHash === ZERO_HASH
        ? KECCAK256_NULL_S
        : proof.codeHash) as PrefixedHexString,
    });
    const isAccountValid = equalsBytes(
      account.serialize(),
      expectedAccountRLP ?? emptyAccountRLP,
    );

    if (!isAccountValid) return false;

    for (let i = 0; i < storageKeys.length; i++) {
      const sp = proof.storageProof[i];
      const key = Web3.utils.keccak256(
        bytesToHex(setLengthLeft(hexToBytes(storageKeys[i]), 32)),
      );
      const expectedStorageRLP = await trie.verifyProof(
        hexToBytes(proof.storageHash),
        hexToBytes(key),
        sp.proof.map(a => hexToBytes(a)),
      );
      const isStorageValid =
        (!expectedStorageRLP && sp.value === '0x0') ||
        (!!expectedStorageRLP &&
          equalsBytes(expectedStorageRLP, rlp.encode(sp.value)));
      if (!isStorageValid) return false;
    }

    return true;
  }
}

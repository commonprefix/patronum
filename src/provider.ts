import _ from 'lodash';
import Web3 from 'web3';
import { Trie } from '@ethereumjs/trie';
import rlp from 'rlp';
import { Common, Chain } from '@ethereumjs/common';
import {
  Address,
  Account,
  toType,
  bufferToHex,
  toBuffer,
  TypeOutput,
  setLengthLeft,
  KECCAK256_NULL_S,
} from '@ethereumjs/util';
import { VM } from '@ethereumjs/vm';
import { BlockHeader, Block } from '@ethereumjs/block';
import { Blockchain } from '@ethereumjs/blockchain';
import { TransactionFactory } from '@ethereumjs/tx';
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
} from './types';
import { InternalError, InvalidParamsError } from './errors';
import log from './logger';
import {
  ZERO_ADDR,
  MAX_BLOCK_HISTORY,
  MAX_BLOCK_FUTURE,
  DEFAULT_BLOCK_PARAMETER,
} from './constants';
import {
  headerDataFromWeb3Response,
  blockDataFromWeb3Response,
  toJSONRPCBlock,
} from './utils';
import { RPC } from './rpc';

const bigIntToHex = (n: string | bigint | number): string =>
  '0x' + BigInt(n).toString(16);

const emptyAccountSerialize = new Account().serialize();

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
  ) {
    this.rpc = new RPC({ URL: providerURL });
    this.common = new Common({
      chain,
      // hardfork: Hardfork.ArrowGlacier,
    });
    const _blockNumber = BigInt(blockNumber);
    this.latestBlockNumber = _blockNumber;
    this.blockHashes[bigIntToHex(_blockNumber)] = blockHash;
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

    const isCodeCorrect = await this.verifyCodeHash(
      code,
      accountProof.codeHash,
    );
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
        data: data ? toBuffer(data) : undefined,
        block: { header },
      };
      const { execResult } = await vm.evm.runCall(runCallOpts);

      return bufferToHex(execResult.returnValue);
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

    const txData = {
      ...transaction,
      type: bigIntToHex(txType),
      gasLimit: transaction.gas,
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
    // TODO: brodcast tx directly to the mem pool?
    const { success } = await this.rpc.request({
      method: 'eth_sendRawTransaction',
      params: [signedTx],
    });

    if (!success) {
      throw new InternalError(`RPC request failed`);
    }

    const tx = TransactionFactory.fromSerializedData(toBuffer(signedTx), {
      common: this.common,
    });
    return bufferToHex(tx.hash());
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
      tx => bufferToHex(tx.hash()) === txHash.toLowerCase(),
    );
    if (index === -1) {
      throw new InternalError('the recipt provided by the RPC is invalid');
    }
    const tx = block.transactions[index];

    return {
      transactionHash: txHash,
      transactionIndex: bigIntToHex(index),
      blockHash: bufferToHex(block.hash()),
      blockNumber: bigIntToHex(block.header.number),
      from: tx.getSenderAddress().toString(),
      to: tx.to?.toString() ?? null,
      // TODO: to verify the params below download all the tx recipts
      // of the block, compute the recipt root and verify the recipt
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

    if (!block.header.hash().equals(header.hash())) {
      throw new InternalError(
        `BN(${header.number}): blockhash doest match the blockData provided by the RPC`,
      );
    }

    if (!(await block.validateTransactionsTrie())) {
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
          `specified block cannot older that ${MAX_BLOCK_HISTORY}`,
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
        const _hash = toBuffer(await this.getBlockHash(BigInt(blockId)));
        return {
          hash: () => _hash,
        };
      };
      this.vm = await VM.create({ common: this.common, blockchain });
    }
    return await this.vm!.copy();
  }

  private async getVM(tx: RPCTx, header: BlockHeader): Promise<VM> {
    // forcefully set gasPrice to 0 to avoid not enough balance error
    const _tx = {
      to: tx.to,
      from: tx.from ? tx.from : ZERO_ADDR,
      data: tx.data,
      value: tx.value,
      gasPrice: '0x0',
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

      const isCodeCorrect = await this.verifyCodeHash(code, codeHash);
      if (!isCodeCorrect) {
        throw new InternalError(
          `code provided by the RPC doesn't match the account's codeHash`,
        );
      }

      const account = Account.fromAccountData({
        nonce: BigInt(nonce),
        balance: BigInt(balance),
        codeHash,
      });

      await vm.stateManager.putAccount(address, account);

      for (let storageAccess of storageAccesses) {
        await vm.stateManager.putContractStorage(
          address,
          setLengthLeft(toBuffer(storageAccess.key), 32),
          setLengthLeft(toBuffer(storageAccess.value), 32),
        );
      }

      if (code !== '0x')
        await vm.stateManager.putContractCode(address, toBuffer(code));
    }
    await vm.stateManager.commit();
    return vm;
  }

  private async getBlockHash(blockNumber: bigint) {
    if (blockNumber > this.latestBlockNumber)
      throw new Error('cannot return blockhash for a blocknumber in future');
    // TODO: fetch the blockHeader is batched request
    let lastVerifiedBlockNumber = this.latestBlockNumber;
    while (lastVerifiedBlockNumber > blockNumber) {
      const hash = this.blockHashes[bigIntToHex(lastVerifiedBlockNumber)];
      const header = await this.getBlockHeaderByHash(hash);
      lastVerifiedBlockNumber--;
      const parentBlockHash = bufferToHex(header.parentHash);
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
      const header = BlockHeader.fromHeaderData(headerData);

      if (!header.hash().equals(toBuffer(blockHash))) {
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
      (code === '0x' && codeHash === '0x' + KECCAK256_NULL_S) ||
      Web3.utils.keccak256(code) === codeHash
    );
  }

  private async verifyProof(
    address: Address,
    storageKeys: Bytes32[],
    stateRoot: Buffer,
    proof: GetProof,
  ): Promise<boolean> {
    const trie = new Trie();
    const key = Web3.utils.keccak256(address.toString());
    const expectedAccountRLP = await trie.verifyProof(
      stateRoot,
      toBuffer(key),
      proof.accountProof.map(a => toBuffer(a)),
    );
    const account = Account.fromAccountData({
      nonce: BigInt(proof.nonce),
      balance: BigInt(proof.balance),
      storageRoot: proof.storageHash,
      codeHash: proof.codeHash,
    });
    const isAccountValid = account
      .serialize()
      .equals(expectedAccountRLP ? expectedAccountRLP : emptyAccountSerialize);
    if (!isAccountValid) return false;

    for (let i = 0; i < storageKeys.length; i++) {
      const sp = proof.storageProof[i];
      const key = Web3.utils.keccak256(
        bufferToHex(setLengthLeft(toBuffer(storageKeys[i]), 32)),
      );
      const expectedStorageRLP = await trie.verifyProof(
        toBuffer(proof.storageHash),
        toBuffer(key),
        sp.proof.map(a => toBuffer(a)),
      );
      const isStorageValid =
        (!expectedStorageRLP && sp.value === '0x0') ||
        (!!expectedStorageRLP &&
          expectedStorageRLP.equals(rlp.encode(sp.value)));
      if (!isStorageValid) return false;
    }

    return true;
  }
}

import http from 'http';
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
  isTruthy,
  isFalsy,
  KECCAK256_NULL_S,
} from '@ethereumjs/util';
import { VM } from '@ethereumjs/vm';
import { BlockHeader, Block } from '@ethereumjs/block';
import { Blockchain } from '@ethereumjs/blockchain';
import { Transaction, TransactionFactory } from '@ethereumjs/tx';
import {
  AddressHex,
  Bytes32,
  RPCTx,
  Request,
  AccountRequest,
  CodeRequest,
  Response,
  AccountResponse,
  CodeResponse,
  RequestMethodCallback,
  Bytes,
  GetProof,
  BlockNumber as BlockOpt,
  Method,
  HexString,
  JsonRpcReceipt
} from './types';
import {
  ZERO_ADDR,
  GAS_LIMIT,
  REQUEST_BATCH_SIZE,
  MAX_BLOCK_HISTORY,
  INTERNAL_ERROR,
  INVALID_PARAMS,
  MAX_SOCKET,
} from './constants';
import {
  headerDataFromWeb3Response,
  blockDataFromWeb3Response,
  toJSONRPCBlock,
} from './utils';

const bigIntToHex = (n: string | bigint): string =>
  '0x' + BigInt(n).toString(16);

const emptyAccountSerialize = new Account().serialize();

// TODO: handle fallback if RPC fails
// TODO: if anything is accessed outside the accesslist the provider
// should throw error
export class VerifyingProvider {
  web3: Web3;
  common: Common;

  private blockHashes: { [blockNumberHex: string]: Bytes32 } = {};
  private blockHeaders: { [blockHash: string]: BlockHeader } = {};
  private latestBlockNumber: bigint;

  private requestTypeToMethod: Record<
    Request['type'],
    (request: Request, callback: RequestMethodCallback) => Method
  > = {
    // Type errors ignored due to https://github.com/ChainSafe/web3.js/issues/4655
    account: (request: AccountRequest, callback) =>
      // @ts-ignore
      this.web3.eth.getProof.request(
        request.addressHex,
        request.storageSlots,
        bigIntToHex(request.blockNumber),
        callback,
      ),
    code: (request: CodeRequest, callback) =>
      // @ts-ignore
      this.web3.eth.getCode.request(
        request.addressHex,
        bigIntToHex(request.blockNumber),
        callback,
      ),
  };

  constructor(
    providerURL: string,
    blockNumber: bigint | number,
    blockHash: Bytes32,
    chain: bigint | Chain = Chain.Mainnet,
  ) {
    this.web3 = new Web3(
      new Web3.providers.HttpProvider(providerURL, {
        keepAlive: true,
        agent: {
          http: new http.Agent({ keepAlive: true, maxSockets: MAX_SOCKET }),
        },
      }),
    );
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
      console.log(
        'Overriding an existing verified blockhash. Possibly the chain had a reorg',
      );
    }
    this.latestBlockNumber = blockNumber;
    this.blockHashes[blockNumberHex] = blockHash;
  }

  async getBalance(addressHex: AddressHex, blockOpt: BlockOpt) {
    const header = await this.getBlockHeader(blockOpt);
    const address = Address.fromString(addressHex);
    const proof = await this.web3.eth.getProof(
      addressHex,
      [],
      bigIntToHex(header.number),
    );
    const isAccountCorrect = await this.verifyProof(
      address,
      [],
      header.stateRoot,
      proof,
    );
    if (!isAccountCorrect) {
      throw {
        error: INTERNAL_ERROR,
        message: `invalid account proof provided by the RPC`,
      };
    }

    return this.web3.utils.numberToHex(proof.balance);
  }

  blockNumber(): HexString {
    return bigIntToHex(this.latestBlockNumber);
  }

  chainId(): HexString {
    return bigIntToHex(this.common.chainId());
  }

  async getCode(
    addressHex: AddressHex,
    blockOpt: BlockOpt,
  ): Promise<HexString> {
    const header = await this.getBlockHeader(blockOpt);
    const [accountProof, code] = (await this.fetchRequests([
      {
        type: 'account',
        blockNumber: header.number,
        storageSlots: [],
        addressHex,
      },
      {
        type: 'code',
        blockNumber: header.number,
        addressHex,
      },
    ])) as [AccountResponse, CodeResponse];

    const address = Address.fromString(addressHex);
    const isAccountCorrect = await this.verifyProof(
      address,
      [],
      header.stateRoot,
      accountProof,
    );
    if (!isAccountCorrect) {
      throw {
        error: INTERNAL_ERROR,
        message: `invalid account proof provided by the RPC`,
      };
    }

    const isCodeCorrect = await this.verifyCodeHash(
      code,
      accountProof.codeHash,
    );
    if (!isCodeCorrect) {
      throw {
        error: INTERNAL_ERROR,
        message: `code privided by the RPC doesn't match the account's codeHash`,
      };
    }

    return code;
  }

  async getTransactionCount(
    addressHex: AddressHex,
    blockOpt: BlockOpt,
  ): Promise<HexString> {
    const header = await this.getBlockHeader(blockOpt);
    const address = Address.fromString(addressHex);
    const proof = await this.web3.eth.getProof(
      addressHex,
      [],
      bigIntToHex(header.number),
    );

    const isAccountCorrect = await this.verifyProof(
      address,
      [],
      header.stateRoot,
      proof,
    );
    if (!isAccountCorrect) {
      throw {
        error: INTERNAL_ERROR,
        message: `invalid account proof provided by the RPC`,
      };
    }

    return bigIntToHex(proof.nonce.toString());
  }

  async call(transaction: RPCTx, blockOpt: BlockOpt) {
    const header = await this.getBlockHeader(blockOpt);
    const vm = await this.getVM(transaction, header.number, header.stateRoot);
    const { from, to, gas: gasLimit, gasPrice, value, data } = transaction;
    try {
      const runCallOpts = {
        caller: isTruthy(from) ? Address.fromString(from) : undefined,
        to: isTruthy(to) ? Address.fromString(to) : undefined,
        gasLimit: toType(gasLimit, TypeOutput.BigInt),
        gasPrice: toType(gasPrice, TypeOutput.BigInt),
        value: toType(value, TypeOutput.BigInt),
        data: isTruthy(data) ? toBuffer(data) : undefined,
        block: { header },
      };
      const { execResult } = await vm.evm.runCall(runCallOpts);
      return bufferToHex(execResult.returnValue);
    } catch (error: any) {
      throw {
        code: INTERNAL_ERROR,
        message: error.message.toString(),
      };
    }
  }

  async estimateGas(transaction: RPCTx, blockOpt: BlockOpt) {
    const header = await this.getBlockHeader(blockOpt);
    if (isFalsy(transaction.gas)) {
      // If no gas limit is specified use the last block gas limit as an upper bound.
      transaction.gas = GAS_LIMIT;
    }
    const txData = { ...transaction, gasLimit: transaction.gas };
    const tx = Transaction.fromTxData(txData, {
      common: this.common,
      freeze: false,
    });

    const vm = await this.getVM(transaction, header.number, header.stateRoot);

    // set from address
    const from = isTruthy(transaction.from)
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
      });
      return `0x${totalGasSpent.toString(16)}`;
    } catch (error: any) {
      throw {
        code: INTERNAL_ERROR,
        message: error.message.toString(),
      };
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
    this.web3.eth.sendSignedTransaction(signedTx).on('error', (err) => console.error(err));
    const tx = TransactionFactory.fromSerializedData(toBuffer(signedTx), {common: this.common});
    return bufferToHex(tx.hash());
  }

  async getTransactionReceipt(txHash: Bytes32): Promise<JsonRpcReceipt | null> {
    const receipt = await this.web3.eth.getTransactionReceipt(txHash);
    if(!receipt) {
      return null;
    }
    const header = await this.getBlockHeader(receipt.blockNumber);
    const block = await this.getBlock(header);
    const index = block.transactions.findIndex(tx => bufferToHex(tx.hash()) === txHash.toLowerCase());
    if(index === -1) {
      throw {
        code: INTERNAL_ERROR,
        message: 'the recipt provided by the RPC is invalid',
      };
    }
    const tx = block.transactions[index];

    return {
      transactionHash: txHash,
      transactionIndex: this.web3.utils.numberToHex(index),
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
      status: '0x1'
    }
  }

  private async getBlock(
    header: BlockHeader
  ) {
    const blockInfo = await this.web3.eth.getBlock(
      parseInt(header.number.toString()),
      true,
    );
    // TODO: add support for uncle headers; First fetch all the uncles
    // add it to the blockData, verify the uncles and use it
    const blockData = blockDataFromWeb3Response(blockInfo);
    const block = Block.fromBlockData(blockData, { common: this.common });

    if (!block.header.hash().equals(header.hash())) {
      throw {
        error: INTERNAL_ERROR,
        message: `blockhash doest match the blockData provided by the RPC`,
      };
    }

    if (!(await block.validateTransactionsTrie())) {
      throw {
        error: INTERNAL_ERROR,
        message: `transactionTree doesn't match the transactions privided by the RPC`,
      };
    }

    return block;
  }

  private async getBlockHeader(blockOpt: BlockOpt): Promise<BlockHeader> {
    const blockNumber = this.getBlockNumberByBlockOpt(blockOpt);
    const blockHash = await this.getBlockHash(blockNumber);
    return this.getBlockHeaderByHash(blockHash);
  }

  private getBlockNumberByBlockOpt(blockOpt: BlockOpt): bigint {
    // TODO: add support for blockOpts below
    if (
      typeof blockOpt === 'string' &&
      ['pending', 'earliest', 'finalized', 'safe'].includes(blockOpt)
    ) {
      throw {
        code: INVALID_PARAMS,
        message: `"pending" is not yet supported`,
      };
    } else if (blockOpt === 'latest') {
      return this.latestBlockNumber;
    } else {
      const blockNumber = BigInt(blockOpt as any);
      if (blockNumber > this.latestBlockNumber) {
        throw {
          code: INVALID_PARAMS,
          message: 'specified block greater than current height',
        };
      } else if (blockNumber + MAX_BLOCK_HISTORY < this.latestBlockNumber) {
        throw {
          code: INVALID_PARAMS,
          message: `specified block cannot older that ${MAX_BLOCK_HISTORY}`,
        };
      }
      return blockNumber;
    }
  }

  private constructRequestMethod(
    request: Request,
    callback: (error: Error, data: Response) => void,
  ): Method {
    return this.requestTypeToMethod[request.type](request, callback);
  }

  private async fetchRequests(requests: Request[]) {
    const batch = new this.web3.BatchRequest();
    const promises = requests.map(request => {
      return new Promise<Response>((resolve, reject) => {
        // Type error ignored due to https://github.com/ChainSafe/web3.js/issues/4655
        const method = this.constructRequestMethod(
          request,
          (error: Error, data: Response) => {
            if (error) reject(error);
            resolve(data);
          },
        );
        batch.add(method);
      });
    });
    batch.execute();
    return Promise.all(promises);
  }

  private async fetchRequestsInBatches(
    requests: Request[],
    batchSize: number,
  ): Promise<Response[]> {
    const batchedRequests = _.chunk(requests, batchSize);
    // const tasks = batchedRequests.map(requestBatch =>
    //   this.fetchRequests(requestBatch),
    // );
    // return flatten((await async.parallelLimit(tasks, RPC_PARALLEL_LIMIT)) as any);
    const results: Response[] = [];
    for (const requestBatch of batchedRequests) {
      const res = await this.fetchRequests(requestBatch);
      results.push(...res);
    }
    return results;
  }

  private async getVM(
    tx: RPCTx,
    blockNumber: bigint,
    stateRoot: Buffer,
  ): Promise<VM> {
    const _tx = {
      ...tx,
      from: tx.from ? tx.from : ZERO_ADDR,
      gas: tx.gas ? tx.gas : GAS_LIMIT,
    };

    const { accessList } = await this.web3.eth.createAccessList(
      _tx,
      bigIntToHex(blockNumber),
    );
    accessList.push({ address: _tx.from, storageKeys: [] });
    if (_tx.to && !accessList.some(a => a.address.toLowerCase() === _tx.to)) {
      accessList.push({ address: _tx.to, storageKeys: [] });
    }

    const blockchain = await Blockchain.create({ common: this.common });
    // path the blockchain to return the correct blockhash
    (blockchain as any).getBlock = async (blockId: number) => {
      const _hash = toBuffer(await this.getBlockHash(BigInt(blockId)));
      return {
        hash: () => _hash,
      };
    };
    const vm = await VM.create({ common: this.common, blockchain });

    await vm.stateManager.checkpoint();

    const requests = accessList
      .map(access => {
        return [
          {
            type: 'account',
            blockNumber,
            storageSlots: access.storageKeys,
            addressHex: access.address,
          },
          {
            type: 'code',
            blockNumber,
            addressHex: access.address,
          },
        ];
      })
      .flat() as Request[];
    const responses = _.chunk(
      await this.fetchRequestsInBatches(requests, REQUEST_BATCH_SIZE),
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
        stateRoot,
        accountProof,
      );
      if (!isAccountCorrect) {
        throw {
          error: INTERNAL_ERROR,
          message: `invalid account proof provided by the RPC`,
        };
      }

      const isCodeCorrect = await this.verifyCodeHash(code, codeHash);
      if (!isCodeCorrect) {
        throw {
          error: INTERNAL_ERROR,
          message: `code privided by the RPC doesn't match the account's codeHash`,
        };
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
        console.log(
          'Overriding an existing verified blockhash. Possibly the chain had a reorg',
        );
      }
      this.blockHashes[parentBlockNumberHex] = parentBlockHash;
    }

    return this.blockHashes[bigIntToHex(blockNumber)];
  }

  private async getBlockHeaderByHash(blockHash: Bytes32) {
    if (!this.blockHeaders[blockHash]) {
      const blockInfo = await this.web3.eth.getBlock(blockHash);
      const headerData = headerDataFromWeb3Response(blockInfo);
      const header = BlockHeader.fromHeaderData(headerData);

      if (!header.hash().equals(toBuffer(blockHash))) {
        throw {
          error: INTERNAL_ERROR,
          message: `blockhash doesn't match the blockInfo provided by the RPC`,
        };
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
      stateRoot: proof.storageHash,
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

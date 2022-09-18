import http from 'http';
import Web3 from "web3"
import { MAX_SOCKET } from './constants';
import { RequestMethodCallback, Method, AccountRequest, CodeRequest, Bytes32, GetProof, BlockNumber, Request, Response, RPCTx } from "./types"
import { getEnv } from "./utils"
import { bigIntToHex } from "@ethereumjs/util"
import { Block } from 'web3-eth';
import _ from 'lodash';

export default class extends Web3 {
	constructor(providerURL?: string) {
		providerURL = providerURL || getEnv('RPC_URL')

		const providerOpts = {
			keepAlive: true,
			agent: {
				http: new http.Agent({ keepAlive: true, maxSockets: MAX_SOCKET }),
			},
		}

		const provider = new Web3.providers.HttpProvider(providerURL, providerOpts)
		super(provider)
	}

	public getBlock(hashOrNumber: BlockNumber, includeTx?: boolean): Promise<Block> {
		return this.eth.getBlock(hashOrNumber, includeTx || true)
	}

	public async createAccessList(tx: RPCTx , blockNumber: bigint) {
		const { accessList } = await this.eth.createAccessList(tx, bigIntToHex(blockNumber));
		return accessList
	}

	public async sendRawTransaction(signedTx: string) {
		const recipt = await this.eth.sendSignedTransaction(signedTx);
		return (recipt as any).transactionHash;
	}

	public getProof(addressHex: string, storageSlots: Bytes32[], blockNumber: bigint): Promise<GetProof> {
		//@ts-ignore
		return this.eth.getProof(addressHex, storageSlots, bigintToHex(blockNumber))
	}

	public getProofRequest(request: AccountRequest, callback: RequestMethodCallback): Method {
		//@ts-ignore
		return this.eth.getProof.request(
			request.addressHex,
			request.storageSlots,
			bigIntToHex(request.blockNumber),
			callback,
		)
	}

	public getCodeRequest(request: CodeRequest, callback: RequestMethodCallback): Method {
		//@ts-ignore
		return this.eth.getCode.request(
			request.addressHex,
			bigIntToHex(request.blockNumber),
			callback
		)
	}

	async fetchRequests(requests: Request[]) {
		const batch = new this.BatchRequest();
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

	async fetchRequestsInBatches(
		requests: Request[],
		batchSize: number,
	): Promise<Response[]> {
		const results: Response[] = [];
		const batchedRequests = _.chunk(requests, batchSize);

		for (const requestBatch of batchedRequests) {
			const res = await this.fetchRequests(requestBatch);
			results.push(...res);
		}
		return results;
	}

	private constructRequestMethod(request: Request, callback: RequestMethodCallback): Method {
		switch (request.type) {
			case 'account': return this.getProofRequest(request, callback);
			case 'code':    return this.getCodeRequest(request, callback);
		}
	}

}
import axios from 'axios';
import * as _ from 'lodash';
import { REQUEST_BATCH_SIZE } from './constants';

export type RPCRequest = {
  method: string;
  params: any[];
};

export type RPCRequestRaw = RPCRequest & {
  jsonrpc: string;
  id: string;
};

export type RPCResponse = {
  success: boolean;
  result: any;
};

export type ProviderConfig = {
  URL: string;
  unsupportedMethods?: string[];
  supportBatchRequests?: boolean;
  batchSize?: number;
};

export class RPC {
  constructor(protected provider: ProviderConfig) {}

  async request(request: RPCRequest) {
    if (this.provider.unsupportedMethods && this.provider.unsupportedMethods.includes(request.method)) {
      throw new Error('method not supported by the provider');
    }
    return await this._retryRequest(request);
  }

  async requestBatch(requests: RPCRequest[]) {
    if (this.provider.unsupportedMethods && requests.some(r => this.provider.unsupportedMethods!.includes(r.method))) {
      throw new Error('method not supported by the provider');
    }

    if (this.provider.supportBatchRequests) {
      const requestChunks = _.chunk(requests, this.provider.batchSize || REQUEST_BATCH_SIZE);
      const res = [];
      for (const chunk of requestChunks) {
        const batchRes = await this._retryBatch(chunk);
        res.push(batchRes);
      }
      return res.flat();
    } else {
      const res = [];
      for (const request of requests) {
        const r = await this._retryRequest(request);
        res.push(r);
      }
      return res;
    }
  }

  private async _retryRequest(_request: RPCRequest, retry = 5): Promise<RPCResponse> {
    const request = [
      {
        ..._request,
        jsonrpc: '2.0',
        id: this.generateId(),
      },
    ];

    for (let i = retry; i > 0; i--) {
      const res = await this._request(request);
      if (res[0].success) return res[0];
      else if (i == 1) {
        console.error(
          `RPC batch request failed after maximum retries: ${JSON.stringify(request, null, 2)} ${JSON.stringify(
            res[0],
            null,
            2,
          )}`,
        );
      }
    }
    throw new Error('RPC request failed');
  }

  private generateId(): string {
    return Math.floor(Math.random() * 2 ** 64).toFixed();
  }

  private async _retryBatch(_requests: RPCRequest[], retry = 5): Promise<RPCResponse[]> {
    let requestsRaw: RPCRequestRaw[] = _requests.map(r => ({
      ...r,
      jsonrpc: '2.0',
      id: this.generateId(),
    }));

    const results: { [id: string]: RPCResponse } = {};
    let requestsLeft = requestsRaw;
    for (let t = 0; t < retry; t++) {
      const res = await this._request(requestsLeft);
      let nextRequests: RPCRequestRaw[] = [];
      res.forEach((r, i) => {
        if (r.success) {
          results[requestsLeft[i].id] = r;
        } else {
          nextRequests.push(requestsLeft[i]);
        }
      });
      if (nextRequests.length === 0) break;
      requestsLeft = nextRequests;
    }

    const failedRequests = requestsRaw.map(r => !(r.id in results));
    if (failedRequests.length > 0) {
      console.error(`RPC batch request failed after maximum retries: ${JSON.stringify(requestsRaw, null, 2)}`);
      throw new Error('RPC request failed');
    }

    return requestsRaw.map(r => results[r.id]);
  }

  private async _request(requests: RPCRequestRaw[]): Promise<RPCResponse[]> {
    try {
      const response = await axios.post(this.provider.URL, requests.length === 1 ? requests[0] : requests);
      const results = requests.length === 1 ? [response.data] : response.data;
      return results.map((r: any) => ({
        success: !r.error,
        result: r.error || r.result,
      }));
    } catch (e) {
      return requests.map(_ => ({
        success: false,
        result: { message: `request failed: ${e}` },
      }));
    }
  }
}

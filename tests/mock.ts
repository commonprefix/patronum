import fs from 'fs';
import { resolve } from 'path';
import { RPC, RPCRequestRaw, RPCResponse } from '../src/rpc';
import { getHash } from './utils';

type FixtureContent = {
  requests: any;
  responses: any;
};

export class MockRPC extends RPC {
  protected async _request(requests: RPCRequestRaw[]): Promise<RPCResponse[]> {
    const hash = getHash(requests);
    const file = resolve(__dirname, `./fixtures/${hash}.json`);

    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file).toString();
      const { responses }: FixtureContent = JSON.parse(content);
      return responses;
    }

    const responses = await super._request(requests);
    const content = { requests, responses };
    fs.writeFileSync(file, JSON.stringify(content, null, 4));
    return responses;
  }
}

import crypto from 'crypto';
import { pick } from 'lodash';
import { Express } from 'express';
import request from 'supertest';

export function getHash(content: any) {
  const stringified = JSON.stringify(
    content.map((c: Array<any>) => pick(c, 'method', 'params')),
  );
  const hash = crypto.createHash('md5').update(stringified).digest('hex');
  return hash;
}

export function RPCClient(app: Express) {
  return function (method: string, params: any[] = []) {
    return request(app).post('/').set('Content-Type', 'application/json').send({
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: 10,
    });
  };
}

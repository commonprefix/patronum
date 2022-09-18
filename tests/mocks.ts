import fs from 'fs'
import { resolve } from 'path'
import { Request } from '../src/types'
import RPC from '../src/rpc'
import { BlockNumber, RPCTx } from '../src/types'
import { createHash } from 'crypto'

const rpc = new RPC('')
const md5 = (m: string) => createHash('md5').update(m).digest('hex')

export const getBlock = async (hash: BlockNumber) => {
	const file  = resolve(__dirname, `./fixtures/blocks/${hash}.json`)
	return createOrReadFixture(file, rpc.getBlock, [hash])
}

export const createAccessList = async (from: RPCTx, blockOpt: bigint) => {
	const hash = md5(from.toString() + blockOpt?.toString())
	const file  = resolve(__dirname, `./fixtures/accessList/${hash}.json`)
	return createOrReadFixture(file, rpc.createAccessList, [from, blockOpt])
}

export const fetchRequests = async (requests: Request[]) => {
	const hash = md5(JSON.stringify(requests.map(r => r.addressHex)))
	const file  = resolve(__dirname, `./fixtures/fetchRequests/${hash}.json`)
	return createOrReadFixture(file, rpc.fetchRequests, [requests])
}

export const call = async (tx: RPCTx, blockNumber: number) => {
	const hash = md5(JSON.stringify(tx) + blockNumber)
	const file  = resolve(__dirname, `./fixtures/call/${hash}.json`)
	return createOrReadFixture(file, rpc.eth.call, [tx, blockNumber])
}

export const getProof = async (address: string, storageKey: any[], blockNumber: bigint) => {
	const hash = md5(address + blockNumber)
	const file  = resolve(__dirname, `./fixtures/getProof/${hash}.json`)
	return createOrReadFixture(file, rpc.getProof, [address, storageKey, blockNumber])
}

export const createOrReadFixture = async (file: string, fn: Function, args: any[]) => {
	if (fs.existsSync(file)) {
		const content = fs.readFileSync(file).toString()
		return JSON.parse(content)
	}

	const res = await fn.bind(rpc)(...args)
	fs.writeFileSync(file, JSON.stringify(res, null, 4));
	return res
}

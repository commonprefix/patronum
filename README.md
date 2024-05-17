# Patronum

Ethereum RPC proxy that verifies RPC responses against given trusted block hashes. Currently, most of the DAPPs and Wallets interact with Ethereum over RPC. Patronum can be used as a building block to build light clients that retrofit into the existing Ethereum infrastructure. This library mainly takes advantage of the `eth_getProof` RPC to perform merkle inclusion proofs for RPC call verification.

<div style='border-radius: 512px; width: 512px; height: 512px; overflow: hidden; margin: auto;'>
    <a title="frostnova, CC BY 2.0 &lt;https://creativecommons.org/licenses/by/2.0&gt;, via Wikimedia Commons" href="https://commons.wikimedia.org/wiki/File:Patronus.jpg"><img width="512" alt="Patronus" src="https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/Patronus.jpg/512px-Patronus.jpg"></a> 
</div>

#### Start RPC Provider

```ts
import { VerifyingProvider, startServer } from 'patronum';

const provider = await VerifyingProvider.create(
  trustlessRPCURL,
  trustedBlockNumber,
  trustedBlockHash,
);
await startServer(provider, PORT);
```

#### Use VerifyingProvider

```ts
import { VerifyingProvider } from 'patronum';

const provider = await VerifyingProvider.create(
  trustlessRPCURL,
  trustedBlockNumber,
  trustedBlockHash,
);

console.log(await provider.getBalance(address, blockTag));

console.log(await provider.call(tx));
```

**The RPC URL provided to VerifyingProvider should support `eth_getProof` and `eth_createAccessList`. Infura doesn't support `eth_createAccessList`.**

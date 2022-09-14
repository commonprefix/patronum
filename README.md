### Patronum
Ethereum RPC proxy that verifies RPC responses against given trusted block hashes. Currently, most of the DAPPs and Wallets interact with Ethereum over RPC. Verifying RPC proxy can be used as a building block to build light clients that retrofit the existing Ethereum infrastructure. This proxy mainly takes advantage of the `eth_getProof` RPC to perform merkle inclusion proofs for RPC call verification. 



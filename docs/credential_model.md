# Credential Model and Eligibility-Set Design

For this Credential-Gated Anonymous Voting MVP, we implement a private membership proof to restrict voting to authorized individuals without exposing their identities.

## Concrete Credential Type
We use a **Merkle-Proof of Inclusion in a Private Allowlist of Eligible Credentials**.
- **Reasoning**:
  - Decentralized and self-contained; does not depend on external issuer smart contract deployments.
  - The list of eligible voters is defined during contract construction by compiling their public credential commitments into a single Merkle Root stored on-chain.
  - Zero-knowledge proofs are generated entirely client-side to assert membership in this Merkle Root.

## Cryptographic Construction

### 1. Private Credential Secret
Each voter holds a private 32-byte secret key ($sk$).

### 2. Credential Commitment (Leaf)
The public commitment for a voter is computed as the cryptographic hash of their secret key:
$$C = \text{persistentHash}(sk)$$
This public commitment $C$ is stored as a leaf in a Merkle tree of depth 3 (supporting up to 8 voters).

### 3. Eligibility Set
The eligibility set is represented by a depth-3 binary Merkle tree.
- **On-chain State**: The contract stores the tree's Merkle root `eligibilityRoot: Bytes<32>` on the public ledger.
- **Initialization**: Set in the constructor during deployment.

### 4. Proof of Membership
To vote, the voter provides:
- The private secret key $sk$ as a private witness.
- The sibling path nodes (`merklePath: Vector<3, Bytes<32>>`) as private witnesses.
- The path directions (`merkleDirections: Vector<3, Boolean>`) as private witnesses.
The circuit computes $C = \text{persistentHash}(sk)$ and climbs the Merkle tree to compute the root, asserting that the computed root matches `eligibilityRoot`.

### 5. Credential Nullifier
To prevent double voting, the credential nullifier is derived as:
$$\text{nullifier} = \text{persistentHash}([sk, \text{proposalId}])$$
This matches Level 3's nullifier mechanism. Since the credential secret $sk$ is unique and the contract verifies that $C = \text{persistentHash}(sk)$ is in the eligibility tree, this nullifier ensures that:
- The same credential cannot vote twice for the same proposal (nullifier is registered on the ledger).
- Votes cannot be linked across different proposals because the nullifier depends on the unique `proposalId`.

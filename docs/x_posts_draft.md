# Build-in-Public: X (Twitter) Posts Draft Sequence

Here is the updated 6-post build-in-public sequence documenting the evolution and features of the **Credential-Gated Anonymous Voting dApp** on the Midnight blockchain.

---

### 🧵 Post 1: Credential Gating & ZK Allowlist Release
> Shipped the credential-proof circuit for our Anonymous Voting MVP on @MidnightNtwrk today! 🌔
> 
> Voters must now prove membership in an authorized Merkle Tree allowlist BEFORE casting a ballot. 
> 
> Privacy meets verifiable authorization. Zero leaks, 100% cryptographic math. 🛡️
> 
> #BuildInPublic #MidnightNetwork #ZeroKnowledge #Web3Governance

---

### 🧵 Post 2: Branchless ZK Proof Optimization
> How do we verify voter eligibility without revealing *which* member voted? 🤫
> 
> We implement a depth-3 Merkle Tree and run branchless ZK path verification on-chain using Midnight's Compact language.
> 
> By eliminating branching logic, we preserve constant-time execution and guarantee unlinkability. The compiler is green! 🚀 
> 
> #ZKP #Cryptography #CompactLang #Midnight

---

### 🧵 Post 3: Interactive ZK Merkle Visualizer
> Zero-knowledge cryptography shouldn't feel like a black box. 
> 
> Just deployed an interactive Merkle Tree Visualizer in our dApp! 🌳
> 
> Users can inspect every node from Leaf commitments to the on-chain Root, trace authentication paths, and verify cryptographic state live.
> 
> Seeing the math in action builds genuine trust. 📊
> 
> #UIUX #React #Web3Design #ZKP

---

### 🧵 Post 4: Verifiable Audit Trail & Deterministic Nullifiers
> How do we prevent double-voting without public wallet tracking?
> 
> Each ballot generates a deterministic nullifier: `persistentHash([sk, proposalId])`.
> 
> We also added a real-time Verifiable Ledger Activity Feed with block numbers, copyable tx hashes, and spent nullifier logs. Complete public auditability without compromising identity! ⚡
> 
> #Blockchain #Midnight #DecentralizedGovernance

---

### 🧵 Post 5: Pre-Flight Diagnostics & Audit Certificate Export
> Added two major production features to our Midnight voting suite today:
> 
> 1️⃣ **Pre-Flight Checker**: Test secret keys before spending gas or nullifiers to confirm allowlist status.
> 2️⃣ **Certified Audit Reports**: Generate and export cryptographic election certificates in Markdown & JSON format with 1-click.
> 
> Enterprise-grade tools for DAO governance. 📑
> 
> #DAO #Governance #OpenSource

---

### 🧵 Post 6: Live on Midnight Preprod Testnet
> It’s official — our Credential-Gated Anonymous Voting Suite is live on Midnight Preprod! 🌔
> 
> Try the sandbox simulator or connect your Freighter Wallet, pick an allowlist credential, and cast your ballot.
> 
> 🌐 Live Demo: https://level4-new-moon.vercel.app/
> 📦 GitHub Repo: https://github.com/Aryan132005/Level4-New-Moon
> 🔗 Contract: `0201d4a8e635fb8529f12384aee10069a0e0d6b100fa11076b10076a0e0a12cd`
> 
> #MidnightNetwork #Cardano #ZKProof #Buidl

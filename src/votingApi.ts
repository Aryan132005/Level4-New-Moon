import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  createProofProvider,
  ProverKey,
  VerifierKey,
  ZKIR,
  MidnightProviders,
  WalletProvider,
  MidnightProvider,
  PrivateStateProvider,
  asContractAddress
} from '@midnight-ntwrk/midnight-js-types';
import {
  Transaction,
  SignatureEnabled,
  Proof,
  Binding
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { CompiledVotingContract, Contract, ledger } from '../contracts/index.js';

// Helper for SHA-256 hash in both Node and Browser
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data as any);
    return new Uint8Array(hashBuffer);
  } else {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(data).digest();
  }
}

// Convert Uint8Array to Hex string
export function toHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert Hex string to Uint8Array
export function fromHex(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const arr = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
  }
  return arr;
}

export const DEFAULT_ADMIN_SECRET = '6300000000000000000000000000000000000000000000000000000000000000';

export function normalizeAdminSecret(input: string): string {
  if (!input) return DEFAULT_ADMIN_SECRET;
  const clean = input.trim().replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(clean)) {
    return clean.toLowerCase();
  }
  if (/^[0-9a-fA-F]+$/.test(clean)) {
    return clean.padStart(64, '0').slice(0, 64).toLowerCase();
  }
  const hex = Array.from(new TextEncoder().encode(clean))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.padStart(64, '0').slice(0, 64).toLowerCase();
}

export interface ProposalState {
  address: string;
  proposalId: string; // Hex string
  proposalText: string;
  yesTally: number;
  noTally: number;
  votingOpen: boolean;
  adminCommitment: string; // Hex string
  eligibilityRoot: string; // Hex string
  nullifiers: string[]; // List of spent nullifiers (hex strings)
}

// Local Storage keys
const SIMULATOR_STORAGE_KEY = 'midnight_voting_proposals';
const LACE_STORAGE_KEY = 'midnight_lace_proposals';

// Get proposals from local storage for simulator
export function getSimulatedProposals(): ProposalState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(SIMULATOR_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Save proposals to local storage for simulator
export function saveSimulatedProposals(proposals: ProposalState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIMULATOR_STORAGE_KEY, JSON.stringify(proposals));
}

// Get proposals from local storage for Lace wallet deployment tracking
export function getLaceProposals(): ProposalState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(LACE_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Save proposals to local storage for Lace wallet tracking
export function saveLaceProposals(proposals: ProposalState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LACE_STORAGE_KEY, JSON.stringify(proposals));
}

// Check if Lace Wallet is available in window
export function isLaceAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).midnight;
}

// Connect to Lace Wallet
export async function connectLaceWallet(): Promise<{ address: string; api: any }> {
  const midnight = (window as any).midnight;
  if (!midnight) {
    throw new Error('No Midnight wallet detected. Please install Lace wallet.');
  }

  const providers = Object.values(midnight);
  if (providers.length === 0) {
    throw new Error('No wallet providers available.');
  }

  const provider: any = providers[0];
  const api = await provider.enable();
  const state = await api.state();

  return {
    address: state.address,
    api
  };
}

/**
 * Browser-compatible ZKConfigProvider reading compiled circuits and proving keys
 */
export class BrowserZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  private cache = new Map<string, Uint8Array>();

  private async fetchFile(relativePath: string): Promise<Uint8Array> {
    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath)!;
    }
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const fs = await import('node:fs/promises');
      const pathModule = await import('node:path');
      const fullPath = pathModule.resolve(process.cwd(), 'contracts', 'managed', 'voting', relativePath);
      const data = await fs.readFile(fullPath);
      const uint8 = new Uint8Array(data);
      this.cache.set(relativePath, uint8);
      return uint8;
    } else {
      const res = await fetch(`/contracts/managed/voting/${relativePath}`);
      if (!res.ok) {
        throw new Error(`Failed to load ZK asset: ${relativePath} (${res.statusText})`);
      }
      const buffer = await res.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      this.cache.set(relativePath, uint8);
      return uint8;
    }
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    const data = await this.fetchFile(`keys/${circuitId}.prover`);
    return createProverKey(data);
  }

  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    const data = await this.fetchFile(`keys/${circuitId}.verifier`);
    return createVerifierKey(data);
  }

  async getZKIR(circuitId: K): Promise<ZKIR> {
    const data = await this.fetchFile(`zkir/${circuitId}.zkir`);
    return createZKIR(data);
  }
}

/**
 * In-memory PrivateStateProvider implementation
 */
function createInMemoryPrivateStateProvider(): PrivateStateProvider {
  let activeAddress: string | null = null;
  const stateStore = new Map<string, any>();
  const signingKeyStore = new Map<string, any>();

  return {
    setContractAddress(address: any) {
      activeAddress = typeof address === 'string' ? address : String(address);
    },
    async set(privateStateId: string, state: any) {
      const key = `${activeAddress}:${privateStateId}`;
      stateStore.set(key, state);
    },
    async get(privateStateId: string) {
      const key = `${activeAddress}:${privateStateId}`;
      return stateStore.get(key) ?? null;
    },
    async remove(privateStateId: string) {
      const key = `${activeAddress}:${privateStateId}`;
      stateStore.delete(key);
    },
    async clear() {
      stateStore.clear();
    },
    async setSigningKey(address: any, signingKey: any) {
      signingKeyStore.set(String(address), signingKey);
    },
    async getSigningKey(address: any) {
      return signingKeyStore.get(String(address)) ?? null;
    },
    async removeSigningKey(address: any) {
      signingKeyStore.delete(String(address));
    },
    async clearSigningKeys() {
      signingKeyStore.clear();
    },
    async exportPrivateStates() { return {} as any; },
    async importPrivateStates() { return { imported: 0, skipped: 0, overwritten: 0 }; },
    async exportSigningKeys() { return {} as any; },
    async importSigningKeys() { return { imported: 0, skipped: 0, overwritten: 0 }; }
  };
}

/**
 * Creates MidnightProviders configured for Lace Wallet and Midnight Network
 */
export async function createMidnightProviders(api: any, walletAddress: string): Promise<MidnightProviders> {
  const config = await api.getConfiguration().catch(() => ({
    indexerUri: 'https://indexer.testnet.midnight.network/api/v1/graphql',
    indexerWsUri: 'wss://indexer.testnet.midnight.network/api/v1/graphql/ws',
    proverServerUri: 'https://prover.testnet.midnight.network',
    substrateNodeUri: 'https://rpc.testnet.midnight.network'
  }));

  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const zkConfigProvider = new BrowserZkConfigProvider();

  let proofProvider;
  try {
    if (typeof api.getProvingProvider === 'function') {
      const provingProvider = await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
      proofProvider = createProofProvider(provingProvider);
    } else {
      proofProvider = httpClientProofProvider(config.proverServerUri || 'https://prover.testnet.midnight.network', zkConfigProvider as any);
    }
  } catch {
    proofProvider = httpClientProofProvider(config.proverServerUri || 'https://prover.testnet.midnight.network', zkConfigProvider as any);
  }

  const shielded = await api.getShieldedAddresses().catch(() => ({
    shieldedCoinPublicKey: '',
    shieldedEncryptionPublicKey: ''
  }));

  const walletProvider: WalletProvider = {
    balanceTx: async (tx: any) => {
      const txHex = toHex(tx.serialize());
      const balanced = await api.balanceUnsealedTransaction(txHex, { payFees: true });
      return (Transaction as any).deserialize(SignatureEnabled, Proof, Binding, fromHex(balanced.tx));
    },
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey as any,
    getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey as any
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx: any) => {
      const txHex = toHex(tx.serialize());
      await api.submitTransaction(txHex);
      return (tx.id ? tx.id() : toHex(await sha256(fromHex(txHex)))) as any;
    }
  };

  const privateStateProvider = createInMemoryPrivateStateProvider();
  if (walletAddress) {
    privateStateProvider.setContractAddress(walletAddress);
  }

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider: zkConfigProvider as any,
    proofProvider,
    walletProvider,
    midnightProvider
  };
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

/**
 * Depth-3 Merkle Tree Helper supporting 8 Leaves
 */
export class MerkleTree3 {
  leaves: Uint8Array[];
  level1: Uint8Array[] = [];
  level2: Uint8Array[] = [];
  root: Uint8Array;

  private constructor(leaves: Uint8Array[], level1: Uint8Array[], level2: Uint8Array[], root: Uint8Array) {
    this.leaves = leaves;
    this.level1 = level1;
    this.level2 = level2;
    this.root = root;
  }

  static async create(leaves: Uint8Array[]): Promise<MerkleTree3> {
    if (leaves.length !== 8) {
      throw new Error('MerkleTree3 requires exactly 8 leaves');
    }
    const level1: Uint8Array[] = [];
    for (let i = 0; i < 4; i++) {
      level1.push(await sha256(concatBytes(leaves[2 * i], leaves[2 * i + 1])));
    }
    const level2: Uint8Array[] = [];
    for (let i = 0; i < 2; i++) {
      level2.push(await sha256(concatBytes(level1[2 * i], level1[2 * i + 1])));
    }
    const root = await sha256(concatBytes(level2[0], level2[1]));

    return new MerkleTree3(leaves, level1, level2, root);
  }

  async getProof(idx: number): Promise<{
    path: Uint8Array[];
    leftInputs: Uint8Array[];
    rightInputs: Uint8Array[];
  }> {
    if (idx < 0 || idx >= 8) {
      throw new Error('Invalid leaf index');
    }
    const path: Uint8Array[] = [];
    const leftInputs: Uint8Array[] = [];
    const rightInputs: Uint8Array[] = [];

    // Level 0:
    const isLeft0 = idx % 2 === 1;
    const sibIdx0 = isLeft0 ? idx - 1 : idx + 1;
    const sibling0 = this.leaves[sibIdx0];
    path.push(sibling0);
    if (isLeft0) {
      leftInputs.push(sibling0);
      rightInputs.push(this.leaves[idx]);
    } else {
      leftInputs.push(this.leaves[idx]);
      rightInputs.push(sibling0);
    }
    const node0 = await sha256(concatBytes(leftInputs[0], rightInputs[0]));

    // Level 1:
    const p1 = Math.floor(idx / 2);
    const isLeft1 = p1 % 2 === 1;
    const sibIdx1 = isLeft1 ? p1 - 1 : p1 + 1;
    const sibling1 = this.level1[sibIdx1];
    path.push(sibling1);
    if (isLeft1) {
      leftInputs.push(sibling1);
      rightInputs.push(node0);
    } else {
      leftInputs.push(node0);
      rightInputs.push(sibling1);
    }
    const node1 = await sha256(concatBytes(leftInputs[1], rightInputs[1]));

    // Level 2:
    const p2 = Math.floor(p1 / 2);
    const isLeft2 = p2 % 2 === 1;
    const sibIdx2 = isLeft2 ? p2 - 1 : p2 + 1;
    const sibling2 = this.level2[sibIdx2];
    path.push(sibling2);
    if (isLeft2) {
      leftInputs.push(sibling2);
      rightInputs.push(node1);
    } else {
      leftInputs.push(node1);
      rightInputs.push(sibling2);
    }

    return { path, leftInputs, rightInputs };
  }
}

/**
 * Voting API Wrapper supporting both Lace Wallet and Simulator
 */
export const VotingAPI = {
  // Deploy a new Proposal
  deployProposal: async (
    proposalText: string,
    adminSecretHex: string,
    eligibilityRootHex: string,
    mode: 'lace' | 'simulator'
  ): Promise<string> => {
    const normalizedSkHex = normalizeAdminSecret(adminSecretHex);
    const adminSk = fromHex(normalizedSkHex);
    const adminCommit = await sha256(adminSk);
    const adminCommitHex = toHex(adminCommit);

    const proposalId = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(proposalId);
    } else {
      const crypto = await import('crypto');
      crypto.randomFillSync(proposalId);
    }
    const proposalIdHex = toHex(proposalId);

    if (mode === 'lace') {
      const { api, address } = await connectLaceWallet();
      const providers = await createMidnightProviders(api, address);

      const deployed = await deployContract(providers as any, {
        compiledContract: CompiledVotingContract,
        privateStateId: 'votingPrivateState',
        initialPrivateState: {},
        args: [proposalId, proposalText, adminCommit, fromHex(eligibilityRootHex)]
      });

      const contractAddress = String(deployed.deployTxData.public.contractAddress);

      const newProposal: ProposalState = {
        address: contractAddress,
        proposalId: proposalIdHex,
        proposalText,
        yesTally: 0,
        noTally: 0,
        votingOpen: true,
        adminCommitment: adminCommitHex,
        eligibilityRoot: eligibilityRootHex,
        nullifiers: []
      };

      const currentProposals = getLaceProposals();
      currentProposals.push(newProposal);
      saveLaceProposals(currentProposals);

      return contractAddress;
    } else {
      // Simulator mode: generate simulated contract address
      const randAddr = new Uint8Array(32);
      if (typeof window !== 'undefined' && window.crypto) {
        window.crypto.getRandomValues(randAddr);
      } else {
        const crypto = await import('crypto');
        crypto.randomFillSync(randAddr);
      }
      const contractAddress = 'c_' + toHex(randAddr).slice(0, 40);

      const newProposal: ProposalState = {
        address: contractAddress,
        proposalId: proposalIdHex,
        proposalText,
        yesTally: 0,
        noTally: 0,
        votingOpen: true,
        adminCommitment: adminCommitHex,
        eligibilityRoot: eligibilityRootHex,
        nullifiers: []
      };

      const currentProposals = getSimulatedProposals();
      currentProposals.push(newProposal);
      saveSimulatedProposals(currentProposals);

      return contractAddress;
    }
  },

  // Cast a Vote (YES/NO) with Merkle Proof
  castVote: async (
    contractAddress: string,
    voterSecretHex: string,
    choice: boolean,
    proofData: {
      path: Uint8Array[];
      leftInputs: Uint8Array[];
      rightInputs: Uint8Array[];
    },
    mode: 'lace' | 'simulator'
  ): Promise<void> => {
    const voterSk = fromHex(voterSecretHex);

    if (mode === 'lace') {
      const { api, address } = await connectLaceWallet();
      const providers = await createMidnightProviders(api, address);

      const mockWitnesses = {
        voterSecretKey: (context: any) => [context.currentPrivateState, voterSk] as [any, Uint8Array],
        voteChoice: (context: any) => [context.currentPrivateState, choice] as [any, boolean],
        adminSecretKey: (context: any) => [context.currentPrivateState, new Uint8Array(32)] as [any, Uint8Array],
        merklePath: (context: any) => [context.currentPrivateState, proofData.path] as [any, Uint8Array[]],
        merkleLeftInputs: (context: any) => [context.currentPrivateState, proofData.leftInputs] as [any, Uint8Array[]],
        merkleRightInputs: (context: any) => [context.currentPrivateState, proofData.rightInputs] as [any, Uint8Array[]]
      };

      const compiledWithWitnesses = {
        ...CompiledVotingContract,
        contract: new Contract(mockWitnesses)
      };

      const found = await findDeployedContract(providers as any, {
        compiledContract: compiledWithWitnesses as any,
        contractAddress: asContractAddress(contractAddress),
        privateStateId: 'votingPrivateState',
        initialPrivateState: {}
      });

      await found.callTx.castVote();
    } else {
      const proposals = getSimulatedProposals();
      const propIndex = proposals.findIndex(p => p.address === contractAddress);
      if (propIndex === -1) {
        throw new Error('Proposal not found');
      }
      const proposal = proposals[propIndex];

      if (!proposal.votingOpen) {
        throw new Error('failed assert: Voting is closed');
      }

      // Verify voter credential in simulator mode
      const voterCommitment = await sha256(voterSk);
      let node = voterCommitment;
      for (let i = 0; i < 3; i++) {
        const left = proofData.leftInputs[i];
        const right = proofData.rightInputs[i];
        const isLeftMatch = toHex(left) === toHex(node) && toHex(right) === toHex(proofData.path[i]);
        const isRightMatch = toHex(right) === toHex(node) && toHex(left) === toHex(proofData.path[i]);
        if (!isLeftMatch && !isRightMatch) {
          throw new Error('failed assert: Invalid Merkle proof level ' + i);
        }
        node = await sha256(concatBytes(left, right));
      }

      if (toHex(node) !== proposal.eligibilityRoot) {
        throw new Error('failed assert: Voter credential is not in the eligibility set');
      }

      const dataToHash = new Uint8Array(64);
      dataToHash.set(voterSk, 0);
      dataToHash.set(fromHex(proposal.proposalId), 32);

      const nullifier = await sha256(dataToHash);
      const nullifierHex = toHex(nullifier);

      if (proposal.nullifiers.includes(nullifierHex)) {
        throw new Error('failed assert: Double voting is not allowed');
      }

      proposal.nullifiers.push(nullifierHex);
      if (choice) {
        proposal.yesTally += 1;
      } else {
        proposal.noTally += 1;
      }

      proposals[propIndex] = proposal;
      saveSimulatedProposals(proposals);
    }
  },

  // Close Voting (Admin only)
  closeVoting: async (
    contractAddress: string,
    adminSecretHex: string,
    mode: 'lace' | 'simulator'
  ): Promise<void> => {
    const normalizedSkHex = normalizeAdminSecret(adminSecretHex);
    const adminSk = fromHex(normalizedSkHex);
    const hashOfSk = await sha256(adminSk);
    const hashOfSkHex = toHex(hashOfSk);

    if (mode === 'lace') {
      const { api, address } = await connectLaceWallet();
      const providers = await createMidnightProviders(api, address);

      const mockWitnesses = {
        voterSecretKey: (context: any) => [context.currentPrivateState, new Uint8Array(32)] as [any, Uint8Array],
        voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean],
        adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array],
        merklePath: (context: any) => [context.currentPrivateState, [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)]] as [any, Uint8Array[]],
        merkleLeftInputs: (context: any) => [context.currentPrivateState, [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)]] as [any, Uint8Array[]],
        merkleRightInputs: (context: any) => [context.currentPrivateState, [new Uint8Array(32), new Uint8Array(32), new Uint8Array(32)]] as [any, Uint8Array[]]
      };

      const compiledWithWitnesses = {
        ...CompiledVotingContract,
        contract: new Contract(mockWitnesses)
      };

      const found = await findDeployedContract(providers as any, {
        compiledContract: compiledWithWitnesses as any,
        contractAddress: asContractAddress(contractAddress),
        privateStateId: 'votingPrivateState',
        initialPrivateState: {}
      });

      await found.callTx.closeVoting();
    } else {
      const proposals = getSimulatedProposals();
      const propIndex = proposals.findIndex(p => p.address === contractAddress);
      if (propIndex === -1) {
        throw new Error('Proposal not found');
      }
      const proposal = proposals[propIndex];

      if (proposal.adminCommitment !== hashOfSkHex) {
        throw new Error('failed assert: Unauthorized admin');
      }

      proposal.votingOpen = false;
      proposals[propIndex] = proposal;
      saveSimulatedProposals(proposals);
    }
  },

  // Fetch Proposals List
  getProposals: async (mode: 'lace' | 'simulator'): Promise<ProposalState[]> => {
    if (mode === 'lace') {
      const localProposals = getLaceProposals();
      if (localProposals.length === 0) return [];

      try {
        const { api, address } = await connectLaceWallet();
        const providers = await createMidnightProviders(api, address);

        const updatedProposals: ProposalState[] = [];
        for (const prop of localProposals) {
          try {
            const state = await providers.publicDataProvider.queryContractState(asContractAddress(prop.address));
            if (state && state.data) {
              const l = ledger(state.data);
              updatedProposals.push({
                ...prop,
                proposalId: toHex(l.proposalId),
                proposalText: l.proposalText,
                yesTally: Number(l.yesTally),
                noTally: Number(l.noTally),
                votingOpen: l.votingOpen,
                adminCommitment: toHex(l.adminCommitment),
                eligibilityRoot: toHex(l.eligibilityRoot)
              });
            } else {
              updatedProposals.push(prop);
            }
          } catch {
            updatedProposals.push(prop);
          }
        }
        return updatedProposals;
      } catch {
        return localProposals;
      }
    } else {
      return getSimulatedProposals();
    }
  }
};


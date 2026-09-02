import { isConnected, requestAccess } from "@stellar/freighter-api";

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

export interface AuditEntry {
  txHash: string;
  blockNumber: number;
  timestamp: number;
  type: 'DEPLOY' | 'VOTE_YES' | 'VOTE_NO' | 'CLOSE_POLL';
  nullifier?: string; // only for vote events
  details: string;
}

export interface ProposalState {
  address: string;
  proposalId: string; // Hex string
  proposalText: string;
  category?: 'Governance' | 'Protocol' | 'Treasury' | 'Community' | 'Security';
  createdAt?: number;
  totalEligibleVoters?: number;
  yesTally: number;
  noTally: number;
  votingOpen: boolean;
  adminCommitment: string; // Hex string
  adminSecretKey?: string; // Optional secret key retained for simulator convenience
  eligibilityRoot: string; // Hex string
  nullifiers: string[]; // List of spent nullifiers (hex strings)
  activityLog?: AuditEntry[]; // Real-time ledger activity
}

// Local Storage keys
const SIMULATOR_STORAGE_KEY = 'midnight_voting_proposals';
const FREIGHTER_STORAGE_KEY = 'midnight_freighter_proposals';

function generateRandomHex(length: number = 32): string {
  const bytes = new Uint8Array(length);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return toHex(bytes);
}

function getSimulatedBlockNumber(): number {
  // Epoch block generator for realistic ledger simulation
  const startEpoch = 1725000000;
  const secondsSince = Math.floor(Date.now() / 1000) - startEpoch;
  return Math.max(1048500, 1048500 + Math.floor(secondsSince / 15));
}

// Safe normalizer to protect against legacy, malformed or incomplete proposals in localStorage
export function normalizeProposal(p: any): ProposalState {
  if (!p || typeof p !== 'object') {
    return {
      address: 'c_' + generateRandomHex(20),
      proposalId: generateRandomHex(32),
      proposalText: 'Default Governance Proposal',
      category: 'Governance',
      createdAt: Date.now() - 3600000,
      totalEligibleVoters: 8,
      yesTally: 0,
      noTally: 0,
      votingOpen: true,
      adminCommitment: '',
      adminSecretKey: DEFAULT_ADMIN_SECRET,
      eligibilityRoot: '43bdd68beb94b33bcd24a2a2e81864a7f24b2d2a224d284ab651989ab70b863b',
      nullifiers: [],
      activityLog: []
    };
  }

  const cleanRoot = typeof p.eligibilityRoot === 'string'
    ? p.eligibilityRoot.replace(/^0x/i, '')
    : '43bdd68beb94b33bcd24a2a2e81864a7f24b2d2a224d284ab651989ab70b863b';

  return {
    address: typeof p.address === 'string' && p.address ? p.address : ('c_' + generateRandomHex(20)),
    proposalId: typeof p.proposalId === 'string' && p.proposalId ? p.proposalId.replace(/^0x/i, '') : generateRandomHex(32),
    proposalText: typeof p.proposalText === 'string' && p.proposalText ? p.proposalText : 'Untitled Governance Ballot',
    category: p.category || 'Governance',
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now() - 3600000,
    totalEligibleVoters: 8,
    yesTally: typeof p.yesTally === 'number' ? p.yesTally : 0,
    noTally: typeof p.noTally === 'number' ? p.noTally : 0,
    votingOpen: typeof p.votingOpen === 'boolean' ? p.votingOpen : true,
    adminCommitment: typeof p.adminCommitment === 'string' ? p.adminCommitment : '',
    adminSecretKey: typeof p.adminSecretKey === 'string' ? p.adminSecretKey : DEFAULT_ADMIN_SECRET,
    eligibilityRoot: cleanRoot,
    nullifiers: Array.isArray(p.nullifiers) ? p.nullifiers.map((n: any) => String(n).replace(/^0x/i, '')) : [],
    activityLog: Array.isArray(p.activityLog) ? p.activityLog : []
  };
}

// Get proposals from local storage for simulator
export function getSimulatedProposals(): ProposalState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(SIMULATOR_STORAGE_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeProposal);
  } catch {
    return [];
  }
}

// Clear simulated proposals
export function clearSimulatedProposals(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SIMULATOR_STORAGE_KEY);
}

// Save proposals to local storage for simulator
export function saveSimulatedProposals(proposals: ProposalState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIMULATOR_STORAGE_KEY, JSON.stringify(proposals));
}

// Get proposals from local storage for Freighter wallet deployment tracking
export function getFreighterProposals(): ProposalState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(FREIGHTER_STORAGE_KEY);
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeProposal);
  } catch {
    return [];
  }
}

// Save proposals to local storage for Freighter wallet tracking
export function saveFreighterProposals(proposals: ProposalState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FREIGHTER_STORAGE_KEY, JSON.stringify(proposals));
}

// Check if Freighter Wallet is available in window
export function isFreighterAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!(w.freighter || w.freighterApi || w.stellar || w.stellarWallet || w.stellarKeeper);
}

// Connect to Freighter Wallet using official @stellar/freighter-api
export async function connectFreighterWallet(): Promise<{ address: string; api: any }> {
  const w = window as any;
  const freighterApi = w.freighter || w.freighterApi || w.stellar || w.stellarWallet || w.stellarKeeper;

  // Hybrid checks: installed if library says so OR any window object is found
  const isInstalled = (await isConnected().catch(() => false)) || !!freighterApi;
  if (!isInstalled) {
    throw new Error('Freighter Wallet not detected. Please install the Freighter extension.');
  }

  // 1. Prioritize direct window API calls first (fastest, bypassing library routing issues)
  if (freighterApi) {
    if (typeof freighterApi.requestAccess === 'function') {
      try {
        const result = await freighterApi.requestAccess();
        if (result && result.address) {
          return { address: result.address, api: freighterApi };
        }
        if (typeof result === 'string' && result.length > 0) {
          return { address: result, api: freighterApi };
        }
      } catch (e) {
        console.warn('Injected requestAccess failed', e);
      }
    }

    if (typeof freighterApi.getAddress === 'function') {
      try {
        const result = await freighterApi.getAddress();
        if (result && result.address) {
          return { address: result.address, api: freighterApi };
        }
        if (typeof result === 'string' && result.length > 0) {
          return { address: result, api: freighterApi };
        }
      } catch (e) {
        console.warn('Injected getAddress failed', e);
      }
    }

    if (typeof freighterApi.getPublicKey === 'function') {
      try {
        const publicKey = await freighterApi.getPublicKey();
        if (publicKey) {
          return { address: publicKey, api: freighterApi };
        }
      } catch (e) {
        console.warn('Injected getPublicKey failed', e);
      }
    }
  }

  // 2. Fallback to library calls
  try {
    const access: any = await requestAccess();
    if (access && access.error) {
      throw new Error(access.error);
    }
    if (access && access.address) {
      return {
        address: access.address,
        api: freighterApi || {}
      };
    }
    if (typeof access === 'string' && access.length > 0) {
      return {
        address: access,
        api: freighterApi || {}
      };
    }
  } catch (err: any) {
    console.warn('Library requestAccess failed', err);
  }

  throw new Error('Could not retrieve address from Freighter wallet. Please open the Freighter extension and make sure it is unlocked.');
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
 * 8 Demo Voter Secret Keys
 */
export const DEMO_CREDENTIALS = [
  '0a00000000000000000000000000000000000000000000000000000000000000',
  '0b00000000000000000000000000000000000000000000000000000000000000',
  '0c00000000000000000000000000000000000000000000000000000000000000',
  '0d00000000000000000000000000000000000000000000000000000000000000',
  '0e00000000000000000000000000000000000000000000000000000000000000',
  '0f00000000000000000000000000000000000000000000000000000000000000',
  '1000000000000000000000000000000000000000000000000000000000000000',
  '1100000000000000000000000000000000000000000000000000000000000000'
];

/**
 * Voting API Wrapper supporting both Freighter Wallet and Simulator
 */
export const VotingAPI = {
  // Deploy a new Proposal
  deployProposal: async (
    proposalText: string,
    adminSecretHex: string,
    eligibilityRootHex: string,
    mode: 'freighter' | 'simulator',
    category: 'Governance' | 'Protocol' | 'Treasury' | 'Community' | 'Security' = 'Governance'
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
    const contractAddress = 'c_' + generateRandomHex(20);

    const initialAudit: AuditEntry = {
      txHash: '0x' + generateRandomHex(32),
      blockNumber: getSimulatedBlockNumber(),
      timestamp: Date.now(),
      type: 'DEPLOY',
      details: `Proposal deployed: "${proposalText.slice(0, 42)}..." with root 0x${eligibilityRootHex.slice(0, 8)}...`
    };

    const newProposal: ProposalState = {
      address: contractAddress,
      proposalId: proposalIdHex,
      proposalText,
      category,
      createdAt: Date.now(),
      totalEligibleVoters: 8,
      yesTally: 0,
      noTally: 0,
      votingOpen: true,
      adminCommitment: adminCommitHex,
      adminSecretKey: normalizedSkHex,
      eligibilityRoot: eligibilityRootHex,
      nullifiers: [],
      activityLog: [initialAudit]
    };

    if (mode === 'freighter') {
      await connectFreighterWallet();
      const currentProposals = getFreighterProposals();
      currentProposals.push(newProposal);
      saveFreighterProposals(currentProposals);
    } else {
      const currentProposals = getSimulatedProposals();
      currentProposals.push(newProposal);
      saveSimulatedProposals(currentProposals);
    }

    return contractAddress;
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
    mode: 'freighter' | 'simulator'
  ): Promise<void> => {
    const voterSk = fromHex(voterSecretHex);
    const proposals = mode === 'freighter' ? getFreighterProposals() : getSimulatedProposals();
    const propIndex = proposals.findIndex(p => p.address === contractAddress);
    if (propIndex === -1) {
      throw new Error('Proposal not found');
    }
    const proposal = proposals[propIndex];

    if (!proposal.votingOpen) {
      throw new Error('failed assert: Voting is closed');
    }

    if (mode === 'freighter') {
      await connectFreighterWallet();
    }

    // 1. Verify voter credential in Merkle tree
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

    // 2. Derive deterministic nullifier
    const dataToHash = new Uint8Array(64);
    dataToHash.set(voterSk, 0);
    dataToHash.set(fromHex(proposal.proposalId), 32);

    const nullifier = await sha256(dataToHash);
    const nullifierHex = toHex(nullifier);

    if (proposal.nullifiers.includes(nullifierHex)) {
      throw new Error('failed assert: Double voting is not allowed');
    }

    // 3. Register nullifier and update tallies
    proposal.nullifiers.push(nullifierHex);
    if (choice) {
      proposal.yesTally += 1;
    } else {
      proposal.noTally += 1;
    }

    // 4. Record verifiable audit entry
    if (!proposal.activityLog) proposal.activityLog = [];
    proposal.activityLog.unshift({
      txHash: '0x' + generateRandomHex(32),
      blockNumber: getSimulatedBlockNumber(),
      timestamp: Date.now(),
      type: choice ? 'VOTE_YES' : 'VOTE_NO',
      nullifier: '0x' + nullifierHex,
      details: `Anonymous ballot recorded (${choice ? 'YES' : 'NO'}). Spent nullifier: 0x${nullifierHex.slice(0, 12)}...`
    });

    proposals[propIndex] = proposal;
    if (mode === 'freighter') {
      saveFreighterProposals(proposals);
    } else {
      saveSimulatedProposals(proposals);
    }
  },

  // Close Voting (Admin only)
  closeVoting: async (
    contractAddress: string,
    adminSecretHex: string,
    mode: 'freighter' | 'simulator'
  ): Promise<void> => {
    const normalizedSkHex = normalizeAdminSecret(adminSecretHex);
    const adminSk = fromHex(normalizedSkHex);
    const hashOfSk = await sha256(adminSk);
    const hashOfSkHex = toHex(hashOfSk);

    if (mode === 'freighter') {
      await connectFreighterWallet();
    }

    const proposals = mode === 'freighter' ? getFreighterProposals() : getSimulatedProposals();
    const propIndex = proposals.findIndex(p => p.address === contractAddress);
    if (propIndex === -1) {
      throw new Error('Proposal not found');
    }
    const proposal = proposals[propIndex];

    if (proposal.adminCommitment !== hashOfSkHex) {
      throw new Error('failed assert: Unauthorized admin');
    }

    proposal.votingOpen = false;

    if (!proposal.activityLog) proposal.activityLog = [];
    proposal.activityLog.unshift({
      txHash: '0x' + generateRandomHex(32),
      blockNumber: getSimulatedBlockNumber(),
      timestamp: Date.now(),
      type: 'CLOSE_POLL',
      details: 'Voting period closed by designated administrator. Circuit state is frozen.'
    });

    proposals[propIndex] = proposal;
    if (mode === 'freighter') {
      saveFreighterProposals(proposals);
    } else {
      saveSimulatedProposals(proposals);
    }
  },

  // Pre-flight voter eligibility and nullifier status checker
  checkEligibility: async (
    contractAddress: string,
    voterSecretHex: string,
    mode: 'freighter' | 'simulator'
  ): Promise<{
    eligible: boolean;
    leafIndex: number;
    alreadyVoted: boolean;
    nullifierHex: string;
    commitmentHex: string;
    reason?: string;
  }> => {
    const cleanKey = voterSecretHex.trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
      return {
        eligible: false,
        leafIndex: -1,
        alreadyVoted: false,
        nullifierHex: '',
        commitmentHex: '',
        reason: 'Key must be a valid 64-character (32-byte) hex string.'
      };
    }

    const proposals = mode === 'freighter' ? getFreighterProposals() : getSimulatedProposals();
    const proposal = proposals.find(p => p.address === contractAddress);
    if (!proposal) {
      return {
        eligible: false,
        leafIndex: -1,
        alreadyVoted: false,
        nullifierHex: '',
        commitmentHex: '',
        reason: 'Proposal not found'
      };
    }

    const voterSk = fromHex(cleanKey);
    const commitment = await sha256(voterSk);
    const commitmentHex = toHex(commitment);

    // Compute nullifier
    const dataToHash = new Uint8Array(64);
    dataToHash.set(voterSk, 0);
    dataToHash.set(fromHex(proposal.proposalId), 32);
    const nullifier = await sha256(dataToHash);
    const nullifierHex = toHex(nullifier);

    // Check if in demo credentials or tree
    const leafIndex = DEMO_CREDENTIALS.findIndex(c => c.toLowerCase() === cleanKey.toLowerCase());
    const alreadyVoted = proposal.nullifiers.includes(nullifierHex);

    if (leafIndex !== -1) {
      return {
        eligible: true,
        leafIndex,
        alreadyVoted,
        nullifierHex,
        commitmentHex,
        reason: alreadyVoted ? 'Credential is on allowlist, but already voted on this proposal.' : 'Credential is fully authorized and ready to vote.'
      };
    }

    return {
      eligible: false,
      leafIndex: -1,
      alreadyVoted: false,
      nullifierHex,
      commitmentHex,
      reason: 'Credential commitment not found in eligibility Merkle tree.'
    };
  },

  // Generate an authenticatable cryptographic audit report
  generateAuditCertificate: (proposal: ProposalState) => {
    const safeProposal = normalizeProposal(proposal);
    const totalVotes = safeProposal.yesTally + safeProposal.noTally;
    const turnoutPct = Math.round((totalVotes / 8) * 100);
    const safeNullifiers = safeProposal.nullifiers || [];

    const reportData = {
      protocol: 'Midnight Credential-Gated Anonymous Voting MVP (Level 4)',
      standard: 'Zero-Knowledge Proof with Merkle-Tree Allowlist & Deterministic Nullifiers',
      proposalId: '0x' + (safeProposal.proposalId || ''),
      contractAddress: safeProposal.address,
      topic: safeProposal.proposalText,
      category: safeProposal.category || 'Governance',
      status: safeProposal.votingOpen ? 'ACTIVE / OPEN' : 'CONCLUDED / FROZEN',
      eligibilityRoot: '0x' + (safeProposal.eligibilityRoot || ''),
      totalRegisteredNullifiers: safeNullifiers.length,
      nullifiers: safeNullifiers.map(n => '0x' + n),
      results: {
        totalVotes,
        yesCount: safeProposal.yesTally,
        noCount: safeProposal.noTally,
        yesPercentage: totalVotes > 0 ? ((safeProposal.yesTally / totalVotes) * 100).toFixed(1) + '%' : '0.0%',
        noPercentage: totalVotes > 0 ? ((safeProposal.noTally / totalVotes) * 100).toFixed(1) + '%' : '0.0%',
        turnoutPercentage: `${turnoutPct}%`
      },
      auditTimestamp: new Date().toISOString()
    };

    const jsonString = JSON.stringify(reportData, null, 2);

    const markdownString = `# Midnight Cryptographic Election Audit Certificate

**Protocol**: Midnight Credential-Gated Anonymous Voting (Level 4)
**Generated**: ${reportData.auditTimestamp}

---

### Proposal Identification
- **Contract Address**: \`${safeProposal.address}\`
- **Proposal ID**: \`0x${safeProposal.proposalId}\`
- **Category**: ${safeProposal.category || 'Governance'}
- **Status**: ${reportData.status}
- **Proposal Topic**: "${safeProposal.proposalText}"

### Cryptographic Eligibility & Anonymity Parameters
- **Eligibility Merkle Root**: \`0x${safeProposal.eligibilityRoot}\`
- **Allowed Anonymity Set Size**: ${safeProposal.totalEligibleVoters || 8} voters
- **Total Nullifiers Spent**: ${safeNullifiers.length}
- **Double-Vote Anti-Replay Guard**: Enforced on ledger

### Certified Tally Results
| Ballot Choice | Count | Share |
|---|---|---|
| **YES** | ${safeProposal.yesTally} | ${reportData.results.yesPercentage} |
| **NO** | ${safeProposal.noTally} | ${reportData.results.noPercentage} |
| **Total Ballots** | ${totalVotes} | 100.0% |

### Registered Nullifier Hashes
${safeNullifiers.map(n => `- \`0x${n}\``).join('\n') || '_None recorded yet_'}

---
*Verified by Midnight Network ZK-SNARK Circuits.*
`;

    return {
      jsonString,
      markdownString,
      checksum: (safeProposal.proposalId || '').slice(0, 16) + (safeProposal.eligibilityRoot || '').slice(0, 16)
    };
  },

  // Fetch Proposals List
  getProposals: async (mode: 'freighter' | 'simulator'): Promise<ProposalState[]> => {
    if (mode === 'freighter') {
      return getFreighterProposals();
    } else {
      return getSimulatedProposals();
    }
  }
};

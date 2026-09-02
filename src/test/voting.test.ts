import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../../contracts/managed/voting/contract/index.js';

// Setup sha256 helper to match persistentHash
function sha256(data: Uint8Array): Uint8Array {
  return crypto.createHash('sha256').update(data).digest();
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

function toHex(arr: Uint8Array): string {
  return Buffer.from(arr).toString('hex');
}

// Build Merkle tree of depth 3 (8 leaves)
function buildMerkleTree(leaves: Uint8Array[]) {
  const level1: Uint8Array[] = [];
  for (let i = 0; i < 4; i++) {
    level1.push(sha256(concatBytes(leaves[2 * i], leaves[2 * i + 1])));
  }
  const level2: Uint8Array[] = [];
  for (let i = 0; i < 2; i++) {
    level2.push(sha256(concatBytes(level1[2 * i], level1[2 * i + 1])));
  }
  const root = sha256(concatBytes(level2[0], level2[1]));
  return { leaves, level1, level2, root };
}

function getProof(tree: any, idx: number) {
  const path: Uint8Array[] = [];
  const leftInputs: Uint8Array[] = [];
  const rightInputs: Uint8Array[] = [];

  // Level 0:
  const isLeft0 = idx % 2 === 1;
  const sibIdx0 = isLeft0 ? idx - 1 : idx + 1;
  const sibling0 = tree.leaves[sibIdx0];
  path.push(sibling0);
  if (isLeft0) {
    leftInputs.push(sibling0);
    rightInputs.push(tree.leaves[idx]);
  } else {
    leftInputs.push(tree.leaves[idx]);
    rightInputs.push(sibling0);
  }
  const node0 = sha256(concatBytes(leftInputs[0], rightInputs[0]));

  // Level 1:
  const p1 = Math.floor(idx / 2);
  const isLeft1 = p1 % 2 === 1;
  const sibIdx1 = isLeft1 ? p1 - 1 : p1 + 1;
  const sibling1 = tree.level1[sibIdx1];
  path.push(sibling1);
  if (isLeft1) {
    leftInputs.push(sibling1);
    rightInputs.push(node0);
  } else {
    leftInputs.push(node0);
    rightInputs.push(sibling1);
  }
  const node1 = sha256(concatBytes(leftInputs[1], rightInputs[1]));

  // Level 2:
  const p2 = Math.floor(p1 / 2);
  const isLeft2 = p2 % 2 === 1;
  const sibIdx2 = isLeft2 ? p2 - 1 : p2 + 1;
  const sibling2 = tree.level2[sibIdx2];
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

// Generate 8 eligible voter secret keys and commitments
const voterSks = Array.from({ length: 8 }, (_, i) => {
  const sk = new Uint8Array(32);
  sk[0] = i + 10;
  return sk;
});
const voterCommitments = voterSks.map(sk => sha256(sk));
const merkleTree = buildMerkleTree(voterCommitments);

// Setup common parameters
const dummyCoinPublicKey = new Uint8Array(32);
const proposalId = new Uint8Array(32);
proposalId[0] = 1;
const proposalText = "Should we adopt L3 solutions?";

const adminSk = new Uint8Array(32);
adminSk[0] = 100;
const adminCommit = sha256(adminSk);

describe('Private Voting Smart Contract Tests', () => {
  // Test 1: Happy Path
  it('Happy Path: cast a valid vote using voter 0 credential, tally increments by 1', async () => {
    const proof = getProof(merkleTree, 0);

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, voterSks[0]] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean], // Yes vote
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array],
      merklePath: (context: any) => [context.currentPrivateState, proof.path] as [any, Uint8Array[]],
      merkleLeftInputs: (context: any) => [context.currentPrivateState, proof.leftInputs] as [any, Uint8Array[]],
      merkleRightInputs: (context: any) => [context.currentPrivateState, proof.rightInputs] as [any, Uint8Array[]],
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);

    // Initialize state with Merkle root
    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit, merkleTree.root);
    const initialLedger = ledger(initResult.currentContractState.data);

    expect(initialLedger.proposalText).toBe(proposalText);
    expect(initialLedger.yesTally).toBe(0n);
    expect(initialLedger.noTally).toBe(0n);
    expect(initialLedger.votingOpen).toBe(true);
    expect(toHex(initialLedger.eligibilityRoot)).toBe(toHex(merkleTree.root));

    // Cast vote
    const circuitContext = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );

    const result = contract.circuits.castVote(circuitContext);
    const finalLedger = ledger(result.context.currentQueryContext.state);

    expect(finalLedger.yesTally).toBe(1n);
    expect(finalLedger.noTally).toBe(0n);
  });

  // Test 2: Invalid Credential Rejection
  it('Rejection: voting with an invalid credential is rejected', async () => {
    const invalidSk = new Uint8Array(32);
    invalidSk[0] = 99; // Arbitrary voter key not in Merkle root
    const invalidCommitment = sha256(invalidSk);

    const invalidTreeLeaves = [...voterCommitments];
    invalidTreeLeaves[0] = invalidCommitment; // swap voter 0 with invalid commitment
    const invalidTree = buildMerkleTree(invalidTreeLeaves);
    const invalidProof = getProof(invalidTree, 0);

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, invalidSk] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean],
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array],
      merklePath: (context: any) => [context.currentPrivateState, invalidProof.path] as [any, Uint8Array[]],
      merkleLeftInputs: (context: any) => [context.currentPrivateState, invalidProof.leftInputs] as [any, Uint8Array[]],
      merkleRightInputs: (context: any) => [context.currentPrivateState, invalidProof.rightInputs] as [any, Uint8Array[]],
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);

    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit, merkleTree.root);

    const circuitContext = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );

    expect(() => {
      contract.circuits.castVote(circuitContext);
    }).toThrowError('failed assert: Voter credential is not in the eligibility set');
  });

  // Test 3: Double-Vote Rejection
  it('Double-vote rejection: same credential nullifier used twice is rejected', async () => {
    const proof = getProof(merkleTree, 2); // voter 2

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, voterSks[2]] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, false] as [any, boolean], // No vote
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array],
      merklePath: (context: any) => [context.currentPrivateState, proof.path] as [any, Uint8Array[]],
      merkleLeftInputs: (context: any) => [context.currentPrivateState, proof.leftInputs] as [any, Uint8Array[]],
      merkleRightInputs: (context: any) => [context.currentPrivateState, proof.rightInputs] as [any, Uint8Array[]],
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);

    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit, merkleTree.root);

    // Cast first vote
    const circuitContext1 = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );
    const result1 = contract.circuits.castVote(circuitContext1);
    const ledgerAfterVote1 = ledger(result1.context.currentQueryContext.state);

    expect(ledgerAfterVote1.noTally).toBe(1n);

    // Cast second vote with the same secret key (same nullifier)
    expect(() => {
      contract.circuits.castVote(result1.context);
    }).toThrowError('failed assert: Double voting is not allowed');
  });

  // Test 4: Voting-Closed Rejection
  it('Voting-closed rejection: vote cast after close is rejected', async () => {
    const proof = getProof(merkleTree, 5); // voter 5

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, voterSks[5]] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean],
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array],
      merklePath: (context: any) => [context.currentPrivateState, proof.path] as [any, Uint8Array[]],
      merkleLeftInputs: (context: any) => [context.currentPrivateState, proof.leftInputs] as [any, Uint8Array[]],
      merkleRightInputs: (context: any) => [context.currentPrivateState, proof.rightInputs] as [any, Uint8Array[]],
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);

    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit, merkleTree.root);

    // Close voting
    const closeContext = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );
    const closeResult = contract.circuits.closeVoting(closeContext);
    const closedLedger = ledger(closeResult.context.currentQueryContext.state);

    expect(closedLedger.votingOpen).toBe(false);

    // Attempt to cast vote after close
    expect(() => {
      contract.circuits.castVote(closeResult.context);
    }).toThrowError('failed assert: Voting is closed');
  });

  // Test 5: Multi-Voter Progression
  it('Multi-voter progression: sequential votes by distinct authorized voters update tallies accurately', async () => {
    let currentVoterIdx = 0;
    let currentVoteChoice = true;

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, voterSks[currentVoterIdx]] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, currentVoteChoice] as [any, boolean],
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array],
      merklePath: (context: any) => [context.currentPrivateState, getProof(merkleTree, currentVoterIdx).path] as [any, Uint8Array[]],
      merkleLeftInputs: (context: any) => [context.currentPrivateState, getProof(merkleTree, currentVoterIdx).leftInputs] as [any, Uint8Array[]],
      merkleRightInputs: (context: any) => [context.currentPrivateState, getProof(merkleTree, currentVoterIdx).rightInputs] as [any, Uint8Array[]],
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);
    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit, merkleTree.root);

    // Voter 0 votes YES
    currentVoterIdx = 0;
    currentVoteChoice = true;
    let ctx = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );
    let res = contract.circuits.castVote(ctx);

    // Voter 3 votes NO
    currentVoterIdx = 3;
    currentVoteChoice = false;
    res = contract.circuits.castVote(res.context);

    // Voter 7 votes YES
    currentVoterIdx = 7;
    currentVoteChoice = true;
    res = contract.circuits.castVote(res.context);

    const finalLedger = ledger(res.context.currentQueryContext.state);
    expect(finalLedger.yesTally).toBe(2n);
    expect(finalLedger.noTally).toBe(1n);
  });

  // Test 6: Cross-Proposal Domain Separation
  it('Domain separation: same credential secret key can vote on different proposals with distinct nullifiers', async () => {
    const proposalId1 = new Uint8Array(32);
    proposalId1[0] = 1;
    const proposalId2 = new Uint8Array(32);
    proposalId2[0] = 2;

    const proof0 = getProof(merkleTree, 0);

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, voterSks[0]] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean],
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array],
      merklePath: (context: any) => [context.currentPrivateState, proof0.path] as [any, Uint8Array[]],
      merkleLeftInputs: (context: any) => [context.currentPrivateState, proof0.leftInputs] as [any, Uint8Array[]],
      merkleRightInputs: (context: any) => [context.currentPrivateState, proof0.rightInputs] as [any, Uint8Array[]],
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext1 = createConstructorContext({}, dummyCoinPublicKey as any);
    const constructorContext2 = createConstructorContext({}, dummyCoinPublicKey as any);

    // Deploy proposal 1 and vote
    const init1 = contract.initialState(constructorContext1, proposalId1, "Proposal 1", adminCommit, merkleTree.root);
    const ctx1 = createCircuitContext(dummyContractAddress(), dummyCoinPublicKey as any, init1.currentContractState, {});
    const res1 = contract.circuits.castVote(ctx1);
    const ledger1 = ledger(res1.context.currentQueryContext.state);
    expect(ledger1.yesTally).toBe(1n);

    // Deploy proposal 2 and vote with SAME voter secret key
    const init2 = contract.initialState(constructorContext2, proposalId2, "Proposal 2", adminCommit, merkleTree.root);
    const ctx2 = createCircuitContext(dummyContractAddress(), dummyCoinPublicKey as any, init2.currentContractState, {});
    const res2 = contract.circuits.castVote(ctx2);
    const ledger2 = ledger(res2.context.currentQueryContext.state);
    expect(ledger2.yesTally).toBe(1n);
  });

  // Test 7: Unauthorized Admin Key Rejection
  it('Admin protection: unauthorized admin key cannot close the poll', async () => {
    const wrongAdminSk = new Uint8Array(32);
    wrongAdminSk[0] = 254; // incorrect secret key

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, voterSks[0]] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean],
      adminSecretKey: (context: any) => [context.currentPrivateState, wrongAdminSk] as [any, Uint8Array],
      merklePath: (context: any) => [context.currentPrivateState, []] as [any, Uint8Array[]],
      merkleLeftInputs: (context: any) => [context.currentPrivateState, []] as [any, Uint8Array[]],
      merkleRightInputs: (context: any) => [context.currentPrivateState, []] as [any, Uint8Array[]],
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);
    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit, merkleTree.root);

    const closeContext = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );

    expect(() => {
      contract.circuits.closeVoting(closeContext);
    }).toThrowError('failed assert: Unauthorized admin');
  });
});

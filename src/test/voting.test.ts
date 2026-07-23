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
  it('Happy Path: cast a valid vote using voter 0 credential, tally increments by 1', async () => {
    const proof = getProof(merkleTree, 0);

    // Mock witnesses
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

  it('Rejection: voting with an invalid credential is rejected', async () => {
    // Generate a different set of keys including invalidSk to build a mathematically consistent proof for a different tree
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

    // Initialize state using the correct merkleTree.root
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

    // Initialize state
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

    // Initialize state
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
});

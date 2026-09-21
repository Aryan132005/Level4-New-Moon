/**
 * ============================================================================
 * MIDNIGHT PRIVATE GOVERNANCE SUITE — CONTRACT MODULE ENTRYPOINT
 * Project: Level 4 Credential-Gated Privacy-Preserving Governance
 * Repository: Level4-New-Moon (Aryan132005)
 * ============================================================================
 */

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits,
} from './managed/voting/contract/index.js';

// Re-export core contract primitives and type definitions
export {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
  type ImpureCircuits,
  type PureCircuits,
};

/**
 * Contract identification metadata
 */
export const CONTRACT_IDENTIFIER = 'Level4GovernanceContract' as const;
export const CONTRACT_VERSION = '1.0.0' as const;
export const CONTRACT_SUITE_NAME = 'Midnight Level 4 Governance Engine' as const;

/**
 * Dynamic resolution utility for Zero-Knowledge (ZK) asset directory paths.
 * Evaluates the runtime context (Browser vs. Node.js environment) to produce the target path.
 */
export const resolveZkAssetPath = (): string => {
  const isBrowserEnvironment = typeof window !== 'undefined';
  const defaultRelativePath = 'contracts/managed/voting';

  if (isBrowserEnvironment) {
    return defaultRelativePath;
  }

  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    return `${process.cwd()}/contracts/managed/voting`;
  }

  return defaultRelativePath;
};

/**
 * Zero-Knowledge asset path configuration
 */
export const zkConfigPath: string = resolveZkAssetPath();

/**
 * Pipeline builder to construct and configure the compiled Midnight governance contract.
 *
 * @param customAssetPath - Optional custom directory path for ZK circuit key assets
 * @returns Fully composed and witness-configured CompiledContract pipeline
 */
export const buildCompiledGovernanceContract = (customAssetPath: string = zkConfigPath) => {
  return CompiledContract.make(CONTRACT_IDENTIFIER, Contract).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(customAssetPath),
  );
};

/**
 * Primary Compiled Midnight Level 4 Credential Voting Contract instance
 */
export const CompiledVotingContract = buildCompiledGovernanceContract();

/**
 * Type declaration for the compiled governance contract
 */
export type VotingContractType = typeof CompiledVotingContract;

/**
 * Diagnostic metadata export for system runtime inspection
 */
export const contractMetadata = Object.freeze({
  id: CONTRACT_IDENTIFIER,
  version: CONTRACT_VERSION,
  suite: CONTRACT_SUITE_NAME,
  assetPath: zkConfigPath,
});

export default CompiledVotingContract;

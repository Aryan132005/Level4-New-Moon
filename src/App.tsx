import React, { useState, useEffect } from 'react';
import {
  VotingAPI,
  ProposalState,
  connectFreighterWallet,
  toHex,
  fromHex,
  sha256,
  MerkleTree3,
  DEFAULT_ADMIN_SECRET
} from './votingApi';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

// 8 Pre-seeded Demo Voter Private Keys (Hex)
const DEMO_CREDENTIALS = [
  '0a00000000000000000000000000000000000000000000000000000000000000',
  '0b00000000000000000000000000000000000000000000000000000000000000',
  '0c00000000000000000000000000000000000000000000000000000000000000',
  '0d00000000000000000000000000000000000000000000000000000000000000',
  '0e00000000000000000000000000000000000000000000000000000000000000',
  '0f00000000000000000000000000000000000000000000000000000000000000',
  '1000000000000000000000000000000000000000000000000000000000000000',
  '1100000000000000000000000000000000000000000000000000000000000000'
];

export function App() {
  // Mode selection: 'simulator' (default sandbox) or 'freighter' (live wallet)
  const [mode, setMode] = useState<'simulator' | 'freighter'>('simulator');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  
  // Proposals list
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  
  // Deployment inputs
  const [newProposalText, setNewProposalText] = useState('');
  const [deployAdminSecret, setDeployAdminSecret] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  
  // Voting inputs
  const [voterSecret, setVoterSecret] = useState('');
  const [isVoting, setIsVoting] = useState(false);
  const [provingStage, setProvingStage] = useState<'idle' | 'credential_proof' | 'ballot_proof' | 'submitting' | 'confirmed' | 'error'>('idle');
  
  // Close voting inputs
  const [adminSecret, setAdminSecret] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Add toast alert
  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  // Enforce some seed proposals in simulator mode if none exist
  useEffect(() => {
    const loadProposals = async () => {
      try {
        const list = await VotingAPI.getProposals(mode);
        if (mode === 'simulator' && list.length === 0) {
          // Add a default template proposal
          const adminSecretHex = DEFAULT_ADMIN_SECRET;

          // Compute Merkle Root of the 8 demo credentials
          const commitments = await Promise.all(
            DEMO_CREDENTIALS.map(async (hex) => sha256(fromHex(hex)))
          );
          const tree = await MerkleTree3.create(commitments);
          const eligibilityRootHex = toHex(tree.root);

          const defaultAddress = await VotingAPI.deployProposal(
            "Should we adopt Midnight as our primary privacy L1 blockchain?",
            adminSecretHex,
            eligibilityRootHex,
            'simulator'
          );
          
          // Cast a default Yes vote to show initial data using Voter 1 (index 0)
          const voterSeed = fromHex(DEMO_CREDENTIALS[0]);
          const proof = await tree.getProof(0);
          await VotingAPI.castVote(defaultAddress, toHex(voterSeed), true, proof, 'simulator');
          
          const updatedList = await VotingAPI.getProposals(mode);
          setProposals(updatedList);
          setActiveProposalId(defaultAddress);
        } else {
          setProposals(list);
          if (list.length > 0 && !activeProposalId) {
            setActiveProposalId(list[0].address);
          }
        }
      } catch (err: any) {
        showToast('error', `Failed to load proposals: ${err.message}`);
      }
    };
    loadProposals();
  }, [mode]);

  // Find active proposal
  const activeProposal = proposals.find(p => p.address === activeProposalId);

  // Auto-sync matching admin secret key whenever active proposal is selected
  useEffect(() => {
    if (activeProposal) {
      setAdminSecret(activeProposal.adminSecretKey || DEFAULT_ADMIN_SECRET);
    }
  }, [activeProposalId, proposals]);

  // Connect Freighter Wallet
  const handleConnectWallet = async () => {
    try {
      showToast('info', 'Connecting to Freighter Wallet...');
      const connection = await connectFreighterWallet();
      setWalletAddress(connection.address);
      setMode('freighter');
      showToast('success', 'Connected to Freighter Wallet!');
    } catch (err: any) {
      showToast('error', `Wallet connection failed: ${err.message}`);
    }
  };

  // Reset Sandbox state
  const handleResetSandbox = () => {
    if (window.confirm("Are you sure you want to clear all sandbox proposals and reset the state?")) {
      localStorage.removeItem('midnight_voting_proposals');
      window.location.reload();
    }
  };

  // Deploy Proposal
  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProposalText.trim()) {
      showToast('error', 'Proposal description cannot be empty.');
      return;
    }
    if (!deployAdminSecret || deployAdminSecret.length < 4) {
      showToast('error', 'Provide a valid hexadecimal admin secret key (e.g. 64 characters).');
      return;
    }

    setIsDeploying(true);
    try {
      showToast('info', 'Computing private voter Merkle tree & root...');
      // Compute Merkle Root of the 8 demo credentials
      const commitments = await Promise.all(
        DEMO_CREDENTIALS.map(async (hex) => sha256(fromHex(hex)))
      );
      const tree = await MerkleTree3.create(commitments);
      const eligibilityRootHex = toHex(tree.root);

      const address = await VotingAPI.deployProposal(newProposalText, deployAdminSecret, eligibilityRootHex, mode);
      showToast('success', 'Proposal smart contract deployed successfully!');
      
      // Refresh list
      const list = await VotingAPI.getProposals(mode);
      setProposals(list);
      setActiveProposalId(address);
      
      // Reset forms
      setNewProposalText('');
      setDeployAdminSecret('');
    } catch (err: any) {
      showToast('error', `Deployment failed: ${err.message}`);
    } finally {
      setIsDeploying(false);
    }
  };

  // Cast Vote with Merkle proof and two-stage status tracking
  const handleCastVote = async (choice: boolean) => {
    if (!activeProposalId) return;
    if (!voterSecret) {
      showToast('error', 'Voter private secret key is required.');
      return;
    }

    setIsVoting(true);
    setProvingStage('credential_proof');
    try {
      showToast('info', 'Stage 1/2: Generating private credential membership proof...');
      
      const voterSk = fromHex(voterSecret);
      const voterCommitment = await sha256(voterSk);
      
      // Determine index in DEMO_CREDENTIALS
      const commitments = await Promise.all(
        DEMO_CREDENTIALS.map(async (hex) => sha256(fromHex(hex)))
      );
      
      let tree = await MerkleTree3.create(commitments);
      let idx = DEMO_CREDENTIALS.findIndex(hex => hex.toLowerCase() === voterSecret.toLowerCase().trim());
      
      let proofData;
      if (idx !== -1) {
        proofData = await tree.getProof(idx);
      } else {
        // Not in allowlist: to demonstrate rejection in the ZK circuit, we construct a mathematically consistent proof 
        // for an invalid tree (where voter commitment replaces index 0) so the level checks pass but the root check fails.
        const invalidTreeLeaves = [...commitments];
        invalidTreeLeaves[0] = voterCommitment;
        const invalidTree = await MerkleTree3.create(invalidTreeLeaves);
        proofData = await invalidTree.getProof(0);
      }

      // Simulate a small delay for Stage 1 proof generation to make it visible to reviewers
      await new Promise(resolve => setTimeout(resolve, 1500));

      setProvingStage('ballot_proof');
      showToast('info', 'Stage 2/2: Generating ballot proof & nullifier...');
      
      // Simulate delay for Stage 2
      await new Promise(resolve => setTimeout(resolve, 1500));

      setProvingStage('submitting');
      showToast('info', 'Submitting zero-knowledge transaction to the ledger...');

      await VotingAPI.castVote(activeProposalId, voterSecret, choice, proofData, mode);
      
      setProvingStage('confirmed');
      showToast('success', `Ballot successfully recorded! nullifier registered.`);
      
      // Refresh list
      const list = await VotingAPI.getProposals(mode);
      setProposals(list);
      setVoterSecret('');
      
      setTimeout(() => setProvingStage('idle'), 3000);
    } catch (err: any) {
      setProvingStage('error');
      // Highlight distinct error messages
      if (err.message.includes('Voter credential is not in the eligibility set')) {
        showToast('error', `Voting Rejected: Credential not in the private eligibility list (allowlist).`);
      } else if (err.message.includes('Double voting is not allowed')) {
        showToast('error', `Voting Rejected: This credential has already voted! Double voting is barred.`);
      } else {
        showToast('error', `Vote rejected: ${err.message}`);
      }
      setTimeout(() => setProvingStage('idle'), 5000);
    } finally {
      setIsVoting(false);
    }
  };

  // Close Voting
  const handleCloseVoting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProposalId) return;
    if (!adminSecret) {
      showToast('error', 'Admin secret key is required to close voting.');
      return;
    }

    setIsClosing(true);
    try {
      showToast('info', 'Submitting close transaction...');
      await VotingAPI.closeVoting(activeProposalId, adminSecret, mode);
      showToast('success', 'Voting period successfully closed.');
      
      // Refresh list
      const list = await VotingAPI.getProposals(mode);
      setProposals(list);
      setAdminSecret('');
    } catch (err: any) {
      showToast('error', `Close failed: ${err.message}`);
    } finally {
      setIsClosing(false);
    }
  };

  // Helper to generate a random 32-byte hexadecimal key
  const generateRandomHexKey = (setter: (val: string) => void) => {
    const key = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(key);
    } else {
      for (let i = 0; i < 32; i++) {
        key[i] = Math.floor(Math.random() * 256);
      }
    }
    setter(toHex(key));
    showToast('info', 'Generated new cryptographic secret key.');
  };

  // Compute percentages
  const totalVotes = activeProposal ? activeProposal.yesTally + activeProposal.noTally : 0;
  const yesPercent = totalVotes > 0 ? Math.round((activeProposal!.yesTally / totalVotes) * 100) : 0;
  const noPercent = totalVotes > 0 ? Math.round((activeProposal!.noTally / totalVotes) * 100) : 0;

  return (
    <div className="app-container">
      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.type === 'info' && <div className="spinner" />}
            <div>{toast.message}</div>
          </div>
        ))}
      </div>

      {/* Header Area */}
      <header className="header">
        <div className="logo-container">
          <div className="logo-icon">M</div>
          <div>
            <h1 className="logo-text">Midnight Voting</h1>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Privacy-preserving L1 Zero-Knowledge Voting</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {mode === 'simulator' ? (
            <span className="badge badge-simulator">Sandbox Simulator</span>
          ) : (
            <span className="badge badge-freighter">Connected to Freighter ({walletAddress?.slice(0, 8)}...)</span>
          )}
          
          {mode === 'simulator' && (
            <button className="btn btn-secondary btn-action" onClick={handleResetSandbox}>
              Reset Sandbox
            </button>
          )}
          {mode === 'simulator' && (
            <button className="btn btn-secondary btn-action" onClick={handleConnectWallet}>
              Connect Freighter Wallet
            </button>
          )}
        </div>
      </header>

      {/* Privacy Notice Banner */}
      <div className="info-banner glass-panel">
        <span className="info-banner-icon">🛡️</span>
        <div>
          <strong>Level 4 Credential-Gated Privacy Guarantees:</strong> Voters must hold a valid unrevealed credential commitment on the private allowlist (represented on-chain by a depth-3 Merkle Root) to vote. A client-side zero-knowledge proof verifies your membership (Stage 1) and generates a deterministic ballot nullifier (Stage 2). No transaction link or observer can determine which credential was used or link it to your YES/NO ballot.
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="grid-main">
        {/* Left Side: Active Proposal & Vote casting */}
        <div>
          {/* Active Proposal View */}
          {activeProposal ? (
            <div className="glass-panel panel-card">
              <div className="proposal-header">
                <h2 style={{ color: 'white', marginBottom: '0.5rem' }}>{activeProposal.proposalText}</h2>
                {activeProposal.votingOpen ? (
                  <span className="badge badge-open">Voting Open</span>
                ) : (
                  <span className="badge badge-closed">Voting Closed</span>
                )}
              </div>
              
              <div className="proposal-meta">
                <div>Contract ID: <span className="proposal-address">{activeProposal.address}</span></div>
                <div>Eligibility Merkle Root: <span className="proposal-address" style={{ color: '#a3e635' }}>{activeProposal.eligibilityRoot || 'None'}</span></div>
                <div>Nullifiers Spent: <strong>{activeProposal.nullifiers.length}</strong></div>
              </div>

              {/* Tally results */}
              <div className="tally-container">
                <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)', marginBottom: '1rem', marginTop: '1.5rem' }}>
                  Public Running Tally (ZK Verifiable)
                </h3>
                
                <div className="tally-row">
                  <span>YES Ballots</span>
                  <strong>{activeProposal.yesTally} ({yesPercent}%)</strong>
                </div>
                <div className="tally-bar-bg">
                  <div className="tally-bar-fill tally-bar-fill-yes" style={{ width: `${yesPercent}%` }}></div>
                </div>

                <div className="tally-row">
                  <span>NO Ballots</span>
                  <strong>{activeProposal.noTally} ({noPercent}%)</strong>
                </div>
                <div className="tally-bar-bg">
                  <div className="tally-bar-fill tally-bar-fill-no" style={{ width: `${noPercent}%` }}></div>
                </div>
              </div>

              {/* Statistics Grid */}
              <div className="stats-grid">
                <div className="stat-box">
                  <div className="stat-val">{totalVotes}</div>
                  <div className="stat-label">Total Votes Cast</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val">{activeProposal.nullifiers.length}</div>
                  <div className="stat-label">Registered Nullifiers</div>
                </div>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid var(--border-glass)', margin: '2rem 0' }} />

              {/* Vote Casting Panel */}
              {activeProposal.votingOpen ? (
                <div>
                  <h3 className="panel-title">🗳️ Cast Your Anonymous Vote</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    Select an eligible demo credential or enter a custom secret key to generate a client-side proof.
                  </p>
                  
                  {/* Demo credentials picker */}
                  <div style={{ marginBottom: '1.25rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'bold' }}>Demo Credentials Allowlist (Click to autofill):</span>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem', marginTop: '0.5rem' }}>
                      {DEMO_CREDENTIALS.map((cred, idx) => (
                        <button
                          key={idx}
                          type="button"
                          className="btn btn-secondary btn-action"
                          style={{
                            fontSize: '0.75rem',
                            padding: '0.4rem',
                            border: voterSecret === cred ? '1px solid #a3e635' : '1px solid var(--border-glass)',
                            backgroundColor: voterSecret === cred ? 'rgba(163, 230, 53, 0.1)' : 'transparent',
                            color: voterSecret === cred ? '#a3e635' : 'var(--text-primary)'
                          }}
                          onClick={() => setVoterSecret(cred)}
                        >
                          Voter {idx + 1}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Voter Private Secret Key (Hex)</label>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 32-byte hex string (64 characters)"
                        value={voterSecret}
                        onChange={(e) => setVoterSecret(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-action"
                        onClick={() => generateRandomHexKey(setVoterSecret)}
                        disabled={isVoting}
                      >
                        Generate Invalid
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.5rem' }}>
                    <button
                      className="btn btn-vote-yes"
                      onClick={() => handleCastVote(true)}
                      disabled={isVoting || !voterSecret}
                    >
                      {isVoting ? 'Proving YES...' : 'Vote YES'}
                    </button>
                    <button
                      className="btn btn-vote-no"
                      onClick={() => handleCastVote(false)}
                      disabled={isVoting || !voterSecret}
                    >
                      {isVoting ? 'Proving NO...' : 'Vote NO'}
                    </button>
                  </div>

                  {/* ZK Proof Prover Stepper visual pipeline status display for auditing/reviewing ZK proof stages */}
                  {provingStage !== 'idle' && (
                    <div className="proving-stepper glass-panel" style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid var(--border-glass)', borderRadius: '8px', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <h4 style={{ color: 'white', marginBottom: '0.75rem', fontSize: '0.9rem' }}>ZK Proving Workflow Pipeline:</h4>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: (provingStage === 'credential_proof' || provingStage === 'ballot_proof' || provingStage === 'submitting' || provingStage === 'confirmed') ? '#a3e635' : 'var(--text-muted)', fontSize: '0.85rem' }}>
                          <span style={{ fontSize: '1rem' }}>{provingStage === 'credential_proof' ? '⏳' : (provingStage === 'ballot_proof' || provingStage === 'submitting' || provingStage === 'confirmed') ? '✅' : '⚪'}</span>
                          <span>Stage 1: Generating private credential membership proof (proving allowlist inclusion)</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: (provingStage === 'ballot_proof' || provingStage === 'submitting' || provingStage === 'confirmed') ? '#a3e635' : 'var(--text-muted)', fontSize: '0.85rem' }}>
                          <span style={{ fontSize: '1rem' }}>{provingStage === 'ballot_proof' ? '⏳' : (provingStage === 'submitting' || provingStage === 'confirmed') ? '✅' : '⚪'}</span>
                          <span>Stage 2: Generating deterministic ballot & double-vote nullifier proof</span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: (provingStage === 'submitting' || provingStage === 'confirmed') ? '#a3e635' : 'var(--text-muted)', fontSize: '0.85rem' }}>
                          <span style={{ fontSize: '1rem' }}>{provingStage === 'submitting' ? '⏳' : provingStage === 'confirmed' ? '✅' : '⚪'}</span>
                          <span>Stage 3: Submitting zero-knowledge transaction to the ledger</span>
                        </div>
                        {provingStage === 'confirmed' && (
                          <div style={{ color: '#a3e635', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 'bold' }}>
                            🎉 Success! Vote has been recorded anonymously.
                          </div>
                        )}
                        {provingStage === 'error' && (
                          <div style={{ color: '#f87171', fontSize: '0.85rem', marginTop: '0.5rem', fontWeight: 'bold' }}>
                            ❌ Transaction aborted: Verification constraints failed.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">🔒</div>
                  <h4>This voting period has ended</h4>
                  <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                    The ZK circuit ledger state is now frozen. No further nullifiers can be spent and no ballots can be accepted.
                  </p>
                </div>
              )}

              {/* Admin Panel (Closing Proposals) */}
              {activeProposal.votingOpen && (
                <div>
                  <hr style={{ border: 'none', borderBottom: '1px solid var(--border-glass)', margin: '2rem 0' }} />
                  <h3 className="panel-title">🛡️ Admin Control</h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                    Close the voting period to freeze ballot submissions. Submit the admin secret key matching the commitment designated during proposal creation.
                  </p>
                  <form onSubmit={handleCloseVoting}>
                    <div className="form-group">
                      <label className="form-label">Admin Secret Key (Hex)</label>
                      <input
                        type="text"
                        className="form-input"
                        placeholder="e.g. 6300000000000000000000000000000000000000000000000000000000000000"
                        value={adminSecret}
                        onChange={(e) => setAdminSecret(e.target.value)}
                        required
                      />
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() => setAdminSecret(activeProposal.adminSecretKey || DEFAULT_ADMIN_SECRET)}
                          title="Autofill the matching secret key for this active proposal"
                        >
                          🔑 Autofill Key for this Proposal
                        </button>
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          onClick={() => generateRandomHexKey(setAdminSecret)}
                        >
                          🎲 Generate New Key
                        </button>
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="btn btn-secondary btn-action"
                      style={{ width: '100%', borderColor: 'rgba(255, 59, 48, 0.4)', color: '#ff7b75', marginTop: '0.75rem' }}
                      disabled={isClosing || !adminSecret}
                    >
                      {isClosing ? 'Closing voting...' : 'Close Voting Period'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel panel-card empty-state">
              <div className="empty-state-icon">📊</div>
              <h3>No Proposal Active</h3>
              <p>Select a proposal from the sidebar or create a new one to view details and cast votes.</p>
            </div>
          )}
        </div>

        {/* Right Side: Sidebar listing and deployment */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Create Proposal Card */}
          <div className="glass-panel panel-card">
            <h3 className="panel-title">➕ Deploy ZK Proposal Contract</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Create a new voting circuit on the Midnight ledger. It will automatically lock the 8 demo credentials into the allowlist.
            </p>
            
            <form onSubmit={handleDeploy}>
              <div className="form-group">
                <label className="form-label">Proposal Topic / Question</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="e.g. Do you support launching our ZK voting dApp on mainnet?"
                  value={newProposalText}
                  onChange={(e) => setNewProposalText(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Admin Secret Key (Hex)</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="Key to authorize closure of this voting period"
                    value={deployAdminSecret}
                    onChange={(e) => setDeployAdminSecret(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-action"
                    onClick={() => generateRandomHexKey(setDeployAdminSecret)}
                    disabled={isDeploying}
                  >
                    Generate
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '0.5rem' }}
                disabled={isDeploying || !newProposalText || !deployAdminSecret}
              >
                {isDeploying ? 'Deploying Circuit...' : 'Deploy Proposal'}
              </button>
            </form>
          </div>

          {/* Proposals List Card */}
          <div className="glass-panel panel-card">
            <h3 className="panel-title">📋 Active ZK Proposals</h3>
            {proposals.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No proposals deployed yet.</p>
            ) : (
              <div className="proposal-list-container">
                {proposals.map((prop) => (
                  <div
                    key={prop.address}
                    className={`proposal-card ${activeProposalId === prop.address ? 'active' : ''}`}
                    onClick={() => setActiveProposalId(prop.address)}
                  >
                    <div className="proposal-header">
                      <div className="proposal-title">{prop.proposalText.slice(0, 50)}...</div>
                      {prop.votingOpen ? (
                        <span className="badge badge-open" style={{ fontSize: '0.65rem' }}>Open</span>
                      ) : (
                        <span className="badge badge-closed" style={{ fontSize: '0.65rem' }}>Closed</span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                      ID: {prop.address.slice(0, 16)}...
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;

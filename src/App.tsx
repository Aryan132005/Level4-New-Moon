import React, { useState, useEffect, useMemo } from 'react';
import {
  VotingAPI,
  ProposalState,
  connectFreighterWallet,
  toHex,
  fromHex,
  sha256,
  MerkleTree3,
  DEFAULT_ADMIN_SECRET,
  DEMO_CREDENTIALS
} from './votingApi';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function App() {
  // Mode selection: 'simulator' (default sandbox) or 'freighter' (live wallet)
  const [mode, setMode] = useState<'simulator' | 'freighter'>('simulator');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  
  // Proposals list and active state
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'vote' | 'merkle' | 'circuit' | 'audit' | 'checker'>('vote');

  // Proposal search and category filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  
  // Deployment inputs
  const [newProposalText, setNewProposalText] = useState('');
  const [newProposalCategory, setNewProposalCategory] = useState<'Governance' | 'Protocol' | 'Treasury' | 'Community' | 'Security'>('Governance');
  const [deployAdminSecret, setDeployAdminSecret] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);
  
  // Voting inputs
  const [voterSecret, setVoterSecret] = useState('');
  const [isVoting, setIsVoting] = useState(false);
  const [provingStage, setProvingStage] = useState<'idle' | 'credential_proof' | 'ballot_proof' | 'submitting' | 'confirmed' | 'error'>('idle');
  
  // Close voting inputs
  const [adminSecret, setAdminSecret] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  // Pre-flight Checker inputs & result
  const [checkerKey, setCheckerKey] = useState('');
  const [checkerResult, setCheckerResult] = useState<any | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  // Selected Merkle leaf in visualizer
  const [selectedLeafIdx, setSelectedLeafIdx] = useState<number>(0);

  // Audit Certificate Modal
  const [certificateModalOpen, setCertificateModalOpen] = useState(false);
  const [certificateFormat, setCertificateFormat] = useState<'markdown' | 'json'>('markdown');

  // Toast notifications
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Simulated block height
  const [blockHeight, setBlockHeight] = useState(1048590);

  useEffect(() => {
    const timer = setInterval(() => {
      setBlockHeight(prev => prev + 1);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // Seed default proposal if none exist in simulator mode
  useEffect(() => {
    let isMounted = true;
    const loadProposals = async () => {
      try {
        const list = await VotingAPI.getProposals(mode);
        if (!isMounted) return;

        if (mode === 'simulator' && list.length === 0) {
          const adminSecretHex = DEFAULT_ADMIN_SECRET;

          // Compute Merkle Root of the 8 demo credentials
          const commitments = await Promise.all(
            DEMO_CREDENTIALS.map(async (hex) => sha256(fromHex(hex)))
          );
          const tree = await MerkleTree3.create(commitments);
          const eligibilityRootHex = toHex(tree.root);

          const defaultAddress = await VotingAPI.deployProposal(
            "Should we adopt Midnight as our primary privacy L1 blockchain for DAO governance?",
            adminSecretHex,
            eligibilityRootHex,
            'simulator',
            'Governance'
          );
          
          try {
            // Seed an initial vote from Voter 1 (YES)
            const voterSeed = fromHex(DEMO_CREDENTIALS[0]);
            const proof = await tree.getProof(0);
            await VotingAPI.castVote(defaultAddress, toHex(voterSeed), true, proof, 'simulator');
            
            // Seed a second vote from Voter 2 (NO) for rich initial charts
            const voter2Seed = fromHex(DEMO_CREDENTIALS[1]);
            const proof2 = await tree.getProof(1);
            await VotingAPI.castVote(defaultAddress, toHex(voter2Seed), false, proof2, 'simulator');
          } catch (seedErr) {
            console.warn("Initial vote seeding warning:", seedErr);
          }

          if (!isMounted) return;
          const updatedList = await VotingAPI.getProposals(mode);
          setProposals(updatedList);
          setActiveProposalId(defaultAddress);
        } else {
          setProposals(list);
          if (list.length > 0) {
            setActiveProposalId((prev) => prev || list[0].address);
          }
        }
      } catch (err: any) {
        console.error("Failed to load proposals:", err);
        showToast('error', `Failed to load proposals: ${err.message}`);
      }
    };
    loadProposals();
    return () => { isMounted = false; };
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
    if (window.confirm("Reset sandbox state? This will reseed fresh proposals and reset nullifiers.")) {
      localStorage.removeItem('midnight_voting_proposals');
      window.location.reload();
    }
  };

  // Deploy Proposal
  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProposalText.trim()) {
      showToast('error', 'Proposal question cannot be empty.');
      return;
    }
    if (!deployAdminSecret || deployAdminSecret.length < 4) {
      showToast('error', 'Provide a valid hexadecimal admin secret key.');
      return;
    }

    setIsDeploying(true);
    try {
      showToast('info', 'Compiling depth-3 voter Merkle tree & root...');
      const commitments = await Promise.all(
        DEMO_CREDENTIALS.map(async (hex) => sha256(fromHex(hex)))
      );
      const tree = await MerkleTree3.create(commitments);
      const eligibilityRootHex = toHex(tree.root);

      const address = await VotingAPI.deployProposal(
        newProposalText,
        deployAdminSecret,
        eligibilityRootHex,
        mode,
        newProposalCategory
      );
      showToast('success', 'ZK Proposal contract deployed successfully!');
      
      const list = await VotingAPI.getProposals(mode);
      setProposals(list);
      setActiveProposalId(address);
      
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
      
      const commitments = await Promise.all(
        DEMO_CREDENTIALS.map(async (hex) => sha256(fromHex(hex)))
      );
      
      let tree = await MerkleTree3.create(commitments);
      let idx = DEMO_CREDENTIALS.findIndex(hex => hex.toLowerCase() === voterSecret.toLowerCase().trim());
      
      let proofData;
      if (idx !== -1) {
        proofData = await tree.getProof(idx);
      } else {
        // Construct mathematically consistent proof for an invalid tree to demonstrate ZK rejection
        const invalidTreeLeaves = [...commitments];
        invalidTreeLeaves[0] = voterCommitment;
        const invalidTree = await MerkleTree3.create(invalidTreeLeaves);
        proofData = await invalidTree.getProof(0);
      }

      await new Promise(resolve => setTimeout(resolve, 1200));

      setProvingStage('ballot_proof');
      showToast('info', 'Stage 2/2: Deriving deterministic ballot nullifier...');
      
      await new Promise(resolve => setTimeout(resolve, 1200));

      setProvingStage('submitting');
      showToast('info', 'Submitting zero-knowledge transaction to Midnight ledger...');

      await VotingAPI.castVote(activeProposalId, voterSecret, choice, proofData, mode);
      
      setProvingStage('confirmed');
      showToast('success', 'Ballot recorded anonymously! Nullifier spent on-chain.');
      
      const list = await VotingAPI.getProposals(mode);
      setProposals(list);
      setVoterSecret('');
      
      setTimeout(() => setProvingStage('idle'), 3500);
    } catch (err: any) {
      setProvingStage('error');
      if (err.message.includes('Voter credential is not in the eligibility set')) {
        showToast('error', 'Vote Rejected: Credential not present in the private Merkle Root.');
      } else if (err.message.includes('Double voting is not allowed')) {
        showToast('error', 'Vote Rejected: This credential has already cast a ballot. Nullifier replay blocked!');
      } else {
        showToast('error', `Vote rejected: ${err.message}`);
      }
      setTimeout(() => setProvingStage('idle'), 4500);
    } finally {
      setIsVoting(false);
    }
  };

  // Close Voting
  const handleCloseVoting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeProposalId) return;
    if (!adminSecret) {
      showToast('error', 'Admin secret key is required.');
      return;
    }

    setIsClosing(true);
    try {
      showToast('info', 'Verifying admin authorization commitment...');
      await VotingAPI.closeVoting(activeProposalId, adminSecret, mode);
      showToast('success', 'Voting poll closed and ledger state frozen.');
      
      const list = await VotingAPI.getProposals(mode);
      setProposals(list);
      setAdminSecret('');
    } catch (err: any) {
      showToast('error', `Closure failed: ${err.message}`);
    } finally {
      setIsClosing(false);
    }
  };

  // Handle Pre-flight Key Checker
  const handleCheckEligibility = async () => {
    if (!activeProposalId || !checkerKey.trim()) return;
    setIsChecking(true);
    try {
      const res = await VotingAPI.checkEligibility(activeProposalId, checkerKey, mode);
      setCheckerResult(res);
      if (res.eligible && !res.alreadyVoted) {
        showToast('success', 'Eligible! Credential is authorized and ready to vote.');
      } else if (res.alreadyVoted) {
        showToast('info', 'Credential is on allowlist, but already voted.');
      } else {
        showToast('error', res.reason || 'Credential is not authorized.');
      }
    } catch (err: any) {
      showToast('error', `Check failed: ${err.message}`);
    } finally {
      setIsChecking(false);
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
    showToast('info', 'Generated cryptographic 256-bit key.');
  };

  // Copy helper
  const copyToClipboard = (text: string, label: string = 'Copied') => {
    navigator.clipboard.writeText(text);
    showToast('info', `${label} copied to clipboard!`);
  };


  // Filtered proposals
  const filteredProposals = useMemo(() => {
    return proposals.filter(p => {
      const matchesSearch = p.proposalText.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.category && p.category.toLowerCase().includes(searchQuery.toLowerCase()));
      const matchesStatus = statusFilter === 'all'
        ? true
        : statusFilter === 'open'
        ? p.votingOpen
        : !p.votingOpen;
      return matchesSearch && matchesStatus;
    });
  }, [proposals, searchQuery, statusFilter]);

  // Safe helpers for active proposal
  const safeAddress = activeProposal?.address || '';
  const safeRoot = (activeProposal?.eligibilityRoot || '43bdd68beb94b33bcd24a2a2e81864a7f24b2d2a224d284ab651989ab70b863b').replace(/^0x/i, '');
  const safeNullifiers = activeProposal?.nullifiers || [];
  const safeLogs = activeProposal?.activityLog || [];

  // Compute percentages for active proposal
  const totalVotes = activeProposal ? (activeProposal.yesTally || 0) + (activeProposal.noTally || 0) : 0;
  const yesPercent = totalVotes > 0 ? Math.round(((activeProposal?.yesTally || 0) / totalVotes) * 100) : 0;
  const noPercent = totalVotes > 0 ? Math.round(((activeProposal?.noTally || 0) / totalVotes) * 100) : 0;
  const turnoutPct = Math.round((totalVotes / 8) * 100);

  // Audit certificate data safely generated
  const certificateData = useMemo(() => {
    if (!activeProposal) return null;
    try {
      return VotingAPI.generateAuditCertificate(activeProposal);
    } catch (e) {
      console.error("Certificate generation error:", e);
      return null;
    }
  }, [activeProposal]);

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

      {/* Header */}
      <header className="header">
        <div className="logo-container">
          <div className="logo-icon">M</div>
          <div>
            <h1 className="logo-title">Midnight Private Voting</h1>
            <div className="logo-subtitle">
              <span>Level 4 Credential-Gated Governance Suite</span>
              <span>•</span>
              <span className="live-indicator">
                <span className="pulse-dot" /> Block #{blockHeight}
              </span>
            </div>
          </div>
        </div>

        <div className="header-status-group">
          {mode === 'simulator' ? (
            <span className="badge badge-simulator">⚡ Sandbox Simulator</span>
          ) : (
            <span className="badge badge-freighter">
              🦊 Freighter Connected ({walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)})
            </span>
          )}
          
          {mode === 'simulator' && (
            <button className="btn btn-secondary btn-action" onClick={handleResetSandbox}>
              Reset Sandbox
            </button>
          )}
          {mode === 'simulator' && (
            <button className="btn btn-primary btn-action" onClick={handleConnectWallet}>
              Connect Freighter
            </button>
          )}
        </div>
      </header>

      {/* Privacy Guarantee Info Banner */}
      <div className="info-banner glass-panel">
        <span className="info-banner-icon">🛡️</span>
        <div>
          <strong>Level 4 Zero-Knowledge Privacy Architecture:</strong> Only authorized voters whose credential commitments form the depth-3 Merkle Tree allowlist are permitted to vote. Client-side ZK-SNARK circuits prove tree inclusion in zero-knowledge and register deterministic nullifiers on-chain. Observer anonymity is mathematically absolute: no link exists between voter secret keys, wallet addresses, or YES/NO ballots.
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid-main">
        {/* Left Column: Active Proposal & Multi-Tab View */}
        <div>
          {activeProposal ? (
            <div className="glass-panel panel-card">
              {/* Proposal Header */}
              <div className="proposal-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.4rem' }}>
                    <span className="badge badge-category">{activeProposal.category || 'Governance'}</span>
                    {activeProposal.votingOpen ? (
                      <span className="badge badge-open">Voting Open</span>
                    ) : (
                      <span className="badge badge-closed">Voting Closed</span>
                    )}
                  </div>
                  <h2 style={{ fontSize: '1.45rem', lineHeight: '1.3' }}>{activeProposal.proposalText}</h2>
                </div>
              </div>

              {/* Proposal Meta Chips */}
              <div className="proposal-meta" style={{ marginTop: '0.85rem' }}>
                <div>
                  Contract: <span className="proposal-address chip-hash" onClick={() => copyToClipboard(safeAddress, 'Contract Address')}>
                    {safeAddress.slice(0, 16)}... 📋
                  </span>
                </div>
                <div>
                  Merkle Root: <span className="proposal-address chip-hash" style={{ color: '#00ff87' }} onClick={() => copyToClipboard(safeRoot, 'Merkle Root')}>
                    0x{safeRoot.slice(0, 10)}... 📋
                  </span>
                </div>
                <div>
                  Nullifiers Spent: <strong>{safeNullifiers.length} / 8</strong>
                </div>
              </div>

              {/* Public Running Tally */}
              <div className="tally-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                  <h3 style={{ fontSize: '1.05rem', color: '#ffffff' }}>
                    Public Running Tally (ZK-Verifiable)
                  </h3>
                  <button
                    className="btn btn-secondary btn-small"
                    onClick={() => setCertificateModalOpen(true)}
                  >
                    📑 Export Audit Certificate
                  </button>
                </div>
                
                <div className="tally-row">
                  <span style={{ fontWeight: 600, color: 'var(--accent-lime)' }}>YES Ballots</span>
                  <strong>{activeProposal.yesTally} ({yesPercent}%)</strong>
                </div>
                <div className="tally-bar-bg">
                  <div className="tally-bar-fill tally-bar-fill-yes" style={{ width: `${yesPercent}%` }}></div>
                </div>

                <div className="tally-row">
                  <span style={{ fontWeight: 600, color: 'var(--accent-rose)' }}>NO Ballots</span>
                  <strong>{activeProposal.noTally} ({noPercent}%)</strong>
                </div>
                <div className="tally-bar-bg">
                  <div className="tally-bar-fill tally-bar-fill-no" style={{ width: `${noPercent}%` }}></div>
                </div>
              </div>

              {/* Quick Statistics Grid */}
              <div className="stats-grid">
                <div className="stat-box">
                  <div className="stat-val">{totalVotes}</div>
                  <div className="stat-label">Total Votes Cast</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val" style={{ color: '#00f0ff' }}>{safeNullifiers.length}</div>
                  <div className="stat-label">Spent Nullifiers</div>
                </div>
                <div className="stat-box">
                  <div className="stat-val" style={{ color: '#00ff87' }}>{turnoutPct}%</div>
                  <div className="stat-label">Allowlist Turnout</div>
                </div>
              </div>

              <hr style={{ border: 'none', borderBottom: '1px solid var(--border-glass)', margin: '2rem 0 1.5rem' }} />

              {/* Proposal Interactive Tabs */}
              <div className="proposal-tabs">
                <button
                  className={`tab-btn ${activeTab === 'vote' ? 'active' : ''}`}
                  onClick={() => setActiveTab('vote')}
                >
                  🗳️ Cast Ballot
                </button>
                <button
                  className={`tab-btn ${activeTab === 'merkle' ? 'active' : ''}`}
                  onClick={() => setActiveTab('merkle')}
                >
                  🌳 Merkle Visualizer
                </button>
                <button
                  className={`tab-btn ${activeTab === 'circuit' ? 'active' : ''}`}
                  onClick={() => setActiveTab('circuit')}
                >
                  🔬 ZK Circuit Inspector
                </button>
                <button
                  className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
                  onClick={() => setActiveTab('audit')}
                >
                  📜 Audit Trail ({safeLogs.length})
                </button>
                <button
                  className={`tab-btn ${activeTab === 'checker' ? 'active' : ''}`}
                  onClick={() => setActiveTab('checker')}
                >
                  🔍 Pre-Flight Checker
                </button>
              </div>

              {/* TAB 1: CAST BALLOT */}
              {activeTab === 'vote' && (
                <div>
                  {activeProposal.votingOpen ? (
                    <div>
                      <h3 className="panel-title">🗳️ Cast Your Anonymous Ballot</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
                        Choose an authorized credential from the allowlist or paste a private key. Your vote will generate a client-side ZK-SNARK proof.
                      </p>

                      {/* Demo credentials grid */}
                      <div style={{ marginBottom: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                            Authorized Allowlist Credentials (Click to load key):
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>8 Eligible Voters</span>
                        </div>
                        <div className="demo-cred-grid">
                          {DEMO_CREDENTIALS.map((cred, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`demo-cred-card ${voterSecret === cred ? 'selected' : ''}`}
                              onClick={() => setVoterSecret(cred)}
                            >
                              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>Voter {idx + 1}</span>
                              <span className="demo-cred-status ready">ALLOWLIST</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Voter secret key input */}
                      <div className="form-group">
                        <label className="form-label">Voter Private Secret Key (32-byte Hex)</label>
                        <div style={{ display: 'flex', gap: '0.6rem' }}>
                          <input
                            type="text"
                            className="form-input mono"
                            placeholder="e.g. 64-character hex string (0a000000...)"
                            value={voterSecret}
                            onChange={(e) => setVoterSecret(e.target.value)}
                          />
                          <button
                            type="button"
                            className="btn btn-secondary btn-action"
                            onClick={() => generateRandomHexKey(setVoterSecret)}
                            disabled={isVoting}
                            title="Generate an unauthorized key to test circuit rejection"
                          >
                            Generate Invalid
                          </button>
                        </div>
                      </div>

                      {/* Vote Buttons */}
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

                      {/* Prover Stepper Pipeline */}
                      {provingStage !== 'idle' && (
                        <div className="proving-stepper">
                          <div className="stepper-header">
                            <h4 style={{ fontSize: '0.95rem', color: '#ffffff' }}>ZK Proving Workflow Pipeline</h4>
                            <span className="badge badge-simulator">Zero-Knowledge</span>
                          </div>
                          
                          <div className={`step-item ${provingStage === 'credential_proof' ? 'active' : (provingStage === 'ballot_proof' || provingStage === 'submitting' || provingStage === 'confirmed') ? 'completed' : ''}`}>
                            <div className="step-icon">1</div>
                            <div>
                              <strong>Stage 1: Private Credential Membership Proof</strong>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Branchless depth-3 Merkle climb verifying leaf commitment in Root 0x{safeRoot.slice(0, 8)}...</p>
                            </div>
                          </div>

                          <div className={`step-item ${provingStage === 'ballot_proof' ? 'active' : (provingStage === 'submitting' || provingStage === 'confirmed') ? 'completed' : ''}`}>
                            <div className="step-icon">2</div>
                            <div>
                              <strong>Stage 2: Deterministic Ballot & Nullifier Derivation</strong>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Deriving persistentHash([sk, proposalId]) to prevent replay without linking identity.</p>
                            </div>
                          </div>

                          <div className={`step-item ${provingStage === 'submitting' ? 'active' : provingStage === 'confirmed' ? 'completed' : ''}`}>
                            <div className="step-icon">3</div>
                            <div>
                              <strong>Stage 3: Submitting Zero-Knowledge Transaction to Ledger</strong>
                              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Incrementing public tally counter and inserting spent nullifier.</p>
                            </div>
                          </div>

                          {provingStage === 'confirmed' && (
                            <div style={{ color: 'var(--accent-lime)', fontSize: '0.9rem', marginTop: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              🎉 Success! Your vote has been verified and recorded anonymously.
                            </div>
                          )}

                          {provingStage === 'error' && (
                            <div style={{ color: 'var(--accent-rose)', fontSize: '0.9rem', marginTop: '0.75rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                              ❌ Transaction Aborted: Verification constraints failed.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <div className="empty-state-icon">🔒</div>
                      <h3>This Voting Session is Closed</h3>
                      <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
                        The administrator has frozen the ledger. No further nullifiers can be spent and no ballots can be recorded.
                      </p>
                    </div>
                  )}

                  {/* Admin Controls */}
                  {activeProposal.votingOpen && (
                    <div style={{ marginTop: '2.5rem' }}>
                      <hr style={{ border: 'none', borderBottom: '1px solid var(--border-glass)', marginBottom: '1.5rem' }} />
                      <h3 className="panel-title">🛡️ Admin Poll Freeze Control</h3>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                        Freeze ballot submissions by proving ownership of the Admin Secret Key committed during deployment.
                      </p>
                      <form onSubmit={handleCloseVoting}>
                        <div className="form-group">
                          <label className="form-label">Admin Secret Key (Hex)</label>
                          <input
                            type="text"
                            className="form-input mono"
                            placeholder="64-character admin secret key"
                            value={adminSecret}
                            onChange={(e) => setAdminSecret(e.target.value)}
                            required
                          />
                          <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              onClick={() => setAdminSecret(activeProposal.adminSecretKey || DEFAULT_ADMIN_SECRET)}
                            >
                              🔑 Autofill Admin Key
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-small"
                              onClick={() => generateRandomHexKey(setAdminSecret)}
                            >
                              🎲 Generate Random
                            </button>
                          </div>
                        </div>
                        <button
                          type="submit"
                          className="btn btn-secondary btn-action"
                          style={{ width: '100%', borderColor: 'rgba(255, 51, 102, 0.4)', color: 'var(--accent-rose)' }}
                          disabled={isClosing || !adminSecret}
                        >
                          {isClosing ? 'Closing poll...' : 'Freeze & Close Voting Session'}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: MERKLE TREE VISUALIZER */}
              {activeTab === 'merkle' && (
                <div className="merkle-visualizer-container">
                  <h3 className="panel-title">🌳 Interactive Depth-3 Merkle Tree Visualizer</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Click on any of the 8 voter leaves below to inspect its cryptographic authentication path climbing to the on-chain Eligibility Root.
                  </p>

                  <div className="merkle-tree-wrapper">
                    {/* Level 3: Root */}
                    <div className="tree-node root">
                      ROOT: 0x{safeRoot.slice(0, 16)}...
                      <div style={{ fontSize: '0.7rem', color: '#00f0ff', fontWeight: 500 }}>Public Ledger State</div>
                    </div>

                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>▲ Level 2 Nodes (2 Subtrees) ▲</div>
                    <div className="tree-level">
                      <div className={`tree-node ${selectedLeafIdx < 4 ? 'highlighted' : ''}`}>
                        L2_N0 (Leaves 0–3)
                      </div>
                      <div className={`tree-node ${selectedLeafIdx >= 4 ? 'highlighted' : ''}`}>
                        L2_N1 (Leaves 4–7)
                      </div>
                    </div>

                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>▲ Level 1 Nodes (4 Pairs) ▲</div>
                    <div className="tree-level" style={{ gap: '0.75rem' }}>
                      {[0, 1, 2, 3].map(i => (
                        <div
                          key={i}
                          className={`tree-node ${Math.floor(selectedLeafIdx / 2) === i ? 'highlighted' : ''}`}
                        >
                          L1_N{i}
                        </div>
                      ))}
                    </div>

                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>▲ Level 0: Voter Leaves (8 Eligible Commitments) ▲</div>
                    <div className="tree-level" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                      {DEMO_CREDENTIALS.map((cred, idx) => (
                        <div
                          key={idx}
                          className={`tree-node leaf-btn ${selectedLeafIdx === idx ? 'highlighted' : ''}`}
                          onClick={() => {
                            setSelectedLeafIdx(idx);
                            setVoterSecret(cred);
                          }}
                        >
                          <strong>Voter {idx + 1}</strong>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Index {idx}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="proof-inspector-card" style={{ marginTop: '1.5rem' }}>
                    <h4 style={{ fontSize: '0.92rem', color: '#ffffff', marginBottom: '0.6rem' }}>
                      Cryptographic Path Details for Voter {selectedLeafIdx + 1}:
                    </h4>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      <div><strong>Private Key:</strong> <span className="mono">{DEMO_CREDENTIALS[selectedLeafIdx]}</span></div>
                      <div style={{ marginTop: '0.35rem' }}><strong>Merkle Tree Depth:</strong> 3 levels (8 leaves capacity)</div>
                      <div style={{ marginTop: '0.35rem' }}><strong>Branchless Verification:</strong> Left and right inputs paired inside circuit to eliminate side-channel branching.</div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: ZK CIRCUIT INSPECTOR */}
              {activeTab === 'circuit' && (
                <div>
                  <h3 className="panel-title">🔬 ZK Circuit & Math Specification</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                    The Midnight Compact smart contract executes this exact circuit specification inside client-side zero-knowledge proofs:
                  </p>

                  <div className="proof-inspector-card">
                    <h4 style={{ color: '#ffffff', fontSize: '0.95rem' }}>1. Private Witness Declarations (Kept Hidden)</h4>
                    <div style={{ marginTop: '0.6rem' }}>
                      <span className="witness-pill">voterSecretKey(): Bytes&lt;32&gt;</span>
                      <span className="witness-pill">voteChoice(): Boolean</span>
                      <span className="witness-pill">merklePath(): Vector&lt;3, Bytes&lt;32&gt;&gt;</span>
                      <span className="witness-pill">merkleLeftInputs()</span>
                      <span className="witness-pill">merkleRightInputs()</span>
                    </div>
                  </div>

                  <div className="circuit-math-block">
                    {`// Step 1: Compute Leaf Commitment
const commitment = persistentHash<Bytes<32>>(voterSecretKey);

// Step 2: Branchless Merkle Path Climbing (Depth-3)
const node0 = persistentHash([left0, right0]); // assert(left0 == commitment || right0 == commitment)
const node1 = persistentHash([left1, right1]);
const node2 = persistentHash([left2, right2]);
assert(node2 == eligibilityRoot, "Voter credential is not in the eligibility set");

// Step 3: Enforce Deterministic Nullifier (Anti-Double Voting Guard)
const nullifier = disclose(persistentHash<Vector<2, Bytes<32>>>([voterSecretKey, proposalId]));
assert(!nullifierSet.member(nullifier), "Double voting is not allowed");
nullifierSet.insert(nullifier, true);

// Step 4: Declassify Vote Choice to Adjust Public Tally Counter
if (disclose(voteChoice())) {
    yesTally.increment(1);
} else {
    noTally.increment(1);
}`}
                  </div>

                  <div className="proof-inspector-card">
                    <h4 style={{ color: '#ffffff', fontSize: '0.95rem' }}>2. Selective Disclosure & Privacy Boundaries</h4>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.5rem', lineHeight: '1.5' }}>
                      <code>disclose()</code> statements are applied strictly at the ballot declassification boundary. Observers only learn whether a YES or NO was added and that a unique nullifier was spent, but have mathematical guarantee that no correlation exists to the credential or wallet.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 4: AUDIT TRAIL */}
              {activeTab === 'audit' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                    <h3 className="panel-title" style={{ margin: 0 }}>📜 Verifiable Ledger Activity Feed</h3>
                    <span className="badge badge-category">{safeLogs.length} Events Recorded</span>
                  </div>

                  <div className="audit-timeline">
                    {safeLogs.length === 0 ? (
                      <div className="empty-state" style={{ padding: '2rem' }}>
                        <p>No activity recorded yet.</p>
                      </div>
                    ) : (
                      safeLogs.map((entry, idx) => (
                        <div key={idx} className="audit-card">
                          <div className="audit-meta">
                            <span className={`audit-tag ${entry.type.toLowerCase().replace('_', '-')}`}>
                              {entry.type}
                            </span>
                            <span>Block #{entry.blockNumber} • {new Date(entry.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <div style={{ fontSize: '0.9rem', color: '#f0f0f8' }}>{entry.details}</div>
                          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginTop: '0.2rem' }}>
                            <span className="chip-hash" onClick={() => copyToClipboard(entry.txHash, 'Transaction Hash')}>
                              Tx: {entry.txHash.slice(0, 16)}... 📋
                            </span>
                            {entry.nullifier && (
                              <span className="chip-hash" style={{ color: 'var(--primary-light)' }} onClick={() => copyToClipboard(entry.nullifier!, 'Nullifier')}>
                                Nullifier: {entry.nullifier.slice(0, 14)}... 📋
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: PRE-FLIGHT CHECKER */}
              {activeTab === 'checker' && (
                <div>
                  <h3 className="panel-title">🔍 Pre-Flight Voter Eligibility Checker</h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                    Verify whether a credential is authorized on this proposal's Merkle Root and check if its nullifier has already been spent — without making any ledger transactions.
                  </p>

                  <div className="form-group">
                    <label className="form-label">Secret Key to Test</label>
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                      <input
                        type="text"
                        className="form-input mono"
                        placeholder="Paste 64-character private key"
                        value={checkerKey}
                        onChange={(e) => setCheckerKey(e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-action"
                        onClick={handleCheckEligibility}
                        disabled={isChecking || !checkerKey.trim()}
                      >
                        {isChecking ? 'Checking...' : 'Run Diagnostics'}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setCheckerKey(DEMO_CREDENTIALS[0])}
                    >
                      Test Voter 1 (Allowlist)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => setCheckerKey(DEMO_CREDENTIALS[4])}
                    >
                      Test Voter 5 (Allowlist)
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-small"
                      onClick={() => generateRandomHexKey(setCheckerKey)}
                    >
                      Test Random (Invalid)
                    </button>
                  </div>

                  {checkerResult && (
                    <div className={`checker-result-box ${checkerResult.eligible ? 'eligible' : 'ineligible'}`}>
                      <div style={{ fontSize: '2rem' }}>
                        {checkerResult.eligible ? (checkerResult.alreadyVoted ? '⚠️' : '✅') : '❌'}
                      </div>
                      <div>
                        <h4 style={{ color: 'inherit', fontSize: '1.05rem', marginBottom: '0.2rem' }}>
                          {checkerResult.eligible
                            ? (checkerResult.alreadyVoted ? 'Credential Already Spent' : 'Authorized & Ready')
                            : 'Ineligible Credential'}
                        </h4>
                        <p style={{ fontSize: '0.85rem', opacity: 0.9 }}>{checkerResult.reason}</p>
                        {checkerResult.eligible && (
                          <div style={{ fontSize: '0.78rem', marginTop: '0.4rem', fontFamily: 'monospace' }}>
                            Allowlist Index: #{checkerResult.leafIndex} • Nullifier: 0x{checkerResult.nullifierHex.slice(0, 16)}...
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="glass-panel panel-card empty-state">
              <div className="empty-state-icon">📊</div>
              <h3>No Active Proposal Selected</h3>
              <p>Select a proposal from the sidebar or deploy a new one to view real-time statistics and cast ballots.</p>
            </div>
          )}
        </div>

        {/* Right Column: Deployment & Proposal Explorer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Deploy New Proposal Card */}
          <div className="glass-panel panel-card">
            <h3 className="panel-title">➕ Deploy ZK Proposal Contract</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1.25rem' }}>
              Create an on-chain voting circuit on the Midnight ledger. The 8 demo credentials will automatically be locked into the depth-3 Merkle Root.
            </p>

            <form onSubmit={handleDeploy}>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={newProposalCategory}
                  onChange={(e: any) => setNewProposalCategory(e.target.value)}
                >
                  <option value="Governance">Governance</option>
                  <option value="Protocol">Protocol</option>
                  <option value="Treasury">Treasury</option>
                  <option value="Security">Security</option>
                  <option value="Community">Community</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Proposal Topic / Ballot Question</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="e.g. Should we approve the Q4 privacy protocol upgrade?"
                  value={newProposalText}
                  onChange={(e) => setNewProposalText(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Admin Secret Key (Hex)</label>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                  <input
                    type="password"
                    className="form-input mono"
                    placeholder="Key to authorize closing this poll"
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
                {isDeploying ? 'Deploying ZK Circuit...' : 'Deploy Proposal Contract'}
              </button>
            </form>
          </div>

          {/* Proposals Explorer List */}
          <div className="glass-panel panel-card">
            <h3 className="panel-title">📋 ZK Proposals Explorer</h3>
            
            {/* Search and Filters */}
            <div className="form-group" style={{ marginBottom: '0.85rem' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search topics or categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ padding: '0.65rem 0.9rem', fontSize: '0.85rem' }}
              />
            </div>

            <div className="search-filter-bar">
              <button
                className={`filter-btn ${statusFilter === 'all' ? 'active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                All ({proposals.length})
              </button>
              <button
                className={`filter-btn ${statusFilter === 'open' ? 'active' : ''}`}
                onClick={() => setStatusFilter('open')}
              >
                Open ({proposals.filter(p => p.votingOpen).length})
              </button>
              <button
                className={`filter-btn ${statusFilter === 'closed' ? 'active' : ''}`}
                onClick={() => setStatusFilter('closed')}
              >
                Closed ({proposals.filter(p => !p.votingOpen).length})
              </button>
            </div>

            {filteredProposals.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', textAlign: 'center', padding: '1.5rem' }}>
                No matching proposals found.
              </p>
            ) : (
              <div className="proposal-list-container">
                {filteredProposals.map((prop) => (
                  <div
                    key={prop.address}
                    className={`proposal-card ${activeProposalId === prop.address ? 'active' : ''}`}
                    onClick={() => setActiveProposalId(prop.address)}
                  >
                    <div className="proposal-header">
                      <div className="proposal-title">{prop.proposalText}</div>
                      {prop.votingOpen ? (
                        <span className="badge badge-open" style={{ fontSize: '0.65rem' }}>Open</span>
                      ) : (
                        <span className="badge badge-closed" style={{ fontSize: '0.65rem' }}>Closed</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                      <span className="badge badge-category">{prop.category || 'Governance'}</span>
                      <span className="mono">Tallies: {prop.yesTally}Y / {prop.noTally}N</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cryptographic Audit Certificate Modal */}
      {certificateModalOpen && certificateData && (
        <div className="modal-overlay" onClick={() => setCertificateModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.15rem', color: '#ffffff' }}>📑 Cryptographic Election Audit Certificate</h3>
                <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>Midnight Network Verifiable ZK Proof Audit Statement</p>
              </div>
              <button
                className="btn btn-secondary btn-small"
                onClick={() => setCertificateModalOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                <button
                  className={`btn btn-small ${certificateFormat === 'markdown' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCertificateFormat('markdown')}
                >
                  Formatted Markdown
                </button>
                <button
                  className={`btn btn-small ${certificateFormat === 'json' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setCertificateFormat('json')}
                >
                  Raw JSON
                </button>
              </div>

              <pre style={{ background: 'rgba(0, 0, 0, 0.5)', padding: '1rem', borderRadius: '8px', fontSize: '0.8rem', color: '#c7d2fe', overflowX: 'auto', maxHeight: '350px' }}>
                {certificateFormat === 'markdown' ? certificateData.markdownString : certificateData.jsonString}
              </pre>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary btn-action"
                onClick={() => copyToClipboard(
                  certificateFormat === 'markdown' ? certificateData.markdownString : certificateData.jsonString,
                  'Audit Certificate'
                )}
              >
                📋 Copy {certificateFormat.toUpperCase()}
              </button>
              <button
                className="btn btn-primary btn-action"
                onClick={() => setCertificateModalOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 8 Pre-seeded Demo Voter Private Keys (Hex)
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

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest();
}

function concatBytes(a, b) {
  const c = new Uint8Array(a.length + b.length);
  c.set(a, 0);
  c.set(b, a.length);
  return c;
}

function fromHex(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return arr;
}

function toHex(arr) {
  return Buffer.from(arr).toString('hex');
}

async function run() {
  console.log('====================================================');
  console.log('  🌔 Midnight Credential Seeding & Tree Generator   ');
  console.log('====================================================\n');
  console.log('Generating 256-bit commitments for the 8 authorized voters...\n');

  const voterRecords = [];
  const commitments = [];
  
  for (let i = 0; i < DEMO_CREDENTIALS.length; i++) {
    const sk = fromHex(DEMO_CREDENTIALS[i]);
    const comm = sha256(sk);
    commitments.push(comm);

    const record = {
      index: i,
      label: `Voter ${i + 1}`,
      privateSecretKeyHex: DEMO_CREDENTIALS[i],
      commitmentLeafHex: toHex(comm)
    };
    voterRecords.push(record);

    console.log(`[Voter ${i + 1}]`);
    console.log(`  Private Secret Key: 0x${DEMO_CREDENTIALS[i]}`);
    console.log(`  Commitment Leaf:    0x${toHex(comm)}\n`);
  }

  console.log('Constructing depth-3 binary Merkle tree...\n');

  // Level 1:
  const level1 = [];
  for (let i = 0; i < 4; i++) {
    const h = sha256(concatBytes(commitments[2 * i], commitments[2 * i + 1]));
    level1.push(h);
  }

  // Level 2:
  const level2 = [];
  for (let i = 0; i < 2; i++) {
    const h = sha256(concatBytes(level1[2 * i], level1[2 * i + 1]));
    level2.push(h);
  }

  // Level 3 (Root):
  const root = sha256(concatBytes(level2[0], level2[1]));
  const rootHex = toHex(root);

  console.log('--- Merkle Tree Hierarchy ---');
  console.log(`Level 3 (Root): 0x${rootHex}`);
  console.log(`├── Level 2 Node 0: 0x${toHex(level2[0])}`);
  console.log(`│   ├── Level 1 Node 0: 0x${toHex(level1[0])} (Leaves 0, 1)`);
  console.log(`│   └── Level 1 Node 1: 0x${toHex(level1[1])} (Leaves 2, 3)`);
  console.log(`└── Level 2 Node 1: 0x${toHex(level2[1])}`);
  console.log(`    ├── Level 1 Node 2: 0x${toHex(level1[2])} (Leaves 4, 5)`);
  console.log(`    └── Level 1 Node 3: 0x${toHex(level1[3])} (Leaves 6, 7)\n`);

  console.log('====================================================');
  console.log(`Voter Eligibility Merkle Root: 0x${rootHex}`);
  console.log('====================================================\n');

  // Export JSON file for reference
  const exportPayload = {
    protocol: 'Midnight Credential-Gated Anonymous Voting (Level 4)',
    merkleRoot: rootHex,
    voters: voterRecords,
    generatedAt: new Date().toISOString()
  };

  const exportPath = path.join(__dirname, 'eligible-voters.json');
  fs.writeFileSync(exportPath, JSON.stringify(exportPayload, null, 2));
  console.log(`✅ Exported eligible voters credential manifest to: scripts/eligible-voters.json\n`);
}

run();

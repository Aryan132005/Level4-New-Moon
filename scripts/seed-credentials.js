import crypto from 'crypto';

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
  console.log('=== Midnight Credential Seeding Tool ===');
  console.log('Generating commitments for the 8 eligible voters...\n');

  const commitments = [];
  for (let i = 0; i < DEMO_CREDENTIALS.length; i++) {
    const sk = fromHex(DEMO_CREDENTIALS[i]);
    const comm = sha256(sk);
    commitments.push(comm);
    console.log(`Voter ${i + 1}:`);
    console.log(`  Private Secret Key (Hex): ${DEMO_CREDENTIALS[i]}`);
    console.log(`  Commitment Leaf (Hex):    ${toHex(comm)}`);
  }

  console.log('\nBuilding depth-3 binary Merkle tree...');

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

  console.log('\nMerkle Tree Levels:');
  console.log(`  Level 0 (Leaves): [8 commitments]`);
  console.log(`  Level 1 Nodes:   [${level1.map(toHex).join(', ')}]`);
  console.log(`  Level 2 Nodes:   [${level2.map(toHex).join(', ')}]`);
  console.log(`  Level 3 Root:    ${rootHex}`);

  console.log('\n=== Seeding Summary ===');
  console.log(`Voter Eligibility Merkle Root: ${rootHex}`);
  console.log('Use this Root to initialize your Midnight contract deployment.');
}

run();

import { readFileSync, writeFileSync } from 'node:fs';
const p = JSON.parse(readFileSync('package.json', 'utf8'));
p.version = '0.2.0';
writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n', 'utf8');
console.log('version:', p.version);
console.log('description ok:', p.description.includes('DeepSeek Harness'));
console.log('files ok:', Array.isArray(p.files) && p.files.includes('lib'));

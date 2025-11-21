import Database from '@replit/database';

const db = new Database();

const article = {
  title: 'Test Article',
  link: 'https://example.com/test',
  pubDate: 'Fri, 21 Nov 2025 07:32:57 +0000',
  source: 'Test',
  summary: 'This is a test summary',
  originalContent: '<p>Test content</p>',
  savedAt: new Date().toISOString()
};

console.log('Saving article...');
await db.set('article:test', article);
console.log('Article saved');

const retrieved = await db.get('article:test');
console.log('Retrieved:', retrieved ? 'SUCCESS' : 'FAILED');
if (retrieved) {
  console.log('Article data:', JSON.stringify(retrieved, null, 2));
}

const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  // Search for Moldova regions
  const moldovaSearch = await fetch('http://localhost:3001/api/regions/search?q=Moldova&limit=20');
  console.log('Moldova search results:');
  moldovaSearch.forEach(r => console.log(`  ${r.id}: ${r.name} - ${r.path || 'no path'}`));
}

main().catch(console.error);

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readCatalogueFromBranch, publishCatalogueToBranch } = require('../scripts/catalog-store.cjs');

const repo = { owner: 'example', repo: 'kuji' };
const content = JSON.stringify({ generatedAt: '2026-11-17T00:00:00Z', products: [{
  id: 'example', name: 'Example product', year: 2026, month: 11, ticketsPerSet: 70,
  method: 'browser', checkedAt: '2026-11-17T00:00:00Z',
  quantitySourceUrl: 'https://kujimap.com/1bankuji/1bankuji_202611/example'
}] });
const missing = () => Object.assign(new Error('missing'), { status: 404 });

function client(existing = false) {
  const calls = [];
  const capture = (name, result) => async (args) => { calls.push({ name, args }); return { data: result }; };
  return { calls, rest: {
    git: {
      getRef: async () => { if (!existing) throw missing(); return { data: { object: { sha: 'head' } } }; },
      createBlob: capture('blob', { sha: 'blob' }),
      createTree: capture('tree', { sha: 'tree' }),
      createCommit: capture('commit', { sha: 'commit' }),
      createRef: capture('ref', {})
    },
    repos: {
      getContent: async (args) => {
        calls.push({ name: 'read', args });
        if (!existing) throw missing();
        return { data: { type: 'file', encoding: 'base64', sha: 'previous-file', content: Buffer.from(content).toString('base64') } };
      },
      createOrUpdateFileContents: capture('update', {})
    }
  } };
}

test('initial data publication creates a separate root branch with only the JSON file', async () => {
  const github = client();
  await publishCatalogueToBranch(github, repo, content);
  assert.deepEqual(github.calls.map((call) => call.name), ['blob', 'tree', 'commit', 'ref']);
  const tree = github.calls.find((call) => call.name === 'tree').args;
  assert.deepEqual(tree.tree, [{ path: 'lot-quantities.json', mode: '100644', type: 'blob', sha: 'blob' }]);
  assert.equal(tree.base_tree, undefined);
  assert.deepEqual(github.calls.find((call) => call.name === 'commit').args.parents, []);
  assert.equal(github.calls.find((call) => call.name === 'ref').args.ref, 'refs/heads/catalog-data');
});

test('later collection changes only the data branch and avoids duplicate commits', async () => {
  const github = client(true);
  await publishCatalogueToBranch(github, repo, content);
  assert.equal(github.calls.filter((call) => call.name === 'update').length, 0);
  const updated = content.replace('"ticketsPerSet":70', '"ticketsPerSet":72');
  await publishCatalogueToBranch(github, repo, updated);
  const update = github.calls.find((call) => call.name === 'update').args;
  assert.equal(update.branch, 'catalog-data');
  assert.equal(update.path, 'lot-quantities.json');
  assert.equal(update.sha, 'previous-file');
  assert.equal(Buffer.from(update.content, 'base64').toString('utf8'), updated);
});

test('restore handles the first run but propagates permission and data errors', async () => {
  assert.equal(await readCatalogueFromBranch(client(), repo), null);
  const github = client(true);
  assert.equal(await readCatalogueFromBranch(github, repo), content);
  assert.equal(github.calls[0].args.ref, 'catalog-data');
  github.rest.repos.getContent = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
  await assert.rejects(readCatalogueFromBranch(github, repo), /forbidden/);
});

test('empty and malformed collection results cannot overwrite the published catalogue', async () => {
  const github = client(true);
  await assert.rejects(publishCatalogueToBranch(github, repo, '{'), SyntaxError);
  await assert.rejects(publishCatalogueToBranch(github, repo, JSON.stringify({ generatedAt: '2026-11-17', products: [] })), /empty/);
  assert.equal(github.calls.length, 0);
});

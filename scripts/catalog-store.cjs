const branch = 'catalog-data';
const path = 'lot-quantities.json';

function validateCatalogue(content) {
  const data = JSON.parse(content);
  if (!Number.isFinite(Date.parse(data.generatedAt)) || !Array.isArray(data.products) || !data.products.length) {
    throw new Error('Refusing to publish an empty or invalid catalogue');
  }
  for (const product of data.products) {
    if (!product.id || !product.name || product.method !== 'browser' ||
        !Number.isSafeInteger(product.ticketsPerSet) || product.ticketsPerSet < 1 || product.ticketsPerSet > 10000 ||
        !Number.isFinite(Date.parse(product.checkedAt)) || !product.quantitySourceUrl?.startsWith('https://kujimap.com/1bankuji/')) {
      throw new Error('Invalid catalogue product');
    }
  }
}

async function readCatalogueFromBranch(github, repo) {
  let result;
  try { result = await github.rest.repos.getContent({ ...repo, path, ref: branch }); }
  catch (error) { if (error.status === 404) return null; throw error; }
  if (result.data.type !== 'file' || result.data.encoding !== 'base64') throw new Error('Unexpected catalogue response');
  const content = Buffer.from(result.data.content, 'base64').toString('utf8');
  validateCatalogue(content);
  return content;
}

async function publishCatalogueToBranch(github, repo, content) {
  validateCatalogue(content);
  const encoded = Buffer.from(content).toString('base64');
  let exists = true;
  try { await github.rest.git.getRef({ ...repo, ref: `heads/${branch}` }); }
  catch (error) { if (error.status === 404) exists = false; else throw error; }
  const message = 'Update automatically collected lot quantities';
  if (!exists) {
    // Start a branch containing only the catalogue, with no copied source tree.
    const blob = await github.rest.git.createBlob({ ...repo, content: encoded, encoding: 'base64' });
    const tree = await github.rest.git.createTree({ ...repo, tree: [{ path, mode: '100644', type: 'blob', sha: blob.data.sha }] });
    const commit = await github.rest.git.createCommit({ ...repo, message, tree: tree.data.sha, parents: [] });
    await github.rest.git.createRef({ ...repo, ref: `refs/heads/${branch}`, sha: commit.data.sha });
    return;
  }
  let previous;
  try { previous = await github.rest.repos.getContent({ ...repo, path, ref: branch }); }
  catch (error) { if (error.status !== 404) throw error; }
  if (previous && previous.data.type !== 'file') throw new Error('Catalogue path is not a file');
  if (previous && Buffer.from(previous.data.content, 'base64').toString('utf8') === content) return;
  await github.rest.repos.createOrUpdateFileContents({ ...repo, path, branch, message, content: encoded,
    ...(previous ? { sha: previous.data.sha } : {}) });
}

module.exports = { readCatalogueFromBranch, publishCatalogueToBranch };

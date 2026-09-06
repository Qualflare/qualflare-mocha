'use strict';
const { qualflare } = require('../../../../../dist/index.cjs');

describe('basics', function () {
  it('passes', function () {});

  it('fails with a recognizable error message', function () {
    throw new Error('qualflare-mocha-integration-test-marker');
  });

  it('is skipped statically');

  it.skip('is explicitly skipped', function () {});

  it('runs after a skipped test', function () {});

  it('records metadata', async function () {
    qualflare.label('team', 'platform');
    qualflare.tag('smoke');
    qualflare.priority('high');
    qualflare.link('https://example.com/issue/42', { type: 'issue', name: 'QF-42' });
    qualflare.parameter('plan', 'pro');
    qualflare.parameter('apiKey', 'super-secret-value', { masked: true });
    await qualflare.step('outer', async function () {
      await qualflare.step('inner', function () {});
    });
  });

  it('attaches a note', function () {
    qualflare.attachment('note', 'hello from mocha', { mimeType: 'text/plain' });
  });

  it('skips an oversized attachment without failing', function () {
    qualflare.attachment('huge', 'x'.repeat(12_000_000));
  });
});

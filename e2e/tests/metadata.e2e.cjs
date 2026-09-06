'use strict';
const { qualflare } = require('../../dist/index.cjs');

describe('metadata api', function () {
  it('records the author-facing metadata API', function () {
    qualflare.label('team', 'platform');
    qualflare.link('https://github.com/Qualflare/qualflare-mocha', {
      type: 'custom',
      name: 'repository',
    });
    qualflare.tag('dogfood');
    qualflare.priority('high');
    qualflare.description('Exercises every metadata call in one case, so the verifier can assert them together.');
    qualflare.parameter('plan', 'enterprise');
  });

  it('nests steps', async function () {
    await qualflare.step('outer', async function () {
      await qualflare.step('inner', function () {
        qualflare.parameter('sku', 'widget');
      });
    });
  });

  it('masks a parameter without leaking its value', function () {
    // The verifier asserts this string appears NOWHERE in the payload — masking
    // happens at source, so absence from the whole file is the only real proof.
    qualflare.parameter('token', 'qf-dogfood-secret-value', { masked: true });
  });

  it('reports a plain passing test with no metadata at all', function () {
    // The baseline: a case carrying nothing must still land correctly.
  });
});

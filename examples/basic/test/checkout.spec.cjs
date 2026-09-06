'use strict';
const assert = require('node:assert');
const { qualflare } = require('@qualflare/mocha');

describe('checkout', function () {
  it('adds an item to the cart', async function () {
    qualflare.label('feature', 'checkout');
    qualflare.tag('smoke');
    qualflare.priority('high');
    qualflare.link('https://example.com/issue/42', { type: 'issue', name: 'QF-42' });

    await qualflare.step('add to cart', function () {
      qualflare.parameter('sku', 'widget');
      assert.strictEqual(1 + 1, 2);
    });
  });

  it('totals the cart', function () {
    assert.strictEqual(2 * 3, 6);
  });
});

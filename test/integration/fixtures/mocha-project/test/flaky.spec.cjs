'use strict';
let attempts = 0;

describe('retries', function () {
  this.retries(2);

  it('fails twice then passes', function () {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('flaky attempt ' + attempts);
    }
  });
});

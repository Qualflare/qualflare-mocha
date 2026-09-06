'use strict';
// A flaky test that ENDS GREEN. The suite must contain no failing tests: status
// mapping for failures is test/integration/'s job, and a red run here should
// mean the reporter/CLI seam broke, not that a fixture failed on purpose.
let attempts = 0;

describe('retries', function () {
  this.retries(1);

  it('fails once, then passes', function () {
    attempts += 1;
    if (attempts < 2) {
      // Mocha's EVENT_TEST_RETRY carries this message, with no opt-in — the
      // verifier asserts it survived into attempts[0].
      throw new Error('deliberate first-attempt failure');
    }
  });
});

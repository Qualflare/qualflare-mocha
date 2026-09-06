'use strict';
const { qualflare } = require('../../dist/index.cjs');

// A 1x1 PNG, so the attachment is a real image rather than something merely
// named one — the upload endpoint cross-checks the extension against the MIME
// type it is handed.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('attachments', function () {
  it('attaches a screenshot', function () {
    qualflare.attachment('screenshot', PNG_BASE64, { encoding: 'base64', mimeType: 'image/png' });
    qualflare.attachment('note', 'plain text attachment', { mimeType: 'text/plain' });
  });
});

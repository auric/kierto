# TLS test fixtures

These files give the fake Bitbucket server (`tests/support/fake-bitbucket.ts`) an HTTPS endpoint for the TLS tests.

- `ca.pem`: the certificate of a test CA, "review-loop test CA". The tests pass it as the custom CA file.
- `server.pem`: the server certificate for 127.0.0.1 and localhost, signed by the test CA.
- `server.key`: the private key of `server.pem`.

`server.key` is a test key. It was generated for these tests and protects nothing. It is not a secret. If GitHub secret scanning reports it, close the alert as "used in tests".

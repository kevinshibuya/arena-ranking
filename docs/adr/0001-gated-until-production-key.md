# Gated behind one shared basic-auth credential until Riot grants a production key

The site is meant to be Open: the ladder and the Riot ID search answer anyone, with no account. Riot's terms forbid public use of a development or personal key, and a revoked key would stop the crawl, so until Riot approves a production key for this product the whole site sits behind one basic-auth credential in Caddy, shared by the two people working on it. The production key is applied for against the gated deployment; removing the `basic_auth` block is the only step from Gated to Open.

## Considered options

- Open on the development key: risks the key and the project on a rule Riot enforces.
- Wait for the production key before deploying: weeks of lost crawl, and nothing for Riot's reviewer to look at.

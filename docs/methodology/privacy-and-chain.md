# Privacy, integrity and chain decision

The public MVP contains only anonymous building IDs, approximate city location
and small derived daily excerpts. It excludes exact addresses, customer meter
identifiers and private load histories.

The browser calculates locally. No account, analytics SDK, data warehouse or
blockchain receives interval values. Public attestations reveal period totals
and cryptographic commitments; a private disclosure package can reveal selected
intervals and Merkle paths.

## Why zero knowledge and Daml are deferred

Zero-knowledge proofs may later prove statements such as “same-site renewable
share exceeded a threshold” without disclosing the load curve. Before that is
valuable, GreenProof must know the exact statement, verifier, circuit inputs and
trusted measurement boundary. Adding a circuit now would hard-code an untested
claim and increase audit cost.

Daml is useful for privacy-aware multi-party workflows and contractual state.
This MVP has no bilateral settlement workflow or participant ledger, so Daml
would not solve the immediate evidence-validation problem.

## Chain gate

The application includes only `NoopAnchorProvider`. A local/testnet anchor spike
should proceed only when a pilot requires third-party timestamping and approves
the disclosure model. Any future chain transaction should contain only a salted
batch identifier, Merkle root, previous root and schema version. A chain can
prove commitment order and immutability after submission; it cannot prove that a
meter or upstream model was truthful.

# Releases are built on the Mac and shipped over SSH; no registry, no CI, no build on the box

The box is a 2 vCPU Always Free A1 that also runs other services, and the project has one operator. Images are built for `linux/arm64` on the Mac from a clean, committed tree, named by the short commit SHA, and moved with `docker save`, `scp` and `docker load`; the stack files reach the box the same way, from `git archive` of the tagged commit. There is no image registry, no CI pipeline and no toolchain on the box.

## Considered options

- Build on the box: a Node toolchain and build cache beside the other services' memory and disk, on a box that must not be pruned.
- A registry (GHCR, Docker Hub): a credential on the box, a public or paid namespace, and a pull path to secure, for one operator shipping a few images a week.
- CI-built images: a deploy that can run without the operator's Mac, worth revisiting when there is a second operator.

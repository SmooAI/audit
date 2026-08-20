---
'@smooai/audit': patch
---

Gate each registry's publish on that registry, not on a parsed stdout flag

Every non-npm publish step was gated on `steps.changesets.outputs.published`, which changesets/action derives by parsing publish stdout. That fails open two ways, both seen for real on 2026-08-20: if npm published in an earlier run, a retry finds nothing new so the flag is false and all four remaining registries skip — a green run that ships nothing; and `@changesets/cli` 3.x renamed the very line the action parses, which silently switched every non-npm publish off in a sibling repo while its releases stayed green.

Each step now gates on whether its own registry already carries `package.json`'s version, so a retry publishes exactly what is missing, and a final step fails the run if npm shipped a version the others didn't. NuGet is reported but not asserted — its index lags an accepted push by minutes to tens of minutes, and a guard that reddens successful releases gets deleted.

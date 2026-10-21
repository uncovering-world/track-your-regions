"""Whether the loader image carries the versions db/requirements.txt pins (#1782).

The image takes its packages from its base and from apt, unpinned, and the
dependency audit reads db/requirements.txt instead of the image. Run during the
image's build, this fails the build where the two disagree. CI does not build
this image: the check runs where `npm run db:load-gadm` builds it, so a bump of
the base tag that leaves the pins behind is caught at the next load, not by the
pull request's audit.
"""

import importlib.metadata
import sys


def pins(text: str) -> dict[str, str]:
    """The `name==version` lines of a requirements file, comments and blanks skipped."""
    pinned: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line:
            continue
        name, sep, version = line.partition("==")
        if not sep:
            raise ValueError(f"not pinned with ==: {line}")
        pinned[name.strip()] = version.strip()
    return pinned


def mismatches(pinned: dict[str, str], installed: dict[str, str | None]) -> list[str]:
    """One line per pin the installed version does not match, in the file's order."""
    return [
        f"{name}: pinned {version}, installed {installed.get(name) or 'nothing'}"
        for name, version in pinned.items()
        if installed.get(name) != version
    ]


def installed_versions(names: list[str]) -> dict[str, str | None]:
    found: dict[str, str | None] = {}
    for name in names:
        try:
            found[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            found[name] = None
    return found


def main(path: str) -> int:
    with open(path, encoding="utf-8") as handle:
        pinned = pins(handle.read())
    wrong = mismatches(pinned, installed_versions(list(pinned)))
    for line in wrong:
        print(f"db/requirements.txt does not match the image: {line}", file=sys.stderr)
    return 1 if wrong else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))

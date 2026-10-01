# ADR-0080: The repository's workflows are skills both agents read from one copy

**Date:** 2026-10-01
**Status:** Accepted

---

## Context

The repository's workflows were 23 Claude Code commands in `.claude/commands/*.md`: `/feature`,
`/commit`, `/pr-create` and the rest. They encode the conventions the development guide asks
for.

A second agent, OpenAI's Codex, can work on the repository too:

- It reads `AGENTS.md`, which has been a symlink to `CLAUDE.md` since #797.
- It reads repository skills from `.agents/skills/<name>/SKILL.md`, the Agent Skills format.
- A Codex import on 2026-09-16 left untracked copies of five commands there. They were frozen
  at that date, already differed from the commands, and the other eighteen were missing.

Four facts, checked on 2026-10-01, shape the decision:

- **Claude Code reads the same format.** It reads `SKILL.md` from `.claude/skills/<name>/`. A
  skill there answers `/<name> args` as a command did, and wins over a command of the same name.
  It does not read `.agents/skills/` (code.claude.com/docs/en/skills).
- **A skill substitutes positional arguments.** `$ARGUMENTS` is substituted, and so are `$0`,
  `$1` and so on. Three commands held such text that was not an argument: the `$0` of an `awk`
  line in `/commit`, and the `$1, $2` of SQL placeholders in the security checks. On 2026-09-30, `/commit`
  called with an argument already received a mangled `awk` line.
- **Codex follows symlinks per skill, not for the whole root.** Codex once found no skills when
  `.agents/skills` itself was a symlink (openai/codex#11314); it reads a skill directory that is
  a symlink inside a real `.agents/skills/`.
- **The review bot only protects `.claude/`.** It runs claude-code-action, which restores
  `.claude/` and `CLAUDE.md` from `main` before reviewing a pull request, so a pull request cannot
  rewrite the instructions it is reviewed by. Files that lived only under `.agents/` would not be
  restored.

## Decision

1. **A workflow is a skill**, `.claude/skills/<name>/SKILL.md`, with `name` and `description`
   frontmatter. This is the only copy. The 23 commands move there unchanged in substance, and
   `.claude/commands/` goes.
2. **Codex reads the same files through links.** `.agents/skills/` is a real directory holding
   one symlink per skill (`<name>` → `../../.claude/skills/<name>`). The copies the Codex import
   left are removed.
3. **The files stay under `.claude/`** so the review bot's restore covers them. The opposite
   arrangement, files in `.agents/` linked from `.claude/skills`, would let a pull request edit
   what the bot reads.
4. **A skill is written so either agent can follow it.** `CLAUDE.md` (which Codex reads as
   `AGENTS.md`) § Skills for other agents states once:
   - how to read `$ARGUMENTS`;
   - what an agent without a Claude Code tool does in its place;
   - that a skill's text never holds `$` followed by a digit.

## Alternatives Considered

| Option | Why rejected |
|--------|-------------|
| Keep commands for Claude Code and generate skills for Codex | Two copies and a generator to keep them equal; the import of 2026-09-16 shows how fast a copy drifts |
| Real files in `.agents/skills/`, `.claude/skills` a symlink to it | claude-code-action restores `.claude/` from `main`, not `.agents/`; the bot would read the pull request's own skills through the link |
| `.agents/skills` as one symlink to `.claude/skills` | Codex did not discover skills through a symlinked root (openai/codex#11314); per-skill links inside a real directory are the shape it reads |
| Rewrite every skill in an agent-neutral voice | Most steps are already agent-neutral (`gh`, `git`, `npm`); the few Claude Code tool names are mapped once in `CLAUDE.md` instead of edited in 23 files |

## Consequences

**Positive:**
- **Each workflow has one copy.** Both agents read the same text, and a skill edited in a pull
  request is reviewed against `main`'s version of the skills.
- **Every workflow now has a `description`,** which both agents use to pick a skill when the
  user does not name one.

**Negative / Trade-offs:**
- **A new skill needs its link** in `.agents/skills/`. `CLAUDE.md` says so, and a missing link
  only hides the skill from Codex.
- **The symlinks are git symlinks.** A checkout on a system without symlink support gets text
  files instead. The project's toolchain is Linux and macOS.
- **Skill text must avoid `$` followed by a digit.** Shell and SQL examples are written around
  it (`awk 'length > 72 { … }'`, "numbered placeholders").

## References

- Related ADRs: ADR-0079 (one home per kind of information; the skills are where workflows live)
- Related docs: `CLAUDE.md` § Skills for other agents, `docs/tech/development-guide.md` § Slash Commands
- Issues: #1181, #797 (`AGENTS.md`)

# Create GitHub Issue

Create a new GitHub issue from a text description. Automatically determines whether it's a bug or a feature and applies appropriate labels.

## Arguments

$ARGUMENTS — required: a description of the issue or feature request, in plain language.

## Instructions

### 1. Parse the description

Read the text in $ARGUMENTS. It may be informal, contain typos, or be brief — that's fine.

Determine the type:
- **Bug** if it describes something broken, wrong, or not working as expected
- **Feature** if it describes something new to build, add, or improve
- **Refactoring** if it describes restructuring existing code without changing behavior

### 2. Draft the issue

Create a well-structured GitHub issue from the description:

**Title**: A clear, concise title (imperative form for features: "Add X", "Support Y"; descriptive for bugs: "X fails when Y", "Broken Z on page W")

**Body**: Structure the body based on type:

For **bugs**:
```markdown
## Description
{Clear description of the bug, expanded from the user's text}

## Steps to Reproduce
{If the user mentioned steps, list them. Otherwise write "To be determined."}

## Expected Behavior
{What should happen}

## Actual Behavior
{What happens instead}
```

For **features**:
```markdown
## Description
{Clear description of what should be built, expanded from the user's text}

## Requirements
{Extract specific requirements as a checklist. If the description is vague, create reasonable requirements and note they need review.}

- [ ] Requirement 1
- [ ] Requirement 2
```

For **refactoring**:
```markdown
## Description
{Clear description of what should be restructured and why}

## Scope
- [ ] Item 1
- [ ] Item 2
```

**Labels**: Pick from existing labels:
- Type: `bug`, `enhancement`, or `refactoring`
- Area (if obvious): `front`, `back`, `API`, `deploy`

### 3. Show the draft to the user

Display the full issue (title, body, labels) and **ask for confirmation** before creating it. The user may want to adjust the wording.

### 4. Create the issue

After the user confirms:

```bash
gh issue create --title "<title>" --body "<body>" --label "<label1>,<label2>"
```

Use a HEREDOC for the body to handle multi-line content and special characters:

```bash
gh issue create --title "<title>" --label "<labels>" --body "$(cat <<'EOF'
<body content>
EOF
)"
```

### 5. Report

Show the created issue number and URL.

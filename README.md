# Attach to Trello Card action

This action looks for a Trello card URL in the start of a Pull Request description.  If found, will push an attachment to Trello (for use by Trello Github Power-Up).  Optionally, this can be configured to also attach a (redundant) PR comment with link/name, similar to what the Trello Power-up will do, for actions that expect that to be present.

## Inputs/Outputs

This requires Trello key+token to be supplied from workflow where used (The token, at least, should come from repo Secrets).

## Example workflow config:
```yml
name: Attach to Trello
on:
  pull_request:
    types: [opened, reopened, edited]
jobs:
  attach-trello:
    runs-on: ubuntu-latest
    name: Find trello link and attach to card
    steps:
      - uses: delivered/attach-to-trello-card-action@master
        with:
          trello-key: ${{ secrets.TRELLO_KEY }}
          trello-token: ${{ secrets.TRELLO_TOKEN }}
          ## optional
          # add-pr-comment: true
          ## required if add-pr-comment is true.  secrets.GITHUB_TOKEN is supplied by GH action implicitly.
          # repo-token: ${{ secrets.GITHUB_TOKEN }}
```


# Attach to Trello Card action

The purpose of this action is to enable attaching a pull request to Trello cards, from within the PR body.  This is best used with the Trello [Github Power-Up](https://trello.com/power-ups/55a5d916446f517774210004) added to your Trello Boards.  With that enabled, this effectively enables the "Attach Pull Request" action of the Power-Up, but from the Github side (and via a quick URL copy-paste instead of clicking through menus).

The action looks for Trello card URLs at the start of a Pull Request description.  If found, it will add the PR URL as an attachment to each specified card in Trello.

Optionally, this can be configured to also attach (redundant) PR comments with card links/names, similar to what the Trello Power-up will do, for use cases requiring that.

## Changes in this fork

Jetabroad forked this for the following reasons:

- Major update of dependencies
- We wanted different, incompatible "link-finding" logic from the original project:
    - This fork will find all trello links in the PR body, regardless of position.

## Link-Finding
Both the short-form (from the "Link to this card" field provided by a card's "Share" button) or long-form (cmd/ctrl+c with card open, copy from url bar with card open, etc.) are supported.

So, for :
```text
https://trello.com/c/aaaaaaaa

https://trello.com/c/bbbbbbbbb/111-qqqqqqqqqqqq
This PR impl's the above 2 features.  These work similarly to feature https://trello.com/c/ccccccccc.  
The below is a random trello url put in this body, for some reason:
https://trello.com/c/dddddddd
```

The cards `aaaaaaaa`, `bbbbbbbbb`, `ccccccccc`, and `dddddddd` will have the PR attached.

## Events

Workflows using this action should include some/all of the following supported event types: 
- `pull_request.opened`
- `pull_request.reopened`
- `pull_request.edited`

Unsupported actions are ignored.


## Inputs/Outputs

This requires Trello key and token to be supplied from the workflow where used.  The token, at least, should come from repo Secrets.  

There are no outputs.


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
      - uses: jetabroad/attach-to-trello-card-action@master  # consider pinning this to a known release.
        with:
          trello-key: ${{ secrets.TRELLO_KEY }}
          trello-token: ${{ secrets.TRELLO_TOKEN }}
          
          ## optional
          # add-pr-comment: true
          ## required if add-pr-comment is true.  secrets.GITHUB_TOKEN is supplied by GH action implicitly.
          # repo-token: ${{ secrets.GITHUB_TOKEN }}
```

## Development Notes
# Incrementing version
1. Update version in package.json (format should be `X.X.X`, per semver)
1. Commit/push changes
1. Create release (and publish to marketplace) - use 'v'-prepended format for new tag and release name
